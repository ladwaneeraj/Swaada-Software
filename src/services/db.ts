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

/** Shape every stored snapshot is measured against. Built once. */
const DEFAULT_SETTINGS = seedSnapshot().settings

/**
 * The app gains fields over time (sound alerts, customer accounts, ...).
 * Filling the missing ones in on read keeps a cafe's existing orders and
 * bills usable instead of forcing a schema bump that would wipe them.
 *
 * Anything added here must be additive and default to "as it was before",
 * so an older snapshot reads exactly the way it did when it was written.
 */
function withDefaults(parsed: DBSnapshot): DBSnapshot {
  const stored = parsed.settings ?? DEFAULT_SETTINGS
  const bills = parsed.bills ?? []
  return {
    ...parsed,
    // Bills predating customer accounts were paid in full at the counter.
    bills: bills.map((b) => ({
      ...b,
      walletApplied: b.walletApplied ?? 0,
      creditAmount: b.creditAmount ?? 0,
      walletTopUp: b.walletTopUp ?? 0,
    })),
    customers: parsed.customers ?? customersFromBills(bills),
    walletEntries: parsed.walletEntries ?? [],
    settings: {
      ...DEFAULT_SETTINGS,
      ...stored,
      sound: { ...DEFAULT_SETTINGS.sound, ...stored.sound },
      wallet: { ...DEFAULT_SETTINGS.wallet, ...stored.wallet },
    },
  }
}

/**
 * Before customer accounts existed, a guest was just a name and number
 * copied onto each bill. Promote those into real records so a returning
 * guest is recognised on the first day of the upgrade rather than the
 * second, with no wallet history (they never had one).
 */
function customersFromBills(bills: DBSnapshot['bills']): DBSnapshot['customers'] {
  const byPhone = new Map<string, DBSnapshot['customers'][number]>()
  for (const bill of bills) {
    const phone = (bill.customerPhone ?? '').replace(/\D/g, '').slice(-10)
    if (phone.length !== 10) continue
    const existing = byPhone.get(phone)
    if (existing) {
      if (bill.customerName) existing.name = bill.customerName
      existing.updatedAt = bill.settledAt
      continue
    }
    byPhone.set(phone, {
      id: `cus-${phone}`,
      phone,
      name: bill.customerName || 'Guest',
      createdAt: bill.settledAt,
      updatedAt: bill.settledAt,
    })
  }
  return [...byPhone.values()]
}

function loadInitial(): DBSnapshot {
  const fresh = seedSnapshot()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as DBSnapshot
      if (parsed.schemaVersion === fresh.schemaVersion) {
        const migrated = withDefaults(parsed)
        // Write the filled-in shape straight back, so other tabs reading
        // localStorage never see a snapshot missing the newer fields.
        persist(migrated)
        return migrated
      }
    }
  } catch {
    // Corrupt or unavailable storage: fall through to a fresh seed.
  }
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
      snapshot = withDefaults(JSON.parse(raw) as DBSnapshot)
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
