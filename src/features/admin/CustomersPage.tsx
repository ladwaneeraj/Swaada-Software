import { ChevronDown, Phone, UserPlus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageHeader } from '@/components/layout/AdminLayout'
import {
  AccountActions,
  BalancePill,
  CustomerSheet,
  MoneySheet,
  WalletHistory,
  type MoneyMode,
} from '@/components/customer/CustomerBits'
import { useToasts } from '@/components/toast'
import { Badge, Button, Card, EmptyState, Input, Segmented, Stat } from '@/components/ui'
import { billOutcome, paymentSummary } from '@/lib/statusMeta'
import { customerProfiles, queries, walletBalance, walletHeld, walletOwed } from '@/services'
import { cn, dateTimeLabel, formatINR } from '@/lib/utils'
import { toAppError } from '@/lib/errors'
import type { CustomerAccount } from '@/services'
import type { Bill, Customer, WalletEntry } from '@/types'

type Filter = 'all' | 'owing' | 'credit'

/**
 * The guest list, fetched for whatever is being asked.
 *
 * Three different queries, because they answer three different questions and
 * each one is cheap on its own: a typed number is a prefix lookup, Owing and
 * In credit range over the cached balance, and the default is simply who was
 * seen most recently. None of them reads the whole guest book.
 */
function useCustomerList(
  filter: Filter,
  search: string,
): { customers: Customer[]; loading: boolean; error: string; reload: () => void } {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [nonce, setNonce] = useState(0)

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')

    // Typing fires a render per keystroke; one query per pause is plenty.
    const timer = window.setTimeout(() => {
      const term = search.trim()
      const run =
        term.length > 0
          ? queries.searchCustomers(term)
          : filter === 'all'
            ? queries.recentCustomers()
            : queries.customersWithBalance(filter)

      void run
        .then((rows) => {
          if (cancelled) return
          // A search is not filtered server-side by balance, so narrow it here.
          setCustomers(
            term.length > 0 && filter !== 'all'
              ? rows.filter((c) =>
                  filter === 'owing' ? (c.balance ?? 0) < 0 : (c.balance ?? 0) > 0,
                )
              : rows,
          )
        })
        .catch((caught: unknown) => {
          if (cancelled) return
          setError(toAppError(caught, 'Could not load guests.').userMessage)
          setCustomers([])
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [filter, search, nonce])

  return { customers, loading, error, reload }
}

/**
 * The guest book. Identity and account balances are stored; visits, spend and
 * points stay derived from bills, so nothing here can disagree with the till.
 */
export function CustomersPage() {
  const pushToast = useToasts((s) => s.push)

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [money, setMoney] = useState<{ account: CustomerAccount; mode: MoneyMode } | null>(null)

  /**
   * The guest book is queried, never held. Which query depends on what is
   * being asked: a search term runs a prefix lookup, the Owing and In credit
   * filters use the cached balance on each guest, and the default view is
   * simply the guests seen most recently.
   *
   * Visits and spend are NOT in this list. They come from a guest's bills,
   * and fetching bills for fifty guests to draw one column would cost more
   * than the whole rest of the screen. They load when a guest is opened.
   */
  const { customers, loading, error, reload } = useCustomerList(filter, query)

  const totals = useMemo(
    () => ({
      owed: customers.reduce((sum, c) => sum + walletOwed(c.balance ?? 0), 0),
      held: customers.reduce((sum, c) => sum + walletHeld(c.balance ?? 0), 0),
    }),
    [customers],
  )

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Customers"
        sub="Everyone who has given a mobile number, with what they have spent and what is in their wallet"
        actions={
          <Button onClick={() => setAdding(true)}>
            <UserPlus className="size-4" /> Add guest
          </Button>
        }
      />

      {/* These totals cover the guests listed below, not every guest who
          ever visited. Switch to Owing to see everyone who owes. */}
      <div className="mb-5 grid grid-cols-3 gap-3">
        <Stat label="Guests listed" value={loading ? '…' : String(customers.length)} />
        <Stat
          label="Owed, of those listed"
          value={formatINR(totals.owed)}
          tone={totals.owed > 0 ? 'danger' : 'neutral'}
        />
        <Stat
          label="In wallets, of those listed"
          value={formatINR(totals.held)}
          tone={totals.held > 0 ? 'ok' : 'neutral'}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="min-w-56 flex-1">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or mobile…"
            aria-label="Search customers"
          />
        </div>
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'owing', label: 'Owing' },
            { value: 'credit', label: 'In credit' },
          ]}
        />
      </div>

      {error && (
        <p className="mb-3 rounded-card bg-danger-100 px-3.5 py-2.5 text-sm font-semibold text-danger-600">
          {error}
        </p>
      )}

      {loading ? (
        <EmptyState icon="⏳" title="Loading guests" hint="Fetching the guest book…" />
      ) : customers.length === 0 ? (
        <EmptyState
          icon="🤝"
          title={query || filter !== 'all' ? 'Nobody matches' : 'No guests yet'}
          hint={
            query || filter !== 'all'
              ? 'Try a different name, number or filter.'
              : 'Tap a table, type a mobile number, and the guest is on file from that first order.'
          }
        />
      ) : (
        <div className="space-y-2">
          {customers.map((customer) => {
            const open = expandedId === customer.id
            const cachedBalance = customer.balance ?? 0
            return (
              <Card key={customer.id} className="overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpandedId(open ? null : customer.id)}
                  aria-expanded={open}
                  className="flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-surface-50"
                >
                  <span className="grid size-11 shrink-0 place-items-center rounded-full bg-accent-50 text-base font-bold text-accent-600">
                    {customer.name.trim().charAt(0).toUpperCase() || '?'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">{customer.name}</p>
                    <p className="flex items-center gap-1 text-xs text-ink-500">
                      <Phone className="size-3" /> {customer.phone}
                      {customer.updatedAt ? ` · last seen ${dateTimeLabel(customer.updatedAt)}` : ''}
                    </p>
                  </div>
                  <BalancePill balance={cachedBalance} className="shrink-0" />
                  <ChevronDown className={cn('size-4 shrink-0 text-ink-300 transition-transform', open && 'rotate-180')} />
                </button>

                {open && (
                  <GuestDetail
                    customer={customer}
                    onMoney={(account, mode) => setMoney({ account, mode })}
                  />
                )}
              </Card>
            )
          })}
        </div>
      )}

      <CustomerSheet
        open={adding}
        onClose={() => setAdding(false)}
        title="Add a guest"
        actionLabel="Save guest"
        skipLabel="Cancel"
        onPick={(customer) => {
          setAdding(false)
          if (!customer) return
          setExpandedId(customer.id)
          reload()
          pushToast(`${customer.name} is on file`, 'ok')
        }}
      />

      <MoneySheet
        account={money?.account ?? null}
        mode={money?.mode ?? 'take'}
        onClose={() => {
          setMoney(null)
          reload()
        }}
      />
    </div>
  )
}

/**
 * One guest, opened. This is where the reads that are too expensive to do
 * for a whole list happen: the guest's full ledger (a balance is the sum of
 * all of it, so there is no useful partial answer) and their bills.
 */
function GuestDetail({
  customer,
  onMoney,
}: {
  customer: Customer
  onMoney: (account: CustomerAccount, mode: MoneyMode) => void
}) {
  const [state, setState] = useState<{
    entries: WalletEntry[]
    bills: Bill[]
    loading: boolean
    error: string
  }>({ entries: [], bills: [], loading: true, error: '' })

  useEffect(() => {
    let cancelled = false
    void Promise.all([queries.ledgerFor(customer.id), queries.billsForCustomer(customer.id)])
      .then(([entries, bills]) => {
        if (!cancelled) setState({ entries, bills, loading: false, error: '' })
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setState({
            entries: [],
            bills: [],
            loading: false,
            error: toAppError(caught, 'Could not load this guest.').userMessage,
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [customer.id])

  const account: CustomerAccount = useMemo(() => {
    const profile = customerProfiles(state.bills)[0]
    return {
      customer,
      visits: profile?.visits ?? 0,
      totalSpent: profile?.totalSpent ?? 0,
      lastVisitAt: profile?.lastVisitAt,
      // Recomputed from the ledger, not read from the cached field. If the
      // two ever disagree, this is the one that is right.
      balance: walletBalance(state.entries, customer.id),
    }
  }, [customer, state.bills, state.entries])

  if (state.loading) {
    return (
      <div className="border-t border-surface-100 px-5 py-6 text-center text-xs text-ink-500">
        Loading this guest&rsquo;s account…
      </div>
    )
  }

  if (state.error) {
    return (
      <div className="border-t border-surface-100 px-5 py-4 text-sm font-semibold text-danger-600">
        {state.error}
      </div>
    )
  }

  const customerBills = state.bills

  return (
                  <div className="space-y-4 border-t border-surface-100 px-5 py-4">
                    <div className="flex flex-wrap items-center gap-3 text-xs text-ink-500">
                      <span>
                        <b className="text-ink-900">{account.visits}</b> visit
                        {account.visits === 1 ? '' : 's'}
                      </span>
                      <span>
                        <b className="text-ink-900">{formatINR(account.totalSpent)}</b> spent
                      </span>
                      {account.lastVisitAt && <span>last visit {dateTimeLabel(account.lastVisitAt)}</span>}
                    </div>

                    <AccountActions
                      held={walletHeld(account.balance)}
                      onTake={() => onMoney(account, 'take')}
                      onReturn={() => onMoney(account, 'return')}
                      onAdjust={() => onMoney(account, 'adjust')}
                    />

                    <section>
                      <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wider text-ink-500">Wallet</h3>
                      <WalletHistory customer={customer} entries={state.entries} />
                    </section>

                    <section>
                      <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wider text-ink-500">Bills</h3>
                      {customerBills.length === 0 ? (
                        <p className="py-3 text-center text-xs text-ink-500">No bills yet.</p>
                      ) : (
                        <ul className="divide-y divide-surface-100">
                          {customerBills.map((b) => (
                            <li key={b.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                              <div className="min-w-0">
                                <p className="font-semibold">
                                  Bill #{b.billNumber} · Table {b.tableName}
                                  <span className="ml-2 font-normal text-ink-500">{dateTimeLabel(b.settledAt)}</span>
                                </p>
                                <p className="text-xs text-ink-500">
                                  {b.orderNumbers.length} round{b.orderNumbers.length > 1 ? 's' : ''}
                                  {b.discountAmount > 0 && ` · discount ${formatINR(b.discountAmount)}`}
                                  {b.walletApplied > 0 && ` · ${formatINR(b.walletApplied)} from wallet`}
                                  {b.creditAmount > 0 && ` · ${formatINR(b.creditAmount)} left on wallet`}
                                  {b.duesCleared > 0 && ` · ${formatINR(b.duesCleared)} old dues cleared`}
                                  {b.walletTopUp > 0 && ` · ${formatINR(b.walletTopUp)} into wallet`}
                                </p>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <Badge tone={billOutcome(b).tone}>{billOutcome(b).label}</Badge>
                                {b.payments.cash + b.payments.upi > 0 && (
                                  <span className="hidden text-xs font-semibold tabular-nums text-ink-500 sm:inline">
                                    {paymentSummary(b.payments, 'short')}
                                  </span>
                                )}
                                <span className="w-20 text-right font-bold tabular-nums">{formatINR(b.total)}</span>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  </div>
  )
}
