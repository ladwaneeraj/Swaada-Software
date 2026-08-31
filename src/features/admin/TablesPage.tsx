import { Pencil, Plus, ReceiptIndianRupee, User, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '@/components/layout/AdminLayout'
import { useToasts } from '@/components/toast'
import { Badge, Button, Field, Input, Modal, Toggle } from '@/components/ui'
import { ORDER_STATUS_META, PAYMENT_METHOD_META } from '@/lib/statusMeta'
import { byDisplayOrder, cn, elapsedLabel, formatINR } from '@/lib/utils'
import { useNow } from '@/lib/useNow'
import { activeOrdersForTable, billService, tableService } from '@/services'
import { useAppStore } from '@/store/useAppStore'
import type { CafeTable, Order, PaymentMethod } from '@/types'
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

function TableBillSheet({ tableId, onClose }: { tableId: string | null; onClose: () => void }) {
  const tables = useAppStore((s) => s.db.tables)
  const orders = useAppStore((s) => s.db.orders)
  const session = useAppStore((s) => s.session)
  const navigate = useNavigate()
  const pushToast = useToasts((s) => s.push)
  const [payment, setPayment] = useState<PaymentMethod>('cash')

  const table = tables.find((t) => t.id === tableId)
  const rounds = table ? activeOrdersForTable(orders, table.id) : []
  const first = rounds[0]

  const subtotal = rounds.reduce((s, o) => s + o.subtotal, 0)
  const taxAmount = rounds.reduce((s, o) => s + o.taxAmount, 0)
  const total = rounds.reduce((s, o) => s + o.total, 0)
  const pendingInKitchen = rounds.filter((o) => o.status !== 'delivered')
  const canSettle = rounds.length > 0 && pendingInKitchen.length === 0

  const settle = () => {
    if (!table || !session || !canSettle) return
    const bill = billService.settleTable({ tableId: table.id, paymentMethod: payment, session })
    if (bill) {
      pushToast(
        `Bill #${bill.billNumber} · ${formatINR(bill.total)} paid by ${PAYMENT_METHOD_META[bill.paymentMethod].label} · ${table.name} is free`,
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
          <div className="flex justify-between text-sm text-ink-500">
            <span>Subtotal</span>
            <span className="tabular-nums">{formatINR(subtotal)}</span>
          </div>
          <div className="flex justify-between text-sm text-ink-500">
            <span>
              {first?.taxLabel ?? 'Tax'} ({first?.taxRatePercent ?? 0}%)
            </span>
            <span className="tabular-nums">{formatINR(taxAmount)}</span>
          </div>
          <div className="flex justify-between text-lg font-bold">
            <span>To pay</span>
            <span className="tabular-nums">{formatINR(total)}</span>
          </div>

          {/* Payment method — shown when payment is being taken */}
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
            <ReceiptIndianRupee className="size-5" /> Take payment · {formatINR(total)}
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
        <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <User className="size-4 text-ink-300" />
          {first.customerName}
          {first.customerPhone && <span className="font-normal text-ink-500">· {first.customerPhone}</span>}
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
          <RoundCard key={round.id} round={round} index={i + 1} />
        ))}
      </div>
    </Modal>
  )
}

function RoundCard({ round, index }: { round: Order; index: number }) {
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
      <p className="mt-1.5 text-right text-sm font-bold tabular-nums">{formatINR(round.total)}</p>
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
