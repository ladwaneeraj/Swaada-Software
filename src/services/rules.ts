import { byDisplayOrder, clamp, isToday, round2 } from '@/lib/utils'
import { PAYMENT_METHODS } from '@/types'
import type {
  Bill,
  BillPayments,
  Category,
  Customer,
  FloorState,
  ID,
  ItemAvailability,
  MenuItem,
  ModifierGroup,
  ModifierOption,
  Order,
  OrderItem,
  OrderItemModifier,
  PaymentMethod,
  Station,
  WalletEntry,
} from '@/types'

/**
 * The cafe's rules, as pure functions.
 *
 * Nothing in this file touches Firebase, the network, or the clock beyond
 * being handed a timestamp. Every number the counter sees — a round total, a
 * bill, a wallet balance, the day-end drawer — is computed here and only
 * here, so the settle sheet and the write that follows it can never disagree
 * about what is owed.
 *
 * Keeping it separate from the Firestore services buys two things: the
 * arithmetic can be tested with plain objects and no emulator, and the parts
 * most expensive to get wrong did not have to be rewritten when the backend
 * changed. This is the prototype's logic, unchanged.
 */


/* ---------------------------- Menu inputs ---------------------------- */

export interface CategoryInput {
  name: string
  description: string
  icon: string
  isActive: boolean
}

export interface MenuItemInput {
  categoryId: ID
  name: string
  description: string
  /** Bundled illustration path or a full photo URL; null shows the category icon. */
  image: string | null
  basePrice: number
  availability: ItemAvailability
  isVegetarian: boolean
  isPopular: boolean
  isRecommended: boolean
  preparationTimeMin: number
  stationId: ID
  modifierGroupIds: ID[]
  tags: string[]
}

export interface TableInput {
  name: string
  zone: string
  capacity: number
  isActive: boolean
}

/* ------------------------------ Ordering ----------------------------- */

export interface CartModifierSelection {
  group: ModifierGroup
  option: ModifierOption
}

export interface PlaceOrderLine {
  menuItem: MenuItem
  quantity: number
  modifiers: CartModifierSelection[]
  specialInstructions: string
}

export function lineUnitPrice(basePrice: number, modifiers: OrderItemModifier[]): number {
  return basePrice + modifiers.reduce((sum, m) => sum + m.priceAdjustment, 0)
}

/** A round's payable amount: the sum of its live lines. No tax is charged. */
export function orderTotal(items: OrderItem[]): number {
  return round2(
    items
      .filter((i) => i.status !== 'cancelled')
      .reduce((sum, i) => sum + i.unitPrice * i.quantity, 0),
  )
}

/* ------------------------------- Billing ----------------------------- */

export interface BillPreview {
  subtotal: number
  discountAmount: number
  total: number
}

/**
 * The ONE place bill arithmetic lives: the settle sheet preview and the
 * actual settlement both call this, so what the cashier sees is what gets
 * charged. The discount is a flat rupee amount off the subtotal, and no tax
 * is applied anywhere.
 */
export function computeBillPreview(input: {
  rounds: Order[]
  discountAmount?: number
}): BillPreview {
  const subtotal = round2(input.rounds.reduce((sum, o) => sum + o.total, 0))
  const discountAmount = round2(clamp(input.discountAmount ?? 0, 0, subtotal))
  return { subtotal, discountAmount, total: round2(subtotal - discountAmount) }
}

/** Methods that actually contributed to a bill, in PAYMENT_METHODS order. */
export function paidMethods(payments: BillPayments): Array<[PaymentMethod, number]> {
  return PAYMENT_METHODS.map((m) => [m, payments[m]] as [PaymentMethod, number]).filter(
    ([, amount]) => amount > 0,
  )
}

/* ------------------------------ Customers ---------------------------- */

/** Digits only, last ten: "+91 98765 43210" and "9876543210" are one guest. */
export function normalisePhone(input: string): string {
  return input.replace(/\D/g, '').slice(-10)
}

export function isCompletePhone(input: string): boolean {
  return normalisePhone(input).length === 10
}

/* -------------------------------- Wallet ----------------------------- */

export function walletBalance(entries: WalletEntry[], customerId: ID | undefined): number {
  if (!customerId) return 0
  return round2(entries.filter((e) => e.customerId === customerId).reduce((sum, e) => sum + e.amount, 0))
}

/** A guest's entries, newest first. */
export function walletLedger(entries: WalletEntry[], customerId: ID): WalletEntry[] {
  return entries.filter((e) => e.customerId === customerId).sort((a, b) => b.at.localeCompare(a.at))
}

/** What the guest owes right now, positive (0 when they are in credit). */
export function walletOwed(balance: number): number {
  return balance < 0 ? round2(-balance) : 0
}

/** Money the cafe is holding for them, positive (0 when they owe). */
export function walletHeld(balance: number): number {
  return balance > 0 ? round2(balance) : 0
}

/* -------------------------- Derived customer views ------------------- */

export interface CustomerProfile {
  phone: string
  name: string
  visits: number
  totalSpent: number
  lastVisitAt: string
}

export function customerProfiles(bills: Bill[]): CustomerProfile[] {
  const byPhone = new Map<string, CustomerProfile>()
  for (const bill of [...bills].sort((a, b) => a.settledAt.localeCompare(b.settledAt))) {
    if (!bill.customerPhone) continue
    const existing = byPhone.get(bill.customerPhone)
    const profile: CustomerProfile = existing ?? {
      phone: bill.customerPhone,
      name: bill.customerName ?? 'Guest',
      visits: 0,
      totalSpent: 0,
      lastVisitAt: bill.settledAt,
    }
    profile.name = bill.customerName || profile.name
    profile.visits += 1
    profile.totalSpent = round2(profile.totalSpent + bill.total)
    profile.lastVisitAt = bill.settledAt
    byPhone.set(bill.customerPhone, profile)
  }
  return [...byPhone.values()].sort((a, b) => b.lastVisitAt.localeCompare(a.lastVisitAt))
}

export function customerByPhone(bills: Bill[], phone: string): CustomerProfile | undefined {
  const key = normalisePhone(phone)
  return customerProfiles(bills).find((c) => normalisePhone(c.phone) === key)
}

/**
 * Everything the counter needs about one guest, in one object: who they are,
 * what they have spent with us, and where their account stands. Assembled
 * from the three sources rather than stored, so it cannot drift.
 */
export interface CustomerAccount {
  customer: Customer
  visits: number
  totalSpent: number
  lastVisitAt?: string
  /** + money the cafe holds in the wallet, − what the guest owes. */
  balance: number
}

export function customerAccounts(input: {
  customers: Customer[]
  bills: Bill[]
  walletEntries: WalletEntry[]
}): CustomerAccount[] {
  const stats = new Map(customerProfiles(input.bills).map((p) => [normalisePhone(p.phone), p]))
  return input.customers
    .map((customer) => {
      const s = stats.get(customer.phone)
      return {
        customer,
        visits: s?.visits ?? 0,
        totalSpent: s?.totalSpent ?? 0,
        lastVisitAt: s?.lastVisitAt,
        balance: walletBalance(input.walletEntries, customer.id),
      }
    })
    .sort((a, b) => (b.lastVisitAt ?? b.customer.createdAt).localeCompare(a.lastVisitAt ?? a.customer.createdAt))
}

/** The bills a guest has settled, newest first. */
export function billsForCustomer(bills: Bill[], customer: Customer): Bill[] {
  return bills
    .filter((b) => b.customerId === customer.id || normalisePhone(b.customerPhone ?? '') === customer.phone)
    .sort((a, b) => b.settledAt.localeCompare(a.settledAt))
}

/* ----------------------------- Settlement ---------------------------- */

/**
 * How one settlement is put together, in the order money moves: the wallet
 * first, then whatever the guest hands over now, then anything left for them
 * to pay later. The settle sheet and the service both call this, so what the
 * cashier sees on screen is exactly what gets written.
 */
export interface SettlementPlan {
  total: number
  /** Taken out of the wallet money the cafe is already holding. */
  walletApplied: number
  /** Left on the guest's wallet to pay next time. */
  creditAmount: number
  /** Of the extra handed over, the part that clears what was already owed. */
  duesCleared: number
  /** The rest of the extra: money kept in the wallet for next time. */
  walletTopUp: number
  /** What cash + UPI must add up to. */
  tenderTarget: number
  walletAvailable: number
  owedBefore: number
  balanceAfter: number
}

export function planSettlement(input: {
  total: number
  /** The wallet before this bill: + money held, − owed. */
  balance: number
  hasCustomer: boolean
  allowPayLater: boolean
  walletApplied?: number
  creditAmount?: number
  /**
   * GROSS money handed over beyond this bill — old dues and money kept for
   * next time are the same rupees at the counter. The split below is this
   * function's job, so callers never have to work it out (and can never get
   * it wrong by passing an already-split figure back in).
   */
  extraTendered?: number
}): SettlementPlan {
  const walletAvailable = walletHeld(input.balance)
  const owedBefore = walletOwed(input.balance)
  const walletApplied = input.hasCustomer
    ? round2(clamp(input.walletApplied ?? 0, 0, Math.min(walletAvailable, input.total)))
    : 0
  const creditAmount =
    input.hasCustomer && input.allowPayLater
      ? round2(clamp(input.creditAmount ?? 0, 0, round2(input.total - walletApplied)))
      : 0
  const extra = input.hasCustomer ? round2(Math.max(0, input.extraTendered ?? 0)) : 0
  // Paying off a debt and leaving money on account look identical in the
  // drawer but mean opposite things on the guest's account, so they are two
  // numbers from here on. Debt is cleared first: nobody tops up a wallet
  // they are overdrawn on.
  const duesCleared = round2(Math.min(extra, owedBefore))
  const walletTopUp = round2(extra - duesCleared)

  return {
    total: input.total,
    walletApplied,
    creditAmount,
    duesCleared,
    walletTopUp,
    tenderTarget: round2(input.total - walletApplied - creditAmount + extra),
    walletAvailable,
    owedBefore,
    balanceAfter: round2(input.balance - walletApplied - creditAmount + extra),
  }
}

/* ------------------------------ Day money ---------------------------- */

/**
 * Two different questions a cafe asks at closing time, kept apart on purpose:
 * what was SOLD today, and what was COLLECTED today. They differ by exactly
 * the amount that was eaten on credit, paid out of a wallet, or handed over
 * for later — so the drawer reconciles even when guests pay on their own
 * schedule.
 */
export interface DayMoney {
  sales: number
  collected: number
  cash: number
  upi: number
  fromWallet: number
  leftUnpaid: number
  /** Old debts guests settled today, on top of their bills. */
  duesCleared: number
  walletTopUps: number
}

export function moneyForDay(input: {
  bills: Bill[]
  walletEntries: WalletEntry[]
  /** Defaults to "today" on this device. */
  onDay?: (iso: string) => boolean
}): DayMoney {
  const onDay = input.onDay ?? isToday
  const bills = input.bills.filter((b) => onDay(b.settledAt))
  // Money taken or returned at the counter, outside any bill.
  const counter = input.walletEntries.filter((e) => onDay(e.at) && !e.billId && e.method)

  const cash = round2(
    bills.reduce((s, b) => s + b.payments.cash, 0) +
      counter.filter((e) => e.method === 'cash').reduce((s, e) => s + e.amount, 0),
  )
  const upi = round2(
    bills.reduce((s, b) => s + b.payments.upi, 0) +
      counter.filter((e) => e.method === 'upi').reduce((s, e) => s + e.amount, 0),
  )

  return {
    sales: round2(bills.reduce((s, b) => s + b.total, 0)),
    collected: round2(cash + upi),
    cash,
    upi,
    fromWallet: round2(bills.reduce((s, b) => s + b.walletApplied, 0)),
    leftUnpaid: round2(bills.reduce((s, b) => s + b.creditAmount, 0)),
    duesCleared: round2(
      bills.reduce((s, b) => s + b.duesCleared, 0) +
        input.walletEntries
          .filter((e) => onDay(e.at) && !e.billId && e.kind === 'repayment')
          .reduce((s, e) => s + e.amount, 0),
    ),
    walletTopUps: round2(
      bills.reduce((s, b) => s + b.walletTopUp, 0) +
        counter.filter((e) => e.amount > 0 && e.kind !== 'repayment').reduce((s, e) => s + e.amount, 0),
    ),
  }
}

/** The bill a settled round belongs to, for history and receipts. */
export function billForOrder(bills: Bill[], order: Order): Bill | undefined {
  return order.billId ? bills.find((b) => b.id === order.billId) : undefined
}

/**
 * Every rupee of a bill, in the order a person reads them, so a screen can
 * show the arithmetic instead of asking anyone to trust it. The identity the
 * counter actually cares about:
 *
 *   cash + UPI  =  total − fromWallet − leftUnpaid + duesCleared + keptInWallet
 *
 * `balances` re-checks that on the stored bill rather than on the plan that
 * produced it, so a bill written by an older build shows up as suspect
 * instead of quietly rendering a wrong-looking sum.
 */
export interface BillBreakdown {
  total: number
  fromWallet: number
  leftUnpaid: number
  duesCleared: number
  keptInWallet: number
  cash: number
  upi: number
  collected: number
  /** Of what was collected, the part that belongs to this bill. */
  towardsThisBill: number
  balances: boolean
}

export function billBreakdown(bill: Bill): BillBreakdown {
  const cash = round2(bill.payments.cash || 0)
  const upi = round2(bill.payments.upi || 0)
  const collected = round2(cash + upi)
  const expected = round2(
    bill.total - bill.walletApplied - bill.creditAmount + bill.duesCleared + bill.walletTopUp,
  )
  return {
    total: bill.total,
    fromWallet: bill.walletApplied,
    leftUnpaid: bill.creditAmount,
    duesCleared: bill.duesCleared,
    keptInWallet: bill.walletTopUp,
    cash,
    upi,
    collected,
    towardsThisBill: round2(bill.total - bill.walletApplied - bill.creditAmount),
    balances: Math.abs(collected - expected) < 0.01,
  }
}

/* ------------------------- Order & floor helpers --------------------- */

/** Unpaid: on the floor or awaiting settlement. */
export const ACTIVE_ORDER_STATUSES = ['placed', 'preparing', 'ready', 'delivered'] as const

/** Still the kitchen's problem (delivered rounds are not). */
export const KITCHEN_ACTIVE_STATUSES = ['placed', 'preparing', 'ready'] as const

/**
 * The lines on a round that the kitchen actually has to make. Cigarettes and
 * bottled water are handed over at the counter, so they are left off the
 * ticket entirely rather than sitting there already ticked.
 */
export function kitchenItems(order: Order, stations: Station[]): OrderItem[] {
  const shelf = new Set(stations.filter((st) => !st.preparesFood).map((st) => st.id))
  return order.items.filter((i) => !shelf.has(i.stationId))
}



export function isActiveOrder(order: Order): boolean {
  return (ACTIVE_ORDER_STATUSES as readonly string[]).includes(order.status)
}

export function isKitchenActiveOrder(order: Order): boolean {
  return (KITCHEN_ACTIVE_STATUSES as readonly string[]).includes(order.status)
}

/** All unpaid rounds for a table, oldest first. */
export function activeOrdersForTable(orders: Order[], tableId: ID): Order[] {
  return orders
    .filter((o) => o.tableId === tableId && isActiveOrder(o))
    .sort((a, b) => a.placedAt.localeCompare(b.placedAt))
}

/** One party's live rounds at a table. This is what a single bill covers. */
export function activeOrdersForGroup(orders: Order[], tableId: ID, groupNo: number): Order[] {
  return activeOrdersForTable(orders, tableId).filter((o) => o.groupNo === groupNo)
}

/**
 * A table can seat several parties at once, each paying separately. This is
 * every party currently sitting at one, in the order they arrived, and it is
 * what the floor tile draws one row per.
 */
export interface TableGroup {
  groupNo: number
  rounds: Order[]
  /** Denormalised off the first round, so the tile needs nothing else. */
  customerId?: ID
  customerName?: string
  total: number
  state: FloorState
  startedAt: string
}

export function groupsAtTable(orders: Order[], tableId: ID): TableGroup[] {
  const byGroup = new Map<number, Order[]>()
  for (const order of activeOrdersForTable(orders, tableId)) {
    byGroup.set(order.groupNo, [...(byGroup.get(order.groupNo) ?? []), order])
  }
  return [...byGroup.entries()]
    .map(([groupNo, rounds]) => ({
      groupNo,
      rounds,
      customerId: rounds[0]?.customerId,
      customerName: rounds[0]?.customerName,
      total: round2(rounds.reduce((sum, o) => sum + o.total, 0)),
      state: floorState(rounds),
      startedAt: rounds[0]?.placedAt ?? '',
    }))
    .sort((a, b) => a.groupNo - b.groupNo)
}

/** The number a new party at this table should get. */
export function nextGroupNo(orders: Order[], tableId: ID): number {
  const taken = groupsAtTable(orders, tableId).map((g) => g.groupNo)
  return taken.length === 0 ? 1 : Math.max(...taken) + 1
}

/**
 * The floor-plan state of a table, most urgent first: food waiting to be
 * carried out beats food still cooking, which beats a table that has eaten
 * and owes money.
 */
export function floorState(rounds: Order[]): FloorState {
  if (rounds.length === 0) return 'free'
  if (rounds.some((o) => o.status === 'ready')) return 'ready'
  if (rounds.some((o) => o.status === 'placed' || o.status === 'preparing')) return 'running'
  return 'billing'
}

/* ------------------------------ Menu views --------------------------- */

export function sortedActiveCategories(categories: Category[]): Category[] {
  return categories.filter((c) => c.isActive).sort(byDisplayOrder)
}

export function itemsForCategory(items: MenuItem[], categoryId: ID): MenuItem[] {
  return items.filter((i) => i.categoryId === categoryId).sort(byDisplayOrder)
}

export function searchMenu(items: MenuItem[], categories: Category[], query: string): MenuItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return items
  const categoryNameById = new Map(categories.map((c) => [c.id, c.name.toLowerCase()]))
  return items.filter(
    (i) =>
      i.name.toLowerCase().includes(q) ||
      (categoryNameById.get(i.categoryId) ?? '').includes(q) ||
      i.tags.some((t) => t.toLowerCase().includes(q)),
  )
}

export function optionsForGroup(options: ModifierOption[], groupId: ID): ModifierOption[] {
  return options.filter((o) => o.modifierGroupId === groupId).sort(byDisplayOrder)
}

export function stationById(stations: Station[], id: ID): Station | undefined {
  return stations.find((s) => s.id === id)
}


/* --------------------------- Customer lookups ------------------------- */

/** Find a guest by any format of their mobile number. */
export function findCustomer(customers: Customer[], phone: string): Customer | undefined {
  const key = normalisePhone(phone)
  return key.length === 10 ? customers.find((c) => c.phone === key) : undefined
}

export function customerById(customers: Customer[], id: ID | undefined): Customer | undefined {
  return id ? customers.find((c) => c.id === id) : undefined
}
