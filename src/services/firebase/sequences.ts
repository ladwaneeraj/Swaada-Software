import { runTransaction } from 'firebase/firestore'
import { firestore } from './app'
import { sequencesRef } from './paths'
import { deviceId } from './device'

/**
 * Order and bill numbers.
 *
 * Two things are wanted and they pull against each other. Numbers should run
 * 1, 2, 3 — a café reads them out loud, and "bill fifty-one" after "bill one"
 * is a support call waiting to happen. And billing must keep working when the
 * wifi drops, which rules out a round trip per number.
 *
 * So: ask the server, and keep a small reserve for when the server is not
 * there.
 *
 *   ONLINE   one transaction increments the shared counter and returns the
 *            number. Genuinely sequential across every device, because there
 *            is one counter and it is authoritative. Costs one round trip,
 *            roughly 40ms from Davanagere to Mumbai, on an action that
 *            already involves a person pressing a button.
 *
 *   OFFLINE  the transaction fails, and the device hands out numbers from a
 *            block it reserved earlier. That block is drawn from the same
 *            counter, so the numbers can never collide with online ones.
 *
 * The visible cost is one gap per device, once: reserving the emergency
 * block advances the shared counter past it. A café with three tills sees
 * three small jumps in its first week and then a clean run. That is a much
 * better trade than the previous design, which handed every device a block
 * of a hundred up front and produced #1 followed by #101.
 *
 * Gaps are acceptable here at all only because no GST is charged anywhere in
 * this app, so there is no legal requirement for a gapless invoice series.
 * If that ever changes, this file is where to start.
 */

/** Deliberately small. This is an emergency runway, not the normal path. */
const RESERVE_SIZES = { order: 50, bill: 25 } as const

type SequenceKind = keyof typeof RESERVE_SIZES

const FIELD: Record<SequenceKind, 'nextOrderNumber' | 'nextBillNumber'> = {
  order: 'nextOrderNumber',
  bill: 'nextBillNumber',
}

interface Reserve {
  /** The next number this device may hand out while offline. */
  next: number
  /** One past the last number in the reserved block. */
  limit: number
}

type ReserveStore = Partial<Record<SequenceKind, Reserve>>

function storageKey(outletId: string): string {
  return `swaada.seq.${outletId}.${deviceId()}`
}

function readReserves(outletId: string): ReserveStore {
  try {
    const raw = localStorage.getItem(storageKey(outletId))
    return raw ? (JSON.parse(raw) as ReserveStore) : {}
  } catch {
    return {}
  }
}

function writeReserves(outletId: string, reserves: ReserveStore): void {
  try {
    localStorage.setItem(storageKey(outletId), JSON.stringify(reserves))
  } catch {
    /* storage unavailable: the in-memory reserve still covers this session */
  }
}

/**
 * Take `count` numbers off the shared counter. Requires connectivity: a
 * Firestore transaction needs a live round trip and will not queue offline.
 */
async function claim(outletId: string, kind: SequenceKind, count: number): Promise<number> {
  const ref = sequencesRef(outletId)
  return runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref)
    const current = snap.data() ?? { nextOrderNumber: 1, nextBillNumber: 1 }
    const from = current[FIELD[kind]]
    tx.set(ref, { ...current, [FIELD[kind]]: from + count }, { merge: true })
    return from
  })
}

const inFlight = new Map<string, Promise<number>>()

/** One reserve refill at a time per outlet+kind, however many callers ask. */
function claimReserveOnce(outletId: string, kind: SequenceKind): Promise<number> {
  const key = `${outletId}:${kind}`
  const existing = inFlight.get(key)
  if (existing) return existing
  const promise = claim(outletId, kind, RESERVE_SIZES[kind]).finally(() => inFlight.delete(key))
  inFlight.set(key, promise)
  return promise
}

export class SequenceExhaustedError extends Error {
  constructor(kind: SequenceKind) {
    super(
      `No internet, and this device has run out of spare ${kind} numbers. ` +
        `Reconnect for a moment and it will top itself up.`,
    )
    this.name = 'SequenceExhaustedError'
  }
}

/** Hand out one number from this device's offline reserve. */
function takeFromReserve(outletId: string, kind: SequenceKind): number {
  const reserves = readReserves(outletId)
  const reserve = reserves[kind]
  if (!reserve || reserve.next >= reserve.limit) throw new SequenceExhaustedError(kind)
  writeReserves(outletId, {
    ...reserves,
    [kind]: { next: reserve.next + 1, limit: reserve.limit },
  })
  return reserve.next
}

/**
 * The next number.
 *
 * Tries the shared counter first, so numbers stay sequential across every
 * device in the café. Falls back to this device's reserve only when that
 * round trip fails, which in practice means the wifi has gone.
 */
export async function nextNumber(outletId: string, kind: SequenceKind): Promise<number> {
  try {
    const value = await claim(outletId, kind, 1)
    // Back online and the reserve was spent during an outage: quietly refill
    // it so the next outage is covered too. Never blocks this call.
    void ensureReserve(outletId, kind).catch(() => {
      /* still flaky: try again after the next order */
    })
    return value
  } catch {
    return takeFromReserve(outletId, kind)
  }
}

/**
 * Make sure this device has an emergency block, claiming one if not.
 *
 * This is what causes the single visible gap per device. It happens once,
 * on first use, and again only after an outage has actually eaten the
 * reserve. Doing it lazily rather than at every login is the difference
 * between one jump and one jump per sign-in.
 */
async function ensureReserve(outletId: string, kind: SequenceKind): Promise<void> {
  const held = readReserves(outletId)[kind]
  if (held && held.next < held.limit) return
  const start = await claimReserveOnce(outletId, kind)
  const latest = readReserves(outletId)
  const current = latest[kind]
  // Only adopt it if the reserve is still spent: another tab may have
  // refilled while this claim was in flight.
  if (!current || current.next >= current.limit) {
    writeReserves(outletId, {
      ...latest,
      [kind]: { next: start, limit: start + RESERVE_SIZES[kind] },
    })
  }
}

/** How many numbers this device could still issue with no internet. */
export function remainingInBlock(outletId: string, kind: SequenceKind): number {
  const reserve = readReserves(outletId)[kind]
  return reserve ? Math.max(0, reserve.limit - reserve.next) : 0
}

/**
 * Claim the emergency blocks at login, so a device that goes offline mid
 * service already has a runway. Failing is fine: the first order will try
 * again, and until then the online path works perfectly well on its own.
 */
export async function primeSequences(outletId: string): Promise<void> {
  await Promise.allSettled(
    (Object.keys(RESERVE_SIZES) as SequenceKind[]).map((kind) => ensureReserve(outletId, kind)),
  )
}
