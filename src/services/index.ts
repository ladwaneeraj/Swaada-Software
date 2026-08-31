import { byDisplayOrder, nowISO, round2, uid } from '@/lib/utils'
import type {
  CafeSettings,
  CafeTable,
  Category,
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
  Station,
} from '@/types'
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
        image: null,
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

function computeTotals(items: OrderItem[], settings: CafeSettings) {
  const active = items.filter((i) => i.status !== 'cancelled')
  const subtotal = round2(active.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0))
  const taxAmount = round2((subtotal * settings.taxRatePercent) / 100)
  return {
    subtotal,
    taxAmount,
    total: round2(subtotal + taxAmount),
    taxLabel: settings.taxLabel,
    taxRatePercent: settings.taxRatePercent,
  }
}

export const orderService = {
  placeOrder(input: {
    tableId: ID | null
    lines: PlaceOrderLine[]
    session: Session
  }): Order {
    let created: Order | null = null
    db.mutate((draft) => {
      const table = draft.tables.find((t) => t.id === input.tableId)
      const now = nowISO()
      const stationById = new Map(draft.stations.map((s) => [s.id, s]))
      const categoryById = new Map(draft.categories.map((c) => [c.id, c]))

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
        ...computeTotals(items, draft.settings),
        createdByUserId: input.session.userId,
        createdByName: input.session.name,
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

  cancelOrder(orderId: ID, reason: string): void {
    db.mutate((draft) => {
      const order = draft.orders.find((o) => o.id === orderId)
      if (!order || order.status === 'served' || order.status === 'cancelled') return
      order.status = 'cancelled'
      order.cancelledAt = nowISO()
      order.cancelReason = reason
      order.items.forEach((i) => {
        if (i.status !== 'ready') i.status = 'cancelled'
      })
      return { type: 'ORDER_CANCELLED', orderId }
    })
  },

  markDelivered(orderId: ID): void {
    db.mutate((draft) => {
      const order = draft.orders.find((o) => o.id === orderId)
      if (!order || order.status !== 'ready') return
      order.status = 'delivered'
      order.deliveredAt = nowISO()
      return { type: 'ORDER_DELIVERED', orderId }
    })
  },

  markServed(orderId: ID): void {
    db.mutate((draft) => {
      const order = draft.orders.find((o) => o.id === orderId)
      if (!order || order.status !== 'delivered') return
      order.status = 'served'
      order.servedAt = nowISO()
      return { type: 'ORDER_SERVED', orderId }
    })
  },
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
      if (!order || order.status === 'cancelled' || order.status === 'served') return
      const item = order.items.find((i) => i.id === itemId)
      if (!item) return

      const now = nowISO()
      item.status = status
      if (status === 'preparing' && !item.startedAt) item.startedAt = now
      if (status === 'ready') item.readyAt = now
      if (status === 'preparing') item.readyAt = undefined

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

export const ACTIVE_ORDER_STATUSES = ['placed', 'preparing', 'ready', 'delivered'] as const

export function isActiveOrder(order: Order): boolean {
  return (ACTIVE_ORDER_STATUSES as readonly string[]).includes(order.status)
}

export function activeOrderForTable(orders: Order[], tableId: ID): Order | undefined {
  return orders.find((o) => o.tableId === tableId && isActiveOrder(o))
}

export function tableStatus(orders: Order[], table: CafeTable): 'available' | 'occupied' {
  return activeOrderForTable(orders, table.id) ? 'occupied' : 'available'
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
