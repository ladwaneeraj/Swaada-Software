import { writeBatch } from 'firebase/firestore'
import { firestore } from './firebase/app'
import { orderRef } from './firebase/paths'
import { nextNumber } from './firebase/sequences'
import { requireCatalogue, requireOutletId, requireSession } from './context'
import { stageAudit } from './audit'
import {
  customerById,
  isActiveOrder,
  isKitchenActiveOrder,
  lineUnitPrice,
  orderTotal,
  type PlaceOrderLine,
} from './rules'
import { businessDayConfig } from './settings'
import { todayBusinessDate } from '@/lib/businessDate'
import { toAppError } from '@/lib/errors'
import { nowISO, uid } from '@/lib/utils'
import type { ID, Order, OrderItem, OrderItemModifier } from '@/types'

/**
 * Taking, correcting and voiding rounds.
 *
 * Every write here is a `writeBatch`, never a transaction. That is a
 * deliberate choice and it is what makes the POS usable during a wifi drop:
 * a batch is queued locally, applies to the on-device cache immediately, and
 * syncs when the connection returns. A transaction needs a live round trip
 * and would leave a cashier staring at a spinner mid-service.
 *
 * The correctness that a transaction would have given is enforced on the
 * server instead, by the security rules: an order may only move along the
 * legal path (placed → preparing → ready → delivered → settled), and a
 * round already settled cannot be settled or edited again. So if two devices
 * somehow act on the same round, the second write is rejected by Firestore
 * rather than quietly overwriting the first.
 */

export const orderService = {
  /**
   * Start a new round for a table. This is the one thing that absolutely
   * must work offline, so it is a plain create with a number taken from the
   * block this device reserved earlier.
   */
  async placeOrder(input: {
    tableId: ID | null
    lines: PlaceOrderLine[]
    /** The guest this sitting belongs to, when one was identified. */
    customerId?: ID
    /** Which party at the table. Defaults to the first one. */
    groupNo?: number
  }): Promise<Order> {
    const outletId = requireOutletId()
    const session = requireSession()
    const live = requireCatalogue()

    try {
      const orderNumber = await nextNumber(outletId, 'order')
      const now = nowISO()
      const table = live.tables.find((t) => t.id === input.tableId)
      const stationById = new Map(live.stations.map((s) => [s.id, s]))
      const categoryById = new Map(live.categories.map((c) => [c.id, c]))
      const customer = customerById(live.customers, input.customerId)

      const items: OrderItem[] = input.lines.map((line) => {
        const modifiers: OrderItemModifier[] = line.modifiers.map((m) => ({
          groupId: m.group.id,
          groupName: m.group.name,
          optionId: m.option.id,
          optionName: m.option.name,
          priceAdjustment: m.option.priceAdjustment,
        }))
        const station = stationById.get(line.menuItem.stationId)
        // A shelf item is not cooked, so it is ready as soon as it is rung
        // up and the kitchen never sees it.
        const isShelf = station?.preparesFood === false
        return {
          id: uid('oi'),
          menuItemId: line.menuItem.id,
          name: line.menuItem.name,
          categoryId: line.menuItem.categoryId,
          categoryName: categoryById.get(line.menuItem.categoryId)?.name ?? '',
          stationId: line.menuItem.stationId,
          stationName: station?.name ?? 'Kitchen',
          isVegetarian: line.menuItem.isVegetarian,
          basePrice: line.menuItem.basePrice,
          unitPrice: lineUnitPrice(line.menuItem.basePrice, modifiers),
          quantity: line.quantity,
          modifiers,
          specialInstructions: line.specialInstructions,
          status: isShelf ? 'ready' : 'queued',
          queuedAt: now,
          readyAt: isShelf ? now : undefined,
        }
      })

      // A round of nothing but counter sales is handed over there and then.
      const handedOver = items.every((i) => i.status === 'ready')

      const order: Order = {
        id: uid('ord'),
        orderNumber,
        businessDate: todayBusinessDate(businessDayConfig(live.settings)),
        tableId: input.tableId,
        tableName: table?.name ?? 'Takeaway',
        groupNo: input.groupNo ?? 1,
        items,
        status: handedOver ? 'delivered' : 'placed',
        total: orderTotal(items),
        createdByUserId: session.userId,
        createdByName: session.name,
        // Denormalised alongside the id so an old round still reads correctly
        // if the guest is renamed later, exactly like the item snapshots.
        customerId: customer?.id,
        customerName: customer?.name,
        customerPhone: customer?.phone,
        placedAt: now,
        readyAt: handedOver ? now : undefined,
        deliveredAt: handedOver ? now : undefined,
      }

      await writeBatch(firestore).set(orderRef(outletId, order.id), order).commit()
      return order
    } catch (error) {
      throw toAppError(error, 'Could not place the order.')
    }
  },

  /**
   * Attach, change or clear the guest on a table's open rounds. Guests often
   * only give their number when the bill arrives — usually because they want
   * to pay later — so this has to work after the food is already served.
   */
  async setSittingCustomer(tableId: ID, groupNo: number, customerId: ID | null): Promise<void> {
    const outletId = requireOutletId()
    const live = requireCatalogue()
    const open = live.orders.filter(
      (o) => o.tableId === tableId && o.groupNo === groupNo && isActiveOrder(o),
    )
    if (open.length === 0) return
    const customer = customerId ? customerById(live.customers, customerId) : undefined

    try {
      const batch = writeBatch(firestore)
      open.forEach((o) => {
        batch.update(orderRef(outletId, o.id), {
          customerId: customer?.id ?? null,
          customerName: customer?.name ?? null,
          customerPhone: customer?.phone ?? null,
        })
      })
      await batch.commit()
    } catch (error) {
      throw toAppError(error, 'Could not attach the guest to this table.')
    }
  },

  /** Cancel a round the kitchen has not handed over yet. */
  async cancelOrder(orderId: ID, reason: string): Promise<void> {
    const outletId = requireOutletId()
    const order = requireCatalogue().orders.find((o) => o.id === orderId)
    // Delivered rounds are part of the open bill and can't be cancelled here.
    if (!order || order.status === 'settled' || order.status === 'cancelled' || order.status === 'delivered') {
      return
    }
    const now = nowISO()
    try {
      const batch = writeBatch(firestore)
      batch.update(orderRef(outletId, orderId), {
        status: 'cancelled',
        cancelledAt: now,
        cancelReason: reason,
        total: 0,
        items: order.items.map((i) => (i.status !== 'ready' ? { ...i, status: 'cancelled' } : i)),
      })
      stageAudit(batch, {
        action: 'order.cancel',
        summary: `Cancelled round #${order.orderNumber} on ${order.tableName}: ${reason || 'no reason given'}`,
        target: { orderId, orderNumber: order.orderNumber },
      })
      await batch.commit()
    } catch (error) {
      throw toAppError(error, 'Could not cancel the round.')
    }
  },

  /**
   * Void a DELIVERED round before settlement (wrong item, guest refused).
   * Distinct from cancelOrder so the ordinary cancel path can't touch
   * delivered food by accident; a reason is always recorded and audited.
   */
  async voidDeliveredRound(orderId: ID, reason: string): Promise<void> {
    const outletId = requireOutletId()
    const order = requireCatalogue().orders.find((o) => o.id === orderId)
    if (!order || order.status !== 'delivered') return
    const now = nowISO()
    try {
      const batch = writeBatch(firestore)
      batch.update(orderRef(outletId, orderId), {
        status: 'cancelled',
        cancelledAt: now,
        cancelReason: `Voided: ${reason || 'no reason given'}`,
        total: 0,
        items: order.items.map((i) => (i.status !== 'ready' ? { ...i, status: 'cancelled' } : i)),
      })
      stageAudit(batch, {
        action: 'order.void',
        summary: `Voided delivered round #${order.orderNumber} (₹${order.total}) on ${order.tableName}: ${reason || 'no reason given'}`,
        target: { orderId, orderNumber: order.orderNumber },
        change: { from: order.total, to: 0 },
      })
      await batch.commit()
    } catch (error) {
      throw toAppError(error, 'Could not void the round.')
    }
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
  async adjustItem(input: {
    orderId: ID
    itemId: ID
    quantity: number
    reason: string
  }): Promise<void> {
    const outletId = requireOutletId()
    const session = requireSession()
    const order = requireCatalogue().orders.find((o) => o.id === input.orderId)
    if (!order || order.status === 'settled' || order.status === 'cancelled') return
    const item = order.items.find((i) => i.id === input.itemId)
    if (!item || item.status === 'cancelled') return

    const next = Math.max(0, Math.floor(input.quantity))
    if (next >= item.quantity) return

    const now = nowISO()
    const adjustment = {
      at: now,
      byName: session.name,
      reason: input.reason.trim() || 'no reason given',
      fromQuantity: item.quantity,
    }

    const items: OrderItem[] = order.items.map((i) => {
      if (i.id !== input.itemId) return i
      return next === 0
        ? { ...i, status: 'cancelled' as const, adjustment }
        : { ...i, quantity: next, adjustment }
    })

    const live = items.filter((i) => i.status !== 'cancelled')
    const total = orderTotal(items)

    try {
      const batch = writeBatch(firestore)

      if (live.length === 0) {
        batch.update(orderRef(outletId, input.orderId), {
          status: 'cancelled',
          cancelledAt: now,
          cancelReason: `Every item removed: ${adjustment.reason}`,
          total: 0,
          items,
        })
      } else if (isKitchenActiveOrder(order) && live.every((i) => i.status === 'ready')) {
        // Removing the last unfinished item can complete a round that was
        // still waiting on it, so the kitchen status is re-derived here too.
        batch.update(orderRef(outletId, input.orderId), {
          items,
          total,
          status: 'ready',
          readyAt: order.readyAt ?? now,
        })
      } else {
        batch.update(orderRef(outletId, input.orderId), { items, total })
      }

      stageAudit(batch, {
        action: 'order.item_adjust',
        summary:
          next === 0
            ? `Removed ${item.name} from round #${order.orderNumber}: ${adjustment.reason}`
            : `${item.name} on round #${order.orderNumber} reduced ${item.quantity} → ${next}: ${adjustment.reason}`,
        target: { orderId: input.orderId, itemId: input.itemId, orderNumber: order.orderNumber },
        change: { from: item.quantity, to: next, amount: -(item.unitPrice * (item.quantity - next)) },
      })
      await batch.commit()
    } catch (error) {
      throw toAppError(error, 'Could not correct the round.')
    }
  },

  /** Called from the KITCHEN when the food is taken to the table. */
  async markDelivered(orderId: ID): Promise<void> {
    const outletId = requireOutletId()
    const order = requireCatalogue().orders.find((o) => o.id === orderId)
    if (!order || order.status !== 'ready') return
    try {
      await writeBatch(firestore)
        .update(orderRef(outletId, orderId), { status: 'delivered', deliveredAt: nowISO() })
        .commit()
    } catch (error) {
      throw toAppError(error, 'Could not mark the round delivered.')
    }
  },
}
