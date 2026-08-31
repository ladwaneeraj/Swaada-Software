import { Clock } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PageHeader } from '@/components/layout/AdminLayout'
import { OrderItemLine, OrderTotals } from '@/components/order/OrderBits'
import { useToasts } from '@/components/toast'
import { Badge, Button, Card, EmptyState, Field, Modal, Textarea } from '@/components/ui'
import { NEXT_ORDER_ACTION, ORDER_STATUS_META } from '@/lib/statusMeta'
import { cn, elapsedLabel, timeLabel } from '@/lib/utils'
import { useNow } from '@/lib/useNow'
import { isActiveOrder, orderService } from '@/services'
import { useAppStore } from '@/store/useAppStore'
import type { Order, OrderStatus } from '@/types'

type Filter = 'all' | Extract<OrderStatus, 'placed' | 'preparing' | 'ready' | 'delivered'>

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'All active' },
  { value: 'placed', label: 'Placed' },
  { value: 'preparing', label: 'Preparing' },
  { value: 'ready', label: 'Ready' },
  { value: 'delivered', label: 'Delivered' },
]

/** Live order tracking for the floor. Finished orders move to History. */
export function OrdersPage() {
  const orders = useAppStore((s) => s.db.orders)
  const [searchParams] = useSearchParams()
  const focusId = searchParams.get('focus')
  const [filter, setFilter] = useState<Filter>('all')
  const [cancelling, setCancelling] = useState<Order | null>(null)
  const now = useNow()

  const active = useMemo(
    () =>
      orders
        .filter(isActiveOrder)
        .filter((o) => filter === 'all' || o.status === filter)
        .sort((a, b) => a.placedAt.localeCompare(b.placedAt)),
    [orders, filter],
  )

  const counts = useMemo(() => {
    const map = new Map<Filter, number>()
    orders.filter(isActiveOrder).forEach((o) => {
      map.set(o.status as Filter, (map.get(o.status as Filter) ?? 0) + 1)
      map.set('all', (map.get('all') ?? 0) + 1)
    })
    return map
  }, [orders])

  return (
    <div>
      <PageHeader title="Orders" sub="Live orders on the floor right now" />

      <div className="no-scrollbar -mx-1 mb-5 flex gap-2 overflow-x-auto px-1 pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={cn(
              'flex h-10 shrink-0 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors',
              filter === f.value ? 'bg-ink-900 text-white' : 'bg-white text-ink-700 shadow-card hover:bg-cream-50',
            )}
          >
            {f.label}
            <span
              className={cn(
                'rounded-full px-1.5 text-xs tabular-nums',
                filter === f.value ? 'bg-white/20' : 'bg-cream-200 text-ink-500',
              )}
            >
              {counts.get(f.value) ?? 0}
            </span>
          </button>
        ))}
      </div>

      {active.length === 0 ? (
        <EmptyState
          icon="🧾"
          title="No active orders"
          hint="New orders appear here the moment they are placed and update live as the kitchen works."
          action={
            <Link to="/admin/tables">
              <Button>Take an order</Button>
            </Link>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {active.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              now={now}
              focused={order.id === focusId}
              onCancel={() => setCancelling(order)}
            />
          ))}
        </div>
      )}

      <CancelDialog order={cancelling} onClose={() => setCancelling(null)} />
    </div>
  )
}

function OrderCard({
  order,
  now,
  focused,
  onCancel,
}: {
  order: Order
  now: number
  focused: boolean
  onCancel: () => void
}) {
  const meta = ORDER_STATUS_META[order.status]
  const nextAction = NEXT_ORDER_ACTION[order.status]
  const pushToast = useToasts((s) => s.push)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [focused])

  const readyCount = order.items.filter((i) => i.status === 'ready').length
  const activeItemCount = order.items.filter((i) => i.status !== 'cancelled').length

  return (
    <div ref={ref}>
      <Card className={cn('rise-in flex h-full flex-col p-5', focused && 'ring-2 ring-accent-500')}>
        <div className="mb-1 flex items-start justify-between gap-3">
          <div>
            <p className="text-lg font-bold tracking-tight">
              #{order.orderNumber} <span className="text-ink-500">· Table {order.tableName}</span>
            </p>
            <p className="text-xs text-ink-500">
              Placed {timeLabel(order.placedAt)} by {order.createdByName}
            </p>
          </div>
          <Badge tone={meta.tone} dot>
            {meta.label}
          </Badge>
        </div>

        <div className="mb-2 flex items-center gap-3 text-xs font-semibold text-ink-500">
          <span className="flex items-center gap-1 tabular-nums">
            <Clock className="size-3.5" /> {elapsedLabel(order.placedAt, now)}
          </span>
          {order.status === 'preparing' && (
            <span>
              {readyCount}/{activeItemCount} items ready
            </span>
          )}
        </div>

        <div className="flex-1 divide-y divide-cream-100 border-y border-cream-100">
          {order.items.map((item) => (
            <OrderItemLine key={item.id} item={item} muted={item.status === 'cancelled'} />
          ))}
        </div>

        <div className="pt-3">
          <OrderTotals order={order} compact />
        </div>

        <div className="mt-4 flex gap-2">
          {nextAction && (
            <Button
              className="flex-1"
              variant={nextAction.to === 'served' ? 'dark' : 'success'}
              onClick={() => {
                if (nextAction.to === 'delivered') orderService.markDelivered(order.id)
                else orderService.markServed(order.id)
                pushToast(
                  nextAction.to === 'delivered'
                    ? `Order #${order.orderNumber} delivered to ${order.tableName}`
                    : `Order #${order.orderNumber} served · table ${order.tableName} is free`,
                  'ok',
                )
              }}
            >
              {nextAction.label}
            </Button>
          )}
          {order.status !== 'delivered' && (
            <Button variant="ghost" className="text-danger-600" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </div>
      </Card>
    </div>
  )
}

function CancelDialog({ order, onClose }: { order: Order | null; onClose: () => void }) {
  const [reason, setReason] = useState('')
  const pushToast = useToasts((s) => s.push)

  useEffect(() => {
    if (order) setReason('')
  }, [order])

  return (
    <Modal
      open={order !== null}
      onClose={onClose}
      title={order ? `Cancel order #${order.orderNumber}?` : 'Cancel order'}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Keep order
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (!order) return
              orderService.cancelOrder(order.id, reason.trim() || 'Cancelled by admin')
              pushToast(`Order #${order.orderNumber} cancelled`, 'danger')
              onClose()
            }}
          >
            Cancel order
          </Button>
        </div>
      }
    >
      <p className="mb-4 text-sm text-ink-500">
        The kitchen will see this immediately. Items already marked ready stay on the ticket for
        reference.
      </p>
      <Field label="Reason (optional)">
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Guest changed their mind" />
      </Field>
    </Modal>
  )
}
