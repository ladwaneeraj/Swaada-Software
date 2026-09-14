import { writeBatch } from 'firebase/firestore'
import { firestore } from './firebase/app'
import { orderRef } from './firebase/paths'
import { requireCatalogue, requireOutletId } from './context'
import { KITCHEN_ACTIVE_STATUSES, orderTotal } from './rules'
import { toAppError } from '@/lib/errors'
import { nowISO } from '@/lib/utils'
import type { ID, OrderItem, OrderItemStatus } from '@/types'

/**
 * The kitchen display's two actions: start a round, and tick items off.
 *
 * These write the whole `items` array back, which means two devices touching
 * the SAME round in the same second could overwrite each other. That is
 * accepted here rather than defended against, because the consequence is a
 * status flipping back and a cook tapping again — annoying, not wrong. The
 * writes that move money (corrections, voids, settlement) are the ones the
 * security rules guard with state transitions.
 *
 * The alternative, a subcollection per item, would make each tick its own
 * document and remove the race entirely, at the cost of several times the
 * reads on every kitchen screen refresh. Not worth it at one cafe's volume;
 * this comment is here so the trade is a decision rather than an oversight.
 */
export const kitchenService = {
  async startOrder(orderId: ID): Promise<void> {
    const outletId = requireOutletId()
    const order = requireCatalogue().orders.find((o) => o.id === orderId)
    if (!order || order.status !== 'placed') return
    const now = nowISO()
    try {
      await writeBatch(firestore)
        .update(orderRef(outletId, orderId), {
          status: 'preparing',
          startedAt: now,
          items: order.items.map((i) =>
            i.status === 'queued' ? { ...i, status: 'preparing', startedAt: now } : i,
          ),
        })
        .commit()
    } catch (error) {
      throw toAppError(error, 'Could not start the round.')
    }
  },

  async setItemStatus(orderId: ID, itemId: ID, status: OrderItemStatus): Promise<void> {
    const outletId = requireOutletId()
    const order = requireCatalogue().orders.find((o) => o.id === orderId)
    if (!order || !(KITCHEN_ACTIVE_STATUSES as readonly string[]).includes(order.status)) return
    if (!order.items.some((i) => i.id === itemId)) return

    const now = nowISO()
    const items: OrderItem[] = order.items.map((i) => {
      if (i.id !== itemId) return i
      return {
        ...i,
        status,
        startedAt: status === 'preparing' && !i.startedAt ? now : i.startedAt,
        readyAt: status === 'ready' ? now : status === 'preparing' ? undefined : i.readyAt,
      }
    })

    const active = items.filter((i) => i.status !== 'cancelled')
    const allReady = active.length > 0 && active.every((i) => i.status === 'ready')

    // A cancelled line stops being payable, so the round's total moves.
    const patch: Record<string, unknown> = { items, total: orderTotal(items) }

    if (allReady && (order.status === 'preparing' || order.status === 'placed')) {
      patch.status = 'ready'
      patch.readyAt = now
    } else if (!allReady && order.status === 'ready') {
      // An item was re-opened after the round auto-completed.
      patch.status = 'preparing'
      patch.readyAt = null
    }

    try {
      await writeBatch(firestore).update(orderRef(outletId, orderId), patch).commit()
    } catch (error) {
      throw toAppError(error, 'Could not update the item.')
    }
  },
}
