/**
 * Domain models for the Swaada Café order system.
 *
 * Everything here is designed to map 1:1 onto database tables later
 * (Supabase/PostgreSQL). IDs are strings so they can become UUIDs without
 * touching the UI. Timestamps are ISO strings for the same reason.
 */

export type ID = string

export interface Timestamps {
  createdAt: string
  updatedAt: string
}

/* ------------------------------------------------------------------ */
/* Menu                                                                */
/* ------------------------------------------------------------------ */

export interface Category extends Timestamps {
  id: ID
  name: string
  description: string
  /** Emoji or icon token, editable by admin. */
  icon: string
  /** Optional image URL; the UI falls back to the icon when absent. */
  image?: string | null
  displayOrder: number
  isActive: boolean
}

export type ItemAvailability = 'available' | 'out_of_stock' | 'disabled'

export interface MenuItem extends Timestamps {
  id: ID
  categoryId: ID
  name: string
  description: string
  image?: string | null
  /** Price in rupees for the base configuration (smallest size). */
  basePrice: number
  availability: ItemAvailability
  isVegetarian: boolean
  isPopular: boolean
  isRecommended: boolean
  /** Estimated preparation time in minutes. */
  preparationTimeMin: number
  /** Kitchen routing: which station prepares this item. */
  stationId: ID
  displayOrder: number
  /** Modifier groups (sizes, add-ons, preferences) offered for this item. */
  modifierGroupIds: ID[]
  /** Extra search keywords, e.g. "coffee" on Cappuccino. Configurable. */
  tags: string[]
}

export type ModifierSelectionType = 'single' | 'multi'

export interface ModifierGroup {
  id: ID
  name: string
  selectionType: ModifierSelectionType
  required: boolean
  minSelections: number
  /** Upper bound for multi-select groups; ignored for single-select. */
  maxSelections: number
  displayOrder: number
}

export interface ModifierOption {
  id: ID
  modifierGroupId: ID
  name: string
  /** Rupees added to the item's base price. Can be 0 (e.g. "No Onion"). */
  priceAdjustment: number
  isAvailable: boolean
  /** Pre-selected for required single-select groups (e.g. "Regular"). */
  isDefault: boolean
  displayOrder: number
}

/* ------------------------------------------------------------------ */
/* Kitchen stations                                                    */
/* ------------------------------------------------------------------ */

export interface Station {
  id: ID
  name: string
  icon: string
  displayOrder: number
  isActive: boolean
}

/* ------------------------------------------------------------------ */
/* Tables                                                              */
/* ------------------------------------------------------------------ */

export interface CafeTable {
  id: ID
  /** Short label shown everywhere, e.g. "L3". */
  name: string
  zone: string
  capacity: number
  displayOrder: number
  isActive: boolean
}

/** Derived at read time from active orders; never stored. */
export type TableStatus = 'available' | 'occupied'

/* ------------------------------------------------------------------ */
/* Orders                                                              */
/* ------------------------------------------------------------------ */

export const ORDER_STATUSES = [
  'placed',
  'preparing',
  'ready',
  'delivered',
  'served',
  'cancelled',
] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

export const ORDER_ITEM_STATUSES = ['queued', 'preparing', 'ready', 'cancelled'] as const
export type OrderItemStatus = (typeof ORDER_ITEM_STATUSES)[number]

/** A modifier choice frozen onto an order line (survives menu edits). */
export interface OrderItemModifier {
  groupId: ID
  groupName: string
  optionId: ID
  optionName: string
  priceAdjustment: number
}

export interface OrderItem {
  id: ID
  menuItemId: ID
  /* Denormalised snapshot so history survives menu changes. */
  name: string
  categoryId: ID
  categoryName: string
  stationId: ID
  stationName: string
  isVegetarian: boolean
  basePrice: number
  /** basePrice + sum of modifier adjustments, per unit. */
  unitPrice: number
  quantity: number
  modifiers: OrderItemModifier[]
  specialInstructions: string
  status: OrderItemStatus
  queuedAt: string
  startedAt?: string
  readyAt?: string
}

export interface Order {
  id: ID
  orderNumber: number
  tableId: ID | null
  tableName: string
  items: OrderItem[]
  status: OrderStatus
  subtotal: number
  taxLabel: string
  taxRatePercent: number
  taxAmount: number
  total: number
  createdByUserId: ID
  createdByName: string
  placedAt: string
  startedAt?: string
  readyAt?: string
  deliveredAt?: string
  servedAt?: string
  cancelledAt?: string
  cancelReason?: string
}

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

export type UserRole = 'admin' | 'kitchen'

export interface User {
  id: ID
  name: string
  role: UserRole
  /** 4-digit PIN for the mock login. Replaced by real auth later. */
  pin: string
}

export interface Session {
  userId: ID
  name: string
  role: UserRole
  loginAt: string
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export interface CafeSettings {
  cafeName: string
  taxLabel: string
  taxRatePercent: number
  currency: 'INR'
}

/* ------------------------------------------------------------------ */
/* Persistence snapshot (the mock "database")                          */
/* ------------------------------------------------------------------ */

export interface DBSnapshot {
  schemaVersion: number
  categories: Category[]
  items: MenuItem[]
  modifierGroups: ModifierGroup[]
  modifierOptions: ModifierOption[]
  stations: Station[]
  tables: CafeTable[]
  orders: Order[]
  users: User[]
  settings: CafeSettings
  counters: { nextOrderNumber: number }
}

/* ------------------------------------------------------------------ */
/* Realtime events                                                     */
/* ------------------------------------------------------------------ */

export type RealtimeEvent =
  | { type: 'ORDER_CREATED'; orderId: ID }
  | { type: 'ORDER_UPDATED'; orderId: ID }
  | { type: 'ITEM_STARTED'; orderId: ID; itemId: ID }
  | { type: 'ITEM_READY'; orderId: ID; itemId: ID }
  | { type: 'ORDER_READY'; orderId: ID }
  | { type: 'ORDER_DELIVERED'; orderId: ID }
  | { type: 'ORDER_SERVED'; orderId: ID }
  | { type: 'ORDER_CANCELLED'; orderId: ID }
  | { type: 'MENU_UPDATED' }
  | { type: 'TABLES_UPDATED' }
  | { type: 'SETTINGS_UPDATED' }

export type ConnectionStatus = 'live' | 'offline'
