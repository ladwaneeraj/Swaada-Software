import { ChevronDown, Phone, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PageHeader } from '@/components/layout/AdminLayout'
import { Badge, Card, EmptyState, Input } from '@/components/ui'
import { PAYMENT_METHOD_META } from '@/lib/statusMeta'
import { cn, dateTimeLabel, formatINR } from '@/lib/utils'
import { customerProfiles } from '@/services'
import { useAppStore } from '@/store/useAppStore'

/**
 * CRM view derived entirely from settled bills — every guest who shared a
 * phone number, with visits, spend and live loyalty balance. No separate
 * customer table to maintain; a real DB computes the same with a GROUP BY.
 */
export function CustomersPage() {
  const bills = useAppStore((s) => s.db.bills)
  const loyalty = useAppStore((s) => s.db.settings.loyalty)
  const [query, setQuery] = useState('')
  const [expandedPhone, setExpandedPhone] = useState<string | null>(null)

  const profiles = useMemo(() => {
    const all = customerProfiles(bills)
    const q = query.trim().toLowerCase()
    if (!q) return all
    return all.filter((c) => c.name.toLowerCase().includes(q) || c.phone.includes(q))
  }, [bills, query])

  const totalCustomers = customerProfiles(bills).length

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Customers"
        sub={
          totalCustomers === 0
            ? 'Guests who share a phone number appear here automatically'
            : `${totalCustomers} known guest${totalCustomers > 1 ? 's' : ''}${loyalty.enabled ? ` · earning ${loyalty.pointsPer100} pts per ₹100` : ''}`
        }
      />

      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name or mobile…"
        aria-label="Search customers"
        className="mb-4"
      />

      {profiles.length === 0 ? (
        <EmptyState
          icon="🤝"
          title={totalCustomers === 0 ? 'No customers yet' : 'No customers match'}
          hint={
            totalCustomers === 0
              ? 'Take a first order with a name and mobile, settle the bill, and the guest shows up here with their visit history and points.'
              : 'Try a different name or number.'
          }
        />
      ) : (
        <div className="space-y-2">
          {profiles.map((c) => {
            const open = expandedPhone === c.phone
            const customerBills = bills
              .filter((b) => b.customerPhone === c.phone)
              .sort((a, b) => b.settledAt.localeCompare(a.settledAt))
            return (
              <Card key={c.phone} className="overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpandedPhone(open ? null : c.phone)}
                  aria-expanded={open}
                  className="flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-cream-50"
                >
                  <span className="grid size-11 shrink-0 place-items-center rounded-full bg-accent-50 text-base font-bold text-accent-600">
                    {c.name.trim().charAt(0).toUpperCase() || '?'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">{c.name}</p>
                    <p className="flex items-center gap-1 text-xs text-ink-500">
                      <Phone className="size-3" /> {c.phone} · last visit {dateTimeLabel(c.lastVisitAt)}
                    </p>
                  </div>
                  <div className="hidden shrink-0 text-right sm:block">
                    <p className="text-sm font-bold tabular-nums">{formatINR(c.totalSpent)}</p>
                    <p className="text-xs text-ink-500">
                      {c.visits} visit{c.visits > 1 ? 's' : ''}
                    </p>
                  </div>
                  {loyalty.enabled && (
                    <Badge tone="accent" className="shrink-0">
                      <Sparkles className="size-3" /> {c.pointsBalance} pts
                    </Badge>
                  )}
                  <ChevronDown className={cn('size-4 shrink-0 text-ink-300 transition-transform', open && 'rotate-180')} />
                </button>

                {open && (
                  <div className="border-t border-cream-100 px-5 py-3">
                    <ul className="divide-y divide-cream-100">
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
                              {b.pointsRedeemed > 0 && ` · redeemed ${b.pointsRedeemed} pts`}
                              {b.pointsEarned > 0 && ` · earned +${b.pointsEarned} pts`}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <Badge tone="ok">
                              {PAYMENT_METHOD_META[b.paymentMethod].icon} {PAYMENT_METHOD_META[b.paymentMethod].label}
                            </Badge>
                            <span className="w-20 text-right font-bold tabular-nums">{formatINR(b.total)}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
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
