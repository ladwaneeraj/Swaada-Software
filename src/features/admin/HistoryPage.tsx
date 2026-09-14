import { AlertTriangle, ChevronDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '@/components/layout/AdminLayout'
import { OrderItemLine } from '@/components/order/OrderBits'
import { Badge, Card, EmptyState, Input, Segmented, Select } from '@/components/ui'
import { billOutcome, paymentSummary } from '@/lib/statusMeta'
import { cn, dateTimeLabel, formatINR } from '@/lib/utils'
import { billBreakdown, billForOrder, isActiveOrder, walletBalance, walletOwed } from '@/services'
import { HISTORY_RANGES, useHistory, type HistoryRangeKey } from '@/lib/useHistory'
import type { Bill, Order } from '@/types'

type HistoryFilter = 'all' | 'paid' | 'owing' | 'cancelled'

const FILTERS: Array<{ value: HistoryFilter; label: string }> = [
  { value: 'all', label: 'All finished' },
  { value: 'paid', label: 'Paid in full' },
  { value: 'owing', label: 'On account' },
  { value: 'cancelled', label: 'Cancelled' },
]

/**
 * One line of a bill's arithmetic. Kept deliberately dumb: the numbers are
 * worked out once in `billBreakdown` so this screen can never invent one.
 */
function MoneyLine({
  label,
  amount,
  sign,
  note,
  strong = false,
  indent = false,
}: {
  label: string
  amount: number
  sign?: '+' | '−'
  note?: string
  strong?: boolean
  indent?: boolean
}) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-3 py-1 text-xs',
        strong && 'text-sm font-bold',
        indent && 'pl-3 text-ink-500',
      )}
    >
      <span className={cn(!strong && !indent && 'text-ink-500')}>
        {label}
        {note && <span className="ml-1 text-[11px] font-normal text-ink-300">{note}</span>}
      </span>
      <span className="shrink-0 tabular-nums">
        {sign}
        {formatINR(amount)}
      </span>
    </div>
  )
}

/**
 * How one bill was settled, laid out so the figures add up on screen.
 *
 * This is the fix for the reading that looked like a miscalculation: a row
 * shows one ROUND's value, while cash and UPI are taken against the whole
 * BILL — which may cover several rounds and may also collect old dues. Those
 * are different numbers for good reasons, so the screen now shows the steps
 * between them instead of printing the two side by side.
 */
function BillMoney({ bill, order, owesNow }: { bill: Bill; order: Order; owesNow: number }) {
  const m = billBreakdown(bill)
  const otherRounds = bill.orderNumbers.filter((n) => n !== order.orderNumber)

  return (
    <div className="mt-3 rounded-xl border border-surface-200 bg-surface-50 px-3 py-2">
      <p className="mb-1 text-xs font-bold">
        Bill #{bill.billNumber}
        <span className="ml-2 font-normal text-ink-500">
          {dateTimeLabel(bill.settledAt)} · {bill.settledByName}
        </span>
      </p>

      {otherRounds.length > 0 && (
        <p className="mb-1 text-[11px] text-ink-500">
          Covers this round with {otherRounds.map((n) => `#${n}`).join(', ')} — the money below is
          for the whole bill, not this round alone.
        </p>
      )}

      <div className="divide-y divide-surface-200">
        <MoneyLine label="Bill total" amount={m.total} strong />
        {m.fromWallet > 0 && <MoneyLine label="Paid from wallet" amount={m.fromWallet} sign="−" />}
        {m.leftUnpaid > 0 && (
          <MoneyLine label="Left on wallet to pay later" amount={m.leftUnpaid} sign="−" />
        )}
        {m.duesCleared > 0 && (
          <MoneyLine
            label="Old dues cleared"
            amount={m.duesCleared}
            sign="+"
            note="from an earlier visit"
          />
        )}
        {m.keptInWallet > 0 && (
          <MoneyLine label="Kept in wallet" amount={m.keptInWallet} sign="+" note="for next time" />
        )}
        <MoneyLine label="Taken at the counter" amount={m.collected} strong />
        {m.cash > 0 && <MoneyLine label="Cash" amount={m.cash} indent />}
        {m.upi > 0 && <MoneyLine label="UPI" amount={m.upi} indent />}
      </div>

      {/*
        * What a bill left unpaid and what the guest owes TODAY are different
        * questions — the debt may have been cleared on a later visit. The
        * badge answers the first; this line answers the second, at the level
        * the ledger can actually prove: the account, not the bill.
        */}
      {m.leftUnpaid > 0 && bill.customerId && (
        <p className="mt-2 text-[11px] font-semibold text-ink-500">
          {owesNow > 0.005
            ? `${bill.customerName ?? 'This guest'} owes ${formatINR(owesNow)} right now.`
            : `${bill.customerName ?? 'This guest'}'s account is clear now — this was settled later.`}
        </p>
      )}

      {!m.balances && (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-danger-100 px-2 py-1.5 text-[11px] font-semibold text-danger-600">
          <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
          These figures do not add up. The bill was written by an older version of the app — check
          it by hand before trusting it.
        </p>
      )}
    </div>
  )
}

/** Completed and cancelled rounds, and the bills that closed them. */
export function HistoryPage() {
  /**
   * History is QUERIED, not held. The store only carries rounds still on the
   * floor and today's money; anything older is fetched for the range the
   * manager actually asked for. See lib/useHistory.ts for why.
   */
  const [rangeKey, setRangeKey] = useState<HistoryRangeKey>('7d')
  const { orders, bills, walletEntries, loading, error, truncated } = useHistory(rangeKey)
  const [filter, setFilter] = useState<HistoryFilter>('all')
  // Seeded from ?q= so the bill search on the floor plan opens straight here.
  const [searchParams] = useSearchParams()
  const [query, setQuery] = useState(() => searchParams.get('q') ?? '')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return orders
      .filter((o) => !isActiveOrder(o))
      .map((o) => ({ order: o, bill: billForOrder(bills, o) }))
      .filter(({ order, bill }) => {
        if (filter === 'all') return true
        if (filter === 'cancelled') return order.status === 'cancelled'
        if (order.status !== 'settled') return false
        const owing = (bill?.creditAmount ?? 0) > 0.005
        return filter === 'owing' ? owing : !owing
      })
      .filter(({ order, bill }) => {
        if (!q) return true
        return (
          String(order.orderNumber).includes(q) ||
          (bill ? String(bill.billNumber).includes(q) : false) ||
          order.tableName.toLowerCase().includes(q) ||
          (order.customerName ?? '').toLowerCase().includes(q) ||
          (order.customerPhone ?? '').includes(q) ||
          order.items.some((i) => i.name.toLowerCase().includes(q))
        )
      })
      .sort((a, b) => b.order.placedAt.localeCompare(a.order.placedAt))
  }, [orders, bills, filter, query])

  /**
   * Header figures are about the ROUNDS listed, and say so. Cash taken is a
   * property of bills, not rounds, so it deliberately is not summed here —
   * that number lives on Analytics, where it is counted once per bill.
   */
  /**
   * What these bills PUT on a guest's account within the range on screen —
   * deliberately not "what they owe today". A balance is the sum of a
   * guest's WHOLE ledger, and this screen only loaded a slice of it. The
   * live figure lives on Customers, where the whole ledger is fetched.
   */
  const owedInRange = (customerId?: string) =>
    customerId ? walletOwed(walletBalance(walletEntries, customerId)) : 0

  const closed = rows.filter((r) => r.order.status === 'settled')
  const roundValue = closed.reduce((s, r) => s + r.order.total, 0)
  // Counted per bill, so a bill covering three rounds is not counted thrice.
  const owedBills = new Map<string, number>()
  closed.forEach(({ bill }) => {
    if (bill && bill.creditAmount > 0.005) owedBills.set(bill.id, bill.creditAmount)
  })
  // What these bills PUT on accounts. Not what is outstanding today — some of
  // it has since been paid, and saying otherwise is the same mistake this
  // screen was making with cash and UPI. Customers holds the live figure.
  const putOnAccounts = [...owedBills.values()].reduce((s, n) => s + n, 0)

  return (
    <div>
      <PageHeader
        title="Order history"
        sub={
          `${rows.length} round${rows.length === 1 ? '' : 's'} · ${formatINR(roundValue)} across closed rounds` +
          (putOnAccounts > 0 ? ` · ${formatINR(putOnAccounts)} went on guest accounts` : '')
        }
      />

      {/* The range is the first control, not the last, because it decides
          what is fetched. Search and filter only narrow what came back. */}
      <div className="mb-3">
        <Segmented
          value={rangeKey}
          onChange={setRangeKey}
          options={HISTORY_RANGES.map((r) => ({ value: r.key, label: r.label }))}
          size="sm"
        />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by order #, bill #, table, guest or item…"
          aria-label="Search history"
          className="min-w-52 flex-1"
        />
        <div className="w-40 shrink-0">
          <Select
            value={filter}
            onChange={(e) => setFilter(e.target.value as HistoryFilter)}
            aria-label="Filter history"
          >
            {FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {error && (
        <p className="mb-3 rounded-card bg-danger-100 px-3.5 py-2.5 text-sm font-semibold text-danger-600">
          {error}
        </p>
      )}
      {truncated && (
        <p className="mb-3 rounded-card bg-warn-100 px-3.5 py-2.5 text-[13px] font-semibold text-warn-600">
          This period has more rounds than one screen can hold. Narrow the range to see the rest.
        </p>
      )}

      {loading ? (
        <EmptyState icon="⏳" title="Loading this period" hint="Fetching rounds and bills…" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="🗂"
          title="No orders here yet"
          hint="Served and cancelled orders will show up in this list."
        />
      ) : (
        <div className="space-y-2">
          {rows.map(({ order, bill }) => {
            const open = expandedId === order.id
            const outcome = bill
              ? billOutcome(bill)
              : order.status === 'cancelled'
                ? { label: 'Cancelled' as const, tone: 'danger' as const }
                : { label: 'Closed' as const, tone: 'neutral' as const }
            // The split is only shown on the row when this bill covers this
            // round and nothing else. Otherwise it reads as the round's
            // payment when it is the whole bill's, which is what made the
            // old screen look like it was calculating wrongly.
            const splitOnRow =
              bill && bill.orderIds.length === 1 && (bill.payments.cash > 0 || bill.payments.upi > 0)

            return (
              <Card key={order.id} className="overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpandedId(open ? null : order.id)}
                  aria-expanded={open}
                  className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left hover:bg-surface-50"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-bold">
                      #{order.orderNumber} · Table {order.tableName}
                      <span className="ml-2 font-normal text-ink-500">
                        {dateTimeLabel(order.placedAt)}
                      </span>
                      {order.customerName && (
                        <span className="ml-2 font-normal text-ink-500">{order.customerName}</span>
                      )}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-ink-500">
                      {order.items
                        .filter((i) => i.status !== 'cancelled')
                        .map((i) => `${i.quantity}× ${i.name}`)
                        .join(', ')}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {splitOnRow && (
                      <span className="hidden text-xs font-semibold tabular-nums text-ink-500 sm:inline">
                        {paymentSummary(bill.payments, 'short')}
                      </span>
                    )}
                    <Badge tone={outcome.tone} dot>
                      {outcome.label}
                    </Badge>
                    <span className="w-20 text-right text-sm font-bold tabular-nums">
                      {formatINR(order.total)}
                    </span>
                    <ChevronDown
                      className={cn('size-4 text-ink-300 transition-transform', open && 'rotate-180')}
                    />
                  </div>
                </button>

                {open && (
                  <div className="border-t border-surface-100 px-5 py-4">
                    <div className="divide-y divide-surface-100">
                      {order.items.map((item) => (
                        <OrderItemLine
                          key={item.id}
                          item={item}
                          muted={item.status === 'cancelled'}
                        />
                      ))}
                    </div>

                    <div className="mt-3 max-w-sm">
                      <div className="flex items-baseline justify-between gap-3 border-t border-surface-200 pt-2 text-sm font-bold">
                        <span>Round total</span>
                        <span className="tabular-nums">{formatINR(order.total)}</span>
                      </div>
                      {bill ? (
                        <BillMoney bill={bill} order={order} owesNow={owedInRange(bill.customerId)} />
                      ) : (
                        order.status === 'settled' && (
                          <p className="mt-2 text-xs text-ink-500">
                            This round was closed without a bill on record.
                          </p>
                        )
                      )}
                    </div>

                    <p className="mt-3 text-xs text-ink-500">
                      Placed {dateTimeLabel(order.placedAt)} by {order.createdByName}
                      {order.customerName && ` · guest ${order.customerName}`}
                      {order.customerPhone && ` (${order.customerPhone})`}
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
