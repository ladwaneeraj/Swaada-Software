import { Pencil, Plus, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '@/components/layout/AdminLayout'
import { Badge, Button, Field, Input, Modal, Toggle } from '@/components/ui'
import { TABLE_STATUS_META, ORDER_STATUS_META } from '@/lib/statusMeta'
import { byDisplayOrder, cn, elapsedLabel, formatINR } from '@/lib/utils'
import { useNow } from '@/lib/useNow'
import { activeOrderForTable, tableService } from '@/services'
import { useAppStore } from '@/store/useAppStore'
import type { CafeTable } from '@/types'

/**
 * Floor view: every table's live status at a glance. Tapping an available
 * table starts an order; tapping an occupied one jumps to its live order.
 */
export function TablesPage() {
  const tables = useAppStore((s) => s.db.tables)
  const orders = useAppStore((s) => s.db.orders)
  const navigate = useNavigate()
  const now = useNow()

  const [editing, setEditing] = useState<CafeTable | 'new' | null>(null)

  const zones = useMemo(() => {
    const active = tables.filter((t) => t.isActive).sort(byDisplayOrder)
    const map = new Map<string, CafeTable[]>()
    active.forEach((t) => {
      map.set(t.zone, [...(map.get(t.zone) ?? []), t])
    })
    return [...map.entries()]
  }, [tables])

  const occupiedCount = tables.filter((t) => t.isActive && activeOrderForTable(orders, t.id)).length

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
              const order = activeOrderForTable(orders, table.id)
              const status = order ? 'occupied' : 'available'
              const meta = TABLE_STATUS_META[status]
              return (
                <button
                  key={table.id}
                  type="button"
                  onClick={() =>
                    order
                      ? navigate(`/admin/orders?focus=${order.id}`)
                      : navigate(`/admin/take-order/${table.id}`)
                  }
                  className={cn(
                    'group relative flex min-h-36 flex-col rounded-card border-2 bg-white p-4 text-left shadow-card transition-all hover:-translate-y-0.5 hover:shadow-pop',
                    order ? 'border-warn-600/40' : 'border-transparent',
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

                  <div className="mt-auto space-y-1.5 pt-3">
                    {order ? (
                      <>
                        <p className="text-sm font-semibold">
                          #{order.orderNumber} · {formatINR(order.total)}
                        </p>
                        <div className="flex items-center justify-between gap-2">
                          <Badge tone={ORDER_STATUS_META[order.status].tone} dot>
                            {ORDER_STATUS_META[order.status].label}
                          </Badge>
                          <span className="text-xs font-semibold tabular-nums text-ink-500">
                            {elapsedLabel(order.placedAt, now)}
                          </span>
                        </div>
                      </>
                    ) : (
                      <Badge tone={meta.tone} dot>
                        {meta.label}
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
    </div>
  )
}

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
