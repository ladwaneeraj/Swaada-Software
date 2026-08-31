import { ArrowLeft, Minus, Plus, Search, ShoppingBag, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useToasts } from '@/components/toast'
import { Badge, Button, Card, Input, Modal, Textarea, VegMark } from '@/components/ui'
import { byDisplayOrder, cn, formatINR } from '@/lib/utils'
import {
  itemsForCategory,
  optionsForGroup,
  orderService,
  searchMenu,
  sortedActiveCategories,
  activeOrdersForTable,
  type CartModifierSelection,
} from '@/services'
import { useAppStore } from '@/store/useAppStore'
import type { ID, MenuItem, ModifierGroup, ModifierOption } from '@/types'

/**
 * Order-taking screen, optimised for speed:
 *  - ADD on a card adds instantly with default selections
 *  - tapping the card body opens the customization sheet
 *  - "/" focuses search, Enter adds the first match, Esc closes the sheet
 */

interface CartLine {
  key: string
  menuItem: MenuItem
  quantity: number
  modifiers: CartModifierSelection[]
  specialInstructions: string
}

function lineKey(itemId: ID, modifiers: CartModifierSelection[], instructions: string): string {
  const optIds = modifiers.map((m) => m.option.id).sort().join(',')
  return `${itemId}|${optIds}|${instructions.trim()}`
}

export function TakeOrderPage() {
  const { tableId } = useParams<{ tableId: string }>()
  const navigate = useNavigate()
  const pushToast = useToasts((s) => s.push)

  const session = useAppStore((s) => s.session)
  const categories = useAppStore((s) => s.db.categories)
  const items = useAppStore((s) => s.db.items)
  const modifierGroups = useAppStore((s) => s.db.modifierGroups)
  const modifierOptions = useAppStore((s) => s.db.modifierOptions)
  const tables = useAppStore((s) => s.db.tables)
  const orders = useAppStore((s) => s.db.orders)
  const settings = useAppStore((s) => s.db.settings)

  const table = tables.find((t) => t.id === tableId)
  const existingRounds = table ? activeOrdersForTable(orders, table.id) : []
  const roundNumber = existingRounds.length + 1
  const billSoFar = existingRounds.reduce((s, o) => s + o.total, 0)
  const askCustomer = settings.askCustomerInfo && roundNumber === 1

  const [query, setQuery] = useState('')
  const [activeCategoryId, setActiveCategoryId] = useState<ID | 'all'>('all')
  const [lines, setLines] = useState<CartLine[]>([])
  const [sheet, setSheet] = useState<{ item: MenuItem; editingKey?: string } | null>(null)
  const [cartOpen, setCartOpen] = useState(false)
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  const activeCategories = useMemo(() => sortedActiveCategories(categories), [categories])
  const activeCategoryIds = useMemo(() => new Set(activeCategories.map((c) => c.id)), [activeCategories])

  /** Items shown on the order screen: active category, not disabled. */
  const orderableItems = useMemo(
    () => items.filter((i) => i.availability !== 'disabled' && activeCategoryIds.has(i.categoryId)),
    [items, activeCategoryIds],
  )

  const visibleItems = useMemo(() => {
    const searched = searchMenu(orderableItems, activeCategories, query)
    if (query.trim()) return searched // search spans all categories
    if (activeCategoryId === 'all') {
      return activeCategories.flatMap((c) => itemsForCategory(searched, c.id))
    }
    return itemsForCategory(searched, activeCategoryId)
  }, [orderableItems, activeCategories, query, activeCategoryId])

  const groupsById = useMemo(() => new Map(modifierGroups.map((g) => [g.id, g])), [modifierGroups])

  const defaultSelections = useCallback(
    (item: MenuItem): CartModifierSelection[] => {
      const selections: CartModifierSelection[] = []
      for (const groupId of item.modifierGroupIds) {
        const group = groupsById.get(groupId)
        if (!group || !group.required) continue
        const options = optionsForGroup(modifierOptions, group.id).filter((o) => o.isAvailable)
        const pick = options.find((o) => o.isDefault) ?? options[0]
        if (pick) selections.push({ group, option: pick })
      }
      return selections
    },
    [groupsById, modifierOptions],
  )

  const upsertLine = useCallback(
    (item: MenuItem, quantity: number, modifiers: CartModifierSelection[], instructions: string, replaceKey?: string) => {
      const key = lineKey(item.id, modifiers, instructions)
      setLines((prev) => {
        let next = prev
        if (replaceKey && replaceKey !== key) next = next.filter((l) => l.key !== replaceKey)
        const existing = next.find((l) => l.key === key)
        if (existing) {
          const mergedQty = replaceKey && replaceKey !== key ? existing.quantity + quantity : replaceKey ? quantity : existing.quantity + quantity
          return next.map((l) => (l.key === key ? { ...l, quantity: mergedQty, specialInstructions: instructions } : l))
        }
        return [...next, { key, menuItem: item, quantity, modifiers, specialInstructions: instructions }]
      })
    },
    [],
  )

  const quickAdd = useCallback(
    (item: MenuItem) => {
      if (item.availability !== 'available') return
      upsertLine(item, 1, defaultSelections(item), '')
    },
    [defaultSelections, upsertLine],
  )

  const decrementItem = useCallback((itemId: ID) => {
    setLines((prev) => {
      const idx = [...prev].reverse().findIndex((l) => l.menuItem.id === itemId)
      if (idx === -1) return prev
      const realIdx = prev.length - 1 - idx
      const line = prev[realIdx]
      if (!line) return prev
      if (line.quantity <= 1) return prev.filter((_, i) => i !== realIdx)
      return prev.map((l, i) => (i === realIdx ? { ...l, quantity: l.quantity - 1 } : l))
    })
  }, [])

  // Keyboard shortcuts: "/" focuses search, Enter (in search) adds first match.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const qtyByItem = useMemo(() => {
    const map = new Map<ID, number>()
    lines.forEach((l) => map.set(l.menuItem.id, (map.get(l.menuItem.id) ?? 0) + l.quantity))
    return map
  }, [lines])

  const cartCount = lines.reduce((n, l) => n + l.quantity, 0)
  const subtotal = lines.reduce(
    (sum, l) =>
      sum + (l.menuItem.basePrice + l.modifiers.reduce((s, m) => s + m.option.priceAdjustment, 0)) * l.quantity,
    0,
  )
  const taxAmount = (subtotal * settings.taxRatePercent) / 100
  const total = subtotal + taxAmount

  const placeOrder = () => {
    if (!session || !table || lines.length === 0) return
    const order = orderService.placeOrder({
      tableId: table.id,
      lines: lines.map((l) => ({
        menuItem: l.menuItem,
        quantity: l.quantity,
        modifiers: l.modifiers,
        specialInstructions: l.specialInstructions,
      })),
      session,
      customerName: askCustomer ? customerName : undefined,
      customerPhone: askCustomer ? customerPhone : undefined,
    })
    pushToast(`Round ${roundNumber} · order #${order.orderNumber} sent to kitchen`, 'ok')
    navigate('/admin/tables')
  }

  // Optional customer capture on the table's first round (configurable in
  // Settings). Shared by the desktop cart panel and the mobile cart sheet.
  const customerSlot = askCustomer ? (
    <div className="space-y-2 border-t border-cream-200 py-3">
      <p className="text-xs font-bold uppercase tracking-wide text-ink-500">
        Customer <span className="font-normal normal-case">(optional)</span>
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Input
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          placeholder="Name"
          aria-label="Customer name"
          className="h-10 text-sm"
        />
        <Input
          value={customerPhone}
          onChange={(e) => setCustomerPhone(e.target.value)}
          placeholder="Mobile"
          type="tel"
          inputMode="tel"
          maxLength={15}
          aria-label="Customer mobile"
          className="h-10 text-sm"
        />
      </div>
    </div>
  ) : undefined

  if (!table) {
    return (
      <div className="py-20 text-center">
        <p className="text-lg font-bold">Table not found</p>
        <Link to="/admin/tables" className="mt-2 inline-block text-sm font-semibold text-accent-600">
          Back to tables
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5 xl:flex-row">
      {/* ---------------------------- Menu side ---------------------------- */}
      <div className="min-w-0 flex-1 pb-24 xl:pb-0">
        <div className="mb-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/admin/tables')}
            aria-label="Back to tables"
            className="grid size-10 shrink-0 place-items-center rounded-xl bg-white shadow-card hover:bg-cream-50"
          >
            <ArrowLeft className="size-5" />
          </button>
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              Table {table.name} <span className="font-normal text-ink-500">· {table.zone}</span>
            </h1>
            <p className="text-xs text-ink-500">
              Round {roundNumber}
              {roundNumber > 1 && ` · bill so far ${formatINR(billSoFar)}`}
            </p>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-300" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && visibleItems[0]) quickAdd(visibleItems[0])
              if (e.key === 'Escape') setQuery('')
            }}
            placeholder="Search menu…  ( / )"
            aria-label="Search menu"
            className="h-12 w-full rounded-xl border border-cream-300 bg-white pl-10 pr-4 text-[15px] shadow-card placeholder:text-ink-300 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/20"
          />
        </div>

        {/* Category chips */}
        <div className="no-scrollbar -mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Categories">
          <CategoryChip
            label="All"
            icon="✦"
            active={activeCategoryId === 'all' && !query.trim()}
            onClick={() => {
              setActiveCategoryId('all')
              setQuery('')
            }}
          />
          {activeCategories.map((c) => (
            <CategoryChip
              key={c.id}
              label={c.name}
              icon={c.icon}
              active={activeCategoryId === c.id && !query.trim()}
              onClick={() => {
                setActiveCategoryId(c.id)
                setQuery('')
              }}
            />
          ))}
        </div>

        {/* Product grid */}
        {visibleItems.length === 0 ? (
          <p className="py-16 text-center text-sm text-ink-500">No items match “{query}”.</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(8.25rem,1fr))] gap-2 sm:grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] sm:gap-3">
            {visibleItems.map((item) => (
              <ProductCard
                key={item.id}
                item={item}
                categoryIcon={activeCategories.find((c) => c.id === item.categoryId)?.icon ?? '🍽'}
                qtyInCart={qtyByItem.get(item.id) ?? 0}
                hasPricedSize={item.modifierGroupIds.some((gid) => {
                  const g = groupsById.get(gid)
                  return g?.required && optionsForGroup(modifierOptions, gid).some((o) => o.priceAdjustment > 0)
                })}
                onQuickAdd={() => quickAdd(item)}
                onDecrement={() => decrementItem(item.id)}
                onCustomize={() => item.availability === 'available' && setSheet({ item })}
              />
            ))}
          </div>
        )}
      </div>

      {/* ---------------------------- Cart side ---------------------------- */}
      <aside className="hidden w-96 shrink-0 xl:block">
        <div className="sticky top-6">
          <CartPanel
            lines={lines}
            tableName={table.name}
            roundNumber={roundNumber}
            customerSlot={customerSlot}
            subtotal={subtotal}
            taxAmount={taxAmount}
            taxLabel={settings.taxLabel}
            taxRate={settings.taxRatePercent}
            total={total}
            onEdit={(l) => setSheet({ item: l.menuItem, editingKey: l.key })}
            onRemove={(l) => setLines((prev) => prev.filter((x) => x.key !== l.key))}
            onQty={(l, d) =>
              setLines((prev) =>
                prev
                  .map((x) => (x.key === l.key ? { ...x, quantity: Math.max(0, x.quantity + d) } : x))
                  .filter((x) => x.quantity > 0),
              )
            }
            onPlace={placeOrder}
          />
        </div>
      </aside>

      {/* Mobile cart bar */}
      {cartCount > 0 && (
        <div className="fixed inset-x-4 bottom-4 z-40 xl:hidden">
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="flex h-14 w-full items-center justify-between rounded-2xl bg-ink-900 px-5 text-white shadow-pop"
          >
            <span className="flex items-center gap-2 text-sm font-bold">
              <ShoppingBag className="size-5" /> {cartCount} item{cartCount > 1 ? 's' : ''}
            </span>
            <span className="text-base font-bold tabular-nums">{formatINR(total)}</span>
          </button>
        </div>
      )}

      <Modal open={cartOpen} onClose={() => setCartOpen(false)} title={`Table ${table.name} · round ${roundNumber}`} position="sheet">
        <CartPanel
          bare
          lines={lines}
          tableName={table.name}
          roundNumber={roundNumber}
          customerSlot={customerSlot}
          subtotal={subtotal}
          taxAmount={taxAmount}
          taxLabel={settings.taxLabel}
          taxRate={settings.taxRatePercent}
          total={total}
          onEdit={(l) => {
            setCartOpen(false)
            setSheet({ item: l.menuItem, editingKey: l.key })
          }}
          onRemove={(l) => setLines((prev) => prev.filter((x) => x.key !== l.key))}
          onQty={(l, d) =>
            setLines((prev) =>
              prev
                .map((x) => (x.key === l.key ? { ...x, quantity: Math.max(0, x.quantity + d) } : x))
                .filter((x) => x.quantity > 0),
            )
          }
          onPlace={() => {
            setCartOpen(false)
            placeOrder()
          }}
        />
      </Modal>

      {/* Customization sheet */}
      {sheet && (
        <CustomizeSheet
          item={sheet.item}
          groups={sheet.item.modifierGroupIds
            .map((gid) => groupsById.get(gid))
            .filter((g): g is ModifierGroup => Boolean(g))
            .sort(byDisplayOrder)}
          allOptions={modifierOptions}
          existing={sheet.editingKey ? lines.find((l) => l.key === sheet.editingKey) : undefined}
          onClose={() => setSheet(null)}
          onConfirm={(qty, selections, instructions) => {
            upsertLine(sheet.item, qty, selections, instructions, sheet.editingKey)
            setSheet(null)
          }}
        />
      )}
    </div>
  )
}

/* ----------------------------- Category chip ----------------------------- */

function CategoryChip({ label, icon, active, onClick }: { label: string; icon: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'flex h-11 shrink-0 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors',
        active ? 'bg-ink-900 text-white shadow-card' : 'bg-white text-ink-700 shadow-card hover:bg-cream-50',
      )}
    >
      <span aria-hidden>{icon}</span>
      {label}
    </button>
  )
}

/* ------------------------------ Product card ----------------------------- */

function ProductCard({
  item,
  categoryIcon,
  qtyInCart,
  hasPricedSize,
  onQuickAdd,
  onDecrement,
  onCustomize,
}: {
  item: MenuItem
  categoryIcon: string
  qtyInCart: number
  hasPricedSize: boolean
  onQuickAdd: () => void
  onDecrement: () => void
  onCustomize: () => void
}) {
  const unavailable = item.availability !== 'available'
  const customizable = item.modifierGroupIds.length > 0
  return (
    <Card testId={`product-${item.id}`} className={cn('relative flex flex-col overflow-hidden', unavailable && 'opacity-60')}>
      <button
        type="button"
        onClick={onCustomize}
        disabled={unavailable}
        className="flex flex-1 flex-col text-left"
        aria-label={customizable ? `Customize ${item.name}` : item.name}
      >
        <div className="relative flex h-12 items-center justify-center bg-gradient-to-br from-cream-100 to-cream-200 text-2xl sm:h-20 sm:text-4xl" aria-hidden>
          {item.image ? (
            <img src={item.image} alt="" className="h-full w-full object-cover" />
          ) : (
            <span>{categoryIcon}</span>
          )}
          <div className="absolute left-2 top-2 hidden gap-1 sm:flex">
            {item.isPopular && <Badge tone="accent">Popular</Badge>}
            {item.isRecommended && <Badge tone="ok">Pick</Badge>}
          </div>
        </div>
        <div className="flex flex-1 flex-col p-2 sm:p-3">
          <p className="flex items-start gap-1.5 text-[13px] font-bold leading-snug sm:text-sm">
            <VegMark isVeg={item.isVegetarian} className="mt-0.5 size-3.5 sm:size-4" />
            {item.name}
          </p>
          <p className="mt-1 line-clamp-2 text-xs text-ink-500 max-sm:hidden">{item.description}</p>
          <p className="mt-auto pt-1.5 text-[13px] font-bold tabular-nums sm:pt-2 sm:text-sm">
            {hasPricedSize && <span className="font-normal text-ink-500">from </span>}
            {formatINR(item.basePrice)}
          </p>
        </div>
      </button>

      <div className="px-2 pb-2 sm:px-3 sm:pb-3">
        {unavailable ? (
          <div className="grid h-9 place-items-center rounded-lg bg-cream-200 text-[11px] font-bold uppercase tracking-wide text-ink-500 sm:h-10 sm:rounded-xl sm:text-xs">
            Unavailable
          </div>
        ) : qtyInCart === 0 ? (
          <Button size="sm" className="h-9 w-full sm:h-10" onClick={onQuickAdd}>
            <Plus className="size-4" /> Add
          </Button>
        ) : (
          <div className="flex h-9 items-center justify-between rounded-lg bg-ink-900 px-1 text-white sm:h-10 sm:rounded-xl">
            <button type="button" onClick={onDecrement} aria-label={`Remove one ${item.name}`} className="grid size-7 place-items-center rounded-md hover:bg-white/10 sm:size-8 sm:rounded-lg">
              <Minus className="size-4" />
            </button>
            <span className="text-sm font-bold tabular-nums">{qtyInCart}</span>
            <button type="button" onClick={onQuickAdd} aria-label={`Add one ${item.name}`} className="grid size-7 place-items-center rounded-md hover:bg-white/10 sm:size-8 sm:rounded-lg">
              <Plus className="size-4" />
            </button>
          </div>
        )}
      </div>
    </Card>
  )
}

/* ------------------------------- Cart panel ------------------------------ */

function CartPanel({
  bare = false,
  lines,
  tableName,
  roundNumber,
  customerSlot,
  subtotal,
  taxAmount,
  taxLabel,
  taxRate,
  total,
  onEdit,
  onRemove,
  onQty,
  onPlace,
}: {
  bare?: boolean
  lines: CartLine[]
  tableName: string
  roundNumber: number
  customerSlot?: React.ReactNode
  subtotal: number
  taxAmount: number
  taxLabel: string
  taxRate: number
  total: number
  onEdit: (line: CartLine) => void
  onRemove: (line: CartLine) => void
  onQty: (line: CartLine, delta: number) => void
  onPlace: () => void
}) {
  const body = (
    <>
      {!bare && (
        <div className="border-b border-cream-200 px-5 py-4">
          <p className="text-base font-bold">
            Table {tableName} <span className="font-normal text-ink-500">· round {roundNumber}</span>
          </p>
          <p className="text-xs text-ink-500">{lines.length === 0 ? 'No items yet' : `${lines.reduce((n, l) => n + l.quantity, 0)} items`}</p>
        </div>
      )}
      <div className={cn('flex-1 overflow-y-auto', bare ? '' : 'max-h-[45vh] px-5', 'py-2')}>
        {lines.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-500">Tap items on the left to build the order.</p>
        ) : (
          lines.map((line) => {
            const unit = line.menuItem.basePrice + line.modifiers.reduce((s, m) => s + m.option.priceAdjustment, 0)
            return (
              <div key={line.key} className="border-b border-cream-100 py-3 last:border-0">
                <div className="flex items-start justify-between gap-2">
                  <button type="button" onClick={() => onEdit(line)} className="min-w-0 text-left">
                    <p className="flex items-center gap-1.5 text-sm font-bold">
                      <VegMark isVeg={line.menuItem.isVegetarian} className="size-3.5" />
                      {line.menuItem.name}
                    </p>
                    {line.modifiers.length > 0 && (
                      <p className="mt-0.5 text-xs text-ink-500">{line.modifiers.map((m) => m.option.name).join(' · ')}</p>
                    )}
                    {line.specialInstructions && (
                      <p className="mt-0.5 text-xs italic text-accent-600">“{line.specialInstructions}”</p>
                    )}
                  </button>
                  <button type="button" onClick={() => onRemove(line)} aria-label={`Remove ${line.menuItem.name}`} className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-300 hover:bg-cream-100 hover:text-danger-600">
                    <Trash2 className="size-4" />
                  </button>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="flex items-center gap-1 rounded-lg bg-cream-100 p-0.5">
                    <button type="button" onClick={() => onQty(line, -1)} aria-label="Decrease quantity" className="grid size-8 place-items-center rounded-md hover:bg-white">
                      <Minus className="size-3.5" />
                    </button>
                    <span className="w-6 text-center text-sm font-bold tabular-nums">{line.quantity}</span>
                    <button type="button" onClick={() => onQty(line, 1)} aria-label="Increase quantity" className="grid size-8 place-items-center rounded-md hover:bg-white">
                      <Plus className="size-3.5" />
                    </button>
                  </div>
                  <span className="text-sm font-bold tabular-nums">{formatINR(unit * line.quantity)}</span>
                </div>
              </div>
            )
          })
        )}
      </div>
      <div className={cn('border-t border-cream-200', bare ? 'pt-2' : 'px-5 pb-4 pt-2')}>
        {customerSlot}
        <div className="space-y-1 pt-2 text-sm">
          <div className="flex justify-between text-ink-500">
            <span>Subtotal</span>
            <span className="tabular-nums">{formatINR(subtotal)}</span>
          </div>
          <div className="flex justify-between text-ink-500">
            <span>
              {taxLabel} ({taxRate}%)
            </span>
            <span className="tabular-nums">{formatINR(taxAmount)}</span>
          </div>
          <div className="flex justify-between pt-1 text-base font-bold">
            <span>Total</span>
            <span className="tabular-nums">{formatINR(total)}</span>
          </div>
        </div>
        <Button size="lg" className="mt-4 w-full" disabled={lines.length === 0} onClick={onPlace}>
          Place order · {formatINR(total)}
        </Button>
      </div>
    </>
  )
  if (bare) return <div className="flex flex-col">{body}</div>
  return <Card className="flex flex-col overflow-hidden">{body}</Card>
}

/* --------------------------- Customization sheet -------------------------- */

function CustomizeSheet({
  item,
  groups,
  allOptions,
  existing,
  onClose,
  onConfirm,
}: {
  item: MenuItem
  groups: ModifierGroup[]
  allOptions: ModifierOption[]
  existing?: CartLine
  onClose: () => void
  onConfirm: (qty: number, selections: CartModifierSelection[], instructions: string) => void
}) {
  const [qty, setQty] = useState(existing?.quantity ?? 1)
  const [instructions, setInstructions] = useState(existing?.specialInstructions ?? '')
  const [selected, setSelected] = useState<Map<ID, Set<ID>>>(() => {
    const map = new Map<ID, Set<ID>>()
    if (existing) {
      existing.modifiers.forEach((m) => {
        map.set(m.group.id, new Set([...(map.get(m.group.id) ?? []), m.option.id]))
      })
    } else {
      groups.forEach((g) => {
        if (!g.required) return
        const opts = optionsForGroup(allOptions, g.id).filter((o) => o.isAvailable)
        const pick = opts.find((o) => o.isDefault) ?? opts[0]
        if (pick) map.set(g.id, new Set([pick.id]))
      })
    }
    return map
  })

  const toggle = (group: ModifierGroup, option: ModifierOption) => {
    setSelected((prev) => {
      const next = new Map(prev)
      const current = new Set(next.get(group.id) ?? [])
      if (group.selectionType === 'single') {
        if (current.has(option.id) && !group.required) current.clear()
        else {
          current.clear()
          current.add(option.id)
        }
      } else if (current.has(option.id)) {
        current.delete(option.id)
      } else if (current.size < group.maxSelections) {
        current.add(option.id)
      }
      next.set(group.id, current)
      return next
    })
  }

  const selections: CartModifierSelection[] = groups.flatMap((g) => {
    const chosen = selected.get(g.id) ?? new Set<ID>()
    return optionsForGroup(allOptions, g.id)
      .filter((o) => chosen.has(o.id))
      .map((option) => ({ group: g, option }))
  })

  const missingRequired = groups.some((g) => g.required && (selected.get(g.id)?.size ?? 0) < Math.max(1, g.minSelections))
  const unit = item.basePrice + selections.reduce((s, m) => s + m.option.priceAdjustment, 0)

  // Enter confirms (unless typing in the instructions box).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName
      if (e.key === 'Enter' && tag !== 'TEXTAREA' && tag !== 'BUTTON' && !missingRequired) {
        onConfirm(qty, selections, instructions.trim())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <Modal
      open
      onClose={onClose}
      title={item.name}
      position="sheet"
      footer={
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 rounded-xl bg-cream-100 p-1">
            <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Decrease quantity" className="grid size-10 place-items-center rounded-lg hover:bg-white">
              <Minus className="size-4" />
            </button>
            <span className="w-8 text-center text-base font-bold tabular-nums">{qty}</span>
            <button type="button" onClick={() => setQty((q) => q + 1)} aria-label="Increase quantity" className="grid size-10 place-items-center rounded-lg hover:bg-white">
              <Plus className="size-4" />
            </button>
          </div>
          <Button size="lg" className="flex-1" disabled={missingRequired} onClick={() => onConfirm(qty, selections, instructions.trim())}>
            {existing ? 'Update' : 'Add'} · {formatINR(unit * qty)}
          </Button>
        </div>
      }
    >
      <div className="mb-4 flex items-start gap-2">
        <VegMark isVeg={item.isVegetarian} className="mt-1" />
        <p className="text-sm text-ink-500">{item.description}</p>
      </div>

      {groups.map((group) => {
        const options = optionsForGroup(allOptions, group.id)
        const chosen = selected.get(group.id) ?? new Set<ID>()
        return (
          <fieldset key={group.id} className="mb-5">
            <legend className="mb-2 flex items-center gap-2 text-sm font-bold">
              {group.name}
              {group.required ? (
                <span className="text-xs font-semibold text-accent-600">Required</span>
              ) : (
                <span className="text-xs font-normal text-ink-500">
                  Optional{group.selectionType === 'multi' ? ` · up to ${group.maxSelections}` : ''}
                </span>
              )}
            </legend>
            <div className="flex flex-wrap gap-2">
              {options.map((option) => {
                const active = chosen.has(option.id)
                return (
                  <button
                    key={option.id}
                    type="button"
                    disabled={!option.isAvailable}
                    aria-pressed={active}
                    onClick={() => toggle(group, option)}
                    className={cn(
                      'flex h-10 items-center gap-1.5 rounded-xl border px-3.5 text-sm font-semibold transition-colors disabled:opacity-40',
                      active
                        ? 'border-accent-500 bg-accent-50 text-accent-600'
                        : 'border-cream-300 bg-white text-ink-700 hover:border-cream-400',
                    )}
                  >
                    {option.name}
                    {option.priceAdjustment > 0 && (
                      <span className={cn('text-xs', active ? 'text-accent-600' : 'text-ink-500')}>
                        +{formatINR(option.priceAdjustment)}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </fieldset>
        )
      })}

      <fieldset>
        <legend className="mb-2 text-sm font-bold">Special instructions</legend>
        <Textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="e.g. Cut sandwich in half"
          maxLength={140}
        />
      </fieldset>
    </Modal>
  )
}
