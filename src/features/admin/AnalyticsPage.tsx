import { IndianRupee, ReceiptText, Soup, TrendingUp } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PageHeader } from '@/components/layout/AdminLayout'
import { Card, EmptyState, Segmented, Stat } from '@/components/ui'
import { PAYMENT_METHOD_META } from '@/lib/statusMeta'
import { cn, formatINR } from '@/lib/utils'
import { useAppStore } from '@/store/useAppStore'
import type { Order } from '@/types'

type Range = 'today' | '7d' | 'all'

/**
 * Sales analytics computed live from order state. Every figure derives from
 * the same orders array the rest of the app uses — no separate bookkeeping.
 */
export function AnalyticsPage() {
  const orders = useAppStore((s) => s.db.orders)
  const [range, setRange] = useState<Range>('today')

  const data = useMemo(() => computeAnalytics(orders, range), [orders, range])

  return (
    <div>
      <PageHeader
        title="Analytics"
        sub="Figures update the moment a bill is settled"
        actions={
          <Segmented
            value={range}
            onChange={setRange}
            options={[
              { value: 'today', label: 'Today' },
              { value: '7d', label: '7 days' },
              { value: 'all', label: 'All time' },
            ]}
          />
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Collected" value={formatINR(data.revenue)} sub="settled bills" icon={<IndianRupee className="size-5" />} />
        <Stat label="Rounds" value={String(data.orderCount)} sub="excluding cancelled" icon={<ReceiptText className="size-5" />} />
        <Stat label="Avg round value" value={data.settledCount ? formatINR(data.revenue / data.settledCount) : '—'} icon={<TrendingUp className="size-5" />} />
        <Stat label="Items sold" value={String(data.itemsSold)} icon={<Soup className="size-5" />} />
      </div>

      {data.orderCount === 0 ? (
        <EmptyState icon="📈" title="No data for this range" hint="Place and serve a few orders to see analytics here." />
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card className="p-5">
            <h2 className="mb-1 text-base font-bold">Revenue by day</h2>
            <p className="mb-4 text-xs text-ink-500">Settled rounds, last 7 days</p>
            <ColumnChart
              points={data.revenueByDay.map((d) => ({ label: d.label, value: d.revenue, detail: `${d.label} — ${formatINR(d.revenue)}` }))}
              format={(v) => formatINR(v)}
            />
          </Card>

          <Card className="p-5">
            <h2 className="mb-1 text-base font-bold">Orders by hour</h2>
            <p className="mb-4 text-xs text-ink-500">When the café is busiest in this range</p>
            <ColumnChart
              points={data.ordersByHour.map((d) => ({ label: d.label, value: d.count, detail: `${d.label} — ${d.count} orders` }))}
              format={(v) => String(v)}
              sparse
            />
          </Card>

          <Card className="p-5">
            <h2 className="mb-1 text-base font-bold">Top items</h2>
            <p className="mb-4 text-xs text-ink-500">By quantity sold in this range</p>
            <BarList rows={data.topItems.map(([name, qty]) => ({ label: name, value: qty, valueLabel: `×${qty}` }))} />
          </Card>

          <Card className="p-5">
            <h2 className="mb-1 text-base font-bold">Revenue by category</h2>
            <p className="mb-4 text-xs text-ink-500">Where the money comes from</p>
            <BarList
              rows={data.byCategory.map(([name, amount]) => ({
                label: name,
                value: amount,
                valueLabel: formatINR(amount),
              }))}
            />
          </Card>

          <Card className="p-5">
            <h2 className="mb-1 text-base font-bold">Payments</h2>
            <p className="mb-4 text-xs text-ink-500">Cash vs UPI, settled bills in this range</p>
            {data.payments.length === 0 ? (
              <p className="py-8 text-center text-sm text-ink-500">No settled bills yet.</p>
            ) : (
              <BarList
                rows={data.payments.map(([label, amount]) => ({
                  label,
                  value: amount,
                  valueLabel: formatINR(amount),
                }))}
              />
            )}
          </Card>
        </div>
      )}
    </div>
  )
}

/* ------------------------------ Computation ------------------------------ */

function computeAnalytics(orders: Order[], range: Range) {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const cutoff =
    range === 'today'
      ? startOfToday
      : range === '7d'
        ? new Date(startOfToday.getTime() - 6 * 86400000)
        : new Date(0)

  const inRange = orders.filter((o) => new Date(o.placedAt) >= cutoff && o.status !== 'cancelled')
  const settled = inRange.filter((o) => o.status === 'settled')

  const revenue = settled.reduce((s, o) => s + o.total, 0)

  const paymentSplit = new Map<string, number>()
  settled.forEach((o) => {
    if (o.paymentMethod) {
      const label = PAYMENT_METHOD_META[o.paymentMethod].label
      paymentSplit.set(label, (paymentSplit.get(label) ?? 0) + o.total)
    }
  })
  const itemsSold = inRange.reduce(
    (s, o) => s + o.items.filter((i) => i.status !== 'cancelled').reduce((n, i) => n + i.quantity, 0),
    0,
  )

  // Last 7 days, oldest first, zero-filled (always shown regardless of range).
  const revenueByDay = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(startOfToday.getTime() - (6 - i) * 86400000)
    const next = new Date(day.getTime() + 86400000)
    const dayRevenue = orders
      .filter((o) => o.status === 'settled')
      .filter((o) => {
        const t = new Date(o.placedAt)
        return t >= day && t < next
      })
      .reduce((s, o) => s + o.total, 0)
    return { label: day.toLocaleDateString([], { weekday: 'short' }), revenue: dayRevenue }
  })

  const hourCounts = new Map<number, number>()
  inRange.forEach((o) => {
    const h = new Date(o.placedAt).getHours()
    hourCounts.set(h, (hourCounts.get(h) ?? 0) + 1)
  })
  // Café hours window 7:00–23:00 keeps the chart readable.
  const ordersByHour = Array.from({ length: 17 }, (_, i) => {
    const h = i + 7
    return { label: `${((h + 11) % 12) + 1}${h < 12 ? 'am' : 'pm'}`, count: hourCounts.get(h) ?? 0 }
  })

  const itemCounts = new Map<string, number>()
  const categoryRevenue = new Map<string, number>()
  inRange.forEach((o) =>
    o.items
      .filter((i) => i.status !== 'cancelled')
      .forEach((i) => {
        itemCounts.set(i.name, (itemCounts.get(i.name) ?? 0) + i.quantity)
        categoryRevenue.set(i.categoryName, (categoryRevenue.get(i.categoryName) ?? 0) + i.unitPrice * i.quantity)
      }),
  )

  return {
    revenue,
    orderCount: inRange.length,
    settledCount: settled.length,
    itemsSold,
    revenueByDay,
    ordersByHour,
    topItems: [...itemCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
    byCategory: [...categoryRevenue.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
    payments: [...paymentSplit.entries()].sort((a, b) => b[1] - a[1]),
  }
}

/* -------------------------------- Charts --------------------------------- */
/* Hand-rolled, single-hue marks (magnitude), ink-token text, hover          */
/* tooltips, rounded data-ends anchored to the baseline.                     */

function ColumnChart({
  points,
  format,
  sparse = false,
}: {
  points: Array<{ label: string; value: number; detail: string }>
  format: (v: number) => string
  sparse?: boolean
}) {
  const max = Math.max(1, ...points.map((p) => p.value))
  const maxIndex = points.findIndex((p) => p.value === max && max > 0)
  return (
    <div>
      <div className="flex h-40 items-end gap-1.5 border-b border-cream-200">
        {points.map((p, i) => (
          <div key={p.label + i} className="group relative flex h-full flex-1 flex-col items-center justify-end">
            {/* selective direct label: only the peak value is printed */}
            {i === maxIndex && p.value > 0 && (
              <span className="mb-1 text-[10px] font-bold tabular-nums text-ink-700">{format(p.value)}</span>
            )}
            <div
              className="w-full max-w-7 rounded-t bg-accent-500 transition-colors group-hover:bg-accent-600"
              style={{ height: `${(p.value / max) * 100}%`, minHeight: p.value > 0 ? 3 : 0 }}
            />
            {/* hover tooltip */}
            <span className="pointer-events-none absolute -top-8 z-10 hidden whitespace-nowrap rounded-lg bg-ink-900 px-2 py-1 text-[11px] font-semibold text-white group-hover:block">
              {p.detail}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        {points.map((p, i) => (
          <span
            key={p.label + i}
            className={cn(
              'flex-1 text-center text-[10px] font-medium text-ink-500',
              sparse && i % 2 === 1 && 'invisible sm:visible',
            )}
          >
            {p.label}
          </span>
        ))}
      </div>
    </div>
  )
}

function BarList({ rows }: { rows: Array<{ label: string; value: number; valueLabel: string }> }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label} className="group">
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-sm font-semibold">{r.label}</span>
            <span className="shrink-0 text-sm font-bold tabular-nums text-ink-700">{r.valueLabel}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-cream-200">
            <div
              className="h-full rounded-full bg-accent-500 transition-colors group-hover:bg-accent-600"
              style={{ width: `${(r.value / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}
