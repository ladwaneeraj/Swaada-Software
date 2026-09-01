import type {
  CafeTable,
  Category,
  DBSnapshot,
  ID,
  ItemAvailability,
  MenuItem,
  ModifierGroup,
  ModifierOption,
  Station,
  User,
} from '@/types'

/**
 * Seed data for the mock database. This file is DATA, not UI: nothing in
 * here is referenced by name from any component. Replacing this with rows
 * from Supabase/PostgreSQL later requires no UI changes.
 *
 * Prices, prep times and flags are sample values for the prototype.
 */

const SEEDED_AT = '2026-08-31T04:00:00.000Z'
const stamp = { createdAt: SEEDED_AT, updatedAt: SEEDED_AT }

/* ------------------------------- Stations ------------------------------ */

const stations: Station[] = [
  { id: 'st-kitchen', name: 'Kitchen', icon: '🍳', displayOrder: 1, isActive: true },
  { id: 'st-beverage', name: 'Beverage Counter', icon: '☕', displayOrder: 2, isActive: true },
  { id: 'st-juice', name: 'Juice Counter', icon: '🍊', displayOrder: 3, isActive: true },
  { id: 'st-pizza', name: 'Pizza Station', icon: '🍕', displayOrder: 4, isActive: true },
  { id: 'st-hot', name: 'Hot Kitchen', icon: '🍝', displayOrder: 5, isActive: true },
  { id: 'st-dessert', name: 'Dessert Counter', icon: '🍰', displayOrder: 6, isActive: true },
]

/* ------------------------------ Categories ----------------------------- */

const categories: Category[] = [
  { id: 'cat-hot-beverages', name: 'Hot Beverages', icon: '☕', description: 'Teas, coffees and comforting cups', displayOrder: 1, isActive: true, ...stamp },
  { id: 'cat-cold-beverages', name: 'Cold Beverages', icon: '🧊', description: 'Coolers, shakes and iced classics', displayOrder: 2, isActive: true, ...stamp },
  { id: 'cat-fresh-juices', name: 'Fresh Juices', icon: '🥤', description: 'Pressed fresh at the juice counter', displayOrder: 3, isActive: true, ...stamp },
  { id: 'cat-sandwiches', name: 'Sandwiches', icon: '🥪', description: 'Grilled and stacked to order', displayOrder: 4, isActive: true, ...stamp },
  { id: 'cat-wraps', name: 'Wraps', icon: '🌯', description: 'Soft tortillas, house sauces', displayOrder: 5, isActive: true, ...stamp },
  { id: 'cat-pizza', name: 'Pizza', icon: '🍕', description: 'Hand-stretched, three sizes', displayOrder: 6, isActive: true, ...stamp },
  { id: 'cat-pasta', name: 'Pasta', icon: '🍝', description: 'Tossed fresh in the hot kitchen', displayOrder: 7, isActive: true, ...stamp },
  { id: 'cat-quick-bites', name: 'Quick Bites', icon: '🍟', description: 'Fries, breads and snacky things', displayOrder: 8, isActive: true, ...stamp },
  { id: 'cat-burgers', name: 'Burgers', icon: '🍔', description: 'Toasted buns, crisp patties', displayOrder: 9, isActive: true, ...stamp },
  { id: 'cat-light-bites', name: 'Light Bites', icon: '🥗', description: 'Salads and fresh bowls', displayOrder: 10, isActive: true, ...stamp },
  { id: 'cat-desserts', name: 'Desserts', icon: '🍰', description: 'Baked, frozen and indulgent', displayOrder: 11, isActive: true, ...stamp },
]

/* --------------------------- Modifier groups --------------------------- */

const modifierGroups: ModifierGroup[] = [
  { id: 'grp-pizza-size', name: 'Size', selectionType: 'single', required: true, minSelections: 1, maxSelections: 1, displayOrder: 1 },
  { id: 'grp-pasta-portion', name: 'Portion', selectionType: 'single', required: true, minSelections: 1, maxSelections: 1, displayOrder: 1 },
  { id: 'grp-shake-flavor', name: 'Flavour', selectionType: 'single', required: true, minSelections: 1, maxSelections: 1, displayOrder: 1 },
  { id: 'grp-extras', name: 'Extras', selectionType: 'multi', required: false, minSelections: 0, maxSelections: 3, displayOrder: 2 },
  { id: 'grp-extras-nonveg', name: 'Non-veg Extras', selectionType: 'multi', required: false, minSelections: 0, maxSelections: 2, displayOrder: 3 },
  { id: 'grp-spice', name: 'Spice Level', selectionType: 'single', required: false, minSelections: 0, maxSelections: 1, displayOrder: 4 },
  { id: 'grp-food-prefs', name: 'Preferences', selectionType: 'multi', required: false, minSelections: 0, maxSelections: 4, displayOrder: 5 },
  { id: 'grp-bev-prefs', name: 'Preferences', selectionType: 'multi', required: false, minSelections: 0, maxSelections: 3, displayOrder: 5 },
  { id: 'grp-dessert-addons', name: 'Add-ons', selectionType: 'multi', required: false, minSelections: 0, maxSelections: 2, displayOrder: 2 },
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

const modifierOptions: ModifierOption[] = [
  opt('grp-pizza-size', 'mo-size-regular', 'Regular', 0, 1, true),
  opt('grp-pizza-size', 'mo-size-medium', 'Medium', 100, 2),
  opt('grp-pizza-size', 'mo-size-large', 'Large', 200, 3),

  opt('grp-pasta-portion', 'mo-portion-half', 'Half', 0, 1, true),
  opt('grp-pasta-portion', 'mo-portion-full', 'Full', 70, 2),

  opt('grp-shake-flavor', 'mo-shake-chocolate', 'Chocolate', 0, 1, true),
  opt('grp-shake-flavor', 'mo-shake-vanilla', 'Vanilla', 0, 2),
  opt('grp-shake-flavor', 'mo-shake-strawberry', 'Strawberry', 0, 3),
  opt('grp-shake-flavor', 'mo-shake-oreo', 'Oreo', 20, 4),

  opt('grp-extras', 'mo-extra-cheese', 'Extra Cheese', 30, 1),
  opt('grp-extras', 'mo-extra-paneer', 'Extra Paneer', 40, 2),
  opt('grp-extras', 'mo-extra-sauce', 'Extra Sauce', 20, 3),

  opt('grp-extras-nonveg', 'mo-extra-chicken', 'Extra Chicken', 60, 1),

  opt('grp-spice', 'mo-spice-mild', 'Mild', 0, 1),
  opt('grp-spice', 'mo-spice-medium', 'Medium', 0, 2),
  opt('grp-spice', 'mo-spice-spicy', 'Extra Spicy', 0, 3),

  opt('grp-food-prefs', 'mo-no-onion', 'No Onion', 0, 1),
  opt('grp-food-prefs', 'mo-no-cheese', 'No Cheese', 0, 2),
  opt('grp-food-prefs', 'mo-no-mayo', 'No Mayo', 0, 3),

  opt('grp-bev-prefs', 'mo-less-sugar', 'Less Sugar', 0, 1),
  opt('grp-bev-prefs', 'mo-no-sugar', 'No Sugar', 0, 2),
  opt('grp-bev-prefs', 'mo-no-ice', 'No Ice', 0, 3),

  opt('grp-dessert-addons', 'mo-icecream-scoop', 'Ice Cream Scoop', 40, 1),
  opt('grp-dessert-addons', 'mo-choc-sauce', 'Chocolate Sauce', 20, 2),
]

/* ------------------------------ Menu items ----------------------------- */

interface ItemSeed {
  id: string
  name: string
  desc: string
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
  chai: ['itm-tea', 'itm-masala-tea', 'itm-ginger-tea', 'itm-black-tea'],
  'tea-cup': ['itm-green-tea', 'itm-lemon-tea'],
  'filter-coffee': ['itm-coffee', 'itm-filter-coffee'],
  espresso: ['itm-espresso'],
  cappuccino: ['itm-cappuccino', 'itm-cafe-latte', 'itm-cafe-mocha'],
  'hot-chocolate': ['itm-hot-chocolate'],
  'cold-coffee': ['itm-cold-coffee', 'itm-iced-coffee', 'itm-cold-chocolate'],
  'iced-tea': ['itm-iced-tea'],
  soda: ['itm-lemon-soda', 'itm-sweet-lime-soda'],
  mojito: ['itm-mint-cooler', 'itm-mojito'],
  milkshake: ['itm-milkshake'],
  'juice-orange': ['itm-orange-juice', 'itm-mosambi-juice', 'itm-pineapple-juice', 'itm-mixed-fruit-juice', 'itm-carrot-juice'],
  'juice-red': ['itm-watermelon-juice', 'itm-pomegranate-juice', 'itm-grape-juice'],
  sandwich: ['itm-veg-sandwich', 'itm-cheese-sandwich', 'itm-grilled-sandwich', 'itm-club-sandwich', 'itm-paneer-sandwich', 'itm-corn-cheese-sandwich', 'itm-chicken-sandwich', 'itm-chicken-club-sandwich'],
  wrap: ['itm-veg-wrap', 'itm-paneer-wrap', 'itm-mexican-wrap', 'itm-cheese-wrap', 'itm-chicken-wrap', 'itm-chicken-tikka-wrap'],
  pizza: ['itm-margherita-pizza', 'itm-veg-pizza', 'itm-paneer-pizza', 'itm-farmhouse-pizza', 'itm-corn-cheese-pizza', 'itm-chicken-pizza', 'itm-chicken-tikka-pizza'],
  pasta: ['itm-white-sauce-pasta', 'itm-red-sauce-pasta', 'itm-pink-sauce-pasta', 'itm-alfredo-pasta', 'itm-arrabbiata-pasta', 'itm-veg-pasta', 'itm-paneer-pasta', 'itm-chicken-pasta'],
  fries: ['itm-french-fries', 'itm-peri-peri-fries', 'itm-cheese-fries', 'itm-potato-wedges'],
  'garlic-bread': ['itm-garlic-bread', 'itm-cheese-garlic-bread'],
  nachos: ['itm-nachos', 'itm-cheese-nachos'],
  snacks: ['itm-onion-rings', 'itm-veg-nuggets', 'itm-chicken-nuggets', 'itm-chicken-popcorn'],
  burger: ['itm-veg-burger', 'itm-cheese-burger', 'itm-paneer-burger', 'itm-crispy-chicken-burger', 'itm-chicken-cheese-burger'],
  salad: ['itm-veg-salad', 'itm-chicken-salad', 'itm-corn-salad', 'itm-paneer-salad'],
  'fruit-bowl': ['itm-fruit-bowl', 'itm-fruit-cream'],
  brownie: ['itm-brownie', 'itm-brownie-icecream'],
  cake: ['itm-chocolate-cake', 'itm-pastry'],
  cheesecake: ['itm-cheesecake'],
  'ice-cream': ['itm-ice-cream', 'itm-sundae'],
}

const imageByItemId = new Map<string, string>()
for (const [img, ids] of Object.entries(ITEM_IMAGES)) {
  ids.forEach((id) => imageByItemId.set(id, `/menu/${img}.svg`))
}

function buildItems(categoryId: ID, defaults: CategoryDefaults, seeds: ItemSeed[]): MenuItem[] {
  return seeds.map((s, i) => ({
    id: s.id,
    categoryId,
    name: s.name,
    description: s.desc,
    image: imageByItemId.get(s.id) ?? null,
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

const hotBeverages = buildItems(
  'cat-hot-beverages',
  { station: 'st-beverage', prep: 4, mods: ['grp-bev-prefs'] },
  [
    { id: 'itm-tea', name: 'Tea', desc: 'Classic chai, brewed strong with milk', price: 20, prep: 3, tags: ['chai'] },
    { id: 'itm-masala-tea', name: 'Masala Tea', desc: 'Chai simmered with crushed spices', price: 25, prep: 4, popular: true, tags: ['chai'] },
    { id: 'itm-ginger-tea', name: 'Ginger Tea', desc: 'Sharp fresh ginger in strong chai', price: 25, prep: 4 },
    { id: 'itm-lemon-tea', name: 'Lemon Tea', desc: 'Light black tea with a squeeze of lemon', price: 30, prep: 3 },
    { id: 'itm-green-tea', name: 'Green Tea', desc: 'Delicate, steeped just right', price: 35, prep: 3 },
    { id: 'itm-black-tea', name: 'Black Tea', desc: 'No milk, full flavour', price: 20, prep: 3 },
    { id: 'itm-coffee', name: 'Coffee', desc: 'House milk coffee, hot and quick', price: 30, prep: 3 },
    { id: 'itm-filter-coffee', name: 'Filter Coffee', desc: 'South Indian decoction, frothed in brass', price: 40, prep: 5, recommended: true },
    { id: 'itm-cappuccino', name: 'Cappuccino', desc: 'Espresso with a deep foam cap', price: 90, prep: 5, popular: true, tags: ['coffee'] },
    { id: 'itm-cafe-latte', name: 'Café Latte', desc: 'Mellow espresso with steamed milk', price: 100, prep: 5, tags: ['coffee', 'latte'] },
    { id: 'itm-cafe-mocha', name: 'Café Mocha', desc: 'Espresso meets chocolate and milk', price: 120, prep: 6, tags: ['coffee', 'mocha'] },
    { id: 'itm-espresso', name: 'Espresso', desc: 'A short, intense single shot', price: 70, prep: 3, tags: ['coffee'] },
    { id: 'itm-hot-chocolate', name: 'Hot Chocolate', desc: 'Melted chocolate, steamed milk, cocoa dust', price: 110, prep: 6 },
  ],
)

const coldBeverages = buildItems(
  'cat-cold-beverages',
  { station: 'st-beverage', prep: 5, mods: ['grp-bev-prefs'] },
  [
    { id: 'itm-cold-coffee', name: 'Cold Coffee', desc: 'Blended coffee, chilled and creamy', price: 120, popular: true },
    { id: 'itm-cold-chocolate', name: 'Cold Chocolate', desc: 'Chocolate shake with a cocoa rim', price: 130 },
    { id: 'itm-iced-coffee', name: 'Iced Coffee', desc: 'Chilled brew over ice, lightly sweet', price: 110 },
    { id: 'itm-iced-tea', name: 'Iced Tea', desc: 'Lemon iced tea, brewed in-house', price: 90 },
    { id: 'itm-lemon-soda', name: 'Lemon Soda', desc: 'Fresh lime, soda, salt or sweet', price: 60, prep: 3 },
    { id: 'itm-sweet-lime-soda', name: 'Sweet Lime Soda', desc: 'Mosambi juice topped with soda', price: 70, prep: 3 },
    { id: 'itm-mint-cooler', name: 'Mint Cooler', desc: 'Crushed mint, lime and crushed ice', price: 80 },
    { id: 'itm-mojito', name: 'Mojito', desc: 'Virgin mojito with mint and lime', price: 90, recommended: true },
    { id: 'itm-milkshake', name: 'Milkshake', desc: 'Thick shake in your pick of flavour', price: 140, prep: 6, mods: ['grp-shake-flavor', 'grp-dessert-addons', 'grp-bev-prefs'] },
  ],
)

const freshJuices = buildItems(
  'cat-fresh-juices',
  { station: 'st-juice', prep: 4, mods: ['grp-bev-prefs'] },
  [
    { id: 'itm-orange-juice', name: 'Orange Juice', desc: 'Pressed sweet oranges, no water added', price: 90, popular: true },
    { id: 'itm-watermelon-juice', name: 'Watermelon Juice', desc: 'Cold-pressed, naturally sweet', price: 70 },
    { id: 'itm-pineapple-juice', name: 'Pineapple Juice', desc: 'Tangy-sweet, pressed to order', price: 80 },
    { id: 'itm-mosambi-juice', name: 'Mosambi Juice', desc: 'Sweet lime, gentle and fresh', price: 80 },
    { id: 'itm-pomegranate-juice', name: 'Pomegranate Juice', desc: 'Deep red, pressed whole arils', price: 110, recommended: true },
    { id: 'itm-grape-juice', name: 'Grape Juice', desc: 'Dark grapes, lightly chilled', price: 80 },
    { id: 'itm-mixed-fruit-juice', name: 'Mixed Fruit Juice', desc: 'Seasonal fruits blended together', price: 100 },
    { id: 'itm-carrot-juice', name: 'Carrot Juice', desc: 'Earthy-sweet with a ginger hint', price: 70 },
  ],
)

const sandwiches = buildItems(
  'cat-sandwiches',
  { station: 'st-kitchen', prep: 8, mods: ['grp-extras', 'grp-spice', 'grp-food-prefs'] },
  [
    { id: 'itm-veg-sandwich', name: 'Veg Sandwich', desc: 'Cucumber, tomato, onion and chutney', price: 80, prep: 6, popular: true },
    { id: 'itm-cheese-sandwich', name: 'Cheese Sandwich', desc: 'Double cheese on soft white bread', price: 100, prep: 6 },
    { id: 'itm-grilled-sandwich', name: 'Grilled Sandwich', desc: 'Veg and cheese, pressed till crisp', price: 110 },
    { id: 'itm-club-sandwich', name: 'Club Sandwich', desc: 'Triple-decker with veg, cheese and egg-free mayo', price: 140 },
    { id: 'itm-paneer-sandwich', name: 'Paneer Sandwich', desc: 'Spiced paneer filling, grilled', price: 120 },
    { id: 'itm-corn-cheese-sandwich', name: 'Corn & Cheese Sandwich', desc: 'Sweet corn folded into melted cheese', price: 120 },
    { id: 'itm-chicken-sandwich', name: 'Chicken Sandwich', desc: 'Shredded chicken, herbed mayo', price: 140, veg: false, mods: ['grp-extras', 'grp-extras-nonveg', 'grp-spice', 'grp-food-prefs'] },
    { id: 'itm-chicken-club-sandwich', name: 'Chicken Club Sandwich', desc: 'Triple-decker with grilled chicken', price: 170, veg: false, recommended: true, mods: ['grp-extras', 'grp-extras-nonveg', 'grp-spice', 'grp-food-prefs'] },
  ],
)

const wraps = buildItems(
  'cat-wraps',
  { station: 'st-kitchen', prep: 8, mods: ['grp-extras', 'grp-spice', 'grp-food-prefs'] },
  [
    { id: 'itm-veg-wrap', name: 'Veg Wrap', desc: 'Crunchy veg and house sauce in a soft tortilla', price: 100 },
    { id: 'itm-paneer-wrap', name: 'Paneer Wrap', desc: 'Grilled paneer, vegetables and house sauce', price: 140, popular: true },
    { id: 'itm-mexican-wrap', name: 'Mexican Wrap', desc: 'Beans, corn, salsa and cheese', price: 130 },
    { id: 'itm-cheese-wrap', name: 'Cheese Wrap', desc: 'Melted cheese with peppers and onion', price: 120 },
    { id: 'itm-chicken-wrap', name: 'Chicken Wrap', desc: 'Grilled chicken with garlic mayo', price: 160, veg: false, mods: ['grp-extras', 'grp-extras-nonveg', 'grp-spice', 'grp-food-prefs'] },
    { id: 'itm-chicken-tikka-wrap', name: 'Chicken Tikka Wrap', desc: 'Smoky tikka chunks, mint chutney', price: 180, veg: false, popular: true, mods: ['grp-extras', 'grp-extras-nonveg', 'grp-spice', 'grp-food-prefs'] },
  ],
)

const pizzas = buildItems(
  'cat-pizza',
  { station: 'st-pizza', prep: 15, mods: ['grp-pizza-size', 'grp-extras', 'grp-spice'] },
  [
    { id: 'itm-margherita-pizza', name: 'Margherita Pizza', desc: 'Tomato base, mozzarella, basil', price: 149, popular: true },
    { id: 'itm-veg-pizza', name: 'Veg Pizza', desc: 'Capsicum, onion, tomato and olives', price: 179 },
    { id: 'itm-paneer-pizza', name: 'Paneer Pizza', desc: 'Spiced paneer with onion and capsicum', price: 209 },
    { id: 'itm-farmhouse-pizza', name: 'Farmhouse Pizza', desc: 'Loaded garden veg on a cheesy base', price: 219, recommended: true },
    { id: 'itm-corn-cheese-pizza', name: 'Corn & Cheese Pizza', desc: 'Sweet corn under a cheese blanket', price: 199 },
    { id: 'itm-chicken-pizza', name: 'Chicken Pizza', desc: 'Herbed chicken and mozzarella', price: 229, veg: false, mods: ['grp-pizza-size', 'grp-extras', 'grp-extras-nonveg', 'grp-spice'] },
    { id: 'itm-chicken-tikka-pizza', name: 'Chicken Tikka Pizza', desc: 'Tikka chicken, onion, coriander', price: 249, veg: false, popular: true, mods: ['grp-pizza-size', 'grp-extras', 'grp-extras-nonveg', 'grp-spice'] },
  ],
)

const pastas = buildItems(
  'cat-pasta',
  { station: 'st-hot', prep: 12, mods: ['grp-pasta-portion', 'grp-extras', 'grp-spice'] },
  [
    { id: 'itm-white-sauce-pasta', name: 'White Sauce Pasta', desc: 'Creamy béchamel with garlic and herbs', price: 120, popular: true },
    { id: 'itm-red-sauce-pasta', name: 'Red Sauce Pasta', desc: 'Slow-cooked tomato and basil', price: 110 },
    { id: 'itm-pink-sauce-pasta', name: 'Pink Sauce Pasta', desc: 'Best of both sauces, folded together', price: 125 },
    { id: 'itm-alfredo-pasta', name: 'Alfredo Pasta', desc: 'Rich parmesan cream sauce', price: 135 },
    { id: 'itm-arrabbiata-pasta', name: 'Arrabbiata Pasta', desc: 'Fiery tomato sauce with chilli flakes', price: 125 },
    { id: 'itm-veg-pasta', name: 'Veg Pasta', desc: 'Tossed with sautéed garden vegetables', price: 110 },
    { id: 'itm-paneer-pasta', name: 'Paneer Pasta', desc: 'Paneer cubes in a masala-tinged sauce', price: 140 },
    { id: 'itm-chicken-pasta', name: 'Chicken Pasta', desc: 'Grilled chicken in your choice of sauce', price: 155, veg: false, mods: ['grp-pasta-portion', 'grp-extras', 'grp-extras-nonveg', 'grp-spice'] },
  ],
)

const quickBites = buildItems(
  'cat-quick-bites',
  { station: 'st-kitchen', prep: 8, mods: ['grp-spice'] },
  [
    { id: 'itm-french-fries', name: 'French Fries', desc: 'Crisp, salted, always hot', price: 90, popular: true, tags: ['chips'] },
    { id: 'itm-peri-peri-fries', name: 'Peri Peri Fries', desc: 'Tossed in peri peri spice mix', price: 110 },
    { id: 'itm-cheese-fries', name: 'Cheese Fries', desc: 'Fries under molten cheese sauce', price: 130 },
    { id: 'itm-garlic-bread', name: 'Garlic Bread', desc: 'Buttery garlic loaf, toasted', price: 100 },
    { id: 'itm-cheese-garlic-bread', name: 'Cheese Garlic Bread', desc: 'Garlic bread with a cheese pull', price: 130 },
    { id: 'itm-potato-wedges', name: 'Potato Wedges', desc: 'Chunky, herbed and golden', price: 110 },
    { id: 'itm-nachos', name: 'Nachos', desc: 'Corn chips with salsa and dip', price: 120 },
    { id: 'itm-cheese-nachos', name: 'Cheese Nachos', desc: 'Loaded with cheese sauce and jalapeños', price: 150 },
    { id: 'itm-onion-rings', name: 'Onion Rings', desc: 'Crisp battered rings with dip', price: 100 },
    { id: 'itm-veg-nuggets', name: 'Veg Nuggets', desc: 'Golden veg bites, 8 pieces', price: 120 },
    { id: 'itm-chicken-nuggets', name: 'Chicken Nuggets', desc: 'Crumb-fried chicken bites, 8 pieces', price: 150, veg: false },
    { id: 'itm-chicken-popcorn', name: 'Chicken Popcorn', desc: 'Bite-size crispy chicken', price: 160, veg: false },
  ],
)

const burgers = buildItems(
  'cat-burgers',
  { station: 'st-kitchen', prep: 10, mods: ['grp-extras', 'grp-food-prefs'] },
  [
    { id: 'itm-veg-burger', name: 'Veg Burger', desc: 'Spiced veg patty, lettuce, house sauce', price: 90 },
    { id: 'itm-cheese-burger', name: 'Cheese Burger', desc: 'Veg patty with a cheese slice', price: 110 },
    { id: 'itm-paneer-burger', name: 'Paneer Burger', desc: 'Crisp paneer steak, mint mayo', price: 130, recommended: true },
    { id: 'itm-crispy-chicken-burger', name: 'Crispy Chicken Burger', desc: 'Crunchy fried chicken thigh', price: 140, veg: false, popular: true, mods: ['grp-extras', 'grp-extras-nonveg', 'grp-food-prefs'] },
    { id: 'itm-chicken-cheese-burger', name: 'Chicken Cheese Burger', desc: 'Fried chicken with melted cheese', price: 160, veg: false, availability: 'out_of_stock', mods: ['grp-extras', 'grp-extras-nonveg', 'grp-food-prefs'] },
  ],
)

const lightBites = buildItems(
  'cat-light-bites',
  { station: 'st-kitchen', prep: 6, mods: ['grp-food-prefs'] },
  [
    { id: 'itm-veg-salad', name: 'Veg Salad', desc: 'Crunchy garden veg, lemon dressing', price: 100 },
    { id: 'itm-chicken-salad', name: 'Chicken Salad', desc: 'Grilled chicken over fresh greens', price: 150, veg: false },
    { id: 'itm-fruit-bowl', name: 'Fruit Bowl', desc: 'Seasonal fruit, chaat masala on the side', price: 90 },
    { id: 'itm-corn-salad', name: 'Corn Salad', desc: 'Buttered corn, peppers, herbs', price: 100 },
    { id: 'itm-paneer-salad', name: 'Paneer Salad', desc: 'Grilled paneer with greens and seeds', price: 130 },
  ],
)

const desserts = buildItems(
  'cat-desserts',
  { station: 'st-dessert', prep: 4, mods: [] },
  [
    { id: 'itm-brownie', name: 'Brownie', desc: 'Dense, fudgy, baked in-house', price: 90, mods: ['grp-dessert-addons'] },
    { id: 'itm-brownie-icecream', name: 'Brownie with Ice Cream', desc: 'Warm brownie, vanilla scoop, chocolate sauce', price: 140, popular: true },
    { id: 'itm-chocolate-cake', name: 'Chocolate Cake', desc: 'Layered chocolate sponge slice', price: 110 },
    { id: 'itm-cheesecake', name: 'Cheesecake', desc: 'Baked cheesecake, biscuit base', price: 150, recommended: true },
    { id: 'itm-pastry', name: 'Pastry', desc: 'Cream pastry of the day', price: 80 },
    { id: 'itm-ice-cream', name: 'Ice Cream', desc: 'Two scoops, ask for flavours', price: 70, mods: ['grp-dessert-addons'] },
    { id: 'itm-sundae', name: 'Sundae', desc: 'Scoops, nuts, sauces, the works', price: 130 },
    { id: 'itm-fruit-cream', name: 'Fruit Cream', desc: 'Fresh fruit folded into sweet cream', price: 100 },
  ],
)

const items: MenuItem[] = [
  ...hotBeverages,
  ...coldBeverages,
  ...freshJuices,
  ...sandwiches,
  ...wraps,
  ...pizzas,
  ...pastas,
  ...quickBites,
  ...burgers,
  ...lightBites,
  ...desserts,
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

/* -------------------------------- Users -------------------------------- */

const users: User[] = [
  { id: 'usr-admin', name: 'Manager', role: 'admin', pin: '1234' },
  { id: 'usr-kitchen', name: 'Kitchen Crew', role: 'kitchen', pin: '5678' },
]

/* ------------------------------- Snapshot ------------------------------ */

export function seedSnapshot(): DBSnapshot {
  return structuredClone({
    schemaVersion: 5,
    categories,
    items,
    modifierGroups,
    modifierOptions,
    stations,
    tables,
    orders: [],
    bills: [],
    users,
    settings: {
      cafeName: 'Swaada Café',
      taxLabel: 'GST',
      taxRatePercent: 5,
      currency: 'INR' as const,
      askCustomerInfo: true,
      loyalty: {
        enabled: true,
        pointsPer100: 5,
        rupeesPerPoint: 1,
      },
    },
    counters: { nextOrderNumber: 1042, nextBillNumber: 501 },
  })
}
