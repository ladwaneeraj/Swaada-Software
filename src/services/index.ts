import { byDisplayOrder, clamp, isToday, nowISO, round2, uid } from '@/lib/utils'
import type {
  Bill,
  BillPayments,
  CafeSettings,
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
  OrderItemStatus,
  RealtimeEvent,
  Session,
  PaymentMethod,
  Station,
  WalletEntry,
  WalletEntryKind,
} from '@/types'
import { PAYMENT_METHODS } from '@/types'
import { db } from './db'

/**
 * Service layer: the ONLY place that reads or writes data.
 *
 * Components and the store call these functions; the functions talk to the
 * mock db. Replacing the mock with Supabase/an API later means reimplementing
 * these bodies (likely async) while keeping the same shapes.
 */

/* ------------------------------- Auth ---------------------------------- */
/* Session lives in sessionStorage so each browser tab can hold its own    */
/* role — that is what lets one tab be Admin and another be Kitchen.       */

const SESSION_KEY = 'swaada.session.v1'

export const authService = {
  listUsers() {
    return db.get().users
  },

  login(userId: ID, pin: string): Session | null {
    const user = db.get().users.find((u) => u.id === userId)
    if (!user || user.pin !== pin) return null
    const session: Session = {
      userId: user.id,
      name: user.name,
      role: user.role,
      loginAt: nowISO(),
    }
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
    } catch {
      /* private mode: keep in-memory only */
    }
    return session
  },

  getSession(): Session | null {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY)
      return raw ? (JSON.parse(raw) as Session) : null
    } catch {
      return null
    }
  },

  logout(): void {
    try {
      sessionStorage.removeItem(SESSION_KEY)
    } catch {
      /* ignore */
    }
  },
}

/* ------------------------------- Menu ---------------------------------- */

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

export const menuService = {
  createCategory(input: CategoryInput): void {
    db.mutate((draft) => {
      const maxOrder = Math.max(0, ...draft.categories.map((c) => c.displayOrder))
      draft.categories.push({
        id: uid('cat'),
        ...input,
        image: null,
        displayOrder: maxOrder + 1,
        createdAt: nowISO(),
        updatedAt: nowISO(),
      })
      return { type: 'MENU_UPDATED' }
    })
  },

  updateCategory(id: ID, patch: Partial<CategoryInput>): void {
    db.mutate((draft) => {
      const cat = draft.categories.find((c) => c.id === id)
      if (!cat) return
      Object.assign(cat, patch, { updatedAt: nowISO() })
      return { type: 'MENU_UPDATED' }
    })
  },

  /**
   * Soft delete: the category disappears from every screen but historical
   * orders keep their denormalised category names.
   */
  archiveCategory(id: ID): void {
    db.mutate((draft) => {
      draft.categories = draft.categories.filter((c) => c.id !== id)
      draft.items = draft.items.filter((i) => i.categoryId !== id)
      return { type: 'MENU_UPDATED' }
    })
  },

  reorderCategories(orderedIds: ID[]): void {
    db.mutate((draft) => {
      orderedIds.forEach((id, index) => {
        const cat = draft.categories.find((c) => c.id === id)
        if (cat) cat.displayOrder = index + 1
      })
      return { type: 'MENU_UPDATED' }
    })
  },

  createItem(input: MenuItemInput): void {
    db.mutate((draft) => {
      const siblings = draft.items.filter((i) => i.categoryId === input.categoryId)
      const maxOrder = Math.max(0, ...siblings.map((i) => i.displayOrder))
      draft.items.push({
        id: uid('itm'),
        ...input,
        displayOrder: maxOrder + 1,
        createdAt: nowISO(),
        updatedAt: nowISO(),
      })
      return { type: 'MENU_UPDATED' }
    })
  },

  updateItem(id: ID, patch: Partial<MenuItemInput>): void {
    db.mutate((draft) => {
      const item = draft.items.find((i) => i.id === id)
      if (!item) return
      Object.assign(item, patch, { updatedAt: nowISO() })
      return { type: 'MENU_UPDATED' }
    })
  },

  setItemAvailability(id: ID, availability: ItemAvailability): void {
    this.updateItem(id, { availability })
  },

  archiveItem(id: ID): void {
    db.mutate((draft) => {
      draft.items = draft.items.filter((i) => i.id !== id)
      return { type: 'MENU_UPDATED' }
    })
  },

  reorderItems(categoryId: ID, orderedIds: ID[]): void {
    db.mutate((draft) => {
      orderedIds.forEach((id, index) => {
        const item = draft.items.find((i) => i.id === id && i.categoryId === categoryId)
        if (item) item.displayOrder = index + 1
      })
      return { type: 'MENU_UPDATED' }
    })
  },
}

/* ------------------------------ Ordering -------------------------------- */

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

export const orderService = {
  placeOrder(input: {
    tableId: ID | null
    lines: PlaceOrderLine[]
    session: Session
    /** The guest this sitting belongs to, when one was identified. */
    customerId?: ID
  }): Order {
    let created: Order | null = null
    db.mutate((draft) => {
      const table = draft.tables.find((t) => t.id === input.tableId)
      const now = nowISO()
      const stationById = new Map(draft.stations.map((s) => [s.id, s]))
      const categoryById = new Map(draft.categories.map((c) => [c.id, c]))
      const customer = customerService.byId(draft.customers, input.customerId)

      const items: OrderItem[] = input.lines.map((line) => {
        const modifiers: OrderItemModifier[] = line.modifiers.map((m) => ({
          groupId: m.group.id,
          groupName: m.group.name,
          optionId: m.option.id,
          optionName: m.option.name,
          priceAdjustment: m.option.priceAdjustment,
        }))
        return {
          id: uid('oi'),
          menuItemId: line.menuItem.id,
          name: line.menuItem.name,
          categoryId: line.menuItem.categoryId,
          categoryName: categoryById.get(line.menuItem.categoryId)?.name ?? '',
          stationId: line.menuItem.stationId,
          stationName: stationById.get(line.menuItem.stationId)?.name ?? 'Kitchen',
          isVegetarian: line.menuItem.isVegetarian,
          basePrice: line.menuItem.basePrice,
          unitPrice: lineUnitPrice(line.menuItem.basePrice, modifiers),
          quantity: line.quantity,
          modifiers,
          specialInstructions: line.specialInstructions,
          status: 'queued',
          queuedAt: now,
        }
      })

      const order: Order = {
        id: uid('ord'),
        orderNumber: draft.counters.nextOrderNumber,
        tableId: input.tableId,
        tableName: table?.name ?? 'Takeaway',
        items,
        status: 'placed',
        total: orderTotal(items),
        createdByUserId: input.session.userId,
        createdByName: input.session.name,
        // Denormalised alongside the id so an old round still reads correctly
        // if the guest is renamed later, exactly like the item snapshots.
        customerId: customer?.id,
        customerName: customer?.name,
        customerPhone: customer?.phone,
        placedAt: now,
      }
      draft.counters.nextOrderNumber += 1
      draft.orders.push(order)
      created = order
      return { type: 'ORDER_CREATED', orderId: order.id }
    })
    if (!created) throw new Error('placeOrder failed')
    return created
  },

  /**
   * Attach, change or clear the guest on a table's open rounds. Guests often
   * only give their number when the bill arrives — usually because they want
   * to pay later — so this has to work after the food is already served.
   */
  setSittingCustomer(tableId: ID, customerId: ID | null): void {
    db.mutate((draft) => {
      const open = draft.orders.filter((o) => o.tableId === tableId && isActiveOrder(o))
      if (open.length === 0) return
      const customer = customerId ? draft.customers.find((c) => c.id === customerId) : undefined
      open.forEach((o) => {
        o.customerId = customer?.id
        o.customerName = customer?.name
        o.customerPhone = customer?.phone
      })
      return open.map((o) => ({ type: 'ORDER_UPDATED', orderId: o.id }) as RealtimeEvent)
    })
  },

  cancelOrder(orderId: ID, reason: string): void {
    db.mutate((draft) => {
      const order = draft.orders.find((o) => o.id === orderId)
      // Delivered rounds are part of the open bill and can't be cancelled here.
      if (!order || order.status === 'settled' || order.status === 'cancelled' || order.status === 'delivered')
        return
      order.status = 'cancelled'
      order.cancelledAt = nowISO()
      order.cancelReason = reason
      order.items.forEach((i) => {
        if (i.status !== 'ready') i.status = 'cancelled'
      })
      return { type: 'ORDER_CANCELLED', orderId }
    })
  },

  /**
   * Void a DELIVERED round before settlement (wrong item, guest refused).
   * Distinct from cancelOrder so the ordinary cancel path can't touch
   * delivered food by accident; a reason is always recorded.
   */
  voidDeliveredRound(orderId: ID, reason: string): void {
    db.mutate((draft) => {
      const order = draft.orders.find((o) => o.id === orderId)
      if (!order || order.status !== 'delivered') return
      order.status = 'cancelled'
      order.cancelledAt = nowISO()
      order.cancelReason = `Voided: ${reason || 'no reason given'}`
      order.items.forEach((i) => {
        if (i.status !== 'ready') i.status = 'cancelled'
      })
      return { type: 'ORDER_CANCELLED', orderId }
    })
  },

  /**
   * Correct a single line on a round that has not been paid for yet: reduce
   * its quantity, or remove it outright with `quantity: 0`.
   *
   * Quantities can only go DOWN. Adding food means a new round, because a
   * round is what the kitchen has already been told to cook; silently
   * bumping a quantity here would put an item on the bill that nobody made.
   * The round's total is recomputed, and a round left with nothing on it is
   * cancelled rather than sitting on the bill at ₹0.
   */
  adjustItem(input: {
    orderId: ID
    itemId: ID
    quantity: number
    reason: string
    session: Session
  }): void {
    db.mutate((draft) => {
      const order = draft.orders.find((o) => o.id === input.orderId)
      if (!order || order.status === 'settled' || order.status === 'cancelled') return
      const item = order.items.find((i) => i.id === input.itemId)
      if (!item || item.status === 'cancelled') return

      const next = Math.max(0, Math.floor(input.quantity))
      if (next >= item.quantity) return

      const now = nowISO()
      const adjustment = {
        at: now,
        byName: input.session.name,
        reason: input.reason.trim() || 'no reason given',
        fromQuantity: item.quantity,
      }
      if (next === 0) {
        item.status = 'cancelled'
        item.adjustment = adjustment
      } else {
        item.quantity = next
        item.adjustment = adjustment
      }

      const live = order.items.filter((i) => i.status !== 'cancelled')
      if (live.length === 0) {
        order.status = 'cancelled'
        order.cancelledAt = now
        order.cancelReason = `Every item removed: ${adjustment.reason}`
        order.total = 0
        return { type: 'ORDER_CANCELLED', orderId: order.id }
      }

      order.total = orderTotal(order.items)
      // Removing the last unfinished item can complete a round that was
      // still waiting on it, so the kitchen status is re-derived here too.
      if (isKitchenActiveOrder(order) && live.every((i) => i.status === 'ready')) {
        order.status = 'ready'
        order.readyAt = order.readyAt ?? now
        return { type: 'ORDER_READY', orderId: order.id }
      }
      return { type: 'ORDER_UPDATED', orderId: order.id }
    })
  },

  /** Called from the KITCHEN when the food is taken to the table. */
  markDelivered(orderId: ID): void {
    db.mutate((draft) => {
      const order = draft.orders.find((o) => o.id === orderId)
      if (!order || order.status !== 'ready') return
      order.status = 'delivered'
      order.deliveredAt = nowISO()
      return { type: 'ORDER_DELIVERED', orderId }
    })
  },
}

/* ------------------------------- Billing -------------------------------- */

export interface BillPreview {
  subtotal: number
  discountAmount: number
  maxRedeemablePoints: number
  pointsRedeemed: number
  pointsValueRedeemed: number
  total: number
  pointsToEarn: number
}

/**
 * The ONE place bill arithmetic lives: the settle sheet preview and the
 * actual settlement both call this, so what the admin sees is what gets
 * charged. The discount is a flat rupee amount off the subtotal; loyalty
 * points then come off what remains. No tax is applied.
 */
export function computeBillPreview(input: {
  rounds: Order[]
  settings: CafeSettings
  discountAmount?: number
  redeemPoints?: number
  availablePoints?: number
  hasCustomer?: boolean
}): BillPreview {
  const { settings } = input
  const subtotal = round2(input.rounds.reduce((s, o) => s + o.total, 0))
  const discountAmount = round2(clamp(input.discountAmount ?? 0, 0, subtotal))
  const preTotal = round2(subtotal - discountAmount)

  const { enabled, rupeesPerPoint, pointsPer100 } = settings.loyalty
  const maxRedeemablePoints =
    enabled && rupeesPerPoint > 0
      ? Math.min(input.availablePoints ?? 0, Math.floor(preTotal / rupeesPerPoint))
      : 0
  const pointsRedeemed = Math.min(Math.max(0, Math.floor(input.redeemPoints ?? 0)), maxRedeemablePoints)
  const pointsValueRedeemed = round2(pointsRedeemed * rupeesPerPoint)
  const total = round2(preTotal - pointsValueRedeemed)
  const pointsToEarn = enabled && input.hasCustomer ? Math.floor(total / 100) * pointsPer100 : 0

  return { subtotal, discountAmount, maxRedeemablePoints, pointsRedeemed, pointsValueRedeemed, total, pointsToEarn }
}

/**
 * Split a bill total across cash and UPI. `amount` is what the guest hands
 * over in `method`; the other method covers the rest. Deriving the second
 * leg instead of accepting two free inputs makes a bill that does not add
 * up to the total unrepresentable.
 */
export function splitPayment(total: number, method: PaymentMethod, amount: number): BillPayments {
  const paid = round2(clamp(amount, 0, total))
  const rest = round2(total - paid)
  return method === 'cash' ? { cash: paid, upi: rest } : { cash: rest, upi: paid }
}

/** Methods that actually contributed to a bill, in PAYMENT_METHODS order. */
export function paidMethods(payments: BillPayments): Array<[PaymentMethod, number]> {
  return PAYMENT_METHODS.map((m) => [m, payments[m]] as [PaymentMethod, number]).filter(
    ([, amount]) => amount > 0,
  )
}

/* ------------------------------ Customers ------------------------------- */
/* A guest is identified by their mobile number and nothing else. The record  */
/* holds only what a person typed; visits, spend and points stay derived from */
/* bills, and the money side lives in the wallet ledger below.                */

/** Digits only, last ten: "+91 98765 43210" and "9876543210" are one guest. */
export function normalisePhone(input: string): string {
  return input.replace(/\D/g, '').slice(-10)
}

export function isCompletePhone(input: string): boolean {
  return normalisePhone(input).length === 10
}

export const customerService = {
  find(customers: Customer[], phone: string): Customer | undefined {
    const key = normalisePhone(phone)
    return key.length === 10 ? customers.find((c) => c.phone === key) : undefined
  },

  byId(customers: Customer[], id: ID | undefined): Customer | undefined {
    return id ? customers.find((c) => c.id === id) : undefined
  },

  /**
   * Look a guest up by mobile, creating the record the first time that number
   * is seen. A name given later fills in or corrects the one on file, so the
   * counter never has to visit a separate "add customer" screen.
   */
  upsert(input: { phone: string; name?: string }): Customer | null {
    const phone = normalisePhone(input.phone)
    if (phone.length !== 10) return null
    let saved: Customer | null = null
    db.mutate((draft) => {
      const now = nowISO()
      const name = input.name?.trim()
      const existing = draft.customers.find((c) => c.phone === phone)
      if (existing) {
        if (name && name !== existing.name) {
          existing.name = name
          existing.updatedAt = now
        }
        saved = existing
      } else {
        const created: Customer = {
          id: uid('cus'),
          phone,
          name: name || 'Guest',
          createdAt: now,
          updatedAt: now,
        }
        draft.customers.push(created)
        saved = created
      }
      return { type: 'CUSTOMERS_UPDATED' }
    })
    return saved
  },

  update(id: ID, patch: { name?: string; note?: string }): void {
    db.mutate((draft) => {
      const customer = draft.customers.find((c) => c.id === id)
      if (!customer) return
      if (patch.name !== undefined) customer.name = patch.name.trim() || customer.name
      if (patch.note !== undefined) customer.note = patch.note.trim() || undefined
      customer.updatedAt = nowISO()
      return { type: 'CUSTOMERS_UPDATED' }
    })
  },
}

/* -------------------------------- Wallet -------------------------------- */
/* One signed ledger per guest. Positive means the cafe is holding their     */
/* money, negative means they owe it. Never write a balance anywhere: it is  */
/* the sum of the entries, so history and balance can never disagree.        */

export function walletBalance(entries: WalletEntry[], customerId: ID | undefined): number {
  if (!customerId) return 0
  return round2(entries.filter((e) => e.customerId === customerId).reduce((sum, e) => sum + e.amount, 0))
}

/** A guest's entries, newest first. */
export function walletLedger(entries: WalletEntry[], customerId: ID): WalletEntry[] {
  return entries.filter((e) => e.customerId === customerId).sort((a, b) => b.at.localeCompare(a.at))
}

/** What the guest owes right now, as a positive number (0 when in credit). */
export function amountOwed(balance: number): number {
  return balance < 0 ? round2(-balance) : 0
}

/** Advance the cafe is holding, as a positive number (0 when they owe). */
export function advanceHeld(balance: number): number {
  return balance > 0 ? round2(balance) : 0
}

function walletEntry(input: {
  customerId: ID
  amount: number
  kind: WalletEntryKind
  session: Session
  billId?: ID
  billNumber?: number
  method?: PaymentMethod
  note?: string
}): WalletEntry {
  return {
    id: uid('wal'),
    customerId: input.customerId,
    amount: round2(input.amount),
    kind: input.kind,
    billId: input.billId,
    billNumber: input.billNumber,
    method: input.method,
    note: input.note?.trim() || undefined,
    at: nowISO(),
    byUserId: input.session.userId,
    byName: input.session.name,
  }
}

export const walletService = {
  /**
   * Money handed over at the counter with no bill attached. It clears what
   * the guest owes first and whatever is left stays as advance — one entry
   * either way, since the balance is a single running number.
   */
  takeMoney(input: {
    customerId: ID
    amount: number
    method: PaymentMethod
    session: Session
    note?: string
  }): void {
    const amount = round2(Math.max(0, input.amount))
    if (amount <= 0) return
    db.mutate((draft) => {
      const owed = amountOwed(walletBalance(draft.walletEntries, input.customerId))
      draft.walletEntries.push(
        walletEntry({ ...input, amount, kind: owed > 0 ? 'repayment' : 'topup' }),
      )
      return { type: 'CUSTOMERS_UPDATED' }
    })
  },

  /** Hand an advance back. Never more than the cafe is actually holding. */
  returnMoney(input: {
    customerId: ID
    amount: number
    method: PaymentMethod
    session: Session
    note?: string
  }): void {
    db.mutate((draft) => {
      const held = advanceHeld(walletBalance(draft.walletEntries, input.customerId))
      const amount = round2(clamp(input.amount, 0, held))
      if (amount <= 0) return
      draft.walletEntries.push(walletEntry({ ...input, amount: -amount, kind: 'refund' }))
      return { type: 'CUSTOMERS_UPDATED' }
    })
  },

  /**
   * Manager correction — writing off a due, fixing a mistyped amount. Signed,
   * and the note is required so the ledger stays readable a month later.
   */
  adjust(input: { customerId: ID; amount: number; note: string; session: Session }): void {
    const amount = round2(input.amount)
    if (amount === 0 || !input.note.trim()) return
    db.mutate((draft) => {
      draft.walletEntries.push(walletEntry({ ...input, amount, kind: 'adjustment' }))
      return { type: 'CUSTOMERS_UPDATED' }
    })
  },
}

/* Customer profiles are DERIVED from bills — no separate table to keep in
   sync, and a real database can compute the same with one GROUP BY. */

export interface CustomerProfile {
  phone: string
  name: string
  visits: number
  totalSpent: number
  lastVisitAt: string
  pointsEarned: number
  pointsRedeemed: number
  pointsBalance: number
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
      pointsEarned: 0,
      pointsRedeemed: 0,
      pointsBalance: 0,
    }
    profile.name = bill.customerName || profile.name
    profile.visits += 1
    profile.totalSpent = round2(profile.totalSpent + bill.total)
    profile.lastVisitAt = bill.settledAt
    profile.pointsEarned += bill.pointsEarned
    profile.pointsRedeemed += bill.pointsRedeemed
    profile.pointsBalance = profile.pointsEarned - profile.pointsRedeemed
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
  pointsBalance: number
  /** + advance the cafe holds, − what the guest owes. */
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
        pointsBalance: s?.pointsBalance ?? 0,
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

/**
 * How one settlement is put together, in the order money moves: advance
 * first, then whatever the guest hands over now, then anything left on the
 * account. The settle sheet and the service both call this, so what the
 * cashier sees on screen is exactly what gets written.
 */
export interface SettlementPlan {
  total: number
  /** Taken out of the advance the cafe is already holding. */
  walletApplied: number
  /** Left on the guest's account to pay next time. */
  creditAmount: number
  /** Handed over beyond this bill and kept as advance. */
  walletTopUp: number
  /** What cash + UPI must add up to. */
  tenderTarget: number
  advanceAvailable: number
  owedBefore: number
  balanceAfter: number
}

export function planSettlement(input: {
  total: number
  /** The guest's balance before this bill: + advance held, − owed. */
  balance: number
  hasCustomer: boolean
  allowPayLater: boolean
  walletApplied?: number
  creditAmount?: number
  walletTopUp?: number
}): SettlementPlan {
  const advanceAvailable = advanceHeld(input.balance)
  const walletApplied = input.hasCustomer
    ? round2(clamp(input.walletApplied ?? 0, 0, Math.min(advanceAvailable, input.total)))
    : 0
  const creditAmount =
    input.hasCustomer && input.allowPayLater
      ? round2(clamp(input.creditAmount ?? 0, 0, round2(input.total - walletApplied)))
      : 0
  const walletTopUp = input.hasCustomer ? round2(Math.max(0, input.walletTopUp ?? 0)) : 0

  return {
    total: input.total,
    walletApplied,
    creditAmount,
    walletTopUp,
    tenderTarget: round2(input.total - walletApplied - creditAmount + walletTopUp),
    advanceAvailable,
    owedBefore: amountOwed(input.balance),
    balanceAfter: round2(input.balance - walletApplied - creditAmount + walletTopUp),
  }
}

export const billService = {
  /**
   * Settle a table: group all of its delivered rounds into one Bill (with an
   * optional flat discount and loyalty redemption), record how it was paid,
   * move the guest's account, and free the table. Refuses while any round is
   * still with the kitchen.
   */
  settleTable(input: {
    tableId: ID
    /** Rupees taken in each method; must add up to the plan's tenderTarget. */
    payments: BillPayments
    session: Session
    discountAmount?: number
    redeemPoints?: number
    /** Account legs. Ignored when the sitting has no guest attached. */
    walletApplied?: number
    creditAmount?: number
    walletTopUp?: number
  }): Bill | null {
    let created: Bill | null = null
    db.mutate((draft) => {
      const open = draft.orders.filter((o) => o.tableId === input.tableId && isActiveOrder(o))
      if (open.length === 0 || open.some((o) => o.status !== 'delivered')) return
      const now = nowISO()
      const table = draft.tables.find((t) => t.id === input.tableId)
      const first = [...open].sort((a, b) => a.placedAt.localeCompare(b.placedAt))[0]
      const phone = first?.customerPhone
      const customer =
        customerService.byId(draft.customers, first?.customerId) ??
        (phone ? customerService.find(draft.customers, phone) : undefined)
      const available = phone ? (customerByPhone(draft.bills, phone)?.pointsBalance ?? 0) : 0
      const preview = computeBillPreview({
        rounds: open,
        settings: draft.settings,
        discountAmount: input.discountAmount,
        redeemPoints: input.redeemPoints,
        availablePoints: available,
        hasCustomer: Boolean(phone),
      })
      const plan = planSettlement({
        total: preview.total,
        balance: walletBalance(draft.walletEntries, customer?.id),
        hasCustomer: Boolean(customer),
        allowPayLater: draft.settings.accounts.allowPayLater,
        walletApplied: input.walletApplied,
        creditAmount: input.creditAmount,
        walletTopUp: input.walletTopUp,
      })
      // Guard the invariant at the only door into the ledger: a bill whose
      // legs do not add up to its total must never be written.
      const tendered = round2(PAYMENT_METHODS.reduce((sum, m) => sum + (input.payments[m] || 0), 0))
      if (Math.abs(tendered - plan.tenderTarget) > 0.01) return

      const bill: Bill = {
        id: uid('bill'),
        billNumber: draft.counters.nextBillNumber,
        tableId: input.tableId,
        tableName: table?.name ?? open[0]?.tableName ?? '',
        orderIds: open.map((o) => o.id),
        orderNumbers: open.map((o) => o.orderNumber),
        customerId: customer?.id,
        customerName: customer?.name ?? first?.customerName,
        customerPhone: customer?.phone ?? phone,
        subtotal: preview.subtotal,
        discountAmount: preview.discountAmount,
        pointsRedeemed: preview.pointsRedeemed,
        pointsValueRedeemed: preview.pointsValueRedeemed,
        pointsEarned: preview.pointsToEarn,
        total: preview.total,
        payments: input.payments,
        walletApplied: plan.walletApplied,
        creditAmount: plan.creditAmount,
        walletTopUp: plan.walletTopUp,
        settledAt: now,
        settledByUserId: input.session.userId,
        settledByName: input.session.name,
      }
      draft.counters.nextBillNumber += 1
      draft.bills.push(bill)

      // One ledger line per thing that actually happened, so the guest's
      // history reads as a story rather than a single net number.
      if (customer) {
        const ledger = (amount: number, kind: WalletEntryKind) =>
          draft.walletEntries.push(
            walletEntry({
              customerId: customer.id,
              amount,
              kind,
              session: input.session,
              billId: bill.id,
              billNumber: bill.billNumber,
            }),
          )
        if (plan.walletApplied > 0) ledger(-plan.walletApplied, 'spend')
        if (plan.creditAmount > 0) ledger(-plan.creditAmount, 'credit')
        if (plan.walletTopUp > 0) ledger(plan.walletTopUp, 'topup')
      }

      open.forEach((o) => {
        o.status = 'settled'
        o.settledAt = now
        o.billId = bill.id
      })
      created = bill
      return { type: 'BILL_SETTLED', billId: bill.id, tableId: input.tableId }
    })
    return created
  },
}

/* ------------------------------ Day money ------------------------------- */

/**
 * Two different questions a cafe asks at closing time, kept apart on purpose:
 * what was SOLD today, and what was COLLECTED today. They differ by exactly
 * the amount that was eaten on credit, paid out of an old advance, or handed
 * over for later — so the drawer reconciles even when guests pay on their
 * own schedule.
 */
export interface DayMoney {
  sales: number
  collected: number
  cash: number
  upi: number
  fromAdvance: number
  leftUnpaid: number
  advanceTaken: number
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
    fromAdvance: round2(bills.reduce((s, b) => s + b.walletApplied, 0)),
    leftUnpaid: round2(bills.reduce((s, b) => s + b.creditAmount, 0)),
    advanceTaken: round2(
      bills.reduce((s, b) => s + b.walletTopUp, 0) +
        counter.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0),
    ),
  }
}

/** The bill a settled round belongs to, for history and receipts. */
export function billForOrder(bills: Bill[], order: Order): Bill | undefined {
  return order.billId ? bills.find((b) => b.id === order.billId) : undefined
}

/* ------------------------------- Kitchen -------------------------------- */

export const kitchenService = {
  startOrder(orderId: ID): void {
    db.mutate((draft) => {
      const order = draft.orders.find((o) => o.id === orderId)
      if (!order || order.status !== 'placed') return
      const now = nowISO()
      order.status = 'preparing'
      order.startedAt = now
      order.items.forEach((i) => {
        if (i.status === 'queued') {
          i.status = 'preparing'
          i.startedAt = now
        }
      })
      return { type: 'ORDER_UPDATED', orderId }
    })
  },

  setItemStatus(orderId: ID, itemId: ID, status: OrderItemStatus): void {
    db.mutate((draft) => {
      const order = draft.orders.find((o) => o.id === orderId)
      if (!order || !(KITCHEN_ACTIVE_STATUSES as readonly string[]).includes(order.status)) return
      const item = order.items.find((i) => i.id === itemId)
      if (!item) return

      const now = nowISO()
      item.status = status
      if (status === 'preparing' && !item.startedAt) item.startedAt = now
      if (status === 'ready') item.readyAt = now
      if (status === 'preparing') item.readyAt = undefined
      // A cancelled line stops being payable, so the round's total moves.
      order.total = orderTotal(order.items)

      const events: RealtimeEvent[] = []
      if (status === 'preparing') events.push({ type: 'ITEM_STARTED', orderId, itemId })
      if (status === 'ready') events.push({ type: 'ITEM_READY', orderId, itemId })

      const activeItems = order.items.filter((i) => i.status !== 'cancelled')
      const allReady = activeItems.length > 0 && activeItems.every((i) => i.status === 'ready')

      if (allReady && (order.status === 'preparing' || order.status === 'placed')) {
        order.status = 'ready'
        order.readyAt = now
        events.push({ type: 'ORDER_READY', orderId })
      } else if (!allReady && order.status === 'ready') {
        // An item was re-opened after the order auto-completed.
        order.status = 'preparing'
        order.readyAt = undefined
        events.push({ type: 'ORDER_UPDATED', orderId })
      } else if (events.length === 0) {
        events.push({ type: 'ORDER_UPDATED', orderId })
      }
      return events
    })
  },
}

/* -------------------------------- Tables -------------------------------- */

export interface TableInput {
  name: string
  zone: string
  capacity: number
  isActive: boolean
}

export const tableService = {
  createTable(input: TableInput): void {
    db.mutate((draft) => {
      const maxOrder = Math.max(0, ...draft.tables.map((t) => t.displayOrder))
      draft.tables.push({ id: uid('tbl'), ...input, displayOrder: maxOrder + 1 })
      return { type: 'TABLES_UPDATED' }
    })
  },

  updateTable(id: ID, patch: Partial<TableInput>): void {
    db.mutate((draft) => {
      const t = draft.tables.find((x) => x.id === id)
      if (!t) return
      Object.assign(t, patch)
      return { type: 'TABLES_UPDATED' }
    })
  },

  archiveTable(id: ID): void {
    db.mutate((draft) => {
      draft.tables = draft.tables.filter((t) => t.id !== id)
      return { type: 'TABLES_UPDATED' }
    })
  },
}

/* ------------------------------- Settings ------------------------------- */

export const settingsService = {
  update(patch: Partial<CafeSettings>): void {
    db.mutate((draft) => {
      Object.assign(draft.settings, patch)
      return { type: 'SETTINGS_UPDATED' }
    })
  },

  resetDemoData(): void {
    db.reset()
  },
}

/* ---------------------- Shared read-side helpers ------------------------ */
/* Pure functions over the snapshot; usable by any screen without          */
/* duplicating business rules inside components.                           */

/** Unpaid: on the floor or awaiting settlement. */
export const ACTIVE_ORDER_STATUSES = ['placed', 'preparing', 'ready', 'delivered'] as const

/** Still the kitchen's problem (delivered rounds are not). */
export const KITCHEN_ACTIVE_STATUSES = ['placed', 'preparing', 'ready'] as const

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
