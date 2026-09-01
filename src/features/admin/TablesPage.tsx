import { Pencil, Plus, ReceiptIndianRupee, Sparkles, User, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '@/components/layout/AdminLayout'
import { useToasts } from '@/components/toast'
import { Badge, Button, Field, Input, Modal, Textarea, Toggle } from '@/components/ui'
import { ORDER_STATUS_META, PAYMENT_METHOD_META } from '@/lib/statusMeta'
import { byDisplayOrder, cn, elapsedLabel, formatINR } from '@/lib/utils'
import { useNow } from '@/lib/useNow'
import {
  activeOrdersForTable,
  billService,
  computeBillPreview,
  customerByPhone,
  orderService,
  tableService,
} from '@/services'
import { useAppStore } from '@/store/useAppStore'
import type { BillDiscount, CafeTable, Order, PaymentMethod } from '@/types'
import { PAYMENT_METHODS } from '@/types'

/**
 * Floor view. A table can order in several rounds; it stays occupied until
 * the whole bill is settled (cash/UPI). Tapping an available table starts
 * round 1; tapping an occupied one opens its running bill.
 */
export function TablesPage() {
  const tables = useAppStore((s) => s.db.tables)
  const orders = useAppStore((s) => s.db.orders)
  const navigate = useNavigate()
  const now = useNow()

  const [editing, setEditing] = useState<CafeTable | 'new' | null>(null)
  const [billTableId, setBillTableId] = useState<string | null>(null)

  const zones = useMemo(() => {
    const active = tables.filter((t) => t.isActive).sort(byDisplayOrder)
    const map = new Map<string, CafeTable[]>()
    active.forEach((t) => {
      map.set(t.zone, [...(map.get(t.zone) ?? []), t])
    })
    return [...map.entries()]
  }, [tables])

  const occupiedCount = tables.filter(
    (t) => t.isActive && activeOrdersForTable(orders, t.id).length > 0,
  ).length

  return (
    <div>
      <PageHeader
        title="Tables"
        sub={`${occupiedCount} occupied · ${tables.filter((t) => t.isActive).length - occupiedCount} free`}
        actions={
          <Button variant="secondary" onClick={() => setEditing('new')}>
            <Plus className="size-4" /> Add table
          </Button>
        }
      />

      {zones.map(([zone, zoneTables]) => (
        <section key={zone} className="mb-8">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-ink-500">{zone}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {zoneTables.map((table) => {
              const rounds = activeOrdersForTable(orders, table.id)
              const occupied = rounds.length > 0
              const first = rounds[0]
              const total = rounds.reduce((s, o) => s + o.total, 0)
              // The "most urgent" round drives the badge: kitchen work first.
              const focusRound =
                rounds.find((o) => o.status !== 'delivered') ?? rounds[rounds.length - 1]
              return (
                <button
                  key={table.id}
                  type="button"
                  onClick={() =>
                    occupied ? setBillTableId(table.id) : navigate(`/admin/take-order/${table.id}`)
                  }
                  className={cn(
                    'group relative flex min-h-36 flex-col rounded-card border-2 bg-white p-4 text-left shadow-card transition-all hover:-translate-y-0.5 hover:shadow-pop',
                    occupied ? 'border-warn-600/40' : 'border-transparent',
                  )}
                >
                  <span
                    className="absolute right-3 top-3 grid size-8 place-items-center rounded-lg text-ink-300 opacity-0 transition-opacity hover:bg-cream-200 hover:text-ink-700 group-hover:opacity-100"
                    role="button"
                    aria-label={`Edit table ${table.name}`}
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditing(table)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.stopPropagation()
                        setEditing(table)
                      }
                    }}
                  >
                    <Pencil className="size-4" />
                  </span>

                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-bold tracking-tight">{table.name}</span>
                    <span className="flex items-center gap-1 text-xs text-ink-500">
                      <Users className="size-3.5" /> {table.capacity}
                    </span>
                  </div>

                  {occupied && first?.customerName && (
                    <p className="mt-1 flex items-center gap-1 truncate text-sm font-semibold text-ink-700">
                      <User className="size-3.5 shrink-0 text-ink-300" /> {first.customerName}
                    </p>
                  )}

                  <div className="mt-auto space-y-1.5 pt-3">
                    {occupied && first ? (
                      <>
                        <p className="text-sm font-semibold">
                          {rounds.length} round{rounds.length > 1 ? 's' : ''} · {formatINR(total)}
                        </p>
                        <div className="flex items-center justify-between gap-2">
                          {focusRound && (
                            <Badge tone={ORDER_STATUS_META[focusRound.status].tone} dot>
                              {focusRound.status === 'delivered'
                                ? 'Bill open'
                                : ORDER_STATUS_META[focusRound.status].label}
                            </Badge>
                          )}
                          <span className="text-xs font-semibold tabular-nums text-ink-500">
                            {elapsedLabel(first.placedAt, now)}
                          </span>
                        </div>
                      </>
                    ) : (
                      <Badge tone="ok" dot>
                        Available
                      </Badge>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </section>
      ))}

      <TableEditor editing={editing} onClose={() => setEditing(null)} />
      <TableBillSheet tableId={billTableId} onClose={() => setBillTableId(null)} />
    </div>
  )
}

/* ----------------------------- Running bill ------------------------------ */

type DiscountChoice = 'none' | '5' | '10' | '15' | 'flat'

function TableBillSheet({ tableId, onClose }: { tableId: string | null; onClose: () => void }) {
  const tables = useAppStore((s) => s.db.tables)
  const orders = useAppStore((s) => s.db.orders)
  const bills = useAppStore((s) => s.db.bills)
  const settings = useAppStore((s) => s.db.settings)
  const session = useAppStore((s) => s.session)
  const navigate = useNavigate()
  const pushToast = useToasts((s) => s.push)

  const [payment, setPayment] = useState<PaymentMethod>('cash')
  const [discountChoice, setDiscountChoice] = useState<DiscountChoice>('none')
  const [flatValue, setFlatValue] = useState('')
  const [redeem, setRedeem] = useState(false)
  const [voiding, setVoiding] = useState<Order | null>(null)
  const [voidReason, setVoidReason] = useState('')

  // Fresh sheet per table opening.
  useEffect(() => {
    setPayment('cash')
    setDiscountChoice('none')
    setFlatValue('')
    setRedeem(false)
    setVoiding(null)
    setVoidReason('')
  }, [tableId])

  const table = tables.find((t) => t.id === tableId)
  const rounds = table ? activeOrdersForTable(orders, table.id) : []
  const first = rounds[0]

  const discount: BillDiscount | undefined =
    discountChoice === 'none'
      ? undefined
      : discountChoice === 'flat'
        ? { type: 'flat', value: Number(flatValue) || 0 }
        : { type: 'percent', value: Number(discountChoice) }

  const profile = first?.customerPhone ? customerByPhone(bills, first.customerPhone) : undefined
  const availablePoints = profile?.pointsBalance ?? 0

  const preview = computeBillPreview({
    rounds,
    settings,
    discount,
    redeemPoints: redeem ? availablePoints : 0,
    availablePoints,
    hasCustomer: Boolean(first?.customerPhone),
  })

  const pendingInKitchen = rounds.filter((o) => o.status !== 'delivered')
  const canSettle = rounds.length > 0 && pendingInKitchen.length === 0

  const settle = () => {
    if (!table || !session || !canSettle) return
    const bill = billService.settleTable({
      tableId: table.id,
      paymentMethod: payment,
      session,
      discount,
      redeemPoints: redeem ? availablePoints : 0,
    })
    if (bill) {
      pushToast(
        `Bill #${bill.billNumber} · ${formatINR(bill.total)} by ${PAYMENT_METHOD_META[bill.paymentMethod].label}${bill.pointsEarned > 0 ? ` · +${bill.pointsEarned} pts` : ''} · ${table.name} is free`,
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
          {/* Discount */}
          <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Discount">
            <span className="mr-1 text-xs font-bold uppercase tracking-wide text-ink-500">Discount</span>
            {(['none', '5', '10', '15'] as const).map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={discountChoice === c}
                onClick={() => setDiscountChoice(c)}
                className={cn(
                  'h-8 rounded-lg px-2.5 text-xs font-bold transition-colors',
                  discountChoice === c ? 'bg-ink-900 text-white' : 'bg-cream-100 text-ink-700 hover:bg-cream-200',
                )}
              >
                {c === 'none' ? 'None' : `${c}%`}
              </button>
            ))}
            <button
              type="button"
              role="radio"
              aria-checked={discountChoice === 'flat'}
              onClick={() => setDiscountChoice('flat')}
              className={cn(
                'h-8 rounded-lg px-2.5 text-xs font-bold transition-colors',
                discountChoice === 'flat' ? 'bg-ink-900 text-white' : 'bg-cream-100 text-ink-700 hover:bg-cream-200',
              )}
            >
              ₹
            </button>
            {discountChoice === 'flat' && (
              <input
                type="number"
                min={0}
                value={flatValue}
                onChange={(e) => setFlatValue(e.target.value)}
                aria-label="Flat discount amount"
                className="h-8 w-20 rounded-lg border border-cream-300 px-2 text-sm tabular-nums focus:border-accent-500 focus:outline-none"
              />
            )}
          </div>

          {/* Loyalty redemption */}
          {settings.loyalty.enabled && availablePoints > 0 && (
            <button
              type="button"
              onClick={() => setRedeem((r) => !r)}
              aria-pressed={redeem}
              className={cn(
                'flex w-full items-center justify-between rounded-xl border-2 px-3 py-2 text-sm font-semibold transition-colors',
                redeem ? 'border-ok-600 bg-ok-100 text-ok-600' : 'border-cream-300 bg-white text-ink-700 hover:border-cream-400',
              )}
            >
              <span className="flex items-center gap-2">
                <Sparkles className="size-4" /> Redeem {preview.maxRedeemablePoints} pts
              </span>
              <span className="tabular-nums">−{formatINR(preview.maxRedeemablePoints * settings.loyalty.rupeesPerPoint)}</span>
            </button>
          )}

          {/* Totals */}
          <div className="space-y-1 text-sm">
            <div className="flex justify-between text-ink-500">
              <span>Subtotal</span>
              <span className="tabular-nums">{formatINR(preview.subtotal)}</span>
            </div>
            {preview.discountAmount > 0 && (
              <div className="flex justify-between font-semibold text-ok-600">
                <span>Discount</span>
                <span className="tabular-nums">−{formatINR(preview.discountAmount)}</span>
              </div>
            )}
            <div className="flex justify-between text-ink-500">
              <span>
                {settings.taxLabel} ({settings.taxRatePercent}%)
              </span>
              <span className="tabular-nums">{formatINR(preview.taxAmount)}</span>
            </div>
            {preview.pointsValueRedeemed > 0 && (
              <div className="flex justify-between font-semibold text-ok-600">
                <span>Points ({preview.pointsRedeemed})</span>
                <span className="tabular-nums">−{formatINR(preview.pointsValueRedeemed)}</span>
              </div>
            )}
            <div className="flex justify-between pt-1 text-lg font-bold">
              <span>To pay</span>
              <span className="tabular-nums">{formatINR(preview.total)}</span>
            </div>
            {preview.pointsToEarn > 0 && (
              <p className="text-right text-xs font-semibold text-accent-600">earns +{preview.pointsToEarn} pts</p>
            )}
          </div>

          {/* Payment method */}
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Payment method">
            {PAYMENT_METHODS.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={payment === m}
                onClick={() => setPayment(m)}
                className={cn(
                  'flex h-12 items-center justify-center gap-2 rounded-xl border-2 text-sm font-bold transition-colors',
                  payment === m
                    ? 'border-accent-500 bg-accent-50 text-accent-600'
                    : 'border-cream-300 bg-white text-ink-700 hover:border-cream-400',
                )}
              >
                <span aria-hidden>{PAYMENT_METHOD_META[m].icon}</span> {PAYMENT_METHOD_META[m].label}
              </button>
            ))}
          </div>

          <Button size="lg" className="w-full" disabled={!canSettle} onClick={settle}>
            <ReceiptIndianRupee className="size-5" /> Take payment · {formatINR(preview.total)}
          </Button>
          {!canSettle && rounds.length > 0 && (
            <p className="text-center text-xs font-semibold text-warn-600">
              {pendingInKitchen.length} round{pendingInKitchen.length > 1 ? 's' : ''} still with the
              kitchen — settle once everything is delivered.
            </p>
          )}
        </div>
      }
    >
      {first?.customerName && (
        <p className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <User className="size-4 text-ink-300" />
          {first.customerName}
          {first.customerPhone && <span className="font-normal text-ink-500">· {first.customerPhone}</span>}
        </p>
      )}
      {profile && settings.loyalty.enabled && (
        <p className="mb-3 text-xs text-ink-500">
          {profile.visits} previous visit{profile.visits > 1 ? 's' : ''} · {availablePoints} pts balance
        </p>
      )}

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
          <RoundCard key={round.id} round={round} index={i + 1} onVoid={() => setVoiding(round)} />
        ))}
      </div>

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

function RoundCard({ round, index, onVoid }: { round: Order; index: number; onVoid: () => void }) {
  const meta = ORDER_STATUS_META[round.status]
  return (
    <div className="rounded-xl border border-cream-200 p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-sm font-bold">
          Round {index} <span className="font-normal text-ink-500">· #{round.orderNumber}</span>
        </p>
        <Badge tone={meta.tone} dot>
          {meta.label}
        </Badge>
      </div>
      <p className="text-xs text-ink-500">
        {round.items
          .filter((i) => i.status !== 'cancelled')
          .map((i) => `${i.quantity}× ${i.name}`)
          .join(', ')}
      </p>
      <div className="mt-1.5 flex items-center justify-between">
        {round.status === 'delivered' ? (
          <button type="button" onClick={onVoid} className="text-xs font-semibold text-danger-600 hover:underline">
            Void round
          </button>
        ) : (
          <span />
        )}
        <p className="text-right text-sm font-bold tabular-nums">{formatINR(round.total)}</p>
      </div>
    </div>
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
