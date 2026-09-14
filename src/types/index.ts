/**
 * Domain models for the Swaada Café POS.
 *
 * These are the shapes the UI works with. Firestore stores them almost
 * verbatim (see services/firebase/converters.ts for the few differences:
 * modifier options are nested inside their group, and timestamps are stored
 * as Firestore Timestamps and read back as ISO strings).
 *
 * Everything lives under one outlet: /outlets/{outletId}/<collection>/{id}.
 * IDs are strings. Timestamps are ISO strings so they sort lexically and
 * survive JSON without a Date round-trip.
 */

export type ID = string

export interface Timestamps {
  createdAt: string
  updatedAt: string
}

/* ------------------------------------------------------------------ */
/* Outlet                                                              */
/* ------------------------------------------------------------------ */

/**
 * One cafe. Everything else hangs off this, so a second branch is a new
 * document rather than a migration.
 */
export interface Outlet extends Timestamps {
  id: ID
  name: string
  /** Short lowercase handle used in usernames and exports, e.g. "swaada". */
  slug: string
  isActive: boolean
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
  /**
   * False for a shelf rather than a stove: cigarettes and bottled water are
   * handed over at the counter, so they never reach the kitchen board and
   * never wait to be cooked. They still appear on the bill like anything else.
   */
  preparesFood: boolean
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
  /**
   * The cafe day this round belongs to (YYYY-MM-DD in the outlet's zone).
   * Every bounded query filters on this: it is what keeps the live listeners
   * small and the read bill near zero as history grows.
   */
  businessDate: string
  tableId: ID | null
  tableName: string
  /**
   * Which party at the table this round belongs to. One table often seats
   * two or three separate groups who each pay for themselves, so the bill is
   * grouped by (table, groupNo) rather than by table alone. Everything that
   * came before the split is group 1.
   */
  groupNo: number
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
  /** Same cafe day as the rounds it settles. See Order.businessDate. */
  businessDate: string
  tableId: ID | null
  tableName: string
  /** The party at that table this bill settles. */
  groupNo: number
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
  /**
   * Old dues the guest cleared at the same counter visit. Money on top of
   * this bill, which is why `payments` can exceed `total`.
   */
  duesCleared: number
  /** Handed over beyond the bill and its dues, and kept in the wallet. */
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
  /**
   * A CACHE of the wallet balance, not the truth.
   *
   * The truth is still the signed sum of the guest's ledger, and every
   * screen that shows one guest recomputes it from their entries. This field
   * exists only so the guest book can answer "who owes me money" in one
   * query — without it, listing fifty guests with balances would mean fifty
   * ledger reads, and filtering by who owes would be impossible.
   *
   * It is kept honest by never being assigned: every wallet entry is written
   * in the same atomic batch as an `increment()` on this field, so the two
   * move together or not at all, offline included. If it ever does drift,
   * the guest's own page will disagree with the list, which is the right
   * way round — the cheap number is the one that looks wrong.
   */
  balance?: number
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
  /** Cafe day, for the day-end figures. See Order.businessDate. */
  businessDate: string
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
/* Staff, roles and sessions                                           */
/* ------------------------------------------------------------------ */

/**
 * Three people work this app. The manager runs the cafe, the kitchen cooks,
 * and the counter takes orders and watches the kitchen board — nothing that
 * touches money, the menu or the books.
 *
 * The role is not only a UI concern: it is written into the Firebase auth
 * token as a custom claim, and the Firestore security rules read it from
 * there. A counter login physically cannot read the books, whatever the
 * client code does.
 */
export const USER_ROLES = ['admin', 'counter', 'kitchen'] as const
export type UserRole = (typeof USER_ROLES)[number]

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Manager',
  counter: 'Counter',
  kitchen: 'Kitchen',
}

/**
 * A staff member. The document id IS the Firebase Auth uid, so a staff row
 * and a login are the same thing and can never drift apart.
 *
 * This document is also the SOURCE OF TRUTH for the person's role. The
 * security rules read it on every request with a `get()`, which costs one
 * document read per request and buys two things worth having: it works
 * entirely on Firebase's free plan, and a role change or a switch-off takes
 * effect on the very next request rather than whenever the auth token next
 * refreshes.
 *
 * There is no password field here. Passwords live in Firebase Auth and are
 * never readable, by us or by anyone.
 */
export interface StaffMember extends Timestamps {
  /** Firebase Auth uid. */
  id: ID
  /** Denormalised so the security rules can check it without a second read. */
  outletId: ID
  /** What they type to sign in. Unique across the whole system, lowercase. */
  username: string
  displayName: string
  role: UserRole
  isActive: boolean
  /** uid of the admin who created them. */
  createdBy: ID
  /**
   * Set when this login was superseded because the person forgot their
   * password. Without Cloud Functions a manager cannot change someone
   * else's password, so the recovery path is a new login and this points at
   * it, keeping the trail readable.
   */
  replacedByUsername?: string
}

/** The signed-in staff member, as the app carries them around. */
export interface Session {
  /** Firebase Auth uid. Kept as `userId` so existing call sites still read. */
  userId: ID
  outletId: ID
  username: string
  name: string
  role: UserRole
  loginAt: string
}

/**
 * The one document outside any outlet: it answers "which outlet does this
 * uid belong to", which a freshly signed-in browser has to know before it is
 * allowed to read anything else. A staff member may read only their own.
 */
export interface StaffIndexEntry {
  /** Firebase Auth uid. */
  id: ID
  outletId: ID
  username: string
}

/**
 * A claimed username, keyed BY the username itself.
 *
 * Usernames are global, because the synthetic email they map to is global.
 * A browser cannot ask Firebase Auth "does this account exist" — so without
 * this, the only way to discover a clash would be to try creating the
 * account and read the error, which burns a real auth user on every typo.
 * This makes the check a single get by id, before anything is created.
 */
export interface UsernameClaim {
  /** The username, lowercase. Also the document id. */
  id: ID
  uid: ID
  outletId: ID
}

/* ------------------------------------------------------------------ */
/* Audit log                                                           */
/* ------------------------------------------------------------------ */

/**
 * Append-only record of anything that moves money or changes what the cafe
 * sells. The security rules allow create and deny update and delete, so a
 * manager cannot quietly rewrite last week.
 */
export const AUDIT_ACTIONS = [
  'order.void',
  'order.cancel',
  'order.item_adjust',
  'bill.settle',
  'bill.discount',
  'wallet.adjust',
  'wallet.refund',
  'menu.price_change',
  'menu.archive',
  'staff.create',
  'staff.update',
  'staff.disable',
  'staff.password_reset',
  'settings.update',
] as const
export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export interface AuditEntry {
  id: ID
  action: AuditAction
  /** Cafe day, so the log can be read a day at a time. */
  businessDate: string
  at: string
  byUserId: ID
  byName: string
  byRole: UserRole
  /** Free-form, one line, written for a human reading it a month later. */
  summary: string
  /** The thing acted on, for filtering: { orderId, billId, itemId, ... }. */
  target?: Record<string, string | number>
  /** Before/after for value changes, e.g. { field: 'basePrice', from: 80, to: 90 }. */
  change?: Record<string, string | number | null>
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export interface CafeSettings {
  cafeName: string
  currency: 'INR'
  /** IANA zone the cafe's day is measured in. See lib/businessDate.ts. */
  timezone: string
  /** Rounds rung up before this hour count as the previous business day. */
  dayStartHour: number
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
/* Live state held in memory                                           */
/* ------------------------------------------------------------------ */

/**
 * What the app keeps in memory, and NOT what the database holds.
 *
 * This is the single most important change from the prototype. The mock db
 * kept every order ever taken in one object and handed it to every screen.
 * Against a real database that pattern means downloading the whole history
 * on every app start, which is slow, expensive, and gets worse every day the
 * cafe is open.
 *
 * So the listeners are scoped:
 *   - the catalogue (menu, tables, stations, staff, settings) is small and
 *     changes rarely, so it is held in full;
 *   - `orders` holds only UNSETTLED rounds — what is on the floor right now;
 *   - `bills` and `walletEntries` hold only TODAY, for the day-end figures.
 *
 * History, analytics and customer search do not live here at all. They run
 * paged queries against Firestore on demand (services/firebase/queries.ts),
 * so opening last month's numbers costs one query instead of being carried
 * around all day.
 */
export interface LiveSnapshot {
  outlet: Outlet | null
  categories: Category[]
  items: MenuItem[]
  modifierGroups: ModifierGroup[]
  modifierOptions: ModifierOption[]
  stations: Station[]
  tables: CafeTable[]
  /** Unsettled rounds only. */
  orders: Order[]
  /**
   * Today's cancelled rounds. A cancelled round leaves `orders` (it is no
   * longer active), so without this the kitchen would simply watch a ticket
   * vanish mid-cook with no explanation. Bounded to one day.
   */
  recentlyCancelled: Order[]
  /** Today's bills only. */
  bills: Bill[]
  /** Today's wallet movements only. */
  walletEntries: WalletEntry[]
  /** Today's customers are fetched on demand; this holds ones in play now. */
  customers: Customer[]
  staff: StaffMember[]
  settings: CafeSettings
}

/* ------------------------------------------------------------------ */
/* Connection                                                          */
/* ------------------------------------------------------------------ */

/**
 * What the badge in the header shows.
 *   live     talking to Firestore, everything written is saved
 *   syncing  online, but this device has writes still on their way up
 *   offline  serving from the local cache; writes are queued and will sync
 */
export type ConnectionStatus = 'live' | 'syncing' | 'offline'
