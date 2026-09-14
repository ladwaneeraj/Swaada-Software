import { AlarmClock, IndianRupee, ReceiptText, UsersRound } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PageHeader } from '@/components/layout/AdminLayout'
import { Badge, Card, EmptyState, Segmented, Stat } from '@/components/ui'
import { PAYMENT_METHOD_META } from '@/lib/statusMeta'
import { cn, dateTimeLabel, formatINR, round2 } from '@/lib/utils'
import { customerAccounts, walletHeld, walletOwed } from '@/services'
import { useAppStore } from '@/store/useAppStore'
import { HISTORY_RANGES, useHistory, type HistoryRangeKey } from '@/lib/useHistory'
import type { Bill, Customer, Order, WalletEntry } from '@/types'
import { PAYMENT_METHODS } from '@/types'

/**
 * Note what is NOT here: "all time".
 *
 * An all-time view has to read every bill the cafe has ever written, which
 * is the one query whose cost grows without limit and never comes back down.
 * A fixed set of windows keeps every question answerable in one bounded
 * read. If a yearly total is ever wanted it belongs in a nightly rollup
 * document, not in a query a manager can fire by tapping a chip.
 */
type Range = HistoryRangeKey

const RANGE_LABEL: Record<Range, string> = {
  today: 'today',
  '7d': 'the last 7 days',
  '30d': 'the last 30 days',
  '90d': 'the last 90 days',
}

/**
 * Everything the cafe can be asked about its own trade, computed live from
 * the same orders, bills and wallet entries the rest of the app uses. There
 * is no separate bookkeeping to fall out of step.
 *
 * Each section answers a question you would actually act on: where the money
 * went, when the rush is, who is worth chasing, what to stop making.
 */
export function AnalyticsPage() {
  const items = useAppStore((s) => s.db.items)
  const [range, setRange] = useState<Range>('today')

  /**
   * Fetched for the chosen window, not read from memory. Opening 30 days
   * costs one query; never opening this screen costs nothing.
   */
  const { orders, bills, walletEntries, loading, error, truncated } = useHistory(range)
  // Guest counts here come from the bills themselves, which carry the guest's
  // id and name, so no separate customer read is needed for this screen.
  const customers = useAppStore((s) => s.db.customers)

  const d = useMemo(
    () =>
      computeAnalytics({
        orders,
        bills,
        customers,
        walletEntries,
        itemNames: items.map((i) => i.name),
        range,
      }),
    [orders, bills, customers, walletEntries, items, range],
  )

  return (
    <div>
      <PageHeader
        title="Analytics"
        sub={
          loading
            ? `Loading ${RANGE_LABEL[range]}…`
            : 'Every figure is computed from the bills themselves, never kept separately'
        }
        actions={
          <Segmented
            value={range}
            onChange={setRange}
            options={HISTORY_RANGES.map((r) => ({ value: r.key, label: r.label }))}
          />
        }
      />

      {error && (
        <p className="mb-4 rounded-card bg-danger-100 px-3.5 py-2.5 text-sm font-semibold text-danger-600">
          {error}
        </p>
      )}
      {truncated && (
        <p className="mb-4 rounded-card bg-warn-100 px-3.5 py-2.5 text-[13px] font-semibold text-warn-600">
          This period is larger than one read can cover, so these figures are based on the most
          recent part of it. Pick a shorter range for exact numbers.
        </p>
      )}

      <div
        className={cn(
          'mb-6 grid grid-cols-2 gap-3 transition-opacity xl:grid-cols-4',
          loading && 'opacity-40',
        )}
      >
        <Stat label="Billed" value={formatINR(d.sales)} sub={`${d.billCount} bills ${RANGE_LABEL[range]}`} icon={<IndianRupee className="size-5" />} />
        <Stat label="Collected" value={formatINR(d.collected)} sub={`${formatINR(d.cash)} cash · ${formatINR(d.upi)} UPI`} icon={<ReceiptText className="size-5" />} />
        <Stat label="Average bill" value={d.billCount ? formatINR(d.avgBill) : '—'} sub={d.billCount ? `${d.avgItems.toFixed(1)} items · ${d.avgRounds.toFixed(1)} rounds` : 'no bills yet'} icon={<UsersRound className="size-5" />} />
        <Stat
          label="Kitchen time"
          value={d.avgKitchenMin === null ? '—' : `${d.avgKitchenMin.toFixed(1)} min`}
          sub={d.avgWaitMin === null ? 'placed to ready' : `then ${d.avgWaitMin.toFixed(1)} min to the table`}
          icon={<AlarmClock className="size-5" />}
        />
      </div>

      {d.billCount === 0 && d.orderCount === 0 ? (
        <EmptyState icon="📈" title={`Nothing billed ${RANGE_LABEL[range]}`} hint="Take a few orders and settle them to see the numbers here." />
      ) : (
        <div className="space-y-6">
          {/* ------------------------------ Money ------------------------------ */}
          <Section title="Money" hint="Billed is what you charged. Collected is what actually came in.">
            <Card className="p-5">
              <h3 className="mb-3 text-sm font-bold">Where the money went</h3>
              <FactList
                rows={[
                  { label: 'Billed', value: formatINR(d.sales) },
                  { label: 'Discounts given', value: formatINR(d.discounts), note: d.sales > 0 ? `${((d.discounts / (d.sales + d.discounts)) * 100).toFixed(1)}% off menu price` : undefined, tone: d.discounts > 0 ? 'warn' : undefined },
                  { label: 'Paid from wallets', value: formatINR(d.fromWallet), note: 'collected on an earlier day' },
                  { label: 'Left unpaid', value: formatINR(d.leftUnpaid), tone: d.leftUnpaid > 0 ? 'danger' : undefined },
                  { label: 'Old dues cleared', value: formatINR(d.duesCleared), note: 'eaten earlier, paid now' },
                  { label: 'Into wallets', value: formatINR(d.intoWallet), note: 'collected now, eaten later' },
                  { label: 'Collected', value: formatINR(d.collected), strong: true },
                ]}
              />
            </Card>

            <Card className="p-5">
              <h3 className="mb-1 text-sm font-bold">Revenue by day</h3>
              <p className="mb-4 text-xs text-ink-500">Bills settled, last 14 days</p>
              <ColumnChart
                points={d.revenueByDay.map((x) => ({ label: x.label, value: x.revenue, detail: `${x.full} — ${formatINR(x.revenue)}` }))}
                format={(v) => formatINR(v)}
                sparse
              />
            </Card>

            <Card className="p-5">
              <h3 className="mb-1 text-sm font-bold">Payments</h3>
              <p className="mb-4 text-xs text-ink-500">Cash against UPI, split bills included</p>
              {d.payments.length === 0 ? (
                <p className="py-8 text-center text-sm text-ink-500">No money taken in this range.</p>
              ) : (
                <BarList rows={d.payments.map(([label, amount]) => ({ label, value: amount, valueLabel: formatINR(amount) }))} />
              )}
            </Card>

            <Card className="p-5">
              <h3 className="mb-1 text-sm font-bold">Open money</h3>
              <p className="mb-4 text-xs text-ink-500">Across all guests, not just this range</p>
              <FactList
                rows={[
                  { label: 'Owed to you', value: formatINR(d.totalOwed), note: `${d.owingGuests.length} guest${d.owingGuests.length === 1 ? '' : 's'}`, tone: d.totalOwed > 0 ? 'danger' : undefined, strong: true },
                  { label: 'Wallet money you hold', value: formatINR(d.totalHeld), note: 'already collected, still owed in food' },
                  { label: 'Sitting on tables now', value: formatINR(d.onTables), note: 'ordered, not yet settled' },
                ]}
              />
            </Card>
          </Section>

          {/* ------------------------------ Timing ----------------------------- */}
          <Section title="When you are busy" hint="Staff the rush, not the average.">
            <Card className="p-5">
              <h3 className="mb-1 text-sm font-bold">Orders by hour</h3>
              <p className="mb-4 text-xs text-ink-500">
                {d.peakHour ? `Busiest at ${d.peakHour.label} — ${d.peakHour.count} rounds` : 'No rounds in this range'}
              </p>
              <ColumnChart points={d.ordersByHour.map((x) => ({ label: x.label, value: x.count, detail: `${x.label} — ${x.count} rounds` }))} format={String} sparse />
            </Card>

            <Card className="p-5">
              <h3 className="mb-1 text-sm font-bold">Sales by weekday</h3>
              <p className="mb-4 text-xs text-ink-500">
                {d.bestWeekday ? `${d.bestWeekday.label} is your strongest day` : 'Not enough bills yet'}
              </p>
              <ColumnChart points={d.byWeekday.map((x) => ({ label: x.label, value: x.revenue, detail: `${x.label} — ${formatINR(x.revenue)}` }))} format={(v) => formatINR(v)} />
            </Card>

            <Card className="p-5">
              <h3 className="mb-1 text-sm font-bold">Slowest to make</h3>
              <p className="mb-4 text-xs text-ink-500">Average minutes from ticket to ready</p>
              {d.slowestItems.length === 0 ? (
                <p className="py-8 text-center text-sm text-ink-500">Nothing has been cooked in this range yet.</p>
              ) : (
                <BarList rows={d.slowestItems.map((x) => ({ label: x.name, value: x.minutes, valueLabel: `${x.minutes.toFixed(1)} min` }))} />
              )}
            </Card>

            <Card className="p-5">
              <h3 className="mb-1 text-sm font-bold">Table turn</h3>
              <p className="mb-4 text-xs text-ink-500">First round to paid bill</p>
              <FactList
                rows={[
                  { label: 'Average sitting', value: d.avgTurnMin === null ? '—' : `${d.avgTurnMin.toFixed(0)} min`, strong: true },
                  { label: 'Kitchen time', value: d.avgKitchenMin === null ? '—' : `${d.avgKitchenMin.toFixed(1)} min`, note: 'placed to ready' },
                  { label: 'Waiting to be carried out', value: d.avgWaitMin === null ? '—' : `${d.avgWaitMin.toFixed(1)} min`, note: 'ready to delivered', tone: (d.avgWaitMin ?? 0) > 5 ? 'warn' : undefined },
                  { label: 'Rounds per sitting', value: d.billCount ? d.avgRounds.toFixed(1) : '—' },
                ]}
              />
            </Card>
          </Section>

          {/* ----------------------------- Customers --------------------------- */}
          <Section title="Customers" hint="Who came back, who owes you, who stopped coming.">
            <Card className="p-5">
              <h3 className="mb-3 text-sm font-bold">Guests in this range</h3>
              <FactList
                rows={[
                  { label: 'Bills with a named guest', value: `${d.namedBills} of ${d.billCount}`, note: d.billCount ? `${((d.namedBills / d.billCount) * 100).toFixed(0)}% of bills` : undefined, strong: true },
                  { label: 'Returning guests', value: String(d.returningBills), note: 'had been in before' },
                  { label: 'First-time guests', value: String(d.newGuests) },
                  { label: 'Average named bill', value: d.namedBills ? formatINR(d.avgNamedBill) : '—' },
                  { label: 'Average walk-in bill', value: d.walkInBills ? formatINR(d.avgWalkInBill) : '—', note: d.namedBills && d.walkInBills ? (d.avgNamedBill > d.avgWalkInBill ? 'guests spend more' : 'walk-ins spend more') : undefined },
                ]}
              />
            </Card>

            <Card className="p-5">
              <h3 className="mb-1 text-sm font-bold">Top guests</h3>
              <p className="mb-4 text-xs text-ink-500">By spend {RANGE_LABEL[range]}</p>
              {d.topGuests.length === 0 ? (
                <p className="py-8 text-center text-sm text-ink-500">No named guests in this range.</p>
              ) : (
                <BarList rows={d.topGuests.map((g) => ({ label: `${g.name} · ${g.visits} visit${g.visits === 1 ? '' : 's'}`, value: g.spend, valueLabel: formatINR(g.spend) }))} />
              )}
            </Card>

            <Card className="p-5">
              <h3 className="mb-1 text-sm font-bold">Owes you money</h3>
              <p className="mb-4 text-xs text-ink-500">All time, oldest debt first</p>
              {d.owingGuests.length === 0 ? (
                <p className="py-8 text-center text-sm text-ink-500">Nobody owes you anything.</p>
              ) : (
                <ul className="divide-y divide-surface-100">
                  {d.owingGuests.slice(0, 8).map((g) => (
                    <li key={g.phone} className="flex items-center justify-between gap-3 py-2.5">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{g.name}</span>
                        <span className="block text-[11px] tabular-nums text-ink-500">{g.phone}{g.since ? ` · since ${dateTimeLabel(g.since)}` : ''}</span>
                      </span>
                      <Badge tone="danger">{formatINR(g.owed)}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="p-5">
              <h3 className="mb-1 text-sm font-bold">Not seen lately</h3>
              <p className="mb-4 text-xs text-ink-500">Regulars with no visit in 30 days</p>
              {d.lapsedGuests.length === 0 ? (
                <p className="py-8 text-center text-sm text-ink-500">Everyone who has been in twice is still coming.</p>
              ) : (
                <ul className="divide-y divide-surface-100">
                  {d.lapsedGuests.slice(0, 8).map((g) => (
                    <li key={g.phone} className="flex items-center justify-between gap-3 py-2.5">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{g.name}</span>
                        <span className="block text-[11px] tabular-nums text-ink-500">{g.phone} · {g.visits} visits · last {dateTimeLabel(g.lastVisitAt)}</span>
                      </span>
                      <span className="shrink-0 text-sm font-bold tabular-nums text-ink-700">{formatINR(g.spent)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </Section>

          {/* ------------------------------- Menu ------------------------------ */}
          <Section title="Menu" hint="What earns its place on the board.">
            <Card className="p-5">
              <h3 className="mb-1 text-sm font-bold">Top sellers</h3>
              <p className="mb-4 text-xs text-ink-500">By plates sold</p>
              <BarList rows={d.topItems.map(([name, qty]) => ({ label: name, value: qty, valueLabel: `×${qty}` }))} />
            </Card>

            <Card className="p-5">
              <h3 className="mb-1 text-sm font-bold">Biggest earners</h3>
              <p className="mb-4 text-xs text-ink-500">By money taken, at menu price</p>
              <BarList rows={d.topItemRevenue.map(([name, amount]) => ({ label: name, value: amount, valueLabel: formatINR(amount) }))} />
            </Card>

            <Card className="p-5">
              <h3 className="mb-1 text-sm font-bold">Revenue by category</h3>
              <p className="mb-4 text-xs text-ink-500">Before bill discounts</p>
              <BarList rows={d.byCategory.map(([name, amount]) => ({ label: name, value: amount, valueLabel: formatINR(amount) }))} />
            </Card>

            <Card className="p-5">
              <h3 className="mb-1 text-sm font-bold">Nobody ordered these</h3>
              <p className="mb-4 text-xs text-ink-500">
                {d.deadItems.length} of {d.menuSize} items sold nothing {RANGE_LABEL[range]}
              </p>
              {d.deadItems.length === 0 ? (
                <p className="py-8 text-center text-sm text-ink-500">Every item on the menu sold at least once.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {d.deadItems.slice(0, 24).map((name) => (
                    <span key={name} className="rounded-full bg-surface-100 px-2.5 py-1 text-[11px] font-semibold text-ink-500">
                      {name}
                    </span>
                  ))}
                  {d.deadItems.length > 24 && (
                    <span className="px-1 py-1 text-[11px] text-ink-300">and {d.deadItems.length - 24} more</span>
                  )}
                </div>
              )}
            </Card>
          </Section>
        </div>
      )}
    </div>
  )
}

/* ------------------------------ Presentation ----------------------------- */

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-3">
        <h2 className="text-base font-bold">{title}</h2>
        <p className="text-xs text-ink-500">{hint}</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">{children}</div>
    </section>
  )
}

/** A short column of "label — figure" lines, the way a ledger reads. */
function FactList({
  rows,
}: {
  rows: Array<{ label: string; value: string; note?: string; strong?: boolean; tone?: 'warn' | 'danger' }>
}) {
  return (
    <ul className="divide-y divide-surface-100">
      {rows.map((r) => (
        <li key={r.label} className="flex items-baseline justify-between gap-3 py-2">
          <span className="min-w-0">
            <span className={cn('block text-[13px]', r.strong ? 'font-bold text-ink-900' : 'text-ink-500')}>{r.label}</span>
            {r.note && <span className="block text-[11px] text-ink-300">{r.note}</span>}
          </span>
          <span
            className={cn(
              'shrink-0 tabular-nums',
              r.strong ? 'text-base font-bold' : 'text-sm font-semibold',
              r.tone === 'danger' && 'text-danger-600',
              r.tone === 'warn' && 'text-warn-600',
            )}
          >
            {r.value}
          </span>
        </li>
      ))}
    </ul>
  )
}

/* ------------------------------ Computation ------------------------------ */

const MINUTE = 60000

function minutesBetween(from?: string, to?: string): number | null {
  if (!from || !to) return null
  return (new Date(to).getTime() - new Date(from).getTime()) / MINUTE
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((s, v) => s + v, 0) / values.length
}

function computeAnalytics(input: {
  orders: Order[]
  bills: Bill[]
  customers: Customer[]
  walletEntries: WalletEntry[]
  itemNames: string[]
  range: Range
}) {
  const { orders, bills, customers, walletEntries, itemNames, range } = input
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  // The query already fetched only this window; this second pass trims the
  // edges, since a business day and a calendar day are not the same thing.
  const windowDays = range === 'today' ? 1 : range === '7d' ? 7 : range === '30d' ? 30 : 90
  const cutoff = new Date(startOfToday.getTime() - (windowDays - 1) * 86400000)

  const inRange = orders.filter((o) => new Date(o.placedAt) >= cutoff && o.status !== 'cancelled')
  const billsInRange = bills.filter((b) => new Date(b.settledAt) >= cutoff)
  const entriesInRange = walletEntries.filter((e) => new Date(e.at) >= cutoff)

  /* ---- money ---- */
  const sales = round2(billsInRange.reduce((s, b) => s + b.total, 0))
  const discounts = round2(billsInRange.reduce((s, b) => s + b.discountAmount, 0))
  const fromWallet = round2(billsInRange.reduce((s, b) => s + b.walletApplied, 0))
  const leftUnpaid = round2(billsInRange.reduce((s, b) => s + b.creditAmount, 0))
  const intoWallet = round2(
    billsInRange.reduce((s, b) => s + b.walletTopUp, 0) +
      entriesInRange
        .filter((e) => !e.billId && e.method && e.amount > 0 && e.kind !== 'repayment')
        .reduce((s, e) => s + e.amount, 0),
  )
  // Old debts paid off. Counted apart from top-ups: one is money the cafe was
  // already owed coming back, the other is money it now owes food against.
  const duesCleared = round2(
    billsInRange.reduce((s, b) => s + b.duesCleared, 0) +
      entriesInRange.filter((e) => !e.billId && e.kind === 'repayment').reduce((s, e) => s + e.amount, 0),
  )
  const counterMoney = entriesInRange.filter((e) => !e.billId && e.method)
  const cash = round2(
    billsInRange.reduce((s, b) => s + b.payments.cash, 0) +
      counterMoney.filter((e) => e.method === 'cash').reduce((s, e) => s + e.amount, 0),
  )
  const upi = round2(
    billsInRange.reduce((s, b) => s + b.payments.upi, 0) +
      counterMoney.filter((e) => e.method === 'upi').reduce((s, e) => s + e.amount, 0),
  )
  const payments: Array<[string, number]> = PAYMENT_METHODS.map((m) => [
    PAYMENT_METHOD_META[m].label,
    m === 'cash' ? cash : upi,
  ]).filter(([, amount]) => (amount as number) > 0) as Array<[string, number]>

  const accounts = customerAccounts({ customers, bills, walletEntries })
  const totalOwed = round2(accounts.reduce((s, a) => s + walletOwed(a.balance), 0))
  const totalHeld = round2(accounts.reduce((s, a) => s + walletHeld(a.balance), 0))
  const onTables = round2(
    orders.filter((o) => ['placed', 'preparing', 'ready', 'delivered'].includes(o.status)).reduce((s, o) => s + o.total, 0),
  )

  /* ---- orders and timing ---- */
  const billCount = billsInRange.length
  const orderById = new Map(orders.map((o) => [o.id, o]))
  const itemsPerBill: number[] = []
  const roundsPerBill: number[] = []
  const turnMinutes: number[] = []
  for (const bill of billsInRange) {
    const rounds = bill.orderIds.map((id) => orderById.get(id)).filter((o): o is Order => Boolean(o))
    roundsPerBill.push(rounds.length)
    itemsPerBill.push(
      rounds.reduce((n, o) => n + o.items.filter((i) => i.status !== 'cancelled').reduce((q, i) => q + i.quantity, 0), 0),
    )
    const firstPlaced = rounds.map((o) => o.placedAt).sort()[0]
    const turn = minutesBetween(firstPlaced, bill.settledAt)
    if (turn !== null && turn >= 0) turnMinutes.push(turn)
  }

  const kitchenMinutes: number[] = []
  const waitMinutes: number[] = []
  const perItemMinutes = new Map<string, number[]>()
  for (const order of inRange) {
    const k = minutesBetween(order.placedAt, order.readyAt)
    if (k !== null && k >= 0) kitchenMinutes.push(k)
    const w = minutesBetween(order.readyAt, order.deliveredAt)
    if (w !== null && w >= 0) waitMinutes.push(w)
    for (const item of order.items) {
      const m = minutesBetween(item.queuedAt, item.readyAt)
      if (m !== null && m >= 0) perItemMinutes.set(item.name, [...(perItemMinutes.get(item.name) ?? []), m])
    }
  }

  const hourCounts = new Map<number, number>()
  inRange.forEach((o) => {
    const h = new Date(o.placedAt).getHours()
    hourCounts.set(h, (hourCounts.get(h) ?? 0) + 1)
  })
  const ordersByHour = Array.from({ length: 17 }, (_, i) => {
    const h = i + 7
    return { label: `${((h + 11) % 12) + 1}${h < 12 ? 'am' : 'pm'}`, count: hourCounts.get(h) ?? 0 }
  })
  const peakHour = [...ordersByHour].sort((a, b) => b.count - a.count)[0]

  const weekdayRevenue = [0, 0, 0, 0, 0, 0, 0]
  billsInRange.forEach((b) => {
    const day = new Date(b.settledAt).getDay()
    weekdayRevenue[day] = (weekdayRevenue[day] ?? 0) + b.total
  })
  const byWeekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label, i) => ({
    label,
    revenue: round2(weekdayRevenue[i] ?? 0),
  }))
  const bestWeekday = [...byWeekday].sort((a, b) => b.revenue - a.revenue)[0]

  const revenueByDay = Array.from({ length: 14 }, (_, i) => {
    const day = new Date(startOfToday.getTime() - (13 - i) * 86400000)
    const next = new Date(day.getTime() + 86400000)
    const revenue = bills
      .filter((b) => {
        const t = new Date(b.settledAt)
        return t >= day && t < next
      })
      .reduce((s, b) => s + b.total, 0)
    return {
      label: day.toLocaleDateString([], { day: 'numeric' }),
      full: day.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }),
      revenue: round2(revenue),
    }
  })

  /* ---- customers ---- */
  const namedBills = billsInRange.filter((b) => b.customerPhone).length
  const walkInBills = billCount - namedBills
  const namedTotal = round2(billsInRange.filter((b) => b.customerPhone).reduce((s, b) => s + b.total, 0))
  const walkInTotal = round2(sales - namedTotal)
  // "Returning" means this guest had settled a bill before this one.
  const seen = new Set<string>()
  let returningBills = 0
  let newGuests = 0
  for (const bill of [...bills].sort((a, b) => a.settledAt.localeCompare(b.settledAt))) {
    if (!bill.customerPhone) continue
    const known = seen.has(bill.customerPhone)
    seen.add(bill.customerPhone)
    if (new Date(bill.settledAt) < cutoff) continue
    if (known) returningBills += 1
    else newGuests += 1
  }

  const guestSpend = new Map<string, { name: string; spend: number; visits: number }>()
  billsInRange.forEach((b) => {
    if (!b.customerPhone) return
    const row = guestSpend.get(b.customerPhone) ?? { name: b.customerName ?? 'Guest', spend: 0, visits: 0 }
    row.spend = round2(row.spend + b.total)
    row.visits += 1
    guestSpend.set(b.customerPhone, row)
  })

  const owingGuests = accounts
    .filter((a) => walletOwed(a.balance) > 0)
    .map((a) => ({
      phone: a.customer.phone,
      name: a.customer.name,
      owed: walletOwed(a.balance),
      since: walletEntries
        .filter((e) => e.customerId === a.customer.id && e.kind === 'credit')
        .map((e) => e.at)
        .sort()[0],
    }))
    .sort((a, b) => (a.since ?? '').localeCompare(b.since ?? ''))

  const lapsedCutoff = new Date(startOfToday.getTime() - 30 * 86400000)
  const lapsedGuests = accounts
    .filter((a) => a.visits >= 2 && a.lastVisitAt && new Date(a.lastVisitAt) < lapsedCutoff)
    .map((a) => ({
      phone: a.customer.phone,
      name: a.customer.name,
      visits: a.visits,
      spent: a.totalSpent,
      lastVisitAt: a.lastVisitAt as string,
    }))
    .sort((a, b) => b.spent - a.spent)

  /* ---- menu ---- */
  const itemCounts = new Map<string, number>()
  const itemRevenue = new Map<string, number>()
  const categoryRevenue = new Map<string, number>()
  inRange.forEach((o) =>
    o.items
      .filter((i) => i.status !== 'cancelled')
      .forEach((i) => {
        itemCounts.set(i.name, (itemCounts.get(i.name) ?? 0) + i.quantity)
        itemRevenue.set(i.name, round2((itemRevenue.get(i.name) ?? 0) + i.unitPrice * i.quantity))
        categoryRevenue.set(i.categoryName, round2((categoryRevenue.get(i.categoryName) ?? 0) + i.unitPrice * i.quantity))
      }),
  )
  const deadItems = itemNames.filter((name) => !itemCounts.has(name))

  return {
    sales,
    discounts,
    fromWallet,
    leftUnpaid,
    duesCleared,
    intoWallet,
    cash,
    upi,
    collected: round2(cash + upi),
    payments,
    totalOwed,
    totalHeld,
    onTables,

    orderCount: inRange.length,
    billCount,
    avgBill: billCount ? round2(sales / billCount) : 0,
    avgItems: mean(itemsPerBill) ?? 0,
    avgRounds: mean(roundsPerBill) ?? 0,
    avgKitchenMin: mean(kitchenMinutes),
    avgWaitMin: mean(waitMinutes),
    avgTurnMin: mean(turnMinutes),
    ordersByHour,
    peakHour: peakHour && peakHour.count > 0 ? peakHour : null,
    byWeekday,
    bestWeekday: bestWeekday && bestWeekday.revenue > 0 ? bestWeekday : null,
    revenueByDay,
    slowestItems: [...perItemMinutes.entries()]
      .map(([name, mins]) => ({ name, minutes: mean(mins) as number }))
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 6),

    namedBills,
    walkInBills,
    returningBills,
    newGuests,
    avgNamedBill: namedBills ? round2(namedTotal / namedBills) : 0,
    avgWalkInBill: walkInBills ? round2(walkInTotal / walkInBills) : 0,
    topGuests: [...guestSpend.values()].sort((a, b) => b.spend - a.spend).slice(0, 6),
    owingGuests,
    lapsedGuests,

    menuSize: itemNames.length,
    topItems: [...itemCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
    topItemRevenue: [...itemRevenue.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
    byCategory: [...categoryRevenue.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
    deadItems,
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
      <div className="flex h-40 items-end gap-1.5 border-b border-surface-200">
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
          <div className="h-2 overflow-hidden rounded-full bg-surface-200">
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
