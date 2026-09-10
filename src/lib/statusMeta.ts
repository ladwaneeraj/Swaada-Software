import { paidMethods } from '@/services'
import { formatINR } from '@/lib/utils'
import type {
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
  settled: { label: 'Paid', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
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
 * How a bill was paid, in one line: "₹1,000 Cash + ₹814 UPI", or just
 * "Cash + UPI" in `short` form where a row has no space for the amounts.
 */
export function paymentSummary(payments: BillPayments, style: 'full' | 'short' = 'full'): string {
  const parts = paidMethods(payments)
  if (parts.length === 0) return '—'
  return parts
    .map(([m, amount]) =>
      style === 'short'
        ? PAYMENT_METHOD_META[m].label
        : `${formatINR(amount)} ${PAYMENT_METHOD_META[m].label}`,
    )
    .join(' + ')
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

