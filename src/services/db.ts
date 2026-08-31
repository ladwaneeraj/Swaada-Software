import { seedSnapshot } from '@/data/seed'
import type { DBSnapshot, RealtimeEvent } from '@/types'
import { realtime } from './realtime'

/**
 * The mock "database": a single snapshot persisted to localStorage and
 * kept in sync across tabs through the realtime channel.
 *
 * Services mutate ONLY through db.mutate(). Each mutation:
 *   1. clones the snapshot (so React sees new references),
 *   2. applies the change,
 *   3. persists to localStorage,
 *   4. notifies this tab's listeners,
 *   5. broadcasts the domain event(s) to other tabs.
 *
 * Other tabs re-read localStorage on any event, so localStorage is the
 * single source of truth — exactly the role a real database takes later.
 */

const STORAGE_KEY = 'swaada.db.v1'

type Listener = (snapshot: DBSnapshot) => void

function loadInitial(): DBSnapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as DBSnapshot
      if (parsed.schemaVersion === seedSnapshot().schemaVersion) return parsed
    }
  } catch {
    // Corrupt or unavailable storage: fall through to a fresh seed.
  }
  const fresh = seedSnapshot()
  persist(fresh)
  return fresh
}

function persist(snapshot: DBSnapshot): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    // Storage full/unavailable: keep running in memory.
  }
}

let snapshot: DBSnapshot = loadInitial()
const listeners = new Set<Listener>()

function notify(): void {
  listeners.forEach((l) => l(snapshot))
}

/** Re-read persisted state (used when another tab writes). */
function reloadFromStorage(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      snapshot = JSON.parse(raw) as DBSnapshot
      notify()
    }
  } catch {
    // Ignore and keep the in-memory copy.
  }
}

realtime.subscribe(() => reloadFromStorage())

// Fallback sync for browsers where BroadcastChannel is unavailable.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) reloadFromStorage()
  })
}

export const db = {
  get(): DBSnapshot {
    return snapshot
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },

  /**
   * Apply a mutation. The mutator edits the draft in place and returns the
   * realtime event(s) describing what happened.
   */
  mutate(mutator: (draft: DBSnapshot) => RealtimeEvent | RealtimeEvent[] | void): void {
    const draft = structuredClone(snapshot)
    const result = mutator(draft)
    snapshot = draft
    persist(snapshot)
    notify()
    const events = result === undefined ? [] : Array.isArray(result) ? result : [result]
    events.forEach((e) => realtime.publish(e))
  },

  /** Wipe and re-seed (Settings → reset demo data). */
  reset(): void {
    snapshot = seedSnapshot()
    persist(snapshot)
    notify()
    realtime.publish({ type: 'MENU_UPDATED' })
    realtime.publish({ type: 'TABLES_UPDATED' })
    realtime.publish({ type: 'SETTINGS_UPDATED' })
  },
}
