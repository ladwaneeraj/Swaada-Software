import { ChevronDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PageHeader } from '@/components/layout/AdminLayout'
import { OrderItemLine, OrderTotals } from '@/components/order/OrderBits'
import { Badge, Card, EmptyState, Input, Select } from '@/components/ui'
import { ORDER_STATUS_META } from '@/lib/statusMeta'
import { cn, dateTimeLabel, formatINR } from '@/lib/utils'
import { isActiveOrder } from '@/services'
import { useAppStore } from '@/store/useAppStore'
import type { OrderStatus } from '@/types'

type HistoryFilter = 'all' | Extract<OrderStatus, 'served' | 'cancelled'>

/** Completed and cancelled orders. Active orders live on the Orders page. */
export function HistoryPage() {
  const orders = useAppStore((s) => s.db.orders)
  const [filter, setFilter] = useState<HistoryFilter>('all')
  const [query, setQuery] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const finished = useMemo(
    () =>
      orders
        .filter((o) => !isActiveOrder(o))
        .filter((o) => filter === 'all' || o.status === filter)
        .filter((o) => {
          const q = query.trim().toLowerCase()
          if (!q) return true
          return (
            String(o.orderNumber).includes(q) ||
            o.tableName.toLowerCase().includes(q) ||
            o.items.some((i) => i.name.toLowerCase().includes(q))
          )
        })
        .sort((a, b) => b.placedAt.localeCompare(a.placedAt)),
    [orders, filter, query],
  )

  const totalRevenue = finished.filter((o) => o.status === 'served').reduce((s, o) => s + o.total, 0)

  return (
    <div>
      <PageHeader title="Order history" sub={`${finished.length} orders · ${formatINR(totalRevenue)} served revenue in view`} />

      <div className="mb-4 flex flex-wrap gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by order #, table or item…"
          aria-label="Search history"
          className="min-w-52 flex-1"
        />
        <Select value={filter} onChange={(e) => setFilter(e.target.value as HistoryFilter)} className="w-40" aria-label="Filter history">
          <option value="all">All finished</option>
          <option value="served">Served</option>
          <option value="cancelled">Cancelled</option>
        </Select>
      </div>

      {finished.length === 0 ? (
        <EmptyState icon="🗂" title="No orders here yet" hint="Served and cancelled orders will show up in this list." />
      ) : (
        <div className="space-y-2">
          {finished.map((order) => {
            const meta = ORDER_STATUS_META[order.status]
            const open = expandedId === order.id
            return (
              <Card key={order.id} className="overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpandedId(open ? null : order.id)}
                  aria-expanded={open}
                  className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left hover:bg-cream-50"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-bold">
                      #{order.orderNumber} · Table {order.tableName}
                      <span className="ml-2 font-normal text-ink-500">{dateTimeLabel(order.placedAt)}</span>
                    </p>
                    <p className="mt-0.5 truncate text-xs text-ink-500">
                      {order.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <Badge tone={meta.tone} dot>
                      {meta.label}
                    </Badge>
                    <span className="w-20 text-right text-sm font-bold tabular-nums">{formatINR(order.total)}</span>
                    <ChevronDown className={cn('size-4 text-ink-300 transition-transform', open && 'rotate-180')} />
                  </div>
                </button>
                {open && (
                  <div className="border-t border-cream-100 px-5 py-4">
                    <div className="divide-y divide-cream-100">
                      {order.items.map((item) => (
                        <OrderItemLine key={item.id} item={item} muted={item.status === 'cancelled'} />
                      ))}
                    </div>
                    <div className="mt-3 max-w-xs">
                      <OrderTotals order={order} compact />
                    </div>
                    <p className="mt-3 text-xs text-ink-500">
                      Placed {dateTimeLabel(order.placedAt)} by {order.createdByName}
                      {order.servedAt && ` · served ${dateTimeLabel(order.servedAt)}`}
                      {order.cancelledAt && ` · cancelled ${dateTimeLabel(order.cancelledAt)}`}
                      {order.cancelReason && ` (${order.cancelReason})`}
                    </p>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
