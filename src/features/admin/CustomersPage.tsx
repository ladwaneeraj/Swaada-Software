import { ChevronDown, Phone, Sparkles, UserPlus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PageHeader } from '@/components/layout/AdminLayout'
import {
  AccountActions,
  BalancePill,
  CustomerSheet,
  MoneySheet,
  WalletHistory,
  useAccounts,
  type MoneyMode,
} from '@/components/customer/CustomerBits'
import { useToasts } from '@/components/toast'
import { Badge, Button, Card, EmptyState, Input, Segmented, Stat } from '@/components/ui'
import { paymentSummary } from '@/lib/statusMeta'
import { advanceHeld, amountOwed, billsForCustomer } from '@/services'
import { cn, dateTimeLabel, formatINR } from '@/lib/utils'
import { useAppStore } from '@/store/useAppStore'
import type { CustomerAccount } from '@/services'

type Filter = 'all' | 'owing' | 'credit'

/**
 * The guest book. Identity and account balances are stored; visits, spend and
 * points stay derived from bills, so nothing here can disagree with the till.
 */
export function CustomersPage() {
  const bills = useAppStore((s) => s.db.bills)
  const loyalty = useAppStore((s) => s.db.settings.loyalty)
  const pushToast = useToasts((s) => s.push)
  const accounts = useAccounts()

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [money, setMoney] = useState<{ account: CustomerAccount; mode: MoneyMode } | null>(null)

  const totals = useMemo(
    () => ({
      owed: accounts.reduce((sum, a) => sum + amountOwed(a.balance), 0),
      held: accounts.reduce((sum, a) => sum + advanceHeld(a.balance), 0),
    }),
    [accounts],
  )

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return accounts
      .filter((a) => (filter === 'owing' ? a.balance < 0 : filter === 'credit' ? a.balance > 0 : true))
      .filter((a) => !q || a.customer.name.toLowerCase().includes(q) || a.customer.phone.includes(q))
  }, [accounts, filter, query])

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Customers"
        sub="Everyone who has given a mobile number, with what they have spent and where their account stands"
        actions={
          <Button onClick={() => setAdding(true)}>
            <UserPlus className="size-4" /> Add guest
          </Button>
        }
      />

      <div className="mb-5 grid grid-cols-3 gap-3">
        <Stat label="Guests" value={String(accounts.length)} />
        <Stat label="Owed to the café" value={formatINR(totals.owed)} tone={totals.owed > 0 ? 'danger' : 'neutral'} />
        <Stat label="Advances held" value={formatINR(totals.held)} tone={totals.held > 0 ? 'ok' : 'neutral'} />
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

      {shown.length === 0 ? (
        <EmptyState
          icon="🤝"
          title={accounts.length === 0 ? 'No guests yet' : 'Nobody matches'}
          hint={
            accounts.length === 0
              ? 'Tap a table, type a mobile number, and the guest is on file from that first order.'
              : 'Try a different name, number or filter.'
          }
        />
      ) : (
        <div className="space-y-2">
          {shown.map((account) => {
            const { customer } = account
            const open = expandedId === customer.id
            const customerBills = billsForCustomer(bills, customer)
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
                      {account.lastVisitAt ? ` · last visit ${dateTimeLabel(account.lastVisitAt)}` : ' · no visits yet'}
                    </p>
                  </div>
                  <div className="hidden shrink-0 text-right sm:block">
                    <p className="text-sm font-bold tabular-nums">{formatINR(account.totalSpent)}</p>
                    <p className="text-xs text-ink-500">
                      {account.visits} visit{account.visits === 1 ? '' : 's'}
                    </p>
                  </div>
                  <BalancePill balance={account.balance} className="shrink-0" />
                  {loyalty.enabled && account.pointsBalance > 0 && (
                    <Badge tone="accent" className="hidden shrink-0 md:inline-flex">
                      <Sparkles className="size-3" /> {account.pointsBalance} pts
                    </Badge>
                  )}
                  <ChevronDown className={cn('size-4 shrink-0 text-ink-300 transition-transform', open && 'rotate-180')} />
                </button>

                {open && (
                  <div className="space-y-4 border-t border-surface-100 px-5 py-4">
                    <AccountActions
                      held={advanceHeld(account.balance)}
                      onTake={() => setMoney({ account, mode: 'take' })}
                      onReturn={() => setMoney({ account, mode: 'return' })}
                      onAdjust={() => setMoney({ account, mode: 'adjust' })}
                    />

                    <section>
                      <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wider text-ink-500">Account</h3>
                      <WalletHistory customer={customer} />
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
                                  {b.walletApplied > 0 && ` · ${formatINR(b.walletApplied)} from advance`}
                                  {b.creditAmount > 0 && ` · ${formatINR(b.creditAmount)} on account`}
                                  {b.walletTopUp > 0 && ` · ${formatINR(b.walletTopUp)} kept as advance`}
                                  {b.pointsRedeemed > 0 && ` · redeemed ${b.pointsRedeemed} pts`}
                                  {b.pointsEarned > 0 && ` · earned +${b.pointsEarned} pts`}
                                </p>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <Badge tone={b.creditAmount > 0 ? 'warn' : 'ok'}>
                                  {b.payments.cash + b.payments.upi > 0
                                    ? paymentSummary(b.payments, 'short')
                                    : 'No cash'}
                                </Badge>
                                <span className="w-20 text-right font-bold tabular-nums">{formatINR(b.total)}</span>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  </div>
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
          pushToast(`${customer.name} is on file`, 'ok')
        }}
      />

      <MoneySheet
        account={money?.account ?? null}
        mode={money?.mode ?? 'take'}
        onClose={() => setMoney(null)}
      />
    </div>
  )
}
