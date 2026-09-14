import { useEffect, useRef } from 'react'
import { useAppStore } from '@/store/useAppStore'
import type { Order, OrderStatus } from '@/types'

/**
 * Turning live state back into events.
 *
 * The prototype had an event bus: a tab published ORDER_READY and other
 * tabs reacted. Firestore does not work that way — it hands you the current
 * state, not the transition — so anything that wants to say "order 42 just
 * became ready" has to notice the change itself.
 *
 * This watches the store and emits the transitions worth telling someone
 * about. The first snapshot after a page load is deliberately swallowed:
 * without that, opening the app during service would fire a toast for every
 * round already on the floor.
 */

export type OrderEventType = 'created' | 'ready' | 'delivered' | 'cancelled'

export interface OrderEvent {
  type: OrderEventType
  order: Order
}

/** Transitions worth a toast, and the ones that are just noise. */
function transitionEvent(previous: OrderStatus | undefined, order: Order): OrderEventType | null {
  if (previous === order.status) return null
  if (previous === undefined) return order.status === 'placed' ? 'created' : null
  if (order.status === 'ready') return 'ready'
  if (order.status === 'delivered') return 'delivered'
  if (order.status === 'cancelled') return 'cancelled'
  return null
}

export function useOrderEvents(handler: (event: OrderEvent) => void): void {
  // Kept in a ref so a handler that changes identity every render does not
  // re-run the subscription and replay history. Assigned in an effect
  // rather than during render, because render must stay side-effect free.
  const handlerRef = useRef(handler)
  useEffect(() => {
    handlerRef.current = handler
  })

  const seen = useRef<Map<string, OrderStatus> | null>(null)

  useEffect(() => {
    const read = (): Order[] => {
      const state = useAppStore.getState().db
      return [...state.orders, ...state.recentlyCancelled]
    }

    const apply = (orders: Order[]): void => {
      const next = new Map(orders.map((o) => [o.id, o.status]))
      const first = seen.current === null
      if (!first) {
        for (const order of orders) {
          const event = transitionEvent(seen.current?.get(order.id), order)
          if (event) handlerRef.current({ type: event, order })
        }
      }
      seen.current = next
    }

    apply(read())
    return useAppStore.subscribe((state, previous) => {
      if (state.db.orders === previous.db.orders && state.db.recentlyCancelled === previous.db.recentlyCancelled) {
        return
      }
      apply(read())
    })
  }, [])
}
