import { runTransaction } from 'firebase/firestore'
import { firestore } from './app'
import { sequencesRef } from './paths'
import { deviceId } from './device'

/**
 * Order and bill numbers that keep working when the wifi does not.
 *
 * The obvious design — read the counter, add one, write it back, inside a
 * Firestore transaction — breaks the moment the cafe's connection drops,
 * because a transaction needs a round trip and a queued offline write does
 * not. A POS that cannot print a bill during an outage is not a POS.
 *
 * So a device RESERVES a block of numbers while it is online and hands them
 * out locally. Reserving 100 order numbers costs one transaction and then
 * covers roughly a day of trading offline. The block is topped up in the
 * background once it is three-quarters used, so the counter never waits.
 *
 * The trade-off, stated plainly: a device that is retired or has its storage
 * cleared mid-block leaves a gap in the sequence. That is acceptable here
 * because no GST is charged anywhere in this app, so there is no legal
 * requirement for a gapless invoice series. If that ever changes, this is
 * the file to revisit.
 */

const BLOCK_SIZES = { order: 100, bill: 50 } as const
/** Top up once this much of the block is gone, so a refill never blocks. */
const REFILL_AT = 0.75

type SequenceKind = keyof typeof BLOCK_SIZES

interface Block {
  /** The next number this device may hand out. */
  next: number
  /** One past the last number in the reserved block. */
  limit: number
}

type BlockStore = Partial<Record<SequenceKind, Block>>

function storageKey(outletId: string): string {
  return `swaada.seq.${outletId}.${deviceId()}`
}

function readBlocks(outletId: string): BlockStore {
  try {
    const raw = localStorage.getItem(storageKey(outletId))
    return raw ? (JSON.parse(raw) as BlockStore) : {}
  } catch {
    return {}
  }
}

function writeBlocks(outletId: string, blocks: BlockStore): void {
  try {
    localStorage.setItem(storageKey(outletId), JSON.stringify(blocks))
  } catch {
    /* storage unavailable: the in-flight block still works for this session */
  }
}

const FIELD: Record<SequenceKind, 'nextOrderNumber' | 'nextBillNumber'> = {
  order: 'nextOrderNumber',
  bill: 'nextBillNumber',
}

/** Claim the next `size` numbers for this device. Requires connectivity. */
async function reserve(outletId: string, kind: SequenceKind, size: number): Promise<Block> {
  const ref = sequencesRef(outletId)
  const start = await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref)
    const current = snap.data() ?? { nextOrderNumber: 1, nextBillNumber: 1 }
    const from = current[FIELD[kind]]
    tx.set(ref, { ...current, [FIELD[kind]]: from + size }, { merge: true })
    return from
  })
  return { next: start, limit: start + size }
}

const inFlight = new Map<string, Promise<Block>>()

/** One refill at a time per outlet+kind, however many callers ask. */
function reserveOnce(outletId: string, kind: SequenceKind, size: number): Promise<Block> {
  const key = `${outletId}:${kind}`
  const existing = inFlight.get(key)
  if (existing) return existing
  const promise = reserve(outletId, kind, size).finally(() => inFlight.delete(key))
  inFlight.set(key, promise)
  return promise
}

export class SequenceExhaustedError extends Error {
  constructor(kind: SequenceKind) {
    super(
      `Ran out of reserved ${kind} numbers while offline. Reconnect to the internet once to get more.`,
    )
    this.name = 'SequenceExhaustedError'
  }
}

/**
 * The next number, taken from this device's block. Tops the block up in the
 * background when it is running low; only throws if the block is completely
 * spent AND the device cannot reach Firestore to reserve more.
 */
export async function nextNumber(outletId: string, kind: SequenceKind): Promise<number> {
  const blocks = readBlocks(outletId)
  let block = blocks[kind]
  const size = BLOCK_SIZES[kind]

  if (!block || block.next >= block.limit) {
    try {
      block = await reserveOnce(outletId, kind, size)
    } catch {
      throw new SequenceExhaustedError(kind)
    }
  }

  const value = block.next
  const updated: Block = { next: value + 1, limit: block.limit }
  writeBlocks(outletId, { ...blocks, [kind]: updated })

  const used = (updated.next - (updated.limit - size)) / size
  if (used >= REFILL_AT && updated.next < updated.limit) {
    // Fire and forget: extend the runway before anyone is waiting on it.
    void reserveOnce(outletId, kind, size)
      .then((fresh) => {
        const latest = readBlocks(outletId)
        const held = latest[kind]
        // Only adopt the fresh block once the current one is actually spent,
        // so numbers stay in order rather than jumping forward early.
        if (!held || held.next >= held.limit) writeBlocks(outletId, { ...latest, [kind]: fresh })
      })
      .catch(() => {
        /* offline: the current block still has room, try again next time */
      })
  }

  return value
}

/** How many numbers this device can still issue offline. For Settings. */
export function remainingInBlock(outletId: string, kind: SequenceKind): number {
  const block = readBlocks(outletId)[kind]
  return block ? Math.max(0, block.limit - block.next) : 0
}

/** Warm both blocks at login so the first order of the day never waits. */
export async function primeSequences(outletId: string): Promise<void> {
  await Promise.allSettled(
    (Object.keys(BLOCK_SIZES) as SequenceKind[]).map(async (kind) => {
      const block = readBlocks(outletId)[kind]
      if (block && block.limit - block.next > BLOCK_SIZES[kind] * (1 - REFILL_AT)) return
      const fresh = await reserveOnce(outletId, kind, BLOCK_SIZES[kind])
      const latest = readBlocks(outletId)
      const held = latest[kind]
      if (!held || held.next >= held.limit) writeBlocks(outletId, { ...latest, [kind]: fresh })
    }),
  )
}
