import type {
  CafeTable,
  Category,
  ID,
  ItemAvailability,
  MenuItem,
  ModifierGroup,
  ModifierOption,
  Station,
} from '@/types'

/**
 * The starting catalogue for a NEW outlet.
 *
 * This file is DATA, not UI: nothing in it is referenced by name from any
 * component. It is read once, by the bootstrap script, which writes these
 * rows into Firestore when an outlet is first created. After that the
 * manager edits the menu in the app and this file is never consulted again —
 * so changing a price here does not change a price in a running cafe.
 *
 * Prices, prep times and flags are sensible starting values, not gospel.
 */

const SEEDED_AT = '2026-08-31T04:00:00.000Z'
const stamp = { createdAt: SEEDED_AT, updatedAt: SEEDED_AT }

/* ------------------------------- Stations ------------------------------ */

const stations: Station[] = [
  { id: 'st-kitchen', name: 'Kitchen', icon: '🍳', displayOrder: 1, isActive: true, preparesFood: true },
  { id: 'st-hot', name: 'Hot Kitchen', icon: '🍜', displayOrder: 2, isActive: true, preparesFood: true },
  { id: 'st-pizza', name: 'Pizza Station', icon: '🍕', displayOrder: 3, isActive: true, preparesFood: true },
  { id: 'st-beverage', name: 'Beverage Counter', icon: '☕', displayOrder: 4, isActive: true, preparesFood: true },
  { id: 'st-juice', name: 'Juice Counter', icon: '🍊', displayOrder: 5, isActive: true, preparesFood: true },
  // Handed over, not made: these never reach the kitchen board.
  { id: 'st-counter', name: 'Front Counter', icon: '🧾', displayOrder: 6, isActive: true, preparesFood: false },
]

/* ------------------------------ Categories ----------------------------- */

const categories: Category[] = [
  { id: 'cat-maggi', name: 'Maggi', icon: '🍜', description: 'Instant noodles, nine ways', displayOrder: 1, isActive: true, ...stamp },
  { id: 'cat-sandwich', name: 'Sandwich', icon: '🥪', description: 'Grilled to order', displayOrder: 2, isActive: true, ...stamp },
  { id: 'cat-bread-toast', name: 'Bread Toast', icon: '🍞', description: 'Toasted and topped', displayOrder: 3, isActive: true, ...stamp },
  { id: 'cat-pizza', name: 'Pizza', icon: '🍕', description: 'Hand made, baked fresh', displayOrder: 4, isActive: true, ...stamp },
  { id: 'cat-wrap', name: 'Wrap', icon: '🌯', description: 'Rolled with house fillings', displayOrder: 5, isActive: true, ...stamp },
  { id: 'cat-sweet-corn', name: 'Sweet Corn', icon: '🌽', description: 'Steamed corn, four seasonings', displayOrder: 6, isActive: true, ...stamp },
  { id: 'cat-snacks', name: 'Fries & Snacks', icon: '🍟', description: 'Fried to order', displayOrder: 7, isActive: true, ...stamp },
  { id: 'cat-hot-beverages', name: 'Hot Beverages', icon: '☕', description: 'Teas and coffees', displayOrder: 8, isActive: true, ...stamp },
  { id: 'cat-cold-beverages', name: 'Cold Beverages', icon: '🧊', description: 'Iced and cold', displayOrder: 9, isActive: true, ...stamp },
  { id: 'cat-milkshakes', name: 'Milk Shakes', icon: '🥤', description: 'Thick shakes, blended fresh', displayOrder: 10, isActive: true, ...stamp },
  { id: 'cat-juices', name: 'Juices', icon: '🍹', description: 'Pressed at the counter', displayOrder: 11, isActive: true, ...stamp },
  { id: 'cat-soda', name: 'Soda', icon: '🫧', description: 'Fizzy coolers', displayOrder: 12, isActive: true, ...stamp },
  { id: 'cat-cigarettes', name: 'Cigarettes', icon: '🚬', description: 'Sold per stick at the counter', displayOrder: 13, isActive: true, ...stamp },
  { id: 'cat-counter', name: 'Counter', icon: '🧾', description: 'Packaged counter sales', displayOrder: 14, isActive: true, ...stamp },
]

/* --------------------------- Modifier groups --------------------------- */

const modifierGroups: ModifierGroup[] = [
  { id: 'grp-extra-cheese', name: 'Extras', selectionType: 'multi', required: false, minSelections: 0, maxSelections: 1, displayOrder: 1 },
]

function opt(
  group: ID,
  id: string,
  name: string,
  priceAdjustment: number,
  displayOrder: number,
  isDefault = false,
): ModifierOption {
  return { id, modifierGroupId: group, name, priceAdjustment, isAvailable: true, isDefault, displayOrder }
}

/* The board lists exactly one paid add-on, on Maggi, Sandwich and Pizza. */
const modifierOptions: ModifierOption[] = [opt('grp-extra-cheese', 'mo-extra-cheese', 'Extra Cheese', 20, 1)]

/* ------------------------------ Menu items ----------------------------- */

interface ItemSeed {
  id: string
  name: string
  /** Optional: the board carries no descriptions, so most items have none. */
  desc?: string
  price: number
  veg?: boolean
  prep?: number
  station?: ID
  popular?: boolean
  recommended?: boolean
  mods?: ID[]
  availability?: ItemAvailability
  tags?: string[]
}

interface CategoryDefaults {
  station: ID
  prep: number
  mods: ID[]
}

/**
 * Bundled flat illustrations (public/menu/*.svg) assigned per item. This is
 * plain data on the item's `image` field — swap any entry for a real photo
 * URL (or edit it in Menu management) and the UI picks it up unchanged.
 */
const ITEM_IMAGES: Record<string, string[]> = {
  'pasta': ['itm-maggi-plain', 'itm-maggi-mixveg', 'itm-maggi-sweet-corn', 'itm-maggi-schezwan', 'itm-maggi-paneer', 'itm-maggi-cheesy', 'itm-maggi-cheesy-corn', 'itm-maggi-cheesy-paneer', 'itm-maggi-cheesy-schezwan'],
  'sandwich': ['itm-sandwich-mixveg', 'itm-sandwich-sweet-corn', 'itm-sandwich-schezwan', 'itm-sandwich-gujrathi', 'itm-sandwich-punjabi', 'itm-sandwich-paneer', 'itm-sandwich-paprica', 'itm-sandwich-jalapeno', 'itm-sandwich-pizza', 'itm-sandwich-spcl-paneer', 'itm-sandwich-bombay', 'itm-sandwich-shahi'],
  'garlic-bread': ['itm-bread-toast-masala', 'itm-bread-toast-sweetcorn', 'itm-bread-toast-paneer', 'itm-bread-toast-schezwan', 'itm-bread-toast-cheesy-corn', 'itm-bread-toast-cheesy-paneer', 'itm-bread-toast-cheesy'],
  'pizza': ['itm-pizza-sweet-corn', 'itm-pizza-olive', 'itm-pizza-jalapeno', 'itm-pizza-paprica', 'itm-pizza-paneer'],
  'wrap': ['itm-wrap-mixveg', 'itm-wrap-sweet-corn', 'itm-wrap-schezwan', 'itm-wrap-gujrathi', 'itm-wrap-punjabi', 'itm-wrap-paneer', 'itm-wrap-paprica', 'itm-wrap-jalapeno', 'itm-wrap-olive', 'itm-wrap-bombay', 'itm-wrap-pizza'],
  'nachos': ['itm-sweet-corn-salt', 'itm-sweet-corn-salt-and-pepper', 'itm-sweet-corn-indian-spicy', 'itm-sweet-corn-peri-peri'],
  'milkshake': ['itm-milk-shake-strawberry', 'itm-milk-shake-mango', 'itm-milk-shake-pink-guava', 'itm-milk-shake-custard-apple', 'itm-milk-shake-chikoo', 'itm-milk-shake-tender-coconut', 'itm-milk-shake-chocolate', 'itm-milk-shake-mixfruit', 'itm-milk-shake-anjeer'],
  'soda': ['itm-soda-lemon', 'itm-soda-jaljeera', 'itm-soda-pudina', 'itm-soda-ginger', 'itm-soda-chilli-guava', 'itm-soda-mojito-mint'],
  'cigarette': ['itm-lites', 'itm-king', 'itm-ice-burst', 'itm-double-burst', 'itm-milds', 'itm-ultra-milds', 'itm-forest', 'itm-fuse-beyond', 'itm-red', 'itm-advance', 'itm-gold', 'itm-clove', 'itm-black-filter', 'itm-fine-touch', 'itm-connect', 'itm-shift', 'itm-american-club', 'itm-social'],
  'fries': ['itm-french-fries-salty', 'itm-french-fries-salt-and-pepper', 'itm-french-fries-indian-spicy', 'itm-french-fries-peri-peri'],
  'snacks': ['itm-potato-shots-10-pcs', 'itm-momos-4-pcs', 'itm-veg-roll-3-pcs', 'itm-corn-triangle-5-pcs', 'itm-onion-rings-5-pcs', 'itm-cutlet-5-pcs', 'itm-samosa', 'itm-pocket-pizza-3-pcs'],
  'chai': ['itm-tea', 'itm-ginger-tea', 'itm-masala-tea', 'itm-green-tea', 'itm-lime-tea'],
  'filter-coffee': ['itm-coffee', 'itm-black-coffee'],
  'hot-chocolate': ['itm-badam', 'itm-horlicks'],
  'cold-coffee': ['itm-ice-coffee', 'itm-cold-coffee', 'itm-cold-horlicks', 'itm-cold-boost', 'itm-ice-boost', 'itm-ice-badam', 'itm-cold-badam'],
  'juice-orange': ['itm-juice-lemon', 'itm-juice-passion-fruit'],
  'juice-red': ['itm-juice-jamun'],
  'water-bottle': ['itm-water-bottle'],
}

const imageByItemId = new Map<string, string>()
for (const [img, ids] of Object.entries(ITEM_IMAGES)) {
  ids.forEach((id) => imageByItemId.set(id, `/menu/${img}.svg`))
}

/**
 * Real photos, resolved at build time. Drop a file into
 * src/assets/menu-photos/ named after the item id WITHOUT its `itm-` prefix
 * — paneer-pizza.webp for itm-paneer-pizza — and the next build picks it up.
 * There is no list to keep in sync here: the folder is the list. Items with
 * no photo fall back to the bundled illustration above, and items with
 * neither show their category icon.
 */
const photoByItemId = new Map<string, string>(
  Object.entries(
    import.meta.glob('../assets/menu-photos/*.{webp,avif,jpg,jpeg,png}', {
      eager: true,
      query: '?url',
      import: 'default',
    }) as Record<string, string>,
  ).map(([path, url]) => [`itm-${path.split('/').pop()!.replace(/\.[^.]+$/, '')}`, url]),
)

function buildItems(categoryId: ID, defaults: CategoryDefaults, seeds: ItemSeed[]): MenuItem[] {
  return seeds.map((s, i) => ({
    id: s.id,
    categoryId,
    name: s.name,
    description: s.desc ?? '',
    image: photoByItemId.get(s.id) ?? imageByItemId.get(s.id) ?? null,
    basePrice: s.price,
    availability: s.availability ?? 'available',
    isVegetarian: s.veg ?? true,
    isPopular: s.popular ?? false,
    isRecommended: s.recommended ?? false,
    preparationTimeMin: s.prep ?? defaults.prep,
    stationId: s.station ?? defaults.station,
    displayOrder: i + 1,
    modifierGroupIds: s.mods ?? defaults.mods,
    tags: s.tags ?? [],
    ...stamp,
  }))
}

const maggi = buildItems(
  'cat-maggi',
  { station: 'st-hot', prep: 8, mods: ['grp-extra-cheese'] },
  [
    { id: 'itm-maggi-plain', name: 'Maggi Plain', price: 60 },
    { id: 'itm-maggi-mixveg', name: 'Maggi Mixveg', price: 70 },
    { id: 'itm-maggi-sweet-corn', name: 'Maggi Sweet Corn', price: 80 },
    { id: 'itm-maggi-schezwan', name: 'Maggi Schezwan', price: 80 },
    { id: 'itm-maggi-paneer', name: 'Maggi Paneer', price: 90 },
    { id: 'itm-maggi-cheesy', name: 'Maggi Cheesy', price: 90 },
    { id: 'itm-maggi-cheesy-corn', name: 'Maggi Cheesy Corn', price: 100 },
    { id: 'itm-maggi-cheesy-paneer', name: 'Maggi Cheesy Paneer', price: 100 },
    { id: 'itm-maggi-cheesy-schezwan', name: 'Maggi Cheesy Schezwan', price: 100 },
  ],
)

const sandwich = buildItems(
  'cat-sandwich',
  { station: 'st-kitchen', prep: 7, mods: ['grp-extra-cheese'] },
  [
    { id: 'itm-sandwich-mixveg', name: 'Sandwich Mixveg', price: 70 },
    { id: 'itm-sandwich-sweet-corn', name: 'Sandwich Sweet Corn', price: 80 },
    { id: 'itm-sandwich-schezwan', name: 'Sandwich Schezwan', price: 80 },
    { id: 'itm-sandwich-gujrathi', name: 'Sandwich Gujrathi', price: 80 },
    { id: 'itm-sandwich-punjabi', name: 'Sandwich Punjabi', price: 80 },
    { id: 'itm-sandwich-paneer', name: 'Sandwich Paneer', price: 90 },
    { id: 'itm-sandwich-paprica', name: 'Sandwich Paprica', price: 80 },
    { id: 'itm-sandwich-jalapeno', name: 'Sandwich Jalapeno', price: 90 },
    { id: 'itm-sandwich-pizza', name: 'Sandwich Pizza', price: 110 },
    { id: 'itm-sandwich-spcl-paneer', name: 'Sandwich Spcl Paneer', price: 110 },
    { id: 'itm-sandwich-bombay', name: 'Sandwich Bombay', price: 130 },
    { id: 'itm-sandwich-shahi', name: 'Sandwich Shahi', price: 130 },
  ],
)

const breadToast = buildItems(
  'cat-bread-toast',
  { station: 'st-kitchen', prep: 5, mods: [] },
  [
    { id: 'itm-bread-toast-masala', name: 'Bread Toast Masala', price: 50 },
    { id: 'itm-bread-toast-sweetcorn', name: 'Bread Toast Sweetcorn', price: 60 },
    { id: 'itm-bread-toast-paneer', name: 'Bread Toast Paneer', price: 70 },
    { id: 'itm-bread-toast-schezwan', name: 'Bread Toast Schezwan', price: 80 },
    { id: 'itm-bread-toast-cheesy-corn', name: 'Bread Toast Cheesy Corn', price: 80 },
    { id: 'itm-bread-toast-cheesy-paneer', name: 'Bread Toast Cheesy Paneer', price: 80 },
    { id: 'itm-bread-toast-cheesy', name: 'Bread Toast Cheesy', price: 70 },
  ],
)

const pizza = buildItems(
  'cat-pizza',
  { station: 'st-pizza', prep: 15, mods: ['grp-extra-cheese'] },
  [
    { id: 'itm-pizza-sweet-corn', name: 'Pizza Sweet Corn', price: 160 },
    { id: 'itm-pizza-olive', name: 'Pizza Olive', price: 170 },
    { id: 'itm-pizza-jalapeno', name: 'Pizza Jalapeno', price: 170 },
    { id: 'itm-pizza-paprica', name: 'Pizza Paprica', price: 180 },
    { id: 'itm-pizza-paneer', name: 'Pizza Paneer', price: 200 },
  ],
)

const wrap = buildItems(
  'cat-wrap',
  { station: 'st-kitchen', prep: 8, mods: [] },
  [
    { id: 'itm-wrap-mixveg', name: 'Wrap Mixveg', price: 80 },
    { id: 'itm-wrap-sweet-corn', name: 'Wrap Sweet Corn', price: 90 },
    { id: 'itm-wrap-schezwan', name: 'Wrap Schezwan', price: 90 },
    { id: 'itm-wrap-gujrathi', name: 'Wrap Gujrathi', price: 90 },
    { id: 'itm-wrap-punjabi', name: 'Wrap Punjabi', price: 90 },
    { id: 'itm-wrap-paneer', name: 'Wrap Paneer', price: 100 },
    { id: 'itm-wrap-paprica', name: 'Wrap Paprica', price: 100 },
    { id: 'itm-wrap-jalapeno', name: 'Wrap Jalapeno', price: 100 },
    { id: 'itm-wrap-olive', name: 'Wrap Olive', price: 100 },
    { id: 'itm-wrap-bombay', name: 'Wrap Bombay', price: 120 },
    { id: 'itm-wrap-pizza', name: 'Wrap Pizza', price: 120 },
  ],
)

const sweetCorn = buildItems(
  'cat-sweet-corn',
  { station: 'st-kitchen', prep: 5, mods: [] },
  [
    { id: 'itm-sweet-corn-salt', name: 'Sweet Corn Salt', price: 60 },
    { id: 'itm-sweet-corn-salt-and-pepper', name: 'Sweet Corn Salt & Pepper', price: 60 },
    { id: 'itm-sweet-corn-indian-spicy', name: 'Sweet Corn Indian Spicy', price: 60 },
    { id: 'itm-sweet-corn-peri-peri', name: 'Sweet Corn Peri Peri', price: 60 },
  ],
)

const friesSnacks = buildItems(
  'cat-snacks',
  { station: 'st-kitchen', prep: 8, mods: [] },
  [
    { id: 'itm-french-fries-salty', name: 'French Fries Salty', price: 110 },
    { id: 'itm-french-fries-salt-and-pepper', name: 'French Fries Salt & Pepper', price: 120 },
    { id: 'itm-french-fries-indian-spicy', name: 'French Fries Indian Spicy', price: 120 },
    { id: 'itm-french-fries-peri-peri', name: 'French Fries Peri-Peri', price: 130 },
    { id: 'itm-potato-shots-10-pcs', name: 'Potato Shots (10 pcs)', price: 130 },
    { id: 'itm-momos-4-pcs', name: 'Momos (4 pcs)', price: 130 },
    { id: 'itm-veg-roll-3-pcs', name: 'Veg Roll (3 pcs)', price: 130 },
    { id: 'itm-corn-triangle-5-pcs', name: 'Corn Triangle (5 pcs)', price: 130 },
    { id: 'itm-onion-rings-5-pcs', name: 'Onion Rings (5 pcs)', price: 130 },
    { id: 'itm-cutlet-5-pcs', name: 'Cutlet (5 pcs)', price: 130 },
    { id: 'itm-samosa', name: 'Samosa', price: 130 },
    { id: 'itm-pocket-pizza-3-pcs', name: 'Pocket Pizza (3 pcs)', price: 130 },
  ],
)

const hotBeverages = buildItems(
  'cat-hot-beverages',
  { station: 'st-beverage', prep: 4, mods: [] },
  [
    { id: 'itm-coffee', name: 'Coffee', price: 20 },
    { id: 'itm-tea', name: 'Tea', price: 20 },
    { id: 'itm-badam', name: 'Badam', price: 20 },
    { id: 'itm-horlicks', name: 'Horlicks', price: 20 },
    { id: 'itm-ginger-tea', name: 'Ginger Tea', price: 25 },
    { id: 'itm-masala-tea', name: 'Masala Tea', price: 25 },
    { id: 'itm-green-tea', name: 'Green Tea', price: 25 },
    { id: 'itm-black-coffee', name: 'Black Coffee', price: 25 },
    { id: 'itm-lime-tea', name: 'Lime Tea', price: 25 },
  ],
)

const coldBeverages = buildItems(
  'cat-cold-beverages',
  { station: 'st-beverage', prep: 5, mods: [] },
  [
    { id: 'itm-ice-coffee', name: 'Ice Coffee', price: 25 },
    { id: 'itm-ice-boost', name: 'Ice Boost', price: 25 },
    { id: 'itm-ice-badam', name: 'Ice Badam', price: 25 },
    { id: 'itm-cold-coffee', name: 'Cold Coffee', price: 80 },
    { id: 'itm-cold-horlicks', name: 'Cold Horlicks', price: 80 },
    { id: 'itm-cold-boost', name: 'Cold Boost', price: 80 },
    { id: 'itm-cold-badam', name: 'Cold Badam', price: 80 },
  ],
)

const milkShakes = buildItems(
  'cat-milkshakes',
  { station: 'st-beverage', prep: 6, mods: [] },
  [
    { id: 'itm-milk-shake-strawberry', name: 'Milk Shake Strawberry', price: 100 },
    { id: 'itm-milk-shake-mango', name: 'Milk Shake Mango', price: 100 },
    { id: 'itm-milk-shake-pink-guava', name: 'Milk Shake Pink Guava', price: 100 },
    { id: 'itm-milk-shake-custard-apple', name: 'Milk Shake Custard Apple', price: 100 },
    { id: 'itm-milk-shake-chikoo', name: 'Milk Shake Chikoo', price: 100 },
    { id: 'itm-milk-shake-tender-coconut', name: 'Milk Shake Tender Coconut', price: 100 },
    { id: 'itm-milk-shake-chocolate', name: 'Milk Shake Chocolate', price: 100 },
    { id: 'itm-milk-shake-mixfruit', name: 'Milk Shake Mixfruit', price: 100 },
    { id: 'itm-milk-shake-anjeer', name: 'Milk Shake Anjeer', price: 100 },
  ],
)

const juices = buildItems(
  'cat-juices',
  { station: 'st-juice', prep: 5, mods: [] },
  [
    { id: 'itm-juice-lemon', name: 'Juice Lemon', price: 50 },
    { id: 'itm-juice-jamun', name: 'Juice Jamun', price: 100 },
    { id: 'itm-juice-passion-fruit', name: 'Juice Passion Fruit', price: 100 },
  ],
)

const soda = buildItems(
  'cat-soda',
  { station: 'st-juice', prep: 3, mods: [] },
  [
    { id: 'itm-soda-lemon', name: 'Soda Lemon', price: 60 },
    { id: 'itm-soda-jaljeera', name: 'Soda Jaljeera', price: 60 },
    { id: 'itm-soda-pudina', name: 'Soda Pudina', price: 60 },
    { id: 'itm-soda-ginger', name: 'Soda Ginger', price: 60 },
    { id: 'itm-soda-chilli-guava', name: 'Soda Chilli Guava', price: 60 },
    { id: 'itm-soda-mojito-mint', name: 'Soda Mojito Mint', price: 60 },
  ],
)

const cigarettes = buildItems(
  'cat-cigarettes',
  { station: 'st-counter', prep: 1, mods: [] },
  [
    { id: 'itm-lites', name: 'Lites', price: 26 },
    { id: 'itm-king', name: 'King', price: 26 },
    { id: 'itm-ice-burst', name: 'Ice Burst', price: 26 },
    { id: 'itm-double-burst', name: 'Double Burst', price: 26 },
    { id: 'itm-milds', name: 'Milds', price: 26 },
    { id: 'itm-ultra-milds', name: 'Ultra Milds', price: 26 },
    { id: 'itm-forest', name: 'Forest', price: 26 },
    { id: 'itm-fuse-beyond', name: 'Fuse Beyond', price: 26 },
    { id: 'itm-red', name: 'Red', price: 26 },
    { id: 'itm-advance', name: 'Advance', price: 26 },
    { id: 'itm-gold', name: 'Gold', price: 26 },
    { id: 'itm-clove', name: 'Clove', price: 26 },
    { id: 'itm-black-filter', name: 'Black Filter', price: 26 },
    { id: 'itm-fine-touch', name: 'Fine Touch', price: 25 },
    { id: 'itm-connect', name: 'Connect', price: 23 },
    { id: 'itm-shift', name: 'Shift', price: 23 },
    { id: 'itm-american-club', name: 'American Club', price: 23 },
    { id: 'itm-social', name: 'Social', price: 23 },
  ],
)

const counter = buildItems(
  'cat-counter',
  { station: 'st-counter', prep: 1, mods: [] },
  [
    { id: 'itm-water-bottle', name: 'Water Bottle', price: 20 },
  ],
)

const items: MenuItem[] = [
  ...maggi,
  ...sandwich,
  ...breadToast,
  ...pizza,
  ...wrap,
  ...sweetCorn,
  ...friesSnacks,
  ...hotBeverages,
  ...coldBeverages,
  ...milkShakes,
  ...juices,
  ...soda,
  ...cigarettes,
  ...counter,
]

/* -------------------------------- Tables ------------------------------- */

function table(id: string, name: string, zone: string, capacity: number, displayOrder: number): CafeTable {
  return { id, name, zone, capacity, displayOrder, isActive: true }
}

const tables: CafeTable[] = [
  table('tbl-l1', 'L1', 'Lounge', 2, 1),
  table('tbl-l2', 'L2', 'Lounge', 2, 2),
  table('tbl-l3', 'L3', 'Lounge', 4, 3),
  table('tbl-l4', 'L4', 'Lounge', 4, 4),
  table('tbl-l5', 'L5', 'Lounge', 4, 5),
  table('tbl-l6', 'L6', 'Lounge', 6, 6),
  table('tbl-g1', 'G1', 'Garden', 4, 7),
  table('tbl-g2', 'G2', 'Garden', 4, 8),
  table('tbl-g3', 'G3', 'Garden', 4, 9),
  table('tbl-g4', 'G4', 'Garden', 6, 10),
  table('tbl-g5', 'G5', 'Garden', 6, 11),
  table('tbl-g6', 'G6', 'Garden', 8, 12),
]

/* ----------------------------- Seed payload ---------------------------- */

/**
 * Everything a new outlet starts with. Modifier options are handed back
 * flat here and nested into their group by the bootstrap script, matching
 * how they are stored.
 */
export interface SeedCatalogue {
  stations: Station[]
  categories: Category[]
  items: MenuItem[]
  modifierGroups: ModifierGroup[]
  modifierOptions: ModifierOption[]
  tables: CafeTable[]
  /** Where order and bill numbering starts for a brand new outlet. */
  sequences: { nextOrderNumber: number; nextBillNumber: number }
}

export function seedCatalogue(): SeedCatalogue {
  return structuredClone({
    stations,
    categories,
    items,
    modifierGroups,
    modifierOptions,
    tables,
    sequences: { nextOrderNumber: 1, nextBillNumber: 1 },
  })
}
