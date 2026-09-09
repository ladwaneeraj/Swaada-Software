import { Minus, Pencil, PencilLine, Plus, ReceiptIndianRupee, Search, Sparkles, UserPlus, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '@/components/layout/AdminLayout'
import { AccountSummary, CustomerSheet, useAccount } from '@/components/customer/CustomerBits'
import { useToasts } from '@/components/toast'
import { Badge, Button, Field, Input, Modal, Textarea, Toggle, VegMark } from '@/components/ui'
import { FLOOR_STATE_META, ORDER_STATUS_META, PAYMENT_METHOD_META, paymentSummary } from '@/lib/statusMeta'
import { byDisplayOrder, cn, elapsedLabel, formatINR, parseAmount, round2 } from '@/lib/utils'
import { useNow } from '@/lib/useNow'
import {
  activeOrdersForTable,
  advanceHeld,
  billService,
  computeBillPreview,
  customerByPhone,
  floorState,
  orderService,
  planSettlement,
  splitPayment,
  tableService,
  walletBalance,
} from '@/services'
import { useAppStore } from '@/store/useAppStore'
import type { CafeTable, Customer, Order, PaymentMethod } from '@/types'
import { FLOOR_STATES, PAYMENT_METHODS } from '@/types'

/**
 * Floor plan. Tables are grouped by zone and colour-coded by what they need:
 * a table orders in several rounds and stays running until the whole bill is
 * settled. Tapping a free table starts round 1; tapping a running one opens
 * its bill.
 */
export function TablesPage() {
  const tables = useAppStore((s) => s.db.tables)
  const orders = useAppStore((s) => s.db.orders)
  const askCustomer = useAppStore((s) => s.db.settings.askCustomerInfo)
  const navigate = useNavigate()

  const [editing, setEditing] = useState<CafeTable | 'new' | null>(null)
  const [billTableId, setBillTableId] = useState<string | null>(null)
  const [newOrderOpen, setNewOrderOpen] = useState(false)
  const [billQuery, setBillQuery] = useState('')
  /** The table waiting on the guest lookup before its first round starts. */
  const [askingFor, setAskingFor] = useState<CafeTable | null>(null)

  const zones = useMemo(() => {
    const active = tables.filter((t) => t.isActive).sort(byDisplayOrder)
    const map = new Map<string, CafeTable[]>()
    active.forEach((t) => {
      map.set(t.zone, [...(map.get(t.zone) ?? []), t])
    })
    return [...map.entries()]
  }, [tables])

  const activeTables = tables.filter((t) => t.isActive)
  const freeTables = activeTables.filter((t) => activeOrdersForTable(orders, t.id).length === 0)

  /**
   * Starting a sitting asks who is at the table first; adding a round to a
   * table that is already running does not, because the guest is already
   * attached to it.
   */
  const startSitting = (table: CafeTable) => {
    if (askCustomer) setAskingFor(table)
    else navigate(`/admin/take-order/${table.id}`)
  }

  const openTable = (table: CafeTable) => {
    if (activeOrdersForTable(orders, table.id).length > 0) setBillTableId(table.id)
    else startSitting(table)
  }

  return (
    <div>
      <PageHeader
        title="Table view"
        sub={`${activeTables.length - freeTables.length} running · ${freeTables.length} free`}
        actions={
          <>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const q = billQuery.trim()
                if (q) navigate(`/admin/history?q=${encodeURIComponent(q)}`)
              }}
              className="relative"
            >
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-300" />
              <input
                value={billQuery}
                onChange={(e) => setBillQuery(e.target.value)}
                placeholder="Bill no."
                aria-label="Find a bill by number"
                className="h-10 w-36 rounded-control border border-surface-200 bg-white pl-8 pr-3 text-[13px] transition-shadow placeholder:text-ink-300 focus:border-accent-500 focus:outline-none focus:ring-4 focus:ring-accent-500/10"
              />
            </form>
            <Button variant="secondary" onClick={() => setEditing('new')}>
              <Plus className="size-4" /> Add table
            </Button>
            <Button onClick={() => setNewOrderOpen(true)}>
              <Plus className="size-4" /> New order
            </Button>
          </>
        }
      />

      {/* Legend: the same tokens the tiles use, so the two can't drift apart */}
      <div className="mb-4 inline-flex w-fit max-w-full flex-wrap items-center gap-x-5 gap-y-1.5 rounded-full bg-white px-4 py-2 shadow-card ring-1 ring-surface-200/70">
        {FLOOR_STATES.map((state) => (
          <span key={state} className="flex items-center gap-1.5 text-[11.5px] font-semibold text-ink-500">
            <span className={cn('size-2.5 rounded-full', FLOOR_STATE_META[state].swatch)} aria-hidden />
            {FLOOR_STATE_META[state].label}
          </span>
        ))}
      </div>

      {zones.map(([zone, zoneTables]) => (
        <section key={zone} className="mb-5">
          <h2 className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-500">{zone}</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2.5">
            {zoneTables.map((table) => (
              <TableTile
                key={table.id}
                table={table}
                rounds={activeOrdersForTable(orders, table.id)}
                onOpen={() => openTable(table)}
                onAddRound={() => navigate(`/admin/take-order/${table.id}`)}

                onEdit={() => setEditing(table)}
              />
            ))}
          </div>
        </section>
      ))}

      {/* New order: pick any free table without hunting for it on the plan */}
      <Modal
        open={newOrderOpen}
        onClose={() => setNewOrderOpen(false)}
        title="New order · pick a table"
      >
        {freeTables.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-500">Every table has a running order.</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(5rem,1fr))] gap-2">
            {freeTables.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setNewOrderOpen(false)
                  startSitting(t)
                }}
                className="flex flex-col items-center rounded-xl bg-white py-3 shadow-card ring-1 ring-surface-200 transition-all hover:-translate-y-0.5 hover:shadow-lift hover:ring-accent-500"
              >
                <span className="text-sm font-bold">{t.name}</span>
                <span className="text-[11px] text-ink-500">
                  {t.zone} · {t.capacity}
                </span>
              </button>
            ))}
          </div>
        )}
      </Modal>

      <CustomerSheet
        open={askingFor !== null}
        onClose={() => setAskingFor(null)}
        title={askingFor ? `Table ${askingFor.name} · who is at the table?` : 'Who is at the table?'}
        onPick={(customer) => {
          const table = askingFor
          setAskingFor(null)
          if (!table) return
          navigate(`/admin/take-order/${table.id}${customer ? `?customer=${customer.id}` : ''}`)
        }}
      />

      <TableEditor editing={editing} onClose={() => setEditing(null)} />
      <TableBillSheet tableId={billTableId} onClose={() => setBillTableId(null)} />
    </div>
  )
}

/* ------------------------------ Table tile ------------------------------- */

function TableTile({
  table,
  rounds,
  onOpen,
  onAddRound,
  onEdit,
}: {
  table: CafeTable
  rounds: Order[]
  onOpen: () => void
  onAddRound: () => void
  onEdit: () => void
}) {
  const now = useNow()
  const state = floorState(rounds)
  const meta = FLOOR_STATE_META[state]
  const first = rounds[0]
  const running = Boolean(first)
  const total = rounds.reduce((s, o) => s + o.total, 0)

  return (
    <div
      className={cn(
        'group relative flex min-h-[5rem] flex-col rounded-2xl transition-all duration-200 hover:-translate-y-0.5',
        meta.tile,
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex flex-1 flex-col items-center justify-center px-1.5 py-2 text-center leading-none"
        aria-label={`${table.name}: ${meta.label}`}
      >
        <span className="text-[15px] font-bold text-ink-900">{table.name}</span>
        {running && first ? (
          <>
            <span className="mt-1.5 text-[13px] font-bold tabular-nums text-ink-900">{formatINR(total)}</span>
            <span className="mt-1 text-[10px] tabular-nums text-ink-500">
              {rounds.length > 1 && `${rounds.length} rounds · `}
              {elapsedLabel(first.placedAt, now)}
            </span>
            {first.customerName && (
              <span className="mt-0.5 max-w-full truncate text-[10px] font-semibold text-ink-700">
                {first.customerName}
              </span>
            )}
          </>
        ) : (
          <span className="mt-1.5 flex items-center gap-1 text-[10px] text-ink-300">
            <Users className="size-3" /> {table.capacity}
          </span>
        )}
      </button>

      {/* Quick actions, the way a busy floor plan works */}
      {running ? (
        <div className="flex items-center justify-center gap-1 pb-1.5">
          <TileAction label={`Add items to ${table.name}`} onClick={onAddRound} icon={<Plus className="size-3.5" />} />
          <TileAction label={`Open bill for ${table.name}`} onClick={onOpen} icon={<ReceiptIndianRupee className="size-3.5" />} />
        </div>
      ) : (
        <span className="absolute right-1 top-1">
          <TileAction label={`Edit table ${table.name}`} onClick={onEdit} icon={<Pencil className="size-3" />} faded />
        </span>
      )}
    </div>
  )
}

function TileAction({
  label,
  onClick,
  icon,
  faded = false,
}: {
  label: string
  onClick: () => void
  icon: React.ReactNode
  faded?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        'grid size-6 place-items-center rounded-lg bg-white/80 text-ink-500 shadow-card ring-1 ring-surface-200 transition-all hover:text-ink-900 hover:shadow-lift',
        faded && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
      )}
    >
      {icon}
    </button>
  )
}

/* ----------------------------- Running bill ------------------------------ */

function TableBillSheet({ tableId, onClose }: { tableId: string | null; onClose: () => void }) {
  const tables = useAppStore((s) => s.db.tables)
  const orders = useAppStore((s) => s.db.orders)
  const bills = useAppStore((s) => s.db.bills)
  const settings = useAppStore((s) => s.db.settings)
  const session = useAppStore((s) => s.session)
  const navigate = useNavigate()
  const pushToast = useToasts((s) => s.push)

  const walletEntries = useAppStore((s) => s.db.walletEntries)
  const customers = useAppStore((s) => s.db.customers)

  const [discountText, setDiscountText] = useState('')
  /** Which box the cashier typed in; the other method covers the remainder. */
  const [entry, setEntry] = useState<{ method: PaymentMethod; text: string } | null>(null)
  const [redeem, setRedeem] = useState(false)
  const [voiding, setVoiding] = useState<Order | null>(null)
  const [voidReason, setVoidReason] = useState('')
  const [editingRound, setEditingRound] = useState<Order | null>(null)
  /** null means "use the whole advance", the pre-filled default. */
  const [walletText, setWalletText] = useState<string | null>(null)
  const [laterText, setLaterText] = useState('')
  const [extraText, setExtraText] = useState('')
  const [askingGuest, setAskingGuest] = useState(false)

  // Fresh sheet per table opening.
  useEffect(() => {
    setDiscountText('')
    setEntry(null)
    setRedeem(false)
    setVoiding(null)
    setVoidReason('')
    setEditingRound(null)
    setWalletText(null)
    setLaterText('')
    setExtraText('')
  }, [tableId])

  const table = tables.find((t) => t.id === tableId)
  const rounds = table ? activeOrdersForTable(orders, table.id) : []
  const first = rounds[0]

  const customer: Customer | undefined =
    customers.find((c) => c.id === first?.customerId) ??
    customers.find((c) => c.phone === (first?.customerPhone ?? ''))
  const account = useAccount(customer?.id)
  const balance = walletBalance(walletEntries, customer?.id)

  const profile = first?.customerPhone ? customerByPhone(bills, first.customerPhone) : undefined
  const availablePoints = profile?.pointsBalance ?? 0

  const preview = computeBillPreview({
    rounds,
    settings,
    discountAmount: parseAmount(discountText),
    redeemPoints: redeem ? availablePoints : 0,
    availablePoints,
    hasCustomer: Boolean(first?.customerPhone),
  })

  // Advance is offered, never taken silently: it comes pre-filled and one tap
  // clears it, so the cashier always sees it move.
  const advance = advanceHeld(balance)
  const requestedWallet =
    walletText === null ? Math.min(advance, preview.total) : parseAmount(walletText)

  const plan = planSettlement({
    total: preview.total,
    balance,
    hasCustomer: Boolean(customer),
    allowPayLater: settings.accounts.allowPayLater,
    walletApplied: requestedWallet,
    creditAmount: parseAmount(laterText),
    walletTopUp: parseAmount(extraText),
  })

  // The split is derived, never free-typed twice, so the two legs always add
  // up to what is being handed over — an unpayable bill is unrepresentable.
  const entryMethod = entry?.method ?? 'cash'
  const entryAmount = entry ? parseAmount(entry.text) : plan.tenderTarget
  const payments = splitPayment(plan.tenderTarget, entryMethod, entryAmount)
  const isSplit = payments.cash > 0 && payments.upi > 0

  /**
   * What a payment box shows. The box being typed into keeps its raw text
   * (so it can be cleared, and the caret stays put); everything else — the
   * other leg, and an amount above the bill — shows the settled value, so
   * the two boxes on screen always add up to what is charged.
   */
  const boxValue = (method: PaymentMethod): string =>
    entry?.method === method && parseAmount(entry.text) <= plan.tenderTarget
      ? entry.text
      : plainAmount(payments[method])

  const pendingInKitchen = rounds.filter((o) => o.status !== 'delivered')
  const canSettle = rounds.length > 0 && pendingInKitchen.length === 0

  const settle = () => {
    if (!table || !session || !canSettle) return
    const bill = billService.settleTable({
      tableId: table.id,
      payments,
      session,
      discountAmount: parseAmount(discountText),
      redeemPoints: redeem ? availablePoints : 0,
      walletApplied: plan.walletApplied,
      creditAmount: plan.creditAmount,
      walletTopUp: plan.walletTopUp,
    })
    if (bill) {
      const extras = [
        bill.walletApplied > 0 && `${formatINR(bill.walletApplied)} from advance`,
        bill.creditAmount > 0 && `${formatINR(bill.creditAmount)} on account`,
        bill.walletTopUp > 0 && `${formatINR(bill.walletTopUp)} kept as advance`,
        bill.pointsEarned > 0 && `+${bill.pointsEarned} pts`,
      ].filter(Boolean)
      pushToast(
        `Bill #${bill.billNumber} · ${formatINR(bill.total)} (${paymentSummary(bill.payments)})${extras.length ? ` · ${extras.join(' · ')}` : ''} · ${table.name} is free`,
        'ok',
      )
      onClose()
    }
  }

  return (
    <Modal
      open={tableId !== null}
      onClose={onClose}
      title={table ? `Table ${table.name} · running bill` : 'Running bill'}
      position="sheet"
      footer={
        <div className="space-y-3">
          {/* Loyalty redemption */}
          {settings.loyalty.enabled && availablePoints > 0 && (
            <button
              type="button"
              onClick={() => setRedeem((r) => !r)}
              aria-pressed={redeem}
              className={cn(
                'flex w-full items-center justify-between rounded-2xl px-3.5 py-2.5 text-[13px] font-semibold ring-1 transition-all',
                redeem ? 'bg-ok-100 text-ok-600 shadow-card ring-ok-600/40' : 'bg-white text-ink-700 ring-surface-200 hover:shadow-card',
              )}
            >
              <span className="flex items-center gap-2">
                <Sparkles className="size-4" /> Redeem {preview.maxRedeemablePoints} pts
              </span>
              <span className="tabular-nums">−{formatINR(preview.maxRedeemablePoints * settings.loyalty.rupeesPerPoint)}</span>
            </button>
          )}

          {/* Totals, with the discount typed straight into the line it affects */}
          <div className="space-y-1 text-sm">
            <div className="flex justify-between text-ink-500">
              <span>Subtotal</span>
              <span className="tabular-nums">{formatINR(preview.subtotal)}</span>
            </div>
            <div className="flex items-center justify-between">
              <label htmlFor="bill-discount" className="text-ink-500">
                Discount
              </label>
              <AmountInput
                id="bill-discount"
                value={discountText}
                placeholder="0"
                ariaLabel="Discount amount in rupees"
                onChange={setDiscountText}
                tone={preview.discountAmount > 0 ? 'ok' : 'plain'}
              />
            </div>
            {preview.pointsValueRedeemed > 0 && (
              <div className="flex justify-between font-semibold text-ok-600">
                <span>Points ({preview.pointsRedeemed})</span>
                <span className="tabular-nums">−{formatINR(preview.pointsValueRedeemed)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-surface-200 pt-1.5 text-base font-bold">
              <span>Bill</span>
              <span className="tabular-nums">{formatINR(preview.total)}</span>
            </div>
            {preview.pointsToEarn > 0 && (
              <p className="text-right text-xs font-semibold text-accent-600">earns +{preview.pointsToEarn} pts</p>
            )}

            {/* The guest's account, as bill lines: what comes off an advance,
                what goes on the tab, what they leave behind for next time. */}
            {customer && (
              <>
                {advance > 0 && (
                  <div className="flex items-center justify-between">
                    <label htmlFor="bill-advance" className="text-ink-500">
                      From advance <span className="text-ink-300">({formatINR(advance)} held)</span>
                    </label>
                    <AmountInput
                      id="bill-advance"
                      value={walletText ?? plainAmount(plan.walletApplied)}
                      ariaLabel="Amount taken from the guest's advance"
                      onChange={setWalletText}
                      tone={plan.walletApplied > 0 ? 'ok' : 'plain'}
                    />
                  </div>
                )}
                {settings.accounts.allowPayLater && (
                  <div className="flex items-center justify-between">
                    <label htmlFor="bill-later" className="text-ink-500">
                      Pay later
                    </label>
                    <span className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          setLaterText(plainAmount(round2(preview.total - plan.walletApplied)))
                        }
                        className="h-7 rounded-full bg-white px-2.5 text-[11px] font-bold text-ink-700 shadow-card ring-1 ring-surface-200 hover:text-ink-900"
                      >
                        Whole bill
                      </button>
                      <AmountInput
                        id="bill-later"
                        value={laterText}
                        placeholder="0"
                        ariaLabel="Amount left on the guest's account"
                        onChange={setLaterText}
                        tone={plan.creditAmount > 0 ? 'warn' : 'plain'}
                      />
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <label htmlFor="bill-extra" className="text-ink-500">
                    Extra for next time
                  </label>
                  <span className="flex items-center gap-1.5">
                    {plan.owedBefore > 0 && (
                      <button
                        type="button"
                        onClick={() => setExtraText(plainAmount(plan.owedBefore))}
                        className="h-7 rounded-full bg-danger-100 px-2.5 text-[11px] font-bold text-danger-600 hover:brightness-95"
                      >
                        Clear {formatINR(plan.owedBefore)} owed
                      </button>
                    )}
                    <AmountInput
                      id="bill-extra"
                      value={extraText}
                      placeholder="0"
                      ariaLabel="Extra amount kept as advance"
                      onChange={setExtraText}
                      tone={plan.walletTopUp > 0 ? 'ok' : 'plain'}
                      sign="+"
                    />
                  </span>
                </div>
              </>
            )}

            <div className="flex justify-between border-t border-surface-200 pt-1.5 text-lg font-bold">
              <span>Taking now</span>
              <span className="tabular-nums">{formatINR(plan.tenderTarget)}</span>
            </div>
            {plan.creditAmount > 0 && (
              <p className="text-right text-xs font-semibold text-warn-600">
                {formatINR(plan.creditAmount)} goes on {customer?.name ?? 'the guest'}'s account
              </p>
            )}
          </div>

          {/* Payment: two legs that always add up to the total */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wide text-ink-500">Payment</span>
              <div className="flex gap-1">
                {PAYMENT_METHODS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setEntry({ method: m, text: plainAmount(preview.total) })}
                    className="h-7 rounded-full bg-white px-3 text-[11px] font-bold text-ink-700 shadow-card ring-1 ring-surface-200 transition-all hover:text-ink-900 hover:shadow-lift"
                  >
                    All {PAYMENT_METHOD_META[m].label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {PAYMENT_METHODS.map((m) => (
                <label
                  key={m}
                  className={cn(
                    'flex cursor-text items-center gap-2.5 rounded-2xl bg-white px-3.5 py-2.5 ring-1 transition-all focus-within:ring-2 focus-within:ring-accent-500',
                    payments[m] > 0 ? 'bg-accent-50 shadow-card ring-accent-500/60' : 'ring-surface-200',
                  )}
                >
                  <span aria-hidden className="text-base">
                    {PAYMENT_METHOD_META[m].icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] font-bold uppercase tracking-wide text-ink-500">
                      {PAYMENT_METHOD_META[m].label}
                    </span>
                    <span className="flex items-baseline gap-0.5">
                      <span className="text-sm text-ink-300">₹</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        aria-label={`${PAYMENT_METHOD_META[m].label} amount`}
                        value={boxValue(m)}
                        onFocus={(e) => e.currentTarget.select()}
                        onChange={(e) => setEntry({ method: m, text: e.target.value })}
                        onBlur={() => setEntry({ method: m, text: plainAmount(payments[m]) })}
                        className="w-full min-w-0 bg-transparent text-base font-bold tabular-nums outline-none"
                      />
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <Button size="lg" className="w-full" disabled={!canSettle} onClick={settle}>
            <ReceiptIndianRupee className="size-5" />
            {plan.tenderTarget > 0
              ? `Take payment · ${formatINR(plan.tenderTarget)}`
              : 'Settle bill · nothing to collect'}
          </Button>
          {canSettle && isSplit && (
            <p className="text-center text-xs font-semibold text-ink-500">
              Split as {paymentSummary(payments)}
            </p>
          )}
          {!canSettle && rounds.length > 0 && (
            <p className="text-center text-xs font-semibold text-warn-600">
              {pendingInKitchen.length} round{pendingInKitchen.length > 1 ? 's' : ''} still with the
              kitchen — settle once everything is delivered.
            </p>
          )}
        </div>
      }
    >
      {account ? (
        <div className="mb-3">
          <AccountSummary account={account} />
          <button
            type="button"
            onClick={() => setAskingGuest(true)}
            className="mt-1.5 text-xs font-bold text-accent-600 hover:underline"
          >
            Change guest
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAskingGuest(true)}
          className="mb-3 flex w-full items-center justify-center gap-2 rounded-card border border-dashed border-surface-300 px-4 py-2.5 text-[13px] font-semibold text-ink-500 transition-colors hover:border-accent-500 hover:text-accent-600"
        >
          <UserPlus className="size-4" /> Add a guest — needed to pay later or use an advance
        </button>
      )}

      <CustomerSheet
        open={askingGuest}
        onClose={() => setAskingGuest(false)}
        title={table ? `Table ${table.name} · guest` : 'Guest'}
        actionLabel="Attach to table"
        skipLabel={customer ? 'Remove guest' : 'No guest'}
        onPick={(picked) => {
          setAskingGuest(false)
          if (table) orderService.setSittingCustomer(table.id, picked?.id ?? null)
          setWalletText(null)
          setLaterText('')
          setExtraText('')
        }}
      />

      <Button
        variant="secondary"
        className="mb-4 w-full"
        onClick={() => {
          onClose()
          if (table) navigate(`/admin/take-order/${table.id}`)
        }}
      >
        <Plus className="size-4" /> Add items (round {rounds.length + 1})
      </Button>

      <div className="space-y-3">
        {rounds.map((round, i) => (
          <RoundCard
            key={round.id}
            round={round}
            index={i + 1}
            onVoid={() => setVoiding(round)}
            onEdit={() => setEditingRound(round)}
          />
        ))}
      </div>

      {/* Correct single lines on a round */}
      <RoundItemsEditor
        round={editingRound ? (rounds.find((r) => r.id === editingRound.id) ?? null) : null}
        onClose={() => setEditingRound(null)}
      />

      {/* Void a delivered round (reason recorded) */}
      <Modal
        open={voiding !== null}
        onClose={() => setVoiding(null)}
        title={voiding ? `Void round #${voiding.orderNumber}?` : 'Void round'}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setVoiding(null)}>
              Keep
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (!voiding) return
                orderService.voidDeliveredRound(voiding.id, voidReason.trim())
                pushToast(`Round #${voiding.orderNumber} voided`, 'warn')
                setVoiding(null)
                setVoidReason('')
              }}
            >
              Void round
            </Button>
          </div>
        }
      >
        <p className="mb-3 text-sm text-ink-500">
          Removes this round from the bill. The order stays in history as cancelled, with the reason.
        </p>
        <Field label="Reason">
          <Textarea value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="e.g. Wrong item served" />
        </Field>
      </Modal>
    </Modal>
  )
}

/** Bare rupee text for an input box: "1814" / "1814.50", never "₹1,814". */
function plainAmount(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

/** Small inline rupee field used inside a totals row. */
function AmountInput({
  id,
  value,
  placeholder,
  ariaLabel,
  onChange,
  tone,
  sign,
}: {
  id?: string
  value: string
  placeholder?: string
  ariaLabel: string
  onChange: (value: string) => void
  tone: 'plain' | 'ok' | 'warn'
  /** Which way the line moves the bill. Deducts by default. */
  sign?: '−' | '+'
}) {
  return (
    <span
      className={cn(
        'inline-flex h-9 items-baseline gap-0.5 rounded-xl bg-white px-2.5 ring-1 transition-all focus-within:ring-2 focus-within:ring-accent-500',
        tone === 'ok' && 'text-ok-600 ring-ok-600/50',
        tone === 'warn' && 'text-warn-600 ring-warn-600/50',
        tone === 'plain' && 'text-ink-700 ring-surface-200',
      )}
    >
      <span className="text-xs">{sign ?? '−'}₹</span>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        aria-label={ariaLabel}
        value={value}
        placeholder={placeholder}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => onChange(e.target.value)}
        className="w-16 bg-transparent text-right text-sm font-bold tabular-nums outline-none placeholder:font-normal placeholder:text-ink-300"
      />
    </span>
  )
}

function RoundCard({
  round,
  index,
  onVoid,
  onEdit,
}: {
  round: Order
  index: number
  onVoid: () => void
  onEdit: () => void
}) {
  const meta = ORDER_STATUS_META[round.status]
  const live = round.items.filter((i) => i.status !== 'cancelled')
  const removed = round.items.filter((i) => i.status === 'cancelled')

  return (
    <div className="rounded-2xl bg-white p-3.5 shadow-card ring-1 ring-surface-200/70">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-sm font-bold">
          Round {index} <span className="font-normal text-ink-500">· #{round.orderNumber}</span>
        </p>
        <Badge tone={meta.tone} dot>
          {meta.label}
        </Badge>
      </div>

      <p className="text-xs text-ink-500">{live.map((i) => `${i.quantity}× ${i.name}`).join(', ')}</p>
      {removed.length > 0 && (
        <p className="mt-0.5 text-xs text-ink-300 line-through">
          {removed.map((i) => `${i.quantity}× ${i.name}`).join(', ')}
        </p>
      )}

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onEdit}
            className="flex items-center gap-1 text-xs font-semibold text-ink-500 hover:text-ink-900"
          >
            <PencilLine className="size-3.5" /> Edit items
          </button>
          {round.status === 'delivered' && (
            <button type="button" onClick={onVoid} className="text-xs font-semibold text-danger-600 hover:underline">
              Void round
            </button>
          )}
        </div>
        <p className="text-right text-sm font-bold tabular-nums">{formatINR(round.total)}</p>
      </div>
    </div>
  )
}

/* --------------------------- Round item editor --------------------------- */

/**
 * Correct what actually reached the table: drop a line the guest never got,
 * or bring a quantity down. Quantities only go down here, because a round is
 * what the kitchen was already told to cook — more food means a new round.
 * One reason covers the whole correction, so fixing a bill is a few taps
 * rather than a form per line.
 */
function RoundItemsEditor({ round, onClose }: { round: Order | null; onClose: () => void }) {
  const session = useAppStore((s) => s.session)
  const pushToast = useToasts((s) => s.push)
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [reason, setReason] = useState('')

  const roundId = round?.id ?? null
  useEffect(() => {
    setQuantities({})
    setReason('')
  }, [roundId])

  if (!round) return <Modal open={false} onClose={onClose} title="Edit items" children={null} />

  const live = round.items.filter((i) => i.status !== 'cancelled')
  const qtyFor = (id: string, fallback: number) => quantities[id] ?? fallback
  const changes = live.filter((i) => qtyFor(i.id, i.quantity) !== i.quantity)
  const newTotal = round2(
    live.reduce((sum, i) => sum + i.unitPrice * qtyFor(i.id, i.quantity), 0),
  )

  const apply = () => {
    if (!session || changes.length === 0) return
    changes.forEach((item) => {
      orderService.adjustItem({
        orderId: round.id,
        itemId: item.id,
        quantity: qtyFor(item.id, item.quantity),
        reason,
        session,
      })
    })
    const removedCount = changes.filter((i) => qtyFor(i.id, i.quantity) === 0).length
    pushToast(
      removedCount === changes.length
        ? `${removedCount} item${removedCount > 1 ? 's' : ''} removed from round #${round.orderNumber}`
        : `Round #${round.orderNumber} updated`,
      'warn',
    )
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Round #${round.orderNumber} · edit items`}
      footer={
        <div className="space-y-3">
          <Field label="Reason" hint="Kept with the order in history">
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Guest didn't order this"
            />
          </Field>
          <div className="flex items-center justify-between text-sm">
            <span className="text-ink-500">Round total</span>
            <span className="font-bold tabular-nums">
              {changes.length > 0 && (
                <span className="mr-2 font-normal text-ink-300 line-through">{formatINR(round.total)}</span>
              )}
              {formatINR(changes.length > 0 ? newTotal : round.total)}
            </span>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="danger" disabled={changes.length === 0} onClick={apply}>
              Apply {changes.length > 0 && `(${changes.length})`}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-2">
        {live.map((item) => {
          const qty = qtyFor(item.id, item.quantity)
          const changed = qty !== item.quantity
          return (
            <div
              key={item.id}
              className={cn(
                'flex items-center gap-2 rounded-xl px-3 py-2 ring-1 transition-colors',
                qty === 0 ? 'bg-danger-100/60 ring-danger-600/25' : changed ? 'bg-warn-100 ring-warn-600/25' : 'bg-white ring-surface-200',
              )}
            >
              <VegMark isVeg={item.isVegetarian} className="size-3.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className={cn('truncate text-[13px] font-semibold', qty === 0 && 'line-through')}>{item.name}</p>
                {item.modifiers.length > 0 && (
                  <p className="truncate text-[11px] text-ink-500">
                    {item.modifiers.map((m) => m.optionName).join(' · ')}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => setQuantities((q) => ({ ...q, [item.id]: Math.max(0, qty - 1) }))}
                  disabled={qty === 0}
                  aria-label={`One less ${item.name}`}
                  className="grid size-7 place-items-center rounded-lg bg-white text-ink-500 shadow-card ring-1 ring-surface-200 disabled:opacity-40"
                >
                  <Minus className="size-3.5" />
                </button>
                <span className="w-5 text-center text-[13px] font-bold tabular-nums">{qty}</span>
                <button
                  type="button"
                  onClick={() =>
                    setQuantities((q) => ({ ...q, [item.id]: Math.min(item.quantity, qty + 1) }))
                  }
                  disabled={qty >= item.quantity}
                  title={qty >= item.quantity ? 'Add more with a new round' : undefined}
                  aria-label={`One more ${item.name}`}
                  className="grid size-7 place-items-center rounded-lg bg-white text-ink-500 shadow-card ring-1 ring-surface-200 disabled:opacity-40"
                >
                  <Plus className="size-3.5" />
                </button>
              </div>

              <span className="w-14 shrink-0 text-right text-[13px] font-bold tabular-nums">
                {formatINR(item.unitPrice * qty)}
              </span>
            </div>
          )
        })}
      </div>
      <p className="mt-3 text-xs text-ink-500">
        More of something? Close this and use <strong>Add items</strong> so the kitchen gets told.
      </p>
    </Modal>
  )
}

/* ------------------------------ Table editor ----------------------------- */

function TableEditor({ editing, onClose }: { editing: CafeTable | 'new' | null; onClose: () => void }) {
  const isNew = editing === 'new'
  const table = isNew || editing === null ? null : editing

  const [name, setName] = useState('')
  const [zone, setZone] = useState('')
  const [capacity, setCapacity] = useState(4)
  const [isActive, setIsActive] = useState(true)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)

  // Sync local form state when a different table (or "new") is opened.
  const editKey = editing === null ? null : isNew ? 'new' : table!.id
  if (editKey !== null && editKey !== loadedFor) {
    setLoadedFor(editKey)
    setName(table?.name ?? '')
    setZone(table?.zone ?? 'Lounge')
    setCapacity(table?.capacity ?? 4)
    setIsActive(table?.isActive ?? true)
  }
  if (editing === null && loadedFor !== null) setLoadedFor(null)

  const save = () => {
    const input = { name: name.trim(), zone: zone.trim() || 'Main', capacity, isActive }
    if (!input.name) return
    if (isNew) tableService.createTable(input)
    else if (table) tableService.updateTable(table.id, input)
    onClose()
  }

  return (
    <Modal
      open={editing !== null}
      onClose={onClose}
      title={isNew ? 'Add table' : `Edit table ${table?.name ?? ''}`}
      footer={
        <div className="flex justify-between gap-2">
          {!isNew && table ? (
            <Button
              variant="ghost"
              className="text-danger-600"
              onClick={() => {
                tableService.archiveTable(table.id)
                onClose()
              }}
            >
              Remove
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={save} disabled={!name.trim()}>
              {isNew ? 'Add table' : 'Save'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Table name" hint="Short label, e.g. L3 or G1">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="L7" />
        </Field>
        <Field label="Zone">
          <Input value={zone} onChange={(e) => setZone(e.target.value)} placeholder="Lounge" />
        </Field>
        <Field label="Capacity">
          <Input
            type="number"
            min={1}
            max={20}
            value={capacity}
            onChange={(e) => setCapacity(Math.max(1, Number(e.target.value) || 1))}
          />
        </Field>
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-ink-700">Active</span>
          <Toggle checked={isActive} onChange={setIsActive} label="Table active" />
        </div>
      </div>
    </Modal>
  )
}
