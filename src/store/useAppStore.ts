import { create } from 'zustand'
import type { Unsubscribe } from 'firebase/firestore'
import {
  authService,
  DEFAULT_SETTINGS,
  primeSequences,
  setCatalogueSource,
  setServiceSession,
} from '@/services'
import { emptySnapshot, startSync, type SyncScope } from '@/services/firebase/sync'
import { AppError, toAppError } from '@/lib/errors'
import { identifyForMonitoring, reportError } from '@/lib/monitoring'
import type { ConnectionStatus, LiveSnapshot, Session } from '@/types'

/**
 * The single store every screen reads from.
 *
 * `db` holds what is happening in the cafe right now — the menu, the floor,
 * unsettled rounds, today's money. It does NOT hold history; see
 * LiveSnapshot for why, and services/firebase/queries.ts for how history is
 * read instead.
 *
 * Auth drives everything. When a session appears the listeners start; when
 * it goes away they stop and the snapshot is wiped, so signing out actually
 * clears the data rather than leaving it on screen behind a redirect.
 *
 * The role in the session decides which listeners attach at all, matching
 * what the security rules allow. A kitchen login does not subscribe to bills
 * because the server would refuse it.
 */

interface AppState {
  db: LiveSnapshot
  session: Session | null
  /** False until Firebase has told us whether anyone is signed in. */
  authReady: boolean
  connection: ConnectionStatus
  /** Which listener groups have delivered their first snapshot. */
  hydrated: Record<SyncScope, boolean>
  /** Set when a listener is refused, usually a rules problem worth seeing. */
  syncError: string | null

  signIn: (username: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const NO_SCOPES: Record<SyncScope, boolean> = {
  config: false,
  live: false,
  today: false,
  staff: false,
}

export const useAppStore = create<AppState>((set, get) => ({
  db: emptySnapshot(DEFAULT_SETTINGS),
  session: null,
  authReady: false,
  connection: 'live',
  hydrated: { ...NO_SCOPES },
  syncError: null,

  /**
   * Signing in has two ways to fail, and they need different words.
   *
   * The password can be wrong, which Firebase says immediately. Or the
   * password can be RIGHT while the account has no staff record, or has been
   * switched off — in which case Firebase is perfectly happy and the app
   * still cannot let them in. Without this wait, that second case looks like
   * a login screen that quietly does nothing when you press the button.
   */
  signIn: async (username, password) => {
    await authService.signIn(username, password)

    const session = await waitForSession(5000)
    if (!session) {
      const reason = await authService.explainMissingSession()
      await authService.signOut()
      throw new AppError(reason, 'auth/no-staff-record')
    }
  },

  signOut: async () => {
    await authService.signOut()
    set({ db: emptySnapshot(get().db.settings), hydrated: { ...NO_SCOPES } })
  },
}))

/**
 * Wait for the session listener to produce a session, or give up.
 *
 * The listener has to do two reads (the outlet index, then the staff
 * document) before it can answer, so there is a real gap between a
 * successful password check and knowing whether this person is allowed in.
 */
function waitForSession(timeoutMs: number): Promise<Session | null> {
  const current = useAppStore.getState().session
  if (current) return Promise.resolve(current)

  return new Promise((resolve) => {
    const done = (value: Session | null) => {
      window.clearTimeout(timer)
      unsubscribe()
      resolve(value)
    }
    const timer = window.setTimeout(() => done(null), timeoutMs)
    const unsubscribe = useAppStore.subscribe((state) => {
      if (state.session) done(state.session)
    })
  })
}

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */

let stopSync: Unsubscribe | null = null
let syncedFor = ''

/** Services read the current snapshot through this rather than being passed it. */
setCatalogueSource(() => useAppStore.getState().db)

function teardown(): void {
  stopSync?.()
  stopSync = null
  syncedFor = ''
}

authService.watchSession((session) => {
  setServiceSession(session)
  identifyForMonitoring(session)
  useAppStore.setState({ session, authReady: true })

  if (!session) {
    teardown()
    useAppStore.setState({
      db: emptySnapshot(DEFAULT_SETTINGS),
      hydrated: { ...NO_SCOPES },
      syncError: null,
    })
    return
  }

  // A token refresh fires this handler every hour with the same user. Only
  // rebuild the listeners when the outlet or the role actually changed.
  const key = `${session.outletId}:${session.role}`
  if (key === syncedFor) return
  teardown()
  syncedFor = key
  useAppStore.setState({ hydrated: { ...NO_SCOPES }, syncError: null })

  stopSync = startSync(session.outletId, session.role, {
    patch: (patch) => useAppStore.setState((state) => ({ db: { ...state.db, ...patch } })),

    hydrated: (scope) =>
      useAppStore.setState((state) => ({ hydrated: { ...state.hydrated, [scope]: true } })),

    meta: ({ fromCache, hasPendingWrites }) => {
      // Pending writes beat a cache read: "syncing" tells the cashier their
      // last action is on its way up, which is the more useful fact.
      const connection: ConnectionStatus = hasPendingWrites
        ? 'syncing'
        : fromCache
          ? 'offline'
          : 'live'
      if (useAppStore.getState().connection !== connection) {
        useAppStore.setState({ connection })
      }
    },

    error: (scope, error) => {
      const appError = toAppError(error, 'Lost the live connection.')
      // A refused listener almost always means the rules and the client
      // disagree about what a role may read, which is worth a report.
      reportError(error, { scope, outletId: session.outletId, role: session.role })
      useAppStore.setState({ syncError: `${scope}: ${appError.userMessage}` })
    },
  })

  // Reserve number blocks now so the first order of the day never waits on a
  // round trip, and so the device can keep billing if the wifi drops later.
  void primeSequences(session.outletId).catch(() => {
    /* offline at login: the blocks fill on the first order instead */
  })
})

/** True once the screens have enough to draw without flashing empty state. */
export function useAppReady(): boolean {
  return useAppStore((s) => s.authReady && (!s.session || (s.hydrated.config && s.hydrated.live)))
}
