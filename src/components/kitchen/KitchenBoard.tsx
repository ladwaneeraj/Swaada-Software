import { Check, ChefHat, ChevronsRight, HandPlatter, Timer } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { Badge, VegMark } from '@/components/ui'
import { cn, elapsedLabel, minutesSince } from '@/lib/utils'
import { useNow } from '@/lib/useNow'
import { isKitchenActiveOrder, kitchenService, orderService } from '@/services'
import { useAppStore } from '@/store/useAppStore'
import type { Order, OrderItem } from '@/types'

/**
 * The kitchen board, shared by the standalone Kitchen screen and the
 * admin's kitchen monitor. Three lanes mirror the physical workflow:
 * incoming → being prepared → ready & waiting for delivery.
 */

export function KitchenBoard({ dark = false }: { dark?: boolean }) {
  const orders = useAppStore((s) => s.db.orders)
  const now = useNow()

  const lanes = useMemo(() => {
    // Delivered rounds leave the board — from there it's a billing matter.
    const active = orders.filter(isKitchenActiveOrder).sort((a, b) => a.placedAt.localeCompare(b.placedAt))
    return {
      incoming: active.filter((o) => o.status === 'placed'),
      preparing: active.filter((o) => o.status === 'preparing'),
      waiting: active.filter((o) => o.status === 'ready'),
    }
  }, [orders])

  return (
    <div className="grid h-full min-h-0 gap-4 lg:grid-cols-3">
      <Lane title="New orders" count={lanes.incoming.length} tone="info" dark={dark}>
        {lanes.incoming.map((o) => (
          <Ticket key={o.id} order={o} now={now} dark={dark} />
        ))}
      </Lane>
      <Lane title="Preparing" count={lanes.preparing.length} tone="warn" dark={dark}>
        {lanes.preparing.map((o) => (
          <Ticket key={o.id} order={o} now={now} dark={dark} />
        ))}
      </Lane>
      <Lane title="Ready · take to table" count={lanes.waiting.length} tone="ok" dark={dark}>
        {lanes.waiting.map((o) => (
          <Ticket key={o.id} order={o} now={now} dark={dark} />
        ))}
      </Lane>
    </div>
  )
}

function Lane({
  title,
  count,
  tone,
  dark,
  children,
}: {
  title: string
  count: number
  tone: 'info' | 'warn' | 'ok'
  dark: boolean
  children: React.ReactNode
}) {
  return (
    <section className="flex min-h-0 flex-col">
      <div className="mb-3 flex items-center gap-2">
        <h2 className={cn('text-sm font-bold uppercase tracking-wide', dark ? 'text-cream-300' : 'text-ink-500')}>
          {title}
        </h2>
        <Badge tone={tone}>{count}</Badge>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-4 pr-1">
        {count === 0 ? (
          <div
            className={cn(
              'grid h-28 place-items-center rounded-card border border-dashed text-sm',
              dark ? 'border-white/15 text-cream-400' : 'border-cream-300 text-ink-300',
            )}
          >
            Nothing here
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  )
}

function Ticket({ order, now, dark }: { order: Order; now: number; dark: boolean }) {
  const mins = minutesSince(order.placedAt, now)
  const urgency = mins >= 15 ? 'text-danger-600' : mins >= 8 ? 'text-warn-600' : dark ? 'text-cream-300' : 'text-ink-500'

  // Group items by station so a future multi-station kitchen can split this
  // ticket; today one screen shows all stations with a tag per group.
  const byStation = useMemo(() => {
    const map = new Map<string, OrderItem[]>()
    order.items.forEach((i) => map.set(i.stationName, [...(map.get(i.stationName) ?? []), i]))
    return [...map.entries()]
  }, [order.items])

  const readyCount = order.items.filter((i) => i.status === 'ready').length
  const activeCount = order.items.filter((i) => i.status !== 'cancelled').length

  return (
    <article className={cn('rise-in overflow-hidden rounded-card bg-white shadow-card', order.status === 'ready' && 'ring-2 ring-ok-600')}>
      <header
        className={cn(
          'flex items-center justify-between gap-2 px-4 py-3',
          order.status === 'ready' ? 'bg-ok-100' : 'bg-cream-100',
        )}
      >
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-bold tracking-tight">#{order.orderNumber}</span>
          <span className="rounded-lg bg-ink-900 px-2 py-0.5 text-sm font-bold text-white">{order.tableName}</span>
        </div>
        <span className={cn('flex items-center gap-1 text-sm font-bold tabular-nums', urgency)}>
          <Timer className="size-4" /> {elapsedLabel(order.placedAt, now)}
        </span>
      </header>

      <div className="px-4 py-2">
        {byStation.map(([stationName, items]) => (
          <div key={stationName} className="border-b border-cream-100 py-2 last:border-0">
            <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-ink-300">{stationName}</p>
            {items.map((item) => (
              <TicketItem key={item.id} order={order} item={item} />
            ))}
          </div>
        ))}
      </div>

      <footer className="px-4 pb-4">
        {order.status === 'placed' && (
          <button
            type="button"
            onClick={() => kitchenService.startOrder(order.id)}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent-500 text-sm font-bold uppercase tracking-wide text-white hover:bg-accent-600"
          >
            <ChefHat className="size-5" /> Start preparing
          </button>
        )}
        {order.status === 'preparing' && (
          <div className="space-y-2">
            <div className="h-1.5 overflow-hidden rounded-full bg-cream-200">
              <div
                className="h-full rounded-full bg-ok-600 transition-all"
                style={{ width: `${activeCount === 0 ? 0 : (readyCount / activeCount) * 100}%` }}
              />
            </div>
            <p className="text-center text-xs font-semibold text-ink-500">
              {readyCount}/{activeCount} items ready — tap items as they finish
            </p>
          </div>
        )}
        {order.status === 'ready' && (
          <div className="space-y-2">
            {order.readyAt && (
              <p className="text-center text-xs font-semibold text-ink-500">
                All items done · waiting {elapsedLabel(order.readyAt, now)}
              </p>
            )}
            <SwipeToDeliver onDeliver={() => orderService.markDelivered(order.id)} />
          </div>
        )}
      </footer>
    </article>
  )
}

/**
 * Slide-to-confirm delivery. A deliberate gesture (drag the handle across)
 * so a stray tap on a busy kitchen tablet can't mark food as delivered.
 * Keyboard users press Enter on the handle instead.
 */
function SwipeToDeliver({ onDeliver }: { onDeliver: () => void }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const startX = useRef(0)
  const [x, setX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [done, setDone] = useState(false)

  const THUMB = 44
  const PAD = 4
  const maxX = () => Math.max(0, (trackRef.current?.clientWidth ?? 0) - THUMB - PAD * 2)

  const finish = () => {
    setDone(true)
    setX(maxX())
    // Let the thumb land before the ticket leaves the board.
    window.setTimeout(onDeliver, 180)
  }

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (done) return
    e.currentTarget.setPointerCapture(e.pointerId)
    startX.current = e.clientX - x
    setDragging(true)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragging || done) return
    setX(Math.min(Math.max(0, e.clientX - startX.current), maxX()))
  }
  const onPointerUp = () => {
    if (!dragging || done) return
    setDragging(false)
    if (x >= maxX() * 0.8) finish()
    else setX(0)
  }

  const progress = maxX() > 0 ? x / maxX() : 0

  return (
    <div
      ref={trackRef}
      className="relative h-13 select-none overflow-hidden rounded-full bg-ok-600"
      style={{ padding: PAD }}
    >
      <span
        className="pointer-events-none absolute inset-0 grid place-items-center text-sm font-bold uppercase tracking-wide text-white transition-opacity"
        style={{ opacity: 1 - progress * 1.4 }}
      >
        Swipe to deliver
        <ChevronsRight className="absolute right-4 size-5 animate-pulse" />
      </span>
      <button
        type="button"
        aria-label="Swipe right (or press Enter) to mark delivered"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !done) finish()
        }}
        className={cn(
          'relative grid size-11 cursor-grab touch-none place-items-center rounded-full bg-white text-ok-600 shadow-card',
          dragging ? 'cursor-grabbing' : 'transition-transform duration-200',
        )}
        style={{ transform: `translateX(${x}px)` }}
      >
        <HandPlatter className="size-5" />
      </button>
    </div>
  )
}

function TicketItem({ order, item }: { order: Order; item: OrderItem }) {
  const interactive = order.status === 'preparing' && item.status !== 'cancelled'
  const ready = item.status === 'ready'
  return (
    <button
      type="button"
      disabled={!interactive}
      onClick={() => kitchenService.setItemStatus(order.id, item.id, ready ? 'preparing' : 'ready')}
      aria-label={`${item.name}: mark ${ready ? 'not ready' : 'ready'}`}
      className={cn(
        'flex w-full items-start gap-3 rounded-lg px-1 py-1.5 text-left',
        interactive && 'hover:bg-cream-50',
        item.status === 'cancelled' && 'opacity-40',
      )}
    >
      <span
        className={cn(
          'mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border-2 transition-colors',
          ready ? 'border-ok-600 bg-ok-600 text-white' : 'border-cream-300 bg-white text-transparent',
        )}
        aria-hidden
      >
        <Check className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('flex items-center gap-2 text-[15px] font-bold leading-snug', item.status === 'cancelled' && 'line-through')}>
          {item.quantity} × {item.name}
          <VegMark isVeg={item.isVegetarian} className="size-3.5" />
        </span>
        {item.modifiers.length > 0 && (
          <span className="block text-xs font-medium text-ink-500">
            {item.modifiers.map((m) => m.optionName).join(' · ')}
          </span>
        )}
        {item.specialInstructions && (
          <span className="block text-xs font-semibold italic text-accent-600">“{item.specialInstructions}”</span>
        )}
      </span>
    </button>
  )
}
