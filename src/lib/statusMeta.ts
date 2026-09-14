import { paidMethods } from '@/services'
import { formatINR } from '@/lib/utils'
import type {
  Bill,
  BillPayments,
  FloorState,
  ItemAvailability,
  OrderItemStatus,
  OrderStatus,
  PaymentMethod,
  WalletEntryKind,
} from '@/types'

/**
 * Presentation metadata for every status in the system, defined ONCE.
 * Components render from these maps; no screen hard-codes a status label
 * or colour. Adding a status = one entry here + the type union.
 */

export type Tone = 'neutral' | 'info' | 'warn' | 'ok' | 'accent' | 'danger'

interface StatusMeta {
  label: string
  tone: Tone
}

/**
 * Tones deliberately match FLOOR_STATE_META below, so a badge and the table
 * tile it belongs to always tell the same story: amber = the kitchen has it,
 * blue = food is up, green = eaten and the bill is open.
 */
export const ORDER_STATUS_META: Record<OrderStatus, StatusMeta> = {
  placed: { label: 'Placed', tone: 'warn' },
  preparing: { label: 'Preparing', tone: 'warn' },
  ready: { label: 'Ready', tone: 'info' },
  delivered: { label: 'Delivered', tone: 'ok' },
  // A closed round, not necessarily a paid one — see billOutcome below.
  settled: { label: 'Closed', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
}

/**
 * What actually happened to a bill, as a badge. `settled` on an order only
 * means the round was closed off the floor: a bill put on the guest's account
 * closes the same way one paid in cash does, so reading "Paid" off the order
 * status was telling the owner money had come in when it had not. The bill
 * knows the truth, so the label comes from the bill.
 */
export function billOutcome(bill: Bill): StatusMeta {
  const owed = bill.creditAmount
  if (owed > 0.005) {
    // Nothing changed hands and no wallet was touched: pure pay-later.
    const paidNow = bill.walletApplied + (bill.payments.cash || 0) + (bill.payments.upi || 0) - bill.duesCleared - bill.walletTopUp
    return paidNow > 0.005
      ? { label: 'Part paid', tone: 'warn' }
      : { label: 'On account', tone: 'danger' }
  }
  if (bill.total > 0.005 && bill.walletApplied >= bill.total - 0.005) {
    return { label: 'Paid by wallet', tone: 'ok' }
  }
  return { label: 'Paid', tone: 'ok' }
}

/** How one line of a guest's account reads. Arithmetic lives in the ledger. */
export const WALLET_ENTRY_META: Record<WalletEntryKind, { label: string; tone: Tone }> = {
  topup: { label: 'Money added to wallet', tone: 'ok' },
  spend: { label: 'Paid from wallet', tone: 'neutral' },
  credit: { label: 'Left unpaid', tone: 'danger' },
  repayment: { label: 'Dues cleared', tone: 'ok' },
  adjustment: { label: 'Adjusted', tone: 'warn' },
  refund: { label: 'Money given back', tone: 'neutral' },
}

export const PAYMENT_METHOD_META: Record<PaymentMethod, { label: string; icon: string }> = {
  cash: { label: 'Cash', icon: '💵' },
  upi: { label: 'UPI', icon: '📱' },
}

/**
 * How a bill was paid, in one line: "₹1,000 cash + ₹814 UPI". `short` drops
 * the separator words for a badge but KEEPS the figures — a badge reading
 * only "Cash + UPI" told the owner a split existed without ever showing it.
 */
export function paymentSummary(payments: BillPayments, style: 'full' | 'short' = 'full'): string {
  const parts = paidMethods(payments)
  if (parts.length === 0) return '—'
  return parts
    .map(([m, amount]) => `${formatINR(amount)} ${PAYMENT_METHOD_META[m].label}`)
    .join(style === 'short' ? ' · ' : ' + ')
}

export const ITEM_STATUS_META: Record<OrderItemStatus, StatusMeta> = {
  queued: { label: 'Queued', tone: 'info' },
  preparing: { label: 'Preparing', tone: 'warn' },
  ready: { label: 'Ready', tone: 'ok' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
}

export const AVAILABILITY_META: Record<ItemAvailability, StatusMeta> = {
  available: { label: 'Available', tone: 'ok' },
  out_of_stock: { label: 'Out of stock', tone: 'danger' },
  disabled: { label: 'Disabled', tone: 'neutral' },
}

/**
 * Table tiles on the floor plan. `tile` is the whole fill + border, `swatch`
 * the dot in the legend, so the legend can never drift from the tiles.
 */
export const FLOOR_STATE_META: Record<FloorState, { label: string; tile: string; swatch: string }> = {
  free: {
    label: 'Blank table',
    tile: 'border-2 border-dashed border-surface-300 bg-white/60 hover:bg-white hover:shadow-card',
    swatch: 'bg-surface-300',
  },
  running: {
    label: 'Running order',
    tile: 'border-2 border-warn-600/20 bg-warn-100 text-warn-600 shadow-card hover:shadow-lift',
    swatch: 'bg-warn-600',
  },
  ready: {
    label: 'Ready to serve',
    tile: 'border-2 border-info-600/20 bg-info-100 text-info-600 shadow-card hover:shadow-lift',
    swatch: 'bg-info-600',
  },
  billing: {
    label: 'Bill open',
    tile: 'border-2 border-ok-600/20 bg-ok-100 text-ok-600 shadow-card hover:shadow-lift',
    swatch: 'bg-ok-600',
  },
}

