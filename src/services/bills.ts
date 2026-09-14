import { writeBatch } from 'firebase/firestore'
import { firestore } from './firebase/app'
import { billRef, orderRef } from './firebase/paths'
import { nextNumber } from './firebase/sequences'
import { requireCatalogue, requireOutletId, requireSession } from './context'
import { stageAudit } from './audit'
import { stageWalletEntry } from './wallet'
import {
  computeBillPreview,
  customerById,
  findCustomer,
  isActiveOrder,
  planSettlement,
  walletBalance,
} from './rules'
import { businessDayConfig } from './settings'
import { todayBusinessDate } from '@/lib/businessDate'
import { AppError, toAppError } from '@/lib/errors'
import { nowISO, round2, uid } from '@/lib/utils'
import { PAYMENT_METHODS, type Bill, type BillPayments, type ID, type WalletEntryKind } from '@/types'

/**
 * Settling a table: the one place in the app where money is actually taken.
 *
 * Everything — the bill, the rounds it closes, and every line it puts on the
 * guest's wallet — goes into ONE batch. Firestore applies a batch all or
 * nothing, so there is no state where the bill exists but the rounds are
 * still open, or the guest was charged but the ledger was not written. That
 * atomicity is the whole reason this is not four separate writes.
 *
 * A batch also queues offline, so the counter can still close a table during
 * a wifi drop. Two protections stand in for the read-check a transaction
 * would have given:
 *
 *  - the arithmetic is re-derived here from the same pure functions the
 *    settle sheet used, and the batch is refused if the legs do not add up;
 *  - the security rules only allow an order to go from `delivered` to
 *    `settled`, so a second device trying to settle the same table has its
 *    whole batch rejected by the server rather than writing a second bill.
 */

export const billService = {
  /**
   * Group a party's delivered rounds into one bill, record how it was paid,
   * move the guest's account, and free the table. Refuses while any round is
   * still with the kitchen.
   */
  async settleTable(input: {
    tableId: ID
    /** Which party at the table is paying. */
    groupNo: number
    /** Rupees taken in each method; must add up to the plan's tenderTarget. */
    payments: BillPayments
    discountAmount?: number
    /** Wallet legs. Ignored when the sitting has no guest attached. */
    walletApplied?: number
    creditAmount?: number
    /** Gross money handed over beyond the bill; split into dues + top-up. */
    extraTendered?: number
  }): Promise<Bill> {
    const outletId = requireOutletId()
    const session = requireSession()
    const live = requireCatalogue()

    const open = live.orders.filter(
      (o) => o.tableId === input.tableId && o.groupNo === input.groupNo && isActiveOrder(o),
    )
    if (open.length === 0) {
      throw new AppError('There is nothing open on this table.', 'settle/empty')
    }
    if (open.some((o) => o.status !== 'delivered')) {
      throw new AppError(
        'The kitchen has not finished every round yet. Serve them before taking payment.',
        'settle/kitchen-busy',
      )
    }

    const first = [...open].sort((a, b) => a.placedAt.localeCompare(b.placedAt))[0]
    const phone = first?.customerPhone
    const customer =
      customerById(live.customers, first?.customerId) ??
      (phone ? findCustomer(live.customers, phone) : undefined)

    const preview = computeBillPreview({ rounds: open, discountAmount: input.discountAmount })
    const plan = planSettlement({
      total: preview.total,
      balance: walletBalance(live.walletEntries, customer?.id),
      hasCustomer: Boolean(customer),
      allowPayLater: live.settings.wallet.allowPayLater,
      walletApplied: input.walletApplied,
      creditAmount: input.creditAmount,
      extraTendered: input.extraTendered,
    })

    // Guard the invariant at the only door into the ledger: a bill whose
    // legs do not add up to its total must never be written.
    const tendered = round2(PAYMENT_METHODS.reduce((sum, m) => sum + (input.payments[m] || 0), 0))
    if (Math.abs(tendered - plan.tenderTarget) > 0.01) {
      throw new AppError(
        `The cash and UPI entered (₹${tendered}) do not match what is due (₹${plan.tenderTarget}).`,
        'settle/unbalanced',
      )
    }

    try {
      const billNumber = await nextNumber(outletId, 'bill')
      const now = nowISO()
      const table = live.tables.find((t) => t.id === input.tableId)

      const bill: Bill = {
        id: uid('bill'),
        billNumber,
        businessDate: todayBusinessDate(businessDayConfig(live.settings)),
        tableId: input.tableId,
        tableName: table?.name ?? open[0]?.tableName ?? '',
        groupNo: input.groupNo,
        orderIds: open.map((o) => o.id),
        orderNumbers: open.map((o) => o.orderNumber),
        customerId: customer?.id,
        customerName: customer?.name ?? first?.customerName,
        customerPhone: customer?.phone ?? phone,
        subtotal: preview.subtotal,
        discountAmount: preview.discountAmount,
        total: preview.total,
        payments: input.payments,
        walletApplied: plan.walletApplied,
        creditAmount: plan.creditAmount,
        duesCleared: plan.duesCleared,
        walletTopUp: plan.walletTopUp,
        settledAt: now,
        settledByUserId: session.userId,
        settledByName: session.name,
      }

      const batch = writeBatch(firestore)
      batch.set(billRef(outletId, bill.id), bill)

      // One ledger line per thing that actually happened, so the guest's
      // history reads as a story rather than a single net number.
      if (customer) {
        const legs: Array<[number, WalletEntryKind]> = [
          [-plan.walletApplied, 'spend'],
          [-plan.creditAmount, 'credit'],
          [plan.duesCleared, 'repayment'],
          [plan.walletTopUp, 'topup'],
        ]
        for (const [amount, kind] of legs) {
          if (amount === 0) continue
          stageWalletEntry(batch, {
            customerId: customer.id,
            amount,
            kind,
            billId: bill.id,
            billNumber: bill.billNumber,
          })
        }
      }

      open.forEach((o) => {
        batch.update(orderRef(outletId, o.id), {
          status: 'settled',
          settledAt: now,
          billId: bill.id,
        })
      })

      stageAudit(batch, {
        action: 'bill.settle',
        summary:
          `Bill #${billNumber} on ${bill.tableName} — ₹${bill.total}` +
          (bill.discountAmount > 0 ? `, ₹${bill.discountAmount} off` : '') +
          (bill.creditAmount > 0 ? `, ₹${bill.creditAmount} left unpaid` : ''),
        target: { billId: bill.id, billNumber, tableId: input.tableId },
      })

      // A discount is the one figure on a bill a person chose rather than
      // the menu deciding, so it gets its own line in the log.
      if (bill.discountAmount > 0) {
        stageAudit(batch, {
          action: 'bill.discount',
          summary: `₹${bill.discountAmount} discount on bill #${billNumber} (subtotal ₹${bill.subtotal})`,
          target: { billId: bill.id, billNumber },
          change: { from: bill.subtotal, to: bill.total },
        })
      }

      await batch.commit()
      return bill
    } catch (error) {
      throw toAppError(error, 'Could not settle the table.')
    }
  },
}
