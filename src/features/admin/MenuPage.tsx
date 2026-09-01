import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PageHeader } from '@/components/layout/AdminLayout'
import { useToasts } from '@/components/toast'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  Segmented,
  Select,
  Textarea,
  Toggle,
  VegMark,
} from '@/components/ui'
import { AVAILABILITY_META } from '@/lib/statusMeta'
import { assetUrl, byDisplayOrder, cn, formatINR } from '@/lib/utils'
import { menuService, searchMenu, type CategoryInput, type MenuItemInput } from '@/services'
import { useAppStore } from '@/store/useAppStore'
import type { Category, ID, ItemAvailability, MenuItem } from '@/types'

/**
 * Menu management: everything about the menu is editable here — items,
 * categories, prices, availability, stations, ordering. One-tap
 * availability changes reach the order screen and kitchen instantly.
 */
export function MenuPage() {
  const [tab, setTab] = useState<'items' | 'categories'>('items')
  return (
    <div>
      <PageHeader
        title="Menu management"
        sub="Categories, items, pricing and availability — all live"
        actions={<Segmented value={tab} onChange={setTab} options={[{ value: 'items', label: 'Items' }, { value: 'categories', label: 'Categories' }]} />}
      />
      {tab === 'items' ? <ItemsTab /> : <CategoriesTab />}
    </div>
  )
}

/* ================================ ITEMS ================================= */

function ItemsTab() {
  const items = useAppStore((s) => s.db.items)
  const categories = useAppStore((s) => s.db.categories)
  const stations = useAppStore((s) => s.db.stations)

  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<ID | 'all'>('all')
  const [availabilityFilter, setAvailabilityFilter] = useState<ItemAvailability | 'all'>('all')
  const [editing, setEditing] = useState<MenuItem | 'new' | null>(null)

  const sortedCategories = useMemo(() => [...categories].sort(byDisplayOrder), [categories])
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  const stationNameById = useMemo(() => new Map(stations.map((s) => [s.id, s.name])), [stations])

  const visible = useMemo(() => {
    let list = searchMenu(items, categories, query)
    if (categoryFilter !== 'all') list = list.filter((i) => i.categoryId === categoryFilter)
    if (availabilityFilter !== 'all') list = list.filter((i) => i.availability === availabilityFilter)
    return [...list].sort((a, b) => {
      const ca = categoryById.get(a.categoryId)?.displayOrder ?? 0
      const cb = categoryById.get(b.categoryId)?.displayOrder ?? 0
      return ca - cb || a.displayOrder - b.displayOrder
    })
  }, [items, categories, query, categoryFilter, availabilityFilter, categoryById])

  const dragEnabled = categoryFilter !== 'all' && !query.trim() && availabilityFilter === 'all'
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id || categoryFilter === 'all') return
    const ids = visible.map((i) => i.id)
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from === -1 || to === -1) return
    menuService.reorderItems(categoryFilter, arrayMove(ids, from, to))
  }

  return (
    <div>
      {/* Controls */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-300" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search items or categories…" className="pl-10" aria-label="Search menu items" />
        </div>
        <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value as ID | 'all')} className="w-44" aria-label="Filter by category">
          <option value="all">All categories</option>
          {sortedCategories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select
          value={availabilityFilter}
          onChange={(e) => setAvailabilityFilter(e.target.value as ItemAvailability | 'all')}
          className="w-40"
          aria-label="Filter by availability"
        >
          <option value="all">Any status</option>
          {(Object.keys(AVAILABILITY_META) as ItemAvailability[]).map((a) => (
            <option key={a} value={a}>
              {AVAILABILITY_META[a].label}
            </option>
          ))}
        </Select>
        <Button onClick={() => setEditing('new')}>
          <Plus className="size-4" /> Add item
        </Button>
      </div>

      <p className="mb-3 text-xs text-ink-500">
        {dragEnabled
          ? 'Drag rows to change the display order within this category.'
          : 'Pick a single category (with no search or status filter) to drag-reorder its items.'}
      </p>

      {visible.length === 0 ? (
        <EmptyState icon="🔍" title="No items match" hint="Try a different search or filter." />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-left text-sm">
              <thead>
                <tr className="border-b border-cream-200 text-xs uppercase tracking-wide text-ink-500">
                  <th className="w-8 px-3 py-3" aria-label="Drag handle" />
                  <th className="px-3 py-3">Item</th>
                  <th className="px-3 py-3">Category</th>
                  <th className="px-3 py-3 text-right">Price</th>
                  <th className="px-3 py-3">Availability</th>
                  <th className="px-3 py-3">Station</th>
                  <th className="w-20 px-3 py-3 text-right">Edit</th>
                </tr>
              </thead>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={visible.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                  <tbody>
                    {visible.map((item) => (
                      <ItemRow
                        key={item.id}
                        item={item}
                        categoryName={categoryById.get(item.categoryId)?.name ?? '—'}
                        stationName={stationNameById.get(item.stationId) ?? '—'}
                        dragEnabled={dragEnabled}
                        onEdit={() => setEditing(item)}
                      />
                    ))}
                  </tbody>
                </SortableContext>
              </DndContext>
            </table>
          </div>
        </Card>
      )}

      {editing && <ItemEditor item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function ItemRow({
  item,
  categoryName,
  stationName,
  dragEnabled,
  onEdit,
}: {
  item: MenuItem
  categoryName: string
  stationName: string
  dragEnabled: boolean
  onEdit: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: !dragEnabled,
  })
  const pushToast = useToasts((s) => s.push)
  const meta = AVAILABILITY_META[item.availability]

  return (
    <tr
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('border-b border-cream-100 last:border-0', isDragging && 'relative z-10 bg-cream-50 shadow-pop')}
    >
      <td className="px-3 py-2.5">
        <button
          type="button"
          {...attributes}
          {...listeners}
          disabled={!dragEnabled}
          aria-label={`Reorder ${item.name}`}
          className={cn('grid size-8 place-items-center rounded-lg text-ink-300', dragEnabled ? 'cursor-grab hover:bg-cream-100 hover:text-ink-700' : 'opacity-30')}
        >
          <GripVertical className="size-4" />
        </button>
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          {item.image && (
            <img src={assetUrl(item.image)} alt="" loading="lazy" className="size-8 shrink-0 rounded-lg bg-cream-100 object-contain p-0.5" />
          )}
          <VegMark isVeg={item.isVegetarian} className="size-3.5" />
          <span className="font-semibold">{item.name}</span>
          {item.isPopular && <Badge tone="accent">Popular</Badge>}
          {item.isRecommended && <Badge tone="ok">Pick</Badge>}
        </div>
      </td>
      <td className="px-3 py-2.5 text-ink-500">{categoryName}</td>
      <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{formatINR(item.basePrice)}</td>
      <td className="px-3 py-2.5">
        {/* One-tap availability cycle: Available → Out of stock → Disabled */}
        <Segmented
          size="sm"
          value={item.availability}
          onChange={(next) => {
            menuService.setItemAvailability(item.id, next)
            if (next === 'out_of_stock') pushToast(`${item.name} marked out of stock`, 'warn')
            if (next === 'available') pushToast(`${item.name} back on the menu`, 'ok')
          }}
          options={[
            { value: 'available', label: '●' },
            { value: 'out_of_stock', label: '×' },
            { value: 'disabled', label: '—' },
          ]}
        />
        <Badge tone={meta.tone} className="ml-2 hidden xl:inline-flex">
          {meta.label}
        </Badge>
      </td>
      <td className="px-3 py-2.5 text-ink-500">{stationName}</td>
      <td className="px-3 py-2.5 text-right">
        <button type="button" onClick={onEdit} aria-label={`Edit ${item.name}`} className="grid size-8 place-items-center rounded-lg text-ink-500 hover:bg-cream-100 hover:text-ink-900">
          <Pencil className="size-4" />
        </button>
      </td>
    </tr>
  )
}

/* ----------------------------- Item editor ------------------------------ */

function ItemEditor({ item, onClose }: { item: MenuItem | null; onClose: () => void }) {
  const categories = useAppStore((s) => s.db.categories)
  const stations = useAppStore((s) => s.db.stations)
  const modifierGroups = useAppStore((s) => s.db.modifierGroups)
  const pushToast = useToasts((s) => s.push)

  const sortedCategories = [...categories].sort(byDisplayOrder)
  const firstCategory = sortedCategories[0]
  const firstStation = [...stations].sort(byDisplayOrder)[0]

  const [form, setForm] = useState<MenuItemInput>(() =>
    item
      ? {
          categoryId: item.categoryId,
          name: item.name,
          description: item.description,
          image: item.image ?? null,
          basePrice: item.basePrice,
          availability: item.availability,
          isVegetarian: item.isVegetarian,
          isPopular: item.isPopular,
          isRecommended: item.isRecommended,
          preparationTimeMin: item.preparationTimeMin,
          stationId: item.stationId,
          modifierGroupIds: item.modifierGroupIds,
          tags: item.tags,
        }
      : {
          categoryId: firstCategory?.id ?? '',
          name: '',
          description: '',
          image: null,
          basePrice: 0,
          availability: 'available',
          isVegetarian: true,
          isPopular: false,
          isRecommended: false,
          preparationTimeMin: 8,
          stationId: firstStation?.id ?? '',
          modifierGroupIds: [],
          tags: [],
        },
  )
  const [tagsText, setTagsText] = useState(() => (item ? item.tags.join(', ') : ''))

  const patch = (p: Partial<MenuItemInput>) => setForm((f) => ({ ...f, ...p }))
  const valid = form.name.trim().length > 0 && form.basePrice > 0 && form.categoryId && form.stationId

  const save = () => {
    if (!valid) return
    const tags = tagsText
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)
    const input = { ...form, name: form.name.trim(), description: form.description.trim(), tags }
    if (item) {
      menuService.updateItem(item.id, input)
      pushToast(`${input.name} updated`, 'ok')
    } else {
      menuService.createItem(input)
      pushToast(`${input.name} added to the menu`, 'ok')
    }
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={item ? `Edit ${item.name}` : 'Add menu item'}
      wide
      footer={
        <div className="flex justify-between gap-2">
          {item ? (
            <Button
              variant="ghost"
              className="text-danger-600"
              onClick={() => {
                menuService.archiveItem(item.id)
                pushToast(`${item.name} removed (order history is kept)`, 'warn')
                onClose()
              }}
            >
              <Trash2 className="size-4" /> Remove
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={save} disabled={!valid}>
              {item ? 'Save changes' : 'Add item'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Item name">
          <Input value={form.name} onChange={(e) => patch({ name: e.target.value })} placeholder="Paneer Wrap" />
        </Field>
        <Field label="Category">
          <Select value={form.categoryId} onChange={(e) => patch({ categoryId: e.target.value })}>
            {sortedCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon} {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Description">
            <Textarea value={form.description} onChange={(e) => patch({ description: e.target.value })} placeholder="Grilled paneer, vegetables and house sauce…" />
          </Field>
        </div>
        <Field label="Base price (₹)">
          <Input type="number" min={0} value={form.basePrice || ''} onChange={(e) => patch({ basePrice: Number(e.target.value) || 0 })} />
        </Field>
        <Field label="Preparation time (min)">
          <Input type="number" min={1} value={form.preparationTimeMin} onChange={(e) => patch({ preparationTimeMin: Math.max(1, Number(e.target.value) || 1) })} />
        </Field>
        <Field label="Search keywords" hint="Comma-separated, e.g. coffee — helps search find this item">
          <Input value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="coffee, latte" />
        </Field>
        <Field label="Image" hint="Bundled illustration (/menu/….svg) or a full photo URL; empty shows the category icon">
          <Input
            value={form.image ?? ''}
            onChange={(e) => patch({ image: e.target.value.trim() || null })}
            placeholder="/menu/sandwich.svg or https://…"
          />
        </Field>
        <Field label="Kitchen station" hint="Where this item is prepared — used for routing">
          <Select value={form.stationId} onChange={(e) => patch({ stationId: e.target.value })}>
            {[...stations].sort(byDisplayOrder).map((s) => (
              <option key={s.id} value={s.id}>
                {s.icon} {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Availability">
          <Segmented
            value={form.availability}
            onChange={(availability) => patch({ availability })}
            options={(Object.keys(AVAILABILITY_META) as ItemAvailability[]).map((a) => ({ value: a, label: AVAILABILITY_META[a].label }))}
          />
        </Field>

        <div className="flex items-center justify-between rounded-xl bg-cream-100 px-4 py-3">
          <span className="text-sm font-semibold">Vegetarian</span>
          <Toggle checked={form.isVegetarian} onChange={(v) => patch({ isVegetarian: v })} label="Vegetarian" />
        </div>
        <div className="flex items-center justify-between rounded-xl bg-cream-100 px-4 py-3">
          <span className="text-sm font-semibold">Popular badge</span>
          <Toggle checked={form.isPopular} onChange={(v) => patch({ isPopular: v })} label="Popular" />
        </div>
        <div className="flex items-center justify-between rounded-xl bg-cream-100 px-4 py-3">
          <span className="text-sm font-semibold">Recommended badge</span>
          <Toggle checked={form.isRecommended} onChange={(v) => patch({ isRecommended: v })} label="Recommended" />
        </div>

        <div className="sm:col-span-2">
          <p className="mb-2 text-sm font-semibold text-ink-700">Customisation groups</p>
          <div className="flex flex-wrap gap-2">
            {[...modifierGroups].sort(byDisplayOrder).map((g) => {
              const active = form.modifierGroupIds.includes(g.id)
              return (
                <button
                  key={g.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    patch({
                      modifierGroupIds: active
                        ? form.modifierGroupIds.filter((id) => id !== g.id)
                        : [...form.modifierGroupIds, g.id],
                    })
                  }
                  className={cn(
                    'h-10 rounded-xl border px-3.5 text-sm font-semibold transition-colors',
                    active ? 'border-accent-500 bg-accent-50 text-accent-600' : 'border-cream-300 bg-white text-ink-700 hover:border-cream-400',
                  )}
                >
                  {g.name}
                  {g.required && ' *'}
                </button>
              )
            })}
          </div>
          <p className="mt-1.5 text-xs text-ink-500">* required groups ask the customer to choose (e.g. size)</p>
        </div>
      </div>
    </Modal>
  )
}

/* ============================== CATEGORIES ============================== */

function CategoriesTab() {
  const categories = useAppStore((s) => s.db.categories)
  const items = useAppStore((s) => s.db.items)
  const [editing, setEditing] = useState<Category | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Category | null>(null)
  const pushToast = useToasts((s) => s.push)

  const sorted = useMemo(() => [...categories].sort(byDisplayOrder), [categories])
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const ids = sorted.map((c) => c.id)
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from === -1 || to === -1) return
    menuService.reorderCategories(arrayMove(ids, from, to))
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-xs text-ink-500">Drag to reorder. Disabled categories vanish from the order screen instantly.</p>
        <Button onClick={() => setEditing('new')}>
          <Plus className="size-4" /> Add category
        </Button>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={sorted.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {sorted.map((category) => (
              <CategoryRow
                key={category.id}
                category={category}
                itemCount={items.filter((i) => i.categoryId === category.id).length}
                onEdit={() => setEditing(category)}
                onDelete={() => setDeleting(category)}
                onToggle={(isActive) => {
                  menuService.updateCategory(category.id, { isActive })
                  pushToast(isActive ? `${category.name} enabled` : `${category.name} hidden from the menu`, isActive ? 'ok' : 'warn')
                }}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {editing && <CategoryEditor category={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}

      <Modal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={deleting ? `Delete “${deleting.name}”?` : 'Delete category'}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              Keep
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (!deleting) return
                menuService.archiveCategory(deleting.id)
                pushToast(`${deleting.name} deleted (past orders keep their history)`, 'warn')
                setDeleting(null)
              }}
            >
              Delete category
            </Button>
          </div>
        }
      >
        <p className="text-sm text-ink-500">
          This removes the category and its {items.filter((i) => i.categoryId === deleting?.id).length} items from
          the menu. Orders already placed keep their item history — nothing historical is lost.
        </p>
      </Modal>
    </div>
  )
}

function CategoryRow({
  category,
  itemCount,
  onEdit,
  onDelete,
  onToggle,
}: {
  category: Category
  itemCount: number
  onEdit: () => void
  onDelete: () => void
  onToggle: (isActive: boolean) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: category.id })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-3 rounded-card bg-white p-3 shadow-card',
        isDragging && 'relative z-10 shadow-pop',
        !category.isActive && 'opacity-60',
      )}
    >
      <button type="button" {...attributes} {...listeners} aria-label={`Reorder ${category.name}`} className="grid size-9 shrink-0 cursor-grab place-items-center rounded-lg text-ink-300 hover:bg-cream-100 hover:text-ink-700">
        <GripVertical className="size-4" />
      </button>
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-cream-100 text-xl" aria-hidden>
        {category.icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-bold">
          {category.name}
          {!category.isActive && <Badge tone="neutral">Hidden</Badge>}
        </p>
        <p className="truncate text-xs text-ink-500">
          {itemCount} items · {category.description}
        </p>
      </div>
      <Toggle checked={category.isActive} onChange={onToggle} label={`${category.name} active`} />
      <button type="button" onClick={onEdit} aria-label={`Edit ${category.name}`} className="grid size-9 place-items-center rounded-lg text-ink-500 hover:bg-cream-100 hover:text-ink-900">
        <Pencil className="size-4" />
      </button>
      <button type="button" onClick={onDelete} aria-label={`Delete ${category.name}`} className="grid size-9 place-items-center rounded-lg text-ink-300 hover:bg-danger-100 hover:text-danger-600">
        <Trash2 className="size-4" />
      </button>
    </div>
  )
}

function CategoryEditor({ category, onClose }: { category: Category | null; onClose: () => void }) {
  const [form, setForm] = useState<CategoryInput>(() =>
    category
      ? { name: category.name, description: category.description, icon: category.icon, isActive: category.isActive }
      : { name: '', description: '', icon: '🍽️', isActive: true },
  )
  const patch = (p: Partial<CategoryInput>) => setForm((f) => ({ ...f, ...p }))

  const save = () => {
    if (!form.name.trim()) return
    const input = { ...form, name: form.name.trim(), description: form.description.trim() }
    if (category) menuService.updateCategory(category.id, input)
    else menuService.createCategory(input)
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={category ? `Edit ${category.name}` : 'Add category'}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!form.name.trim()}>
            {category ? 'Save' : 'Add category'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-[5rem_1fr] gap-3">
          <Field label="Icon">
            <Input value={form.icon} onChange={(e) => patch({ icon: e.target.value })} maxLength={4} className="text-center text-lg" />
          </Field>
          <Field label="Category name">
            <Input value={form.name} onChange={(e) => patch({ name: e.target.value })} placeholder="Sandwiches" />
          </Field>
        </div>
        <Field label="Description">
          <Textarea value={form.description} onChange={(e) => patch({ description: e.target.value })} placeholder="Short line shown in admin" />
        </Field>
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-ink-700">Visible on order screen</span>
          <Toggle checked={form.isActive} onChange={(v) => patch({ isActive: v })} label="Category active" />
        </div>
      </div>
    </Modal>
  )
}
