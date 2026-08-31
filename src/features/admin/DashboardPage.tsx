import { Clock, Flame, IndianRupee, ReceiptText } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '@/components/layout/AdminLayout'
import { Badge, Button, Card, EmptyState, Stat } from '@/components/ui'
import { ORDER_STATUS_META } from '@/lib/statusMeta'
import { elapsedLabel, formatINR, isToday, timeLabel } from '@/lib/utils'
import { useNow } from '@/lib/useNow'
import { activeOrdersForTable, isActiveOrder } from '@/services'
import { useAppStore } from '@/store/useAppStore'

/** Morning-glance view: how today is going and what needs attention now. */
export function DashboardPage() {
  const orders = useAppStore((s) => s.db.orders)
  const tables = useAppStore((s) => s.db.tables)
  const session = useAppStore((s) => s.session)
  const now = useNow()

  const stats = useMemo(() => {
    const today = orders.filter((o) => isToday(o.placedAt))
    const revenue = today.filter((o) => o.status === 'settled').reduce((sum, o) => sum + o.total, 0)
    const fulfilled = today.filter((o) => o.readyAt)
    const avgReadyMin =
      fulfilled.length === 0
        ? null
        : fulfilled.reduce(
            (sum, o) => sum + (new Date(o.readyAt!).getTime() - new Date(o.placedAt).getTime()) / 60000,
            0,
          ) / fulfilled.length

    const itemCounts = new Map<string, number>()
    today
      .filter((o) => o.status !== 'cancelled')
      .forEach((o) =>
        o.items
          .filter((i) => i.status !== 'cancelled')
          .forEach((i) => itemCounts.set(i.name, (itemCounts.get(i.name) ?? 0) + i.quantity)),
      )
    const topItems = [...itemCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)

    return {
      revenue,
      ordersToday: today.filter((o) => o.status !== 'cancelled').length,
      avgReadyMin,
      topItems,
    }
  }, [orders])

  const activeOrders = useMemo(
    () => orders.filter(isActiveOrder).sort((a, b) => a.placedAt.localeCompare(b.placedAt)),
    [orders],
  )

  const activeTables = tables.filter((t) => t.isActive)
  const occupied = activeTables.filter((t) => activeOrdersForTable(orders, t.id).length > 0).length
  const unsettled = activeOrders.reduce((s, o) => s + o.total, 0)

  return (
    <div>
      <PageHeader
        title={`Hello, ${session?.name ?? 'there'}`}
        sub="Here's how the café is doing today"
        actions={
          <Link to="/admin/tables">
            <Button>Take an order</Button>
          </Link>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Collected today" value={formatINR(stats.revenue)} sub="settled bills" icon={<IndianRupee className="size-5" />} />
        <Stat label="Rounds today" value={String(stats.ordersToday)} icon={<ReceiptText className="size-5" />} />
        <Stat
          label="Open on tables"
          value={String(activeOrders.length)}
          sub={`${occupied}/${activeTables.length} tables · ${formatINR(unsettled)} unsettled`}
          icon={<Flame className="size-5" />}
        />
        <Stat
          label="Avg. kitchen time"
          value={stats.avgReadyMin === null ? '—' : `${stats.avgReadyMin.toFixed(1)} min`}
          sub="placed → ready"
          icon={<Clock className="size-5" />}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Live orders */}
        <Card className="p-5 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-bold">Live orders</h2>
            <Link to="/admin/orders" className="text-sm font-semibold text-accent-600 hover:underline">
              Open orders board
            </Link>
          </div>
          {activeOrders.length === 0 ? (
            <EmptyState icon="☕" title="All quiet" hint="No active orders right now." />
          ) : (
            <ul className="divide-y divide-cream-100">
              {activeOrders.slice(0, 6).map((order) => {
                const meta = ORDER_STATUS_META[order.status]
                return (
                  <li key={order.id}>
                    <Link
                      to={`/admin/orders?focus=${order.id}`}
                      className="flex items-center justify-between gap-3 py-3 hover:bg-cream-50"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-bold">
                          #{order.orderNumber} · Table {order.tableName}
                        </p>
                        <p className="text-xs text-ink-500">
                          {order.items.reduce((n, i) => n + i.quantity, 0)} items · placed {timeLabel(order.placedAt)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="text-xs font-semibold tabular-nums text-ink-500">
                          {elapsedLabel(order.placedAt, now)}
                        </span>
                        <Badge tone={meta.tone} dot>
                          {meta.label}
                        </Badge>
                        <span className="w-16 text-right text-sm font-bold tabular-nums">{formatINR(order.total)}</span>
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        {/* Top items today */}
        <Card className="p-5">
          <h2 className="mb-3 text-base font-bold">Selling today</h2>
          {stats.topItems.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-500">No sales yet today.</p>
          ) : (
            <ul className="space-y-3">
              {stats.topItems.map(([name, qty], i) => (
                <li key={name} className="flex items-center gap-3">
                  <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-cream-200 text-xs font-bold text-ink-700">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{name}</span>
                  <span className="text-sm font-bold tabular-nums text-ink-500">×{qty}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
