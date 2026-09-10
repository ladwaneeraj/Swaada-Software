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

/**
 * What a table looks like on the floor plan, derived at read time from its
 * active orders and never stored. These are the four colours on the legend.
 */
export const FLOOR_STATES = ['free', 'running', 'ready', 'billing'] as const
export type FloorState = (typeof FLOOR_STATES)[number]

/* ------------------------------------------------------------------ */
/* Orders                                                              */
/* ------------------------------------------------------------------ */

/**
 * A table orders in rounds: each round is one Order (one kitchen ticket).
 * Rounds stay 'delivered' (bill open) until the table settles; settling
 * groups them into a Bill and marks them 'settled'.
 */
export const ORDER_STATUSES = [
  'placed',
  'preparing',
  'ready',
  'delivered',
  'settled',
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
  /**
   * Set when the line was reduced or removed after the round was placed:
   * who changed it, why, and what the quantity was before. Kept on the item
   * so the correction survives into history instead of quietly vanishing.
   */
  adjustment?: {
    at: string
    byName: string
    reason: string
    fromQuantity: number
  }
}

export interface Order {
  id: ID
  orderNumber: number
  tableId: ID | null
  tableName: string
  items: OrderItem[]
  status: OrderStatus
  /** Sum of the round's active lines. No tax is applied anywhere. */
  total: number
  createdByUserId: ID
  createdByName: string
  /** Captured on the table's first round (configurable, always skippable). */
  customerId?: ID
  customerName?: string
  customerPhone?: string
  placedAt: string
  startedAt?: string
  readyAt?: string
  deliveredAt?: string
  settledAt?: string
  cancelledAt?: string
  cancelReason?: string
  /** Set when the round is settled into a bill; the bill holds the payment. */
  billId?: ID
}

/* ------------------------------------------------------------------ */
/* Billing                                                             */
/* ------------------------------------------------------------------ */

export const PAYMENT_METHODS = ['cash', 'upi'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

/**
 * How a bill was paid, in rupees per method. A single-method bill simply has
 * 0 in the other slots, so split and non-split bills read the same way and a
 * new method later is one entry in PAYMENT_METHODS.
 */
export type BillPayments = Record<PaymentMethod, number>

/** One settled sitting: all of a table's rounds paid together at the end. */
export interface Bill {
  id: ID
  billNumber: number
  tableId: ID | null
  tableName: string
  orderIds: ID[]
  orderNumbers: number[]
  customerId?: ID
  customerName?: string
  customerPhone?: string
  /** Sum of round totals, before any adjustment. */
  subtotal: number
  /** Flat rupees off the bill; never more than the subtotal. */
  discountAmount: number
  total: number
  /** Cash and UPI that actually changed hands at the counter. */
  payments: BillPayments
  /** Paid out of the guest's wallet. */
  walletApplied: number
  /** Left on the guest's wallet to pay next time. */
  creditAmount: number
  /** Handed over beyond the bill and kept in the wallet. */
  walletTopUp: number
  settledAt: string
  settledByUserId: ID
  settledByName: string
}

/* ------------------------------------------------------------------ */
/* Customers & wallet                                                  */
/* ------------------------------------------------------------------ */

/** A guest we know by mobile number, created the first time one is typed. */
export interface Customer extends Timestamps {
  id: ID
  /** Digits only, last 10. The lookup key, unique across customers. */
  phone: string
  name: string
  /** Anything the counter wants to remember ("regular, likes table G2"). */
  note?: string
}

/**
 * How the entry reads in history. It never changes the arithmetic — the
 * balance is always the signed sum of `amount`.
 *   topup      guest put money into the wallet (or paid over a bill)
 *   spend      wallet money paid for a bill
 *   credit     a bill went out unpaid
 *   repayment  guest cleared what they owed
 *   adjustment manager correction, note required
 *   refund     wallet money handed back to the guest
 */
export const WALLET_ENTRY_KINDS = [
  'topup',
  'spend',
  'credit',
  'repayment',
  'adjustment',
  'refund',
] as const
export type WalletEntryKind = (typeof WALLET_ENTRY_KINDS)[number]

/**
 * One movement in a guest's wallet, signed from the cafe's side:
 *   positive -> the cafe is holding the guest's money
 *   negative -> the guest owes the cafe
 * The balance is the running sum, so one wallet covers both directions and
 * nothing has to be zeroed when a guest swings from owing to in credit.
 */
export interface WalletEntry {
  id: ID
  customerId: ID
  amount: number
  kind: WalletEntryKind
  /** Set when the entry came out of settling a bill. */
  billId?: ID
  billNumber?: number
  /** How the cash moved, for money taken or returned at the counter. */
  method?: PaymentMethod
  note?: string
  at: string
  byUserId: ID
  byName: string
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
  currency: 'INR'
  /** Open the guest lookup when a table's first round is started. */
  askCustomerInfo: boolean
  /** Customer wallets: money held for a guest, and bills paid later. */
  wallet: {
    /** Allow a bill to go out partly or fully unpaid. Needs a mobile number. */
    allowPayLater: boolean
  }
  /** Audible alert on the kitchen display. */
  sound: {
    /** Ring when a new round reaches the kitchen. */
    newOrderAlert: boolean
    /** 0-1, applied to the synthesised chime. */
    volume: number
    /** Keep re-ringing while a round sits untouched in New orders. */
    repeatUntilAcknowledged: boolean
    /** Seconds between those repeats. */
    repeatSeconds: number
  }
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
  bills: Bill[]
  customers: Customer[]
  walletEntries: WalletEntry[]
  users: User[]
  settings: CafeSettings
  counters: { nextOrderNumber: number; nextBillNumber: number }
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
  | { type: 'BILL_SETTLED'; billId: ID; tableId: ID | null }
  | { type: 'ORDER_CANCELLED'; orderId: ID }
  | { type: 'CUSTOMERS_UPDATED' }
  | { type: 'MENU_UPDATED' }
  | { type: 'TABLES_UPDATED' }
  | { type: 'SETTINGS_UPDATED' }

export type ConnectionStatus = 'live' | 'offline'
