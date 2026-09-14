import { doc, increment, writeBatch, type WriteBatch } from 'firebase/firestore'
import { firestore } from './firebase/app'
import { customerRef, walletEntriesCol, walletEntryRef } from './firebase/paths'
import { requireOutletId, requireSession } from './context'
import { stageAudit } from './audit'
import { walletHeld, walletOwed } from './rules'
import { todayBusinessDate } from '@/lib/businessDate'
import { toAppError } from '@/lib/errors'
import { clamp, round2, nowISO } from '@/lib/utils'
import type { ID, PaymentMethod, WalletEntry, WalletEntryKind } from '@/types'

/**
 * One signed ledger per guest. Positive means the cafe is holding their
 * money, negative means they owe it.
 *
 * No balance is ever stored. It is the sum of the entries, so the history
 * and the balance cannot disagree — there is no second number to drift.
 * That property is also what lets these writes work offline: every entry is
 * a plain create, never a read-modify-write, so a queued entry applies
 * correctly whenever it reaches the server and in whatever order.
 *
 * Callers pass the balance they already have on screen. It is used only to
 * LABEL the entry (repayment versus top-up) and to clamp a refund. If that
 * balance is a few seconds stale the label can be imprecise; the arithmetic
 * cannot be, because the balance is recomputed from the entries.
 */

interface EntryInput {
  customerId: ID
  amount: number
  kind: WalletEntryKind
  billId?: string
  billNumber?: number
  method?: PaymentMethod
  note?: string
}

/** Build one ledger line, stamped with who and when. */
export function buildWalletEntry(input: EntryInput, id: string): WalletEntry {
  const session = requireSession()
  return {
    id,
    customerId: input.customerId,
    businessDate: todayBusinessDate(),
    amount: round2(input.amount),
    kind: input.kind,
    billId: input.billId,
    billNumber: input.billNumber,
    method: input.method,
    note: input.note?.trim() || undefined,
    at: nowISO(),
    byUserId: session.userId,
    byName: session.name,
  }
}

/**
 * Add a ledger line to a batch that is already being committed, and move the
 * guest's cached balance by the same amount in the SAME batch.
 *
 * `increment()` is what makes the cache safe: it is applied by the server
 * relative to whatever is there, so it needs no read, it cannot lose a
 * concurrent entry, and it survives being queued offline. An assignment
 * would do none of those things.
 */
export function stageWalletEntry(batch: WriteBatch, input: EntryInput): WalletEntry {
  const outletId = requireOutletId()
  const ref = doc(walletEntriesCol(outletId))
  const entry = buildWalletEntry(input, ref.id)
  batch.set(walletEntryRef(outletId, ref.id), entry)
  batch.set(
    customerRef(outletId, input.customerId),
    { balance: increment(entry.amount), updatedAt: entry.at } as never,
    { merge: true },
  )
  return entry
}

export const walletService = {
  /**
   * Money handed over at the counter with no bill attached.
   *
   * It clears what the guest owes first and whatever is left stays in the
   * wallet. Those are two different things on the guest's account even
   * though they are the same rupees in the drawer, so they are written as
   * two lines — the same split the settle sheet makes.
   */
  async takeMoney(input: {
    customerId: ID
    amount: number
    method: PaymentMethod
    /** The guest's balance as the screen has it: + held, − owed. */
    balance: number
    note?: string
  }): Promise<void> {
    const amount = round2(Math.max(0, input.amount))
    if (amount <= 0) return
    try {
      const owed = walletOwed(input.balance)
      const repayment = round2(Math.min(amount, owed))
      const topup = round2(amount - repayment)
      const batch = writeBatch(firestore)
      if (repayment > 0) {
        stageWalletEntry(batch, { ...input, amount: repayment, kind: 'repayment' })
      }
      if (topup > 0) {
        stageWalletEntry(batch, { ...input, amount: topup, kind: 'topup' })
      }
      await batch.commit()
    } catch (error) {
      throw toAppError(error, 'Could not record the payment.')
    }
  },

  /** Hand wallet money back. Never more than the cafe is actually holding. */
  async returnMoney(input: {
    customerId: ID
    amount: number
    method: PaymentMethod
    balance: number
    note?: string
  }): Promise<void> {
    const held = walletHeld(input.balance)
    const amount = round2(clamp(input.amount, 0, held))
    if (amount <= 0) return
    try {
      const batch = writeBatch(firestore)
      stageWalletEntry(batch, { ...input, amount: -amount, kind: 'refund' })
      stageAudit(batch, {
        action: 'wallet.refund',
        summary: `Returned ₹${amount} to guest by ${input.method}`,
        target: { customerId: input.customerId },
      })
      await batch.commit()
    } catch (error) {
      throw toAppError(error, 'Could not record the refund.')
    }
  },

  /**
   * Manager correction — writing off a due, fixing a mistyped amount.
   * Signed, the note is required, and it is always audited: this is the one
   * way money can move without anything being sold.
   */
  async adjust(input: { customerId: ID; amount: number; note: string }): Promise<void> {
    const amount = round2(input.amount)
    const note = input.note.trim()
    if (amount === 0 || !note) return
    try {
      const batch = writeBatch(firestore)
      stageWalletEntry(batch, { ...input, amount, kind: 'adjustment', note })
      stageAudit(batch, {
        action: 'wallet.adjust',
        summary: `Adjusted guest balance by ₹${amount}: ${note}`,
        target: { customerId: input.customerId },
        change: { amount },
      })
      await batch.commit()
    } catch (error) {
      throw toAppError(error, 'Could not save the adjustment.')
    }
  },
}
