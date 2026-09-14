import { AlertTriangle, ChevronDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '@/components/layout/AdminLayout'
import { OrderItemLine } from '@/components/order/OrderBits'
import { Badge, Card, EmptyState, Input, Segmented, Select } from '@/components/ui'
import { billOutcome, paymentSummary } from '@/lib/statusMeta'
import { cn, dateTimeLabel, formatINR } from '@/lib/utils'
import { billBreakdown, isActiveOrder, walletBalance, walletOwed } from '@/services'
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
/**
 * The money on a bill, shown ONCE under the bill it belongs to.
 *
 * This used to be rendered under every round the bill covered, with a note
 * explaining that the figures were for the whole bill rather than that
 * round. The note was correct and nobody read it: a two-round sitting looked
 * like two bills for the same money. Grouping the screen by bill removed the
 * need for the note and the confusion with it.
 */
function BillMoney({ bill, owesNow }: { bill: Bill; owesNow: number }) {
  const m = billBreakdown(bill)

  return (
    <div className="mt-3 rounded-xl border border-surface-200 bg-surface-50 px-3 py-2">
      <p className="mb-1 text-xs font-bold">
        Bill #{bill.billNumber}
        <span className="ml-2 font-normal text-ink-500">
          {dateTimeLabel(bill.settledAt)} · {bill.settledByName}
        </span>
      </p>

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

  /**
   * One entry per BILL, with the rounds it covered inside it.
   *
   * The screen used to be one entry per round, repeating the bill under each
   * one. A table that ordered twice therefore showed the same ₹264 bill
   * twice, and read as two bills for one sitting — which is exactly what a
   * café manager would panic about. A bill is what the guest paid, so a bill
   * is what a row is.
   *
   * Rounds with no bill (cancelled, or closed without one) stand on their
   * own, because there is nothing to group them under.
   */
  const entries = useMemo(() => {
    const q = query.trim().toLowerCase()
    const billById = new Map(bills.map((b) => [b.id, b]))

    // Group by billId; a round without one gets a key of its own.
    const groups = new Map<string, Order[]>()
    for (const order of orders) {
      if (isActiveOrder(order)) continue
      const key = order.billId ?? `round:${order.id}`
      groups.set(key, [...(groups.get(key) ?? []), order])
    }

    return [...groups.entries()]
      .map(([key, grouped]) => {
        const rounds = [...grouped].sort((a, b) => a.placedAt.localeCompare(b.placedAt))
        const bill = key.startsWith('round:') ? undefined : billById.get(key)
        const first = rounds[0]
        return {
          key,
          bill,
          rounds,
          // A bill's own total, which is NOT the sum of its rounds once a
          // discount is involved. Falling back to the round keeps a
          // bill-less entry honest rather than showing zero.
          total: bill ? bill.total : rounds.reduce((sum, o) => sum + o.total, 0),
          at: bill?.settledAt ?? rounds[rounds.length - 1]?.placedAt ?? '',
          tableName: bill?.tableName ?? first?.tableName ?? '',
          customerName: bill?.customerName ?? first?.customerName,
        }
      })
      .filter((entry) => {
        if (filter === 'all') return true
        if (filter === 'cancelled') return entry.rounds.every((o) => o.status === 'cancelled')
        if (!entry.bill) return false
        const owing = entry.bill.creditAmount > 0.005
        return filter === 'owing' ? owing : !owing
      })
      .filter((entry) => {
        if (!q) return true
        return (
          (entry.bill ? String(entry.bill.billNumber).includes(q) : false) ||
          entry.tableName.toLowerCase().includes(q) ||
          (entry.customerName ?? '').toLowerCase().includes(q) ||
          entry.rounds.some(
            (o) =>
              String(o.orderNumber).includes(q) ||
              (o.customerPhone ?? '').includes(q) ||
              o.items.some((i) => i.name.toLowerCase().includes(q)),
          )
        )
      })
      .sort((a, b) => b.at.localeCompare(a.at))
  }, [orders, bills, filter, query])

  /**
   * What these bills PUT on a guest's account within the range on screen —
   * deliberately not "what they owe today". A balance is the sum of a
   * guest's WHOLE ledger, and this screen only loaded a slice of it. The
   * live figure lives on Customers, where the whole ledger is fetched.
   */
  const owedInRange = (customerId?: string) =>
    customerId ? walletOwed(walletBalance(walletEntries, customerId)) : 0

  // Counted per bill, which is now also how the list is grouped, so the
  // header and the rows can no longer disagree about what a sitting is.
  const settled = entries.filter((e) => e.bill)
  const billed = settled.reduce((sum, e) => sum + (e.bill?.total ?? 0), 0)
  // What these bills PUT on accounts. Not what is outstanding today — some of
  // it has since been paid, and saying otherwise is the same mistake this
  // screen was making with cash and UPI. Customers holds the live figure.
  const putOnAccounts = settled.reduce((sum, e) => sum + (e.bill?.creditAmount ?? 0), 0)

  return (
    <div>
      <PageHeader
        title="Order history"
        sub={
          `${settled.length} bill${settled.length === 1 ? '' : 's'} · ${formatINR(billed)} billed` +
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
      ) : entries.length === 0 ? (
        <EmptyState
          icon="🗂"
          title="No orders here yet"
          hint="Served and cancelled orders will show up in this list."
        />
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => {
            const { bill, rounds } = entry
            const open = expandedId === entry.key
            const first = rounds[0]
            const outcome = bill
              ? billOutcome(bill)
              : rounds.every((o) => o.status === 'cancelled')
                ? { label: 'Cancelled' as const, tone: 'danger' as const }
                : { label: 'Closed' as const, tone: 'neutral' as const }
            const itemSummary = rounds
              .flatMap((o) => o.items.filter((i) => i.status !== 'cancelled'))
              .map((i) => `${i.quantity}× ${i.name}`)
              .join(', ')

            return (
              <Card key={entry.key} className="overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpandedId(open ? null : entry.key)}
                  aria-expanded={open}
                  className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left hover:bg-surface-50"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-bold">
                      {bill ? `Bill #${bill.billNumber}` : `Round #${first?.orderNumber ?? '—'}`} ·
                      Table {entry.tableName}
                      <span className="ml-2 font-normal text-ink-500">
                        {dateTimeLabel(entry.at)}
                      </span>
                      {entry.customerName && (
                        <span className="ml-2 font-normal text-ink-500">{entry.customerName}</span>
                      )}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-ink-500">
                      {rounds.length > 1 && (
                        <span className="font-semibold">{rounds.length} rounds · </span>
                      )}
                      {itemSummary}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {/* Safe on the row now that a row IS a bill: this split
                        belongs to exactly the total printed beside it. */}
                    {bill && (bill.payments.cash > 0 || bill.payments.upi > 0) && (
                      <span className="hidden text-xs font-semibold tabular-nums text-ink-500 sm:inline">
                        {paymentSummary(bill.payments, 'short')}
                      </span>
                    )}
                    <Badge tone={outcome.tone} dot>
                      {outcome.label}
                    </Badge>
                    <span className="w-20 text-right text-sm font-bold tabular-nums">
                      {formatINR(entry.total)}
                    </span>
                    <ChevronDown
                      className={cn('size-4 text-ink-300 transition-transform', open && 'rotate-180')}
                    />
                  </div>
                </button>

                {open && (
                  <div className="border-t border-surface-100 px-5 py-4">
                    {/* One section per round. A bill can cover several of them:
                        the rounds are what the guest ordered, the bill is how
                        it was paid for. Both belong on screen, nested this way
                        round, not repeated side by side. */}
                    <div className="space-y-4">
                      {rounds.map((order) => (
                        <div key={order.id}>
                          <div className="mb-1 flex items-baseline justify-between gap-3">
                            <p className="text-xs font-bold">
                              Round #{order.orderNumber}
                              <span className="ml-2 font-normal text-ink-500">
                                {dateTimeLabel(order.placedAt)} · {order.createdByName}
                              </span>
                            </p>
                            <span className="shrink-0 text-xs font-bold tabular-nums">
                              {formatINR(order.total)}
                            </span>
                          </div>
                          <div className="divide-y divide-surface-100">
                            {order.items.map((item) => (
                              <OrderItemLine
                                key={item.id}
                                item={item}
                                muted={item.status === 'cancelled'}
                              />
                            ))}
                          </div>
                          {order.cancelledAt && (
                            <p className="mt-1.5 text-xs text-ink-500">
                              Cancelled {dateTimeLabel(order.cancelledAt)}
                              {order.cancelReason && ` · ${order.cancelReason}`}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="mt-3 max-w-sm">
                      {rounds.length > 1 && (
                        <div className="flex items-baseline justify-between gap-3 border-t border-surface-200 pt-2 text-sm font-bold">
                          <span>
                            {rounds.length} rounds together
                          </span>
                          <span className="tabular-nums">
                            {formatINR(rounds.reduce((sum, o) => sum + o.total, 0))}
                          </span>
                        </div>
                      )}
                      {bill ? (
                        <BillMoney bill={bill} owesNow={owedInRange(bill.customerId)} />
                      ) : (
                        rounds.some((o) => o.status === 'settled') && (
                          <p className="mt-2 text-xs text-ink-500">
                            This round was closed without a bill on record.
                          </p>
                        )
                      )}
                    </div>

                    {(entry.customerName ?? first?.customerPhone) && (
                      <p className="mt-3 text-xs text-ink-500">
                        Guest {entry.customerName ?? 'not recorded'}
                        {first?.customerPhone && ` (${first.customerPhone})`}
                      </p>
                    )}
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
