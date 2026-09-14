import { doc, setDoc, type WriteBatch } from 'firebase/firestore'
import { auditCol, auditRef } from './firebase/paths'
import { requireOutletId, requireSession } from './context'
import { todayBusinessDate } from '@/lib/businessDate'
import type { AuditAction, AuditEntry } from '@/types'
import { nowISO } from '@/lib/utils'

/**
 * The append-only record of anything that moves money or changes what the
 * cafe sells.
 *
 * The security rules allow `create` and deny `update` and `delete`, for
 * everyone including the manager. That is the point: a log a manager can
 * quietly edit is not a log. If an entry is wrong, the fix is another entry,
 * the same way a ledger is corrected.
 *
 * Two ways in. `record()` writes on its own and never throws, for the cases
 * where a failed log must not fail the thing being logged. `stageAudit()`
 * puts the entry into a batch you are already committing, so a settlement
 * and its audit line land together or not at all.
 */

export interface AuditInput {
  action: AuditAction
  summary: string
  target?: Record<string, string | number>
  change?: Record<string, string | number | null>
}

function buildEntry(input: AuditInput): Omit<AuditEntry, 'id'> {
  const session = requireSession()
  return {
    action: input.action,
    businessDate: todayBusinessDate(),
    at: nowISO(),
    byUserId: session.userId,
    byName: session.name,
    byRole: session.role,
    summary: input.summary.trim(),
    target: input.target,
    change: input.change,
  }
}

/** Add the entry to a batch that is about to be committed. */
export function stageAudit(batch: WriteBatch, input: AuditInput): void {
  const outletId = requireOutletId()
  const ref = doc(auditCol(outletId))
  batch.set(auditRef(outletId, ref.id), { ...buildEntry(input), id: ref.id })
}

/**
 * Write the entry on its own. Deliberately swallows failures: losing an
 * audit line is bad, but refusing to take a customer's money because the
 * log write failed is worse. Failures go to the console and to Sentry.
 */
export async function record(input: AuditInput): Promise<void> {
  try {
    const outletId = requireOutletId()
    const ref = doc(auditCol(outletId))
    await setDoc(auditRef(outletId, ref.id), { ...buildEntry(input), id: ref.id })
  } catch (error) {
    console.error('[audit] failed to record', input.action, error)
  }
}
