import type { ItemAvailability, OrderItemStatus, OrderStatus, TableStatus } from '@/types'

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

export const ORDER_STATUS_META: Record<OrderStatus, StatusMeta> = {
  placed: { label: 'Placed', tone: 'info' },
  preparing: { label: 'Preparing', tone: 'warn' },
  ready: { label: 'Ready', tone: 'ok' },
  delivered: { label: 'Delivered', tone: 'accent' },
  served: { label: 'Served', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
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

export const TABLE_STATUS_META: Record<TableStatus, StatusMeta> = {
  available: { label: 'Available', tone: 'ok' },
  occupied: { label: 'Occupied', tone: 'warn' },
}

/** What the admin can do next for an order in a given status. */
export const NEXT_ORDER_ACTION: Partial<
  Record<OrderStatus, { to: Extract<OrderStatus, 'delivered' | 'served'>; label: string }>
> = {
  ready: { to: 'delivered', label: 'Mark delivered' },
  delivered: { to: 'served', label: 'Mark served' },
}
