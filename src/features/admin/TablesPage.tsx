import { Minus, Pencil, PencilLine, Plus, ReceiptIndianRupee, Search, Split, UserPlus, Users, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '@/components/layout/AdminLayout'
import { CustomerSheet, GuestChip, useAccount } from '@/components/customer/CustomerBits'
import { useAction, useToasts } from '@/components/toast'
import { Badge, Button, Field, Input, Modal, Textarea, Toggle, VegMark } from '@/components/ui'
import { FLOOR_STATE_META, ORDER_STATUS_META, PAYMENT_METHOD_META, paymentSummary } from '@/lib/statusMeta'
import { byDisplayOrder, clamp, cn, elapsedLabel, formatINR, parseAmount, round2 } from '@/lib/utils'
import { useNow } from '@/lib/useNow'
import { toAppError } from '@/lib/errors'
import {
  activeOrdersForGroup,
  activeOrdersForTable,
  billService,
  computeBillPreview,
  groupsAtTable,
  nextGroupNo,
  orderService,
  planSettlement,
  tableService,
  walletBalance,
  walletHeld,
  walletOwed,
} from '@/services'
import type { TableGroup } from '@/services'
import { useAppStore } from '@/store/useAppStore'
import type { BillPayments, CafeTable, Customer, FloorState, Order, PaymentMethod } from '@/types'
import { FLOOR_STATES, PAYMENT_METHODS } from '@/types'

/** Most urgent first: the tile shows the worst state among its parties. */
const FLOOR_ORDER: FloorState[] = ['billing', 'running', 'ready']

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
  /** Which party's bill is open: a table and the group within it. */
  const [billFor, setBillFor] = useState<{ tableId: string; groupNo: number } | null>(null)
  const [newOrderOpen, setNewOrderOpen] = useState(false)
  const [billQuery, setBillQuery] = useState('')
  /** The party waiting on the guest lookup before its first round starts. */
  const [askingFor, setAskingFor] = useState<{ table: CafeTable; groupNo: number } | null>(null)

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
   * Starting a party asks who is sitting there first; adding a round to a
   * party that is already running does not, because the guest is already
   * attached to it.
   */
  const startSitting = (table: CafeTable, groupNo = 1) => {
    if (askCustomer) setAskingFor({ table, groupNo })
    else navigate(`/admin/take-order/${table.id}?group=${groupNo}`)
  }

  /** Seat another party at a table that is already busy. */
  const splitTable = (table: CafeTable) => startSitting(table, nextGroupNo(orders, table.id))



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
          <div className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] items-start gap-2.5">
            {zoneTables.map((table) => (
              <TableTile
                key={table.id}
                table={table}
                groups={groupsAtTable(orders, table.id)}
                onStart={() => startSitting(table)}
                onSplit={() => splitTable(table)}
                onOpenGroup={(groupNo) => setBillFor({ tableId: table.id, groupNo })}
                onAddRound={(groupNo) => navigate(`/admin/take-order/${table.id}?group=${groupNo}`)}
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
        title={
          askingFor
            ? `Table ${askingFor.table.name}${askingFor.groupNo > 1 ? ` · group ${askingFor.groupNo}` : ''} · who is sitting here?`
            : 'Who is sitting here?'
        }
        onPick={(customer) => {
          const asking = askingFor
          setAskingFor(null)
          if (!asking) return
          const query = new URLSearchParams({ group: String(asking.groupNo) })
          if (customer) query.set('customer', customer.id)
          navigate(`/admin/take-order/${asking.table.id}?${query}`)
        }}
      />

      <TableEditor editing={editing} onClose={() => setEditing(null)} />
      <TableBillSheet target={billFor} onClose={() => setBillFor(null)} />
    </div>
  )
}

/* ------------------------------ Table tile ------------------------------- */

/**
 * One table on the floor. A table can seat more than one party at a time —
 * three friends at one end, a couple at the other — so the tile is a stack of
 * parties separated by a dashed rule, each with its own colour, its own
 * running total and its own bill. A table with a single party looks almost
 * like it always did; the stack only appears once it is actually split.
 */
function TableTile({
  table,
  groups,
  onStart,
  onSplit,
  onOpenGroup,
  onAddRound,
  onEdit,
}: {
  table: CafeTable
  groups: TableGroup[]
  onStart: () => void
  onSplit: () => void
  onOpenGroup: (groupNo: number) => void
  onAddRound: (groupNo: number) => void
  onEdit: () => void
}) {
  const now = useNow()
  const running = groups.length > 0
  // The tile takes its colour from the party that needs attention first.
  const state = running ? FLOOR_ORDER.reduce((worst, s) => (groups.some((g) => g.state === s) ? s : worst), 'billing' as FloorState) : 'free'
  const meta = FLOOR_STATE_META[state]

  if (!running) {
    return (
      <div className={cn('group relative flex min-h-[5rem] flex-col rounded-2xl transition-all duration-200 hover:-translate-y-0.5', meta.tile)}>
        <button
          type="button"
          onClick={onStart}
          className="flex flex-1 flex-col items-center justify-center px-1.5 py-2 text-center leading-none"
          aria-label={`${table.name}: ${meta.label}`}
        >
          <span className="text-[15px] font-bold text-ink-900">{table.name}</span>
          <span className="mt-1.5 flex items-center gap-1 text-[10px] text-ink-300">
            <Users className="size-3" /> {table.capacity}
          </span>
        </button>
        <span className="absolute right-1 top-1">
          <TileAction label={`Edit table ${table.name}`} onClick={onEdit} icon={<Pencil className="size-3" />} faded />
        </span>
      </div>
    )
  }

  return (
    // A split table grows sideways: it takes one grid column per party, so
    // the parties sit next to each other the way they do at the table.
    <div
      className={cn('group relative flex flex-col rounded-2xl transition-all duration-200 hover:-translate-y-0.5', meta.tile)}
      style={{ gridColumn: `span ${Math.min(groups.length, 4)}` }}
    >
      <div className="flex items-center justify-between gap-2 px-2 pt-1.5">
        <span className="text-[15px] font-bold leading-none text-ink-900">{table.name}</span>
        <button
          type="button"
          onClick={onSplit}
          className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold text-ink-500 transition-colors hover:bg-white/60 hover:text-accent-600"
        >
          <Split className="size-3" /> Split
        </button>
      </div>

      <div className="flex flex-1 flex-wrap items-stretch">
        {groups.map((group, i) => {
          const groupMeta = FLOOR_STATE_META[group.state]
          return (
            <div
              key={group.groupNo}
              className={cn(
                'flex min-w-0 flex-1 basis-24 flex-col px-1 py-1.5',
                // The dashed rule is the split, now running down between them.
                i > 0 && 'border-l border-dashed border-ink-900/25',
              )}
            >
              <button
                type="button"
                onClick={() => onOpenGroup(group.groupNo)}
                className="flex w-full flex-1 flex-col items-center justify-center text-center leading-none"
                aria-label={`${table.name} group ${group.groupNo}: ${groupMeta.label}`}
              >
                <span className="flex max-w-full items-center gap-1">
                  <span className={cn('size-1.5 shrink-0 rounded-full', groupMeta.swatch)} aria-hidden />
                  <span className="truncate text-[10px] font-semibold text-ink-700">
                    {group.customerName ?? `Group ${group.groupNo}`}
                  </span>
                </span>
                <span className="mt-1 text-[13px] font-bold tabular-nums text-ink-900">
                  {formatINR(group.total)}
                </span>
                <span className="mt-0.5 text-[10px] tabular-nums text-ink-500">
                  {group.rounds.length > 1 && `${group.rounds.length}r · `}
                  {elapsedLabel(group.startedAt, now)}
                </span>
              </button>
              <div className="mt-1 flex items-center justify-center gap-1">
                <TileAction
                  label={`Add items for ${group.customerName ?? `group ${group.groupNo}`} at ${table.name}`}
                  onClick={() => onAddRound(group.groupNo)}
                  icon={<Plus className="size-3.5" />}
                />
                <TileAction
                  label={`Open bill for ${group.customerName ?? `group ${group.groupNo}`} at ${table.name}`}
                  onClick={() => onOpenGroup(group.groupNo)}
                  icon={<ReceiptIndianRupee className="size-3.5" />}
                />
              </div>
            </div>
          )
        })}
      </div>
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

function TableBillSheet({
  target,
  onClose,
}: {
  /** Which party's bill this is: a table, and the group within it. */
  target: { tableId: string; groupNo: number } | null
  onClose: () => void
}) {
  const run = useAction()
  const tables = useAppStore((s) => s.db.tables)
  const orders = useAppStore((s) => s.db.orders)
  const settings = useAppStore((s) => s.db.settings)
  const session = useAppStore((s) => s.session)
  const navigate = useNavigate()
  const pushToast = useToasts((s) => s.push)

  const walletEntries = useAppStore((s) => s.db.walletEntries)
  const customers = useAppStore((s) => s.db.customers)

  const tableId = target?.tableId ?? null
  const groupNo = target?.groupNo ?? 1
  const groups = tableId ? groupsAtTable(orders, tableId) : []

  const [discountText, setDiscountText] = useState('')
  const [voiding, setVoiding] = useState<Order | null>(null)
  const [voidReason, setVoidReason] = useState('')
  const [editingRound, setEditingRound] = useState<Order | null>(null)
  /** How much of the wallet this bill spends. null means "as much as it can". */
  const [walletText, setWalletText] = useState<string | null>(null)
  /** The rest of the bill goes on the wallet instead of being collected. */
  const [payLater, setPayLater] = useState(false)
  /**
   * Money being collected ON TOP of this bill — old dues the guest is
   * clearing at the same time. It has to be its own number: the two payment
   * boxes fill each other in against what is being collected, and if that
   * were just the bill, typing into either box would quietly drop the dues.
   */
  const [extraCollect, setExtraCollect] = useState(0)
  const [settling, setSettling] = useState(false)
  /** What is in the two cash boxes. null means "the whole amount in cash". */
  const [tender, setTender] = useState<{ cash: string; upi: string } | null>(null)
  const [askingGuest, setAskingGuest] = useState(false)

  // Fresh sheet per table opening.
  useEffect(() => {
    setDiscountText('')
    setVoiding(null)
    setVoidReason('')
    setEditingRound(null)
    setWalletText(null)
    setPayLater(false)
    setExtraCollect(0)
    setTender(null)
  }, [tableId, groupNo])

  const table = tables.find((t) => t.id === tableId)
  const rounds = table ? activeOrdersForGroup(orders, table.id, groupNo) : []
  const first = rounds[0]

  const customer: Customer | undefined =
    customers.find((c) => c.id === first?.customerId) ??
    customers.find((c) => c.phone === (first?.customerPhone ?? ''))
  const account = useAccount(customer?.id)
  const balance = walletBalance(walletEntries, customer?.id)

  const preview = computeBillPreview({ rounds, discountAmount: parseAmount(discountText) })

  /**
   * The wallet is one running number: what the guest has with us, or what
   * they owe. It pays as much of this bill as it can, and anything the guest
   * does not hand over now goes back on it. That is the whole feature — no
   * separate advance, credit and top-up to keep straight.
   */
  const held = walletHeld(balance)
  // Offered in full and editable down: a guest can ask to keep some back.
  const walletCeiling = Math.min(held, preview.total)
  const walletApplied = customer
    ? round2(clamp(walletText === null ? walletCeiling : parseAmount(walletText), 0, walletCeiling))
    : 0
  const due = round2(preview.total - walletApplied)

  /** What the two boxes should add up to: this bill, plus any old dues. */
  const collectTarget = round2(due + extraCollect)
  const boxes = tender ?? { cash: plainAmount(collectTarget), upi: '0' }
  const cash = Math.max(0, parseAmount(boxes.cash))
  const upi = Math.max(0, parseAmount(boxes.upi))
  const tendered = round2(cash + upi)

  const plan = planSettlement({
    total: preview.total,
    balance,
    hasCustomer: Boolean(customer),
    allowPayLater: settings.wallet.allowPayLater,
    walletApplied,
    creditAmount: Math.max(0, round2(due - tendered)),
    // Gross. planSettlement decides how much of it clears old dues and how
    // much stays in the wallet; passing an already-split figure back in is
    // how that money used to end up filed under the wrong heading.
    extraTendered: Math.max(0, round2(tendered - due)),
  })

  const payments: BillPayments = { cash, upi }

  /**
   * A shortcut chip is lit when the boxes hold exactly what that chip does,
   * so the row always shows how this bill is being paid rather than which
   * button happened to be pressed last.
   */
  const coversTarget = (amount: number) => Math.abs(amount - collectTarget) < 0.01
  const chosen: PaymentMethod | 'later' | null = payLater
    ? 'later'
    : upi === 0 && coversTarget(cash)
      ? 'cash'
      : cash === 0 && coversTarget(upi)
        ? 'upi'
        : null
  /** True when the wallet is doing something to this bill. */
  const onWallet = plan.tenderTarget !== preview.total
  /** The boxes have to add up to what is actually being collected. */
  const addsUp = Math.abs(tendered - plan.tenderTarget) < 0.01

  // The counter takes orders and takes payment. Writing money off without
  // any of it changing hands stays with the manager.
  const handlesMoney = session?.role !== 'kitchen'
  const canWriteOff = session?.role === 'admin'

  /**
   * Paying in full is the normal case, so the two boxes fill each other in.
   * Once "pay later" is on, each box holds exactly what was handed over and
   * the wallet takes the difference.
   */
  const setLeg = (method: PaymentMethod, text: string) => {
    if (payLater) {
      setTender({ ...boxes, [method]: text })
      return
    }
    const typed = Math.max(0, parseAmount(text))
    const rest = plainAmount(Math.max(0, round2(collectTarget - typed)))
    setTender(method === 'cash' ? { cash: text, upi: rest } : { cash: rest, upi: text })
  }

  /**
   * Taking the whole amount in one method also cancels pay later — you can't
   * be collecting everything and deferring it at the same time, and leaving
   * the chip lit after this made the screen lie about what was happening.
   */
  const allIn = (method: PaymentMethod) => {
    setPayLater(false)
    setTender(
      method === 'cash'
        ? { cash: plainAmount(collectTarget), upi: '0' }
        : { cash: '0', upi: plainAmount(collectTarget) },
    )
  }

  /** Add or drop the guest's old dues from what is being collected now. */
  const toggleOwed = () => {
    const next = extraCollect > 0 ? 0 : plan.owedBefore
    setPayLater(false)
    setExtraCollect(next)
    setTender({ cash: plainAmount(round2(due + next)), upi: '0' })
  }

  const pendingInKitchen = rounds.filter((o) => o.status !== 'delivered')
  const canSettle = rounds.length > 0 && pendingInKitchen.length === 0 && addsUp && !settling

  /**
   * Taking the money. `settling` is not cosmetic: without it an impatient
   * double-tap on a slow connection would send two settlements. The server
   * would reject the second (the rounds are no longer `delivered`), but the
   * cashier would see an error instead of a clean close.
   */
  const settle = async () => {
    if (!table || !session || !canSettle) return
    setSettling(true)
    try {
      const bill = await billService.settleTable({
        tableId: table.id,
        groupNo,
        payments,
        discountAmount: parseAmount(discountText),
        walletApplied: plan.walletApplied,
        creditAmount: plan.creditAmount,
        extraTendered: round2(plan.duesCleared + plan.walletTopUp),
      })
      const extras = [
        bill.walletApplied > 0 && `${formatINR(bill.walletApplied)} from wallet`,
        bill.creditAmount > 0 && `${formatINR(bill.creditAmount)} on wallet`,
        bill.duesCleared > 0 && `${formatINR(bill.duesCleared)} old dues cleared`,
        bill.walletTopUp > 0 && `${formatINR(bill.walletTopUp)} into wallet`,
      ].filter(Boolean)
      pushToast(
        `Bill #${bill.billNumber} · ${formatINR(bill.total)} · took ${paymentSummary(bill.payments)}${extras.length ? ` · ${extras.join(' · ')}` : ''} · ${table.name} is free`,
        'ok',
      )
      onClose()
    } catch (error) {
      pushToast(toAppError(error, 'Could not settle the table.').userMessage, 'danger')
    } finally {
      setSettling(false)
    }
  }

  return (
    <Modal
      open={tableId !== null}
      onClose={onClose}
      title={
        table
          ? `Table ${table.name}${groups.length > 1 ? ` · ${first?.customerName ?? `group ${groupNo}`}` : ''} · running bill`
          : 'Running bill'
      }
      position="sheet"
      footer={
        !handlesMoney ? (
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-bold">Bill so far</span>
              <span className="text-xl font-bold tabular-nums">{formatINR(preview.total)}</span>
            </div>
            <p className="rounded-xl bg-surface-100 px-3 py-2 text-center text-[12px] font-semibold text-ink-500">
              The manager settles this bill.
            </p>
          </div>
        ) : (
        <div className="space-y-2">
          {/* Three bill lines on one rail: labels flush left, figures flush
              right, so the eye runs straight down each column. The boxed
              controls below are a separate block on purpose. */}
          <div className="space-y-1.5 text-[13px]">
            <div className="flex items-center justify-between gap-3">
              <span className="text-ink-500">Subtotal</span>
              <span className="pr-2.5 font-bold tabular-nums">{formatINR(preview.subtotal)}</span>
            </div>

            <div className="flex items-center justify-between gap-3">
              <label htmlFor="bill-discount" className="text-ink-500">
                Discount
              </label>
              <AmountChip
                id="bill-discount"
                ariaLabel="Discount amount in rupees"
                value={discountText}
                applied={preview.discountAmount}
                onChange={(text) => {
                  setDiscountText(text)
                  setTender(null)
                }}
                onClear={() => {
                  setDiscountText('')
                  setTender(null)
                }}
              />
            </div>

            {customer && held > 0 && (
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="bill-wallet" className="text-ink-500">
                  Wallet <span className="text-ink-300">({formatINR(held)} in it)</span>
                </label>
                <AmountChip
                  id="bill-wallet"
                  ariaLabel="Amount taken from the wallet"
                  value={walletText ?? plainAmount(walletApplied)}
                  applied={walletApplied}
                  onChange={(text) => {
                    setWalletText(text)
                    setTender(null)
                  }}
                  onBlur={() => setWalletText(plainAmount(walletApplied))}
                  onClear={() => {
                    setWalletText('0')
                    setTender(null)
                  }}
                />
              </div>
            )}

            {extraCollect > 0 && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-ink-500">
                  Old dues <span className="text-ink-300">being cleared now</span>
                </span>
                <span className="inline-flex h-7 items-center gap-1 rounded-md bg-danger-100 pl-2 pr-2.5 text-[13px] font-bold text-danger-600">
                  <button
                    type="button"
                    onClick={toggleOwed}
                    aria-label="Do not collect the old dues now"
                    className="mr-0.5 grid size-4 place-items-center rounded-full text-danger-600/60 transition-colors hover:bg-white/70 hover:text-danger-600"
                  >
                    <X className="size-3" />
                  </button>
                  <span className="tabular-nums">+{formatINR(extraCollect)}</span>
                </span>
              </div>
            )}

            <div className="flex items-baseline justify-between gap-3 border-t border-surface-200 pt-2">
              <span className="text-sm font-bold">
                Taking now
                {(onWallet || extraCollect > 0) && (
                  <span className="ml-1.5 text-[11px] font-semibold text-ink-500">
                    bill {formatINR(preview.total)}
                    {extraCollect > 0 && ` + dues ${formatINR(extraCollect)}`}
                  </span>
                )}
              </span>
              <span className="pr-2.5 text-xl font-bold tabular-nums">
                {formatINR(plan.tenderTarget)}
              </span>
            </div>
          </div>

          {/* Payment: two boxes, and the shortcuts on the same line. */}
          <div className="flex items-center gap-1.5">
            {PAYMENT_METHODS.map((m) => (
              <label
                key={m}
                className={cn(
                  'flex min-w-0 flex-1 cursor-text items-center gap-1.5 rounded-xl bg-white px-2.5 py-1.5 ring-1 transition-all focus-within:ring-2 focus-within:ring-accent-500',
                  payments[m] > 0 ? 'bg-accent-50 shadow-card ring-accent-500/60' : 'ring-surface-200',
                )}
              >
                <span aria-hidden className="text-sm">
                  {PAYMENT_METHOD_META[m].icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[10px] font-bold uppercase leading-tight tracking-wide text-ink-500">
                    {PAYMENT_METHOD_META[m].label}
                  </span>
                  <span className="flex items-baseline gap-0.5">
                    <span className="text-xs text-ink-300">₹</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      aria-label={`${PAYMENT_METHOD_META[m].label} amount`}
                      value={boxes[m]}
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => setLeg(m, e.target.value)}
                      onBlur={() => setLeg(m, plainAmount(payments[m]))}
                      className="w-full min-w-0 bg-transparent text-[15px] font-bold leading-tight tabular-nums outline-none"
                    />
                  </span>
                </span>
              </label>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1">
            {PAYMENT_METHODS.map((m) => (
              <ShortcutChip key={m} active={chosen === m} onClick={() => allIn(m)}>
                All {PAYMENT_METHOD_META[m].label}
              </ShortcutChip>
            ))}
            {customer && (plan.owedBefore > 0 || extraCollect > 0) && !payLater && (
              <ShortcutChip tone="danger" active={extraCollect > 0} onClick={toggleOwed}>
                + Old dues {formatINR(plan.owedBefore || extraCollect)}
              </ShortcutChip>
            )}
            {customer && settings.wallet.allowPayLater && (
              <ShortcutChip
                active={payLater}
                onClick={() => {
                  const next = !payLater
                  setPayLater(next)
                  setTender(next ? { cash: '0', upi: '0' } : null)
                }}
              >
                Pay later
              </ShortcutChip>
            )}
            {customer && onWallet && (
              <span
                className={cn(
                  'ml-auto text-[11px] font-bold',
                  plan.balanceAfter < 0 ? 'text-warn-600' : 'text-ok-600',
                )}
              >
                {plan.balanceAfter < 0
                  ? `owes ${formatINR(walletOwed(plan.balanceAfter))} after`
                  : plan.balanceAfter > 0
                    ? `${formatINR(plan.balanceAfter)} left in wallet`
                    : 'wallet square after'}
              </span>
            )}
          </div>

          <Button className="w-full" disabled={!canSettle} onClick={settle}>
            <ReceiptIndianRupee className="size-4" />
            {plan.tenderTarget > 0
              ? `Take payment · ${formatINR(plan.tenderTarget)}`
              : 'Settle bill · nothing to collect'}
          </Button>
          {!addsUp && rounds.length > 0 && (
            <p className="text-center text-[11px] font-semibold text-danger-600">
              {formatINR(Math.abs(round2(collectTarget - tendered)))}{' '}
              {tendered < collectTarget ? 'short of' : 'over'} the {formatINR(collectTarget)} being
              collected — add a guest to put it on a wallet, or fix the amounts.
            </p>
          )}
          {!canSettle && addsUp && rounds.length > 0 && (
            <p className="text-center text-[11px] font-semibold text-warn-600">
              {pendingInKitchen.length} round{pendingInKitchen.length > 1 ? 's' : ''} still with the
              kitchen — settle once everything is delivered.
            </p>
          )}
        </div>
        )
      }
    >
      {/* One line for the guest, so the rounds get the room. */}
      {account ? (
        <div className="mb-2.5">
          <GuestChip account={account} onChange={() => setAskingGuest(true)} showBalance />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAskingGuest(true)}
          className="mb-2.5 flex w-full items-center justify-center gap-2 rounded-full border border-dashed border-surface-300 py-1.5 text-[12px] font-semibold text-ink-500 transition-colors hover:border-accent-500 hover:text-accent-600"
        >
          <UserPlus className="size-3.5" /> Add a guest for wallet and pay later
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
          if (table) run(orderService.setSittingCustomer(table.id, groupNo, picked?.id ?? null))
          setWalletText(null)
          setPayLater(false)
          setTender(null)
        }}
      />

      <Button
        variant="secondary"
        size="sm"
        className="mb-3 w-full"
        onClick={() => {
          onClose()
          if (table) navigate(`/admin/take-order/${table.id}?group=${groupNo}`)
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
            onVoid={canWriteOff ? () => setVoiding(round) : undefined}
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
                run(orderService.voidDeliveredRound(voiding.id, voidReason.trim()))
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

/**
 * One payment shortcut. Lit means the amounts in the boxes are exactly what
 * this chip sets, so at a glance the cashier can see how the bill is being
 * paid — only one of them can be true at a time.
 */
function ShortcutChip({
  active,
  onClick,
  tone = 'plain',
  children,
}: {
  active: boolean
  onClick: () => void
  tone?: 'plain' | 'danger'
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'h-7 rounded-full px-2.5 text-[11px] font-bold transition-all',
        active && 'bg-ink-900 text-white shadow-card',
        !active && tone === 'danger' && 'bg-danger-100 text-danger-600 hover:brightness-95',
        !active &&
          tone === 'plain' &&
          'bg-white text-ink-700 shadow-card ring-1 ring-surface-200 hover:text-ink-900 hover:shadow-lift',
      )}
    >
      {children}
    </button>
  )
}

/**
 * A rupee figure on a bill line that can be typed into: the discount, and
 * how much of the wallet this bill spends. It hugs its own digits rather
 * than sitting as a wide empty field, and turns green once it is doing
 * something. Clearing lives to the LEFT of the number so the digits stay on
 * the same rail as every other figure in the column.
 */
function AmountChip({
  id,
  ariaLabel,
  value,
  applied,
  onChange,
  onBlur,
  onClear,
}: {
  id: string
  ariaLabel: string
  value: string
  /** What the bill actually used, after clamping. Drives the colour. */
  applied: number
  onChange: (value: string) => void
  onBlur?: () => void
  onClear: () => void
}) {
  const has = applied > 0
  return (
    <span
      className={cn(
        'inline-flex h-7 items-center gap-px rounded-md pl-2 pr-2.5 text-[13px] font-bold transition-colors focus-within:ring-2 focus-within:ring-accent-500',
        has ? 'bg-ok-100 text-ok-600' : 'bg-white text-ink-700 ring-1 ring-surface-200',
      )}
    >
      {has && (
        <button
          type="button"
          onClick={onClear}
          aria-label={`Clear ${ariaLabel.toLowerCase()}`}
          className="mr-1 grid size-4 place-items-center rounded-full text-ok-600/60 transition-colors hover:bg-white/70 hover:text-ok-600"
        >
          <X className="size-3" />
        </button>
      )}
      <span className={cn('text-[11px]', has ? 'text-ok-600/70' : 'text-ink-300')}>−₹</span>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        aria-label={ariaLabel}
        value={value}
        placeholder="0"
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        style={{ width: `${Math.max(1, value.length)}ch` }}
        className="bg-transparent tabular-nums outline-none placeholder:font-semibold placeholder:text-ink-300"
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
  /** Absent for the counter: voiding a delivered round is a write-off. */
  onVoid?: () => void
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
          {round.status === 'delivered' && onVoid && (
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
  const [applying, setApplying] = useState(false)

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

  /**
   * Corrections are applied one at a time rather than in parallel: each one
   * recomputes the round's total from the previous state, so firing them
   * together would let the last write win with a stale total.
   */
  const apply = async () => {
    if (!session || changes.length === 0 || applying) return
    setApplying(true)
    try {
      for (const item of changes) {
        await orderService.adjustItem({
          orderId: round.id,
          itemId: item.id,
          quantity: qtyFor(item.id, item.quantity),
          reason,
        })
      }
      const removedCount = changes.filter((i) => qtyFor(i.id, i.quantity) === 0).length
      pushToast(
        removedCount === changes.length
          ? `${removedCount} item${removedCount > 1 ? 's' : ''} removed from round #${round.orderNumber}`
          : `Round #${round.orderNumber} updated`,
        'warn',
      )
      onClose()
    } catch (error) {
      pushToast(toAppError(error, 'Could not correct the round.').userMessage, 'danger')
    } finally {
      setApplying(false)
    }
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
  const run = useAction()
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
    if (isNew) run(tableService.createTable(input))
    else if (table) run(tableService.updateTable(table.id, input))
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
                run(tableService.archiveTable(table.id))
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
