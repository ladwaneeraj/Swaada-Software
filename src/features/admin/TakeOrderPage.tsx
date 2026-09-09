import { ArrowLeft, Minus, Plus, Search, ShoppingBag, SlidersHorizontal, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { CustomerSheet, GuestChip, useAccount } from '@/components/customer/CustomerBits'
import { useToasts } from '@/components/toast'
import { Button, Card, Modal, Textarea, VegMark } from '@/components/ui'
import { assetUrl, byDisplayOrder, cn, formatINR } from '@/lib/utils'
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
 * Order-taking screen, laid out as a billing terminal: categories on the
 * left, the menu in the middle, the running bill on the right.
 *
 * Speed rules:
 *  - tapping an item adds it immediately with its default options
 *  - the slider icon opens the options sheet when a choice matters
 *  - quantities are corrected in the bill, not on the menu
 *  - "/" focuses search, Enter adds the first match, Esc clears it
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
  const [searchParams, setSearchParams] = useSearchParams()
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

  // Round 1 carries the guest chosen on the tables screen (?customer=...);
  // later rounds inherit whoever is already attached to the sitting.
  const customerId = existingRounds[0]?.customerId ?? searchParams.get('customer') ?? undefined
  const account = useAccount(customerId)

  const [query, setQuery] = useState('')
  const [activeCategoryId, setActiveCategoryId] = useState<ID | 'all'>('all')
  const [lines, setLines] = useState<CartLine[]>([])
  const [sheet, setSheet] = useState<{ item: MenuItem; editingKey?: string } | null>(null)
  const [cartOpen, setCartOpen] = useState(false)
  const [changingGuest, setChangingGuest] = useState(false)
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

  /** True when a required option group can push the price up ("from ₹209"). */
  const pricedFrom = useCallback(
    (item: MenuItem) =>
      item.modifierGroupIds.some((gid) => {
        const g = groupsById.get(gid)
        return g?.required && optionsForGroup(modifierOptions, gid).some((o) => o.priceAdjustment > 0)
      }),
    [groupsById, modifierOptions],
  )

  const qtyByItem = useMemo(() => {
    const map = new Map<ID, number>()
    lines.forEach((l) => map.set(l.menuItem.id, (map.get(l.menuItem.id) ?? 0) + l.quantity))
    return map
  }, [lines])

  const cartCount = lines.reduce((n, l) => n + l.quantity, 0)
  const total = lines.reduce(
    (sum, l) =>
      sum + (l.menuItem.basePrice + l.modifiers.reduce((s, m) => s + m.option.priceAdjustment, 0)) * l.quantity,
    0,
  )

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
      customerId,
    })
    pushToast(`Round ${roundNumber} · order #${order.orderNumber} sent to kitchen`, 'ok')
    navigate('/admin/tables')
  }

  // Who the sitting belongs to, shown where the bill is built so the
  // cashier can see the guest's balance before a single item is added.
  const customerSlot = account ? (
    <div className="border-t border-surface-200 py-2.5">
      <GuestChip account={account} onChange={() => setChangingGuest(true)} />
    </div>
  ) : settings.askCustomerInfo && roundNumber === 1 ? (
    <div className="border-t border-surface-200 py-2.5">
      <button
        type="button"
        onClick={() => setChangingGuest(true)}
        className="w-full rounded-xl border border-dashed border-surface-300 py-2 text-[12px] font-semibold text-ink-500 transition-colors hover:border-accent-500 hover:text-accent-600"
      >
        + Add guest
      </button>
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

  const menuBody =
    visibleItems.length === 0 ? (
      <p className="py-16 text-center text-sm text-ink-500">No items match “{query}”.</p>
    ) : query.trim() || activeCategoryId !== 'all' ? (
      <ItemGrid
        items={visibleItems}
        qtyByItem={qtyByItem}
        pricedFrom={pricedFrom}
        onAdd={quickAdd}
        onCustomize={(item) => setSheet({ item })}
      />
    ) : (
      // "All items" keeps the menu's own order and labels each run, so the
      // list reads like the printed menu instead of one undifferentiated wall.
      activeCategories.map((c) => {
        const list = itemsForCategory(orderableItems, c.id)
        if (list.length === 0) return null
        return (
          <section key={c.id} className="mb-3">
            <h3 className="sticky top-0 z-10 -mx-0.5 mb-2 bg-surface-100/90 px-0.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-500 backdrop-blur">
              <span aria-hidden>{c.icon}</span> {c.name}
            </h3>
            <ItemGrid
              items={list}
              qtyByItem={qtyByItem}
              pricedFrom={pricedFrom}
              onAdd={quickAdd}
              onCustomize={(item) => setSheet({ item })}
            />
          </section>
        )
      })
    )

  return (
    <div className="flex flex-col gap-3 xl:h-[calc(100dvh-6.25rem)] xl:flex-row">
      {/* --------------------------- Category rail -------------------------- */}
      <aside className="hidden w-44 shrink-0 xl:flex xl:flex-col">
        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <p className="border-b border-surface-200 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-500">
            Categories
          </p>
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5" role="tablist" aria-label="Categories">
            <CategoryRow
              label="All items"
              icon="✦"
              count={orderableItems.length}
              active={activeCategoryId === 'all' && !query.trim()}
              onClick={() => {
                setActiveCategoryId('all')
                setQuery('')
              }}
            />
            {activeCategories.map((c) => (
              <CategoryRow
                key={c.id}
                label={c.name}
                icon={c.icon}
                count={itemsForCategory(orderableItems, c.id).length}
                active={activeCategoryId === c.id && !query.trim()}
                onClick={() => {
                  setActiveCategoryId(c.id)
                  setQuery('')
                }}
              />
            ))}
          </div>
        </Card>
      </aside>

      {/* ------------------------------- Menu ------------------------------- */}
      <div className="flex min-w-0 flex-1 flex-col gap-2.5 pb-24 xl:min-h-0 xl:pb-0">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate('/admin/tables')}
            aria-label="Back to tables"
            className="grid size-10 shrink-0 place-items-center rounded-control bg-white shadow-card ring-1 ring-surface-200 transition-all hover:shadow-lift"
          >
            <ArrowLeft className="size-4" />
          </button>
          <h1 className="shrink-0 text-sm font-bold">
            Table {table.name}
            <span className="ml-1.5 text-xs font-normal text-ink-500">
              round {roundNumber}
              {roundNumber > 1 && ` · so far ${formatINR(billSoFar)}`}
            </span>
          </h1>
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-300" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && visibleItems[0]) quickAdd(visibleItems[0])
                if (e.key === 'Escape') setQuery('')
              }}
              placeholder="Search the menu…  ( / )"
              aria-label="Search menu"
              className="h-10 w-full rounded-control border border-surface-200 bg-white pl-9 pr-3 text-[13px] shadow-card transition-shadow placeholder:text-ink-300 focus:border-accent-500 focus:outline-none focus:ring-4 focus:ring-accent-500/10"
            />
          </div>
        </div>

        {/* Categories as chips below the rail's breakpoint */}
        <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 xl:hidden" role="tablist" aria-label="Categories">
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

        <div className="min-h-0 flex-1 xl:overflow-y-auto xl:pr-1">{menuBody}</div>
      </div>

      {/* ------------------------------- Bill ------------------------------- */}
      <aside className="hidden w-[21rem] shrink-0 xl:flex xl:flex-col">
        <BillPanel
          lines={lines}
          tableName={table.name}
          roundNumber={roundNumber}
          customerSlot={customerSlot}
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
      </aside>

      {/* Bill as a bottom bar + sheet on smaller screens */}
      {cartCount > 0 && (
        <div className="fixed inset-x-4 bottom-4 z-40 xl:hidden">
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="flex h-13 w-full items-center justify-between rounded-2xl bg-gradient-to-b from-accent-500 to-accent-600 px-5 text-white shadow-pop"
          >
            <span className="flex items-center gap-2 text-sm font-bold">
              <ShoppingBag className="size-4" /> {cartCount} item{cartCount > 1 ? 's' : ''}
            </span>
            <span className="text-sm font-bold tabular-nums">{formatINR(total)}</span>
          </button>
        </div>
      )}

      <Modal open={cartOpen} onClose={() => setCartOpen(false)} title={`Table ${table.name} · round ${roundNumber}`} position="sheet">
        <BillPanel
          bare
          lines={lines}
          tableName={table.name}
          roundNumber={roundNumber}
          customerSlot={customerSlot}
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
      <CustomerSheet
        open={changingGuest}
        onClose={() => setChangingGuest(false)}
        title={table ? `Table ${table.name} · guest` : 'Guest'}
        actionLabel="Use this guest"
        skipLabel={account ? 'Remove guest' : 'No guest'}
        onPick={(picked) => {
          setChangingGuest(false)
          if (!table) return
          // Rounds already placed carry the guest; a sitting that has not
          // started yet only needs the URL to change.
          if (existingRounds.length > 0) orderService.setSittingCustomer(table.id, picked?.id ?? null)
          else setSearchParams(picked ? { customer: picked.id } : {}, { replace: true })
        }}
      />

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

/* ------------------------------ Categories ------------------------------- */

function CategoryRow({
  label,
  icon,
  count,
  active,
  onClick,
}: {
  label: string
  icon: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[13px] font-semibold transition-all duration-150',
        active
          ? 'bg-gradient-to-b from-accent-500 to-accent-600 text-white shadow-accent'
          : 'text-ink-700 hover:bg-surface-100',
      )}
    >
      <span aria-hidden className="text-sm">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className={cn('text-[11px] tabular-nums', active ? 'text-white/75' : 'text-ink-300')}>{count}</span>
    </button>
  )
}

function CategoryChip({ label, icon, active, onClick }: { label: string; icon: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold transition-all',
        active ? 'bg-gradient-to-b from-accent-500 to-accent-600 text-white shadow-accent' : 'bg-white text-ink-700 shadow-card ring-1 ring-surface-200',
      )}
    >
      <span aria-hidden className="text-sm">
        {icon}
      </span>
      {label}
    </button>
  )
}

/* ------------------------------- Item tiles ------------------------------ */

function ItemGrid({
  items,
  qtyByItem,
  pricedFrom,
  onAdd,
  onCustomize,
}: {
  items: MenuItem[]
  qtyByItem: Map<ID, number>
  pricedFrom: (item: MenuItem) => boolean
  onAdd: (item: MenuItem) => void
  onCustomize: (item: MenuItem) => void
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-1.5 sm:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))]">
      {items.map((item) => (
        <ItemTile
          key={item.id}
          item={item}
          qtyInCart={qtyByItem.get(item.id) ?? 0}
          hasPricedSize={pricedFrom(item)}
          onAdd={() => onAdd(item)}
          onCustomize={() => onCustomize(item)}
        />
      ))}
    </div>
  )
}

/**
 * One menu item. Tapping the tile adds it straight away with its default
 * options, which is what makes punching an order fast; the pencil opens the
 * options sheet for the times that matters, and quantities are corrected in
 * the bill on the right.
 */
function ItemTile({
  item,
  qtyInCart,
  hasPricedSize,
  onAdd,
  onCustomize,
}: {
  item: MenuItem
  qtyInCart: number
  hasPricedSize: boolean
  onAdd: () => void
  onCustomize: () => void
}) {
  const unavailable = item.availability !== 'available'
  const customizable = item.modifierGroupIds.length > 0
  const [imageBroken, setImageBroken] = useState(false)
  const showImage = Boolean(item.image) && !imageBroken

  return (
    <div
      className={cn(
        'group relative flex items-stretch overflow-hidden rounded-xl bg-white shadow-card ring-1 transition-all duration-150',
        unavailable
          ? 'opacity-55 ring-surface-200'
          : 'ring-surface-200 hover:-translate-y-0.5 hover:shadow-lift hover:ring-accent-500/50',
        qtyInCart > 0 && 'bg-accent-50 ring-accent-500',
      )}
    >
      <button
        type="button"
        onClick={onAdd}
        disabled={unavailable}
        className="flex min-w-0 flex-1 items-center gap-2.5 p-2 text-left"
        aria-label={`Add ${item.name}`}
      >
        {showImage && item.image ? (
          <img
            src={assetUrl(item.image)}
            alt=""
            loading="lazy"
            onError={() => setImageBroken(true)}
            className={cn(
              'size-10 shrink-0 rounded-lg bg-surface-100',
              item.image.endsWith('.svg') ? 'object-contain p-0.5' : 'object-cover',
            )}
          />
        ) : (
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-100 text-ink-300" aria-hidden>
            <VegMark isVeg={item.isVegetarian} className="size-3.5" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-start gap-1">
            {showImage && <VegMark isVeg={item.isVegetarian} className="mt-px size-3 shrink-0" />}
            <span className="line-clamp-2 text-[12px] font-semibold leading-tight">{item.name}</span>
          </span>
          <span className="mt-0.5 block text-[12px] font-bold tabular-nums">
            {hasPricedSize && <span className="font-normal text-ink-500">from </span>}
            {formatINR(item.basePrice)}
          </span>
        </span>
      </button>

      {unavailable ? (
        <span className="grid w-7 shrink-0 place-items-center bg-surface-100 text-[9px] font-bold uppercase text-ink-300">
          Out
        </span>
      ) : (
        <span className="flex w-7 shrink-0 flex-col items-center justify-center gap-1">
          {qtyInCart > 0 && (
            <span className="grid size-5 place-items-center rounded-full bg-accent-500 text-[10px] font-bold text-white tabular-nums">
              {qtyInCart}
            </span>
          )}
          {customizable && (
            <button
              type="button"
              onClick={onCustomize}
              title={`Options for ${item.name}`}
              aria-label={`Options for ${item.name}`}
              className="grid size-5 place-items-center rounded-md text-ink-300 transition-colors hover:bg-surface-200 hover:text-ink-700"
            >
              <SlidersHorizontal className="size-3" />
            </button>
          )}
        </span>
      )}
    </div>
  )
}

/* -------------------------------- Bill panel ----------------------------- */

function BillPanel({
  bare = false,
  lines,
  tableName,
  roundNumber,
  customerSlot,
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
  total: number
  onEdit: (line: CartLine) => void
  onRemove: (line: CartLine) => void
  onQty: (line: CartLine, delta: number) => void
  onPlace: () => void
}) {
  const count = lines.reduce((n, l) => n + l.quantity, 0)
  const body = (
    <>
      {!bare && (
        <div className="flex items-baseline justify-between gap-2 border-b border-surface-200 px-3.5 py-3">
          <p className="text-[13px] font-bold">
            Table {tableName} <span className="font-normal text-ink-500">· round {roundNumber}</span>
          </p>
          <p className="text-[11px] text-ink-500">{count === 0 ? 'empty' : `${count} item${count > 1 ? 's' : ''}`}</p>
        </div>
      )}

      {/* Column headings turn the running order into something that reads
          like the bill it becomes. */}
      <div className={cn('flex items-center gap-2 border-b border-surface-200 bg-surface-100/70 py-2 text-[10px] font-bold uppercase tracking-[0.1em] text-ink-500', bare ? 'px-1' : 'px-3.5')}>
        <span className="flex-1">Item</span>
        <span className="w-[4.5rem] text-center">Qty</span>
        <span className="w-14 text-right">Amount</span>
        <span className="w-5" />
      </div>

      <div className={cn('min-h-0 flex-1 overflow-y-auto', bare ? 'px-1' : 'px-3.5')}>
        {lines.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-ink-500">Tap items to build the order.</p>
        ) : (
          lines.map((line) => {
            const unit = line.menuItem.basePrice + line.modifiers.reduce((s, m) => s + m.option.priceAdjustment, 0)
            return (
              <div key={line.key} className="flex items-center gap-2 border-b border-surface-200 py-1.5 last:border-0">
                <button type="button" onClick={() => onEdit(line)} className="min-w-0 flex-1 text-left">
                  <span className="flex items-center gap-1.5">
                    <VegMark isVeg={line.menuItem.isVegetarian} className="size-3 shrink-0" />
                    <span className="truncate text-[12px] font-semibold">{line.menuItem.name}</span>
                  </span>
                  {(line.modifiers.length > 0 || line.specialInstructions) && (
                    <span className="mt-0.5 block truncate text-[10px] text-ink-500">
                      {[...line.modifiers.map((m) => m.option.name), line.specialInstructions].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </button>

                <div className="flex w-[4.5rem] shrink-0 items-center justify-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => onQty(line, -1)}
                    aria-label={`One less ${line.menuItem.name}`}
                    className="grid size-6 place-items-center rounded-lg bg-white text-ink-500 shadow-card ring-1 ring-surface-200 transition-all hover:text-ink-900 hover:shadow-lift"
                  >
                    <Minus className="size-3" />
                  </button>
                  <span className="w-5 text-center text-[12px] font-bold tabular-nums">{line.quantity}</span>
                  <button
                    type="button"
                    onClick={() => onQty(line, 1)}
                    aria-label={`One more ${line.menuItem.name}`}
                    className="grid size-6 place-items-center rounded-lg bg-white text-ink-500 shadow-card ring-1 ring-surface-200 transition-all hover:text-ink-900 hover:shadow-lift"
                  >
                    <Plus className="size-3" />
                  </button>
                </div>

                <span className="w-14 shrink-0 text-right text-[12px] font-bold tabular-nums">
                  {formatINR(unit * line.quantity)}
                </span>
                <button
                  type="button"
                  onClick={() => onRemove(line)}
                  aria-label={`Remove ${line.menuItem.name}`}
                  className="grid size-5 shrink-0 place-items-center rounded-md text-ink-300 transition-colors hover:bg-danger-100 hover:text-danger-600"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            )
          })
        )}
      </div>

      <div className={cn('border-t border-surface-200 bg-surface-100/50', bare ? 'pt-2' : 'px-3.5 pb-3.5 pt-2')}>
        {customerSlot}
        <div className="flex items-baseline justify-between py-2">
          <span className="text-[13px] font-bold">Round total</span>
          <span className="text-lg font-bold tabular-nums">{formatINR(total)}</span>
        </div>
        <Button size="lg" className="w-full" disabled={lines.length === 0} onClick={onPlace}>
          Place order · {formatINR(total)}
        </Button>
      </div>
    </>
  )
  if (bare) return <div className="flex flex-col">{body}</div>
  return <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">{body}</Card>
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
          <div className="flex items-center gap-1 rounded-xl bg-surface-100 p-1">
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
                        : 'border-surface-300 bg-white text-ink-700 hover:border-surface-400',
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
