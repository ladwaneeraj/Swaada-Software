import {
  onSnapshot,
  query,
  where,
  type DocumentData,
  type Query,
  type Unsubscribe,
} from 'firebase/firestore'
import {
  billsCol,
  categoriesCol,
  customerRef,
  itemsCol,
  modifierGroupsCol,
  ordersCol,
  outletRef,
  settingsRef,
  staffCol,
  stationsCol,
  tablesCol,
  walletEntriesCol,
} from './paths'
import { splitModifierGroups } from './converters'
import { ACTIVE_ORDER_STATUSES } from '../rules'
import { todayBusinessDate } from '@/lib/businessDate'
import type {
  Bill,
  CafeSettings,
  Customer,
  LiveSnapshot,
  Order,
  UserRole,
  WalletEntry,
} from '@/types'

/**
 * The listeners that keep the app live, and the reason the read bill stays
 * near zero.
 *
 * The prototype held every order ever taken in memory. Against Firestore
 * that would mean re-downloading the cafe's whole history on every app
 * start, which gets slower and dearer every day it trades. So nothing is
 * held that is not needed right now:
 *
 *   CONFIG   menu, tables, stations, staff, settings. A few hundred small
 *            documents that change once a week. After the first load these
 *            come from the local cache and cost nothing.
 *   LIVE     orders that are not settled yet. Bounded by how many tables are
 *            occupied, so typically under thirty.
 *   TODAY    today's bills and wallet movements, for the day-end figures.
 *   GUESTS   the customer records and full wallet ledgers of the guests
 *            actually sitting in the cafe right now, attached and detached
 *            as tables fill and clear. A balance is the sum of a guest's
 *            WHOLE ledger, not just today's, so the settle sheet needs it
 *            in full — but only for the handful of guests in play.
 *
 * History, analytics and customer search attach no listeners at all. They
 * run paged queries on demand (queries.ts), so last month's numbers cost one
 * query when someone opens them instead of being carried around all day.
 *
 * Listeners are also scoped BY ROLE, to match what the security rules allow.
 * A kitchen login that tried to listen to bills would be denied by the
 * server; not attaching is how the client stays honest about that.
 */

export type SnapshotPatch = Partial<LiveSnapshot>

export interface SyncHandlers {
  patch: (patch: SnapshotPatch) => void
  /** Called with the scopes that have delivered their first snapshot. */
  hydrated: (scope: SyncScope) => void
  /** fromCache / hasPendingWrites, for the connection badge. */
  meta: (meta: { fromCache: boolean; hasPendingWrites: boolean }) => void
  error: (scope: SyncScope, error: unknown) => void
}

export type SyncScope = 'config' | 'live' | 'today' | 'staff'

/** What each role is allowed to see, matching firestore.rules. */
function scopesForRole(role: UserRole): Set<SyncScope> {
  if (role === 'kitchen') return new Set<SyncScope>(['config', 'live'])
  if (role === 'counter') return new Set<SyncScope>(['config', 'live', 'today'])
  return new Set<SyncScope>(['config', 'live', 'today', 'staff'])
}

export function startSync(
  outletId: string,
  role: UserRole,
  handlers: SyncHandlers,
): Unsubscribe {
  const scopes = scopesForRole(role)
  const subs: Unsubscribe[] = []
  /** Guest ledger listeners, keyed by customer id. */
  const guestSubs = new Map<string, Unsubscribe[]>()
  let disposed = false

  const watch = <T,>(
    scope: SyncScope,
    ref: Query<T, DocumentData>,
    apply: (rows: T[]) => SnapshotPatch,
    options: { meta?: boolean } = {},
  ): void => {
    let first = true
    subs.push(
      onSnapshot<T, DocumentData>(
        ref,
        { includeMetadataChanges: options.meta ?? false },
        (snap) => {
          if (disposed) return
          handlers.patch(apply(snap.docs.map((d) => d.data())))
          if (options.meta) {
            handlers.meta({
              fromCache: snap.metadata.fromCache,
              hasPendingWrites: snap.metadata.hasPendingWrites,
            })
          }
          if (first) {
            first = false
            handlers.hydrated(scope)
          }
        },
        (error) => handlers.error(scope, error),
      ),
    )
  }

  /* ------------------------------ config ------------------------------ */

  subs.push(
    onSnapshot(
      outletRef(outletId),
      (snap) => handlers.patch({ outlet: snap.data() ?? null }),
      (error) => handlers.error('config', error),
    ),
  )

  subs.push(
    onSnapshot(
      settingsRef(outletId),
      (snap) => {
        const settings = snap.data()
        if (settings) handlers.patch({ settings })
        handlers.hydrated('config')
      },
      (error) => handlers.error('config', error),
    ),
  )

  watch('config', stationsCol(outletId), (stations) => ({ stations }))
  watch('config', categoriesCol(outletId), (categories) => ({ categories }))
  watch('config', itemsCol(outletId), (items) => ({ items }))
  watch('config', tablesCol(outletId), (tables) => ({ tables }))
  watch('config', modifierGroupsCol(outletId), (stored) => splitModifierGroups(stored))

  if (scopes.has('staff')) {
    watch('staff', staffCol(outletId), (staff) => ({ staff }))
  }

  /* ------------------------------- live -------------------------------- */

  /**
   * Unsettled rounds. `status in [...]` uses the automatic single-field
   * index, so this needs no composite index and no orderBy; the set is
   * small enough that the screens sort it themselves.
   */
  const liveOrders = query(
    ordersCol(outletId),
    where('status', 'in', [...ACTIVE_ORDER_STATUSES]),
  )

  /**
   * Today's cancelled rounds, so the kitchen is told rather than left to
   * notice a ticket disappearing. Scoped to one business day, so it stays a
   * handful of documents however long the cafe has been open.
   */
  const cancelledToday = query(
    ordersCol(outletId),
    where('businessDate', '==', todayBusinessDate()),
    where('status', '==', 'cancelled'),
  )
  watch('live', cancelledToday, (recentlyCancelled: Order[]) => ({ recentlyCancelled }))

  let lastGuestIds = ''
  watch(
    'live',
    liveOrders,
    (orders: Order[]) => {
      // Follow the guests who are actually seated, and only them.
      const ids = [...new Set(orders.map((o) => o.customerId).filter((id): id is string => !!id))]
      const key = ids.sort().join(',')
      if (key !== lastGuestIds) {
        lastGuestIds = key
        syncGuests(ids)
      }
      return { orders }
    },
    { meta: true },
  )

  /* ------------------------------- today ------------------------------- */

  if (scopes.has('today')) {
    const today = todayBusinessDate()
    watch('today', query(billsCol(outletId), where('businessDate', '==', today)), (bills: Bill[]) => ({
      bills,
    }))
    watch(
      'today',
      query(walletEntriesCol(outletId), where('businessDate', '==', today)),
      (entries: WalletEntry[]) => ({ walletEntries: mergeWallet('today', entries) }),
    )
  } else {
    handlers.hydrated('today')
  }

  /* ------------------------------ guests ------------------------------- */

  /**
   * Wallet entries arrive from two places: today's movements (for the
   * day-end totals) and each seated guest's full ledger (for their balance).
   * They are merged by id so an entry that is in both appears once.
   */
  const walletBuckets = new Map<string, WalletEntry[]>()
  function mergeWallet(bucket: string, entries: WalletEntry[]): WalletEntry[] {
    walletBuckets.set(bucket, entries)
    const byId = new Map<string, WalletEntry>()
    for (const list of walletBuckets.values()) {
      for (const entry of list) byId.set(entry.id, entry)
    }
    return [...byId.values()]
  }

  const guestCustomers = new Map<string, Customer>()
  function publishGuests(): void {
    handlers.patch({ customers: [...guestCustomers.values()] })
  }

  function syncGuests(ids: string[]): void {
    if (!scopes.has('today')) return
    const wanted = new Set(ids)

    for (const [id, unsubs] of guestSubs) {
      if (wanted.has(id)) continue
      unsubs.forEach((u) => u())
      guestSubs.delete(id)
      guestCustomers.delete(id)
      walletBuckets.delete(`guest:${id}`)
    }

    for (const id of wanted) {
      if (guestSubs.has(id)) continue
      const unsubs: Unsubscribe[] = [
        onSnapshot(
          customerRef(outletId, id),
          (snap) => {
            const customer = snap.data()
            if (customer) guestCustomers.set(id, customer)
            else guestCustomers.delete(id)
            publishGuests()
          },
          (error) => handlers.error('today', error),
        ),
        onSnapshot(
          query(walletEntriesCol(outletId), where('customerId', '==', id)),
          (snap) => {
            handlers.patch({
              walletEntries: mergeWallet(
                `guest:${id}`,
                snap.docs.map((d) => d.data()),
              ),
            })
          },
          (error) => handlers.error('today', error),
        ),
      ]
      guestSubs.set(id, unsubs)
    }
    publishGuests()
  }

  return () => {
    disposed = true
    subs.forEach((u) => u())
    guestSubs.forEach((unsubs) => unsubs.forEach((u) => u()))
    guestSubs.clear()
  }
}

/** Starting point before anything has loaded. */
export function emptySnapshot(settings: CafeSettings): LiveSnapshot {
  return {
    outlet: null,
    categories: [],
    items: [],
    modifierGroups: [],
    modifierOptions: [],
    stations: [],
    tables: [],
    orders: [],
    recentlyCancelled: [],
    bills: [],
    walletEntries: [],
    customers: [],
    staff: [],
    settings,
  }
}
