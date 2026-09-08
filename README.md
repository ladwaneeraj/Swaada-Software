# Swaada Café — Order System

Frontend prototype of a café POS: admin order-taking, live order tracking, a
kitchen display, and fully configurable menu management. No backend yet — the
whole thing runs on mock data behind a service layer that is shaped to be
swapped for Supabase/PostgreSQL later.

## Run it

```bash
npm install
npm run dev
```

Requires Node 20+. Open the printed URL (usually http://localhost:5173).

Demo logins (PIN pad on the login screen):

| Role    | User         | PIN  |
| ------- | ------------ | ---- |
| Admin   | Manager      | 1234 |
| Kitchen | Kitchen Crew | 5678 |

To see realtime sync, open two tabs: log one in as Manager and one as Kitchen
Crew. Sessions are per-tab on purpose (sessionStorage), while data is shared
(localStorage + BroadcastChannel), so an order placed in the admin tab appears
on the kitchen tab instantly, and item/order status flows back the same way.

## The demo flow

A table orders in ROUNDS and pays once at the end. Login as Manager → Tables
→ tap L3 → optionally enter the customer's name/mobile (asked on the first
round; toggle in Settings) → add Cold Coffee, Veg Sandwich (tap the card body
to customise), French Fries → Place order. In the kitchen tab: Start
preparing → tap items as they finish → the ticket flips to READY by itself →
tap "Delivered to table" (the kitchen delivers; admin doesn't). Back in
admin, tap L3 again: the running bill opens — add more rounds, or once
everything is delivered, type a ₹ discount if one is due, split the amount
between Cash and UPI (type one box, the other fills the rest) and Take
payment. That settles all rounds into one bill and frees the table. Also try: marking an item out of
stock in Menu (it becomes unselectable on the order screen immediately),
search ("coffee" also finds Cappuccino/Latte/Mocha via configurable
keywords), drag-reordering categories, and cancelling a round that hasn't
been delivered yet.

Keyboard on the order screen: `/` focuses search, `Enter` adds the first
match, `Esc` closes the customisation sheet, `Enter` confirms it.

## Architecture

```
UI (React components)
  ↓ read via zustand selectors, write via services
Store (src/store/useAppStore.ts — one state tree for Admin AND Kitchen)
  ↓
Services (src/services/index.ts — menu/order/kitchen/table/auth/settings)
  ↓
Mock DB (src/services/db.ts — localStorage snapshot, single source of truth)
  +
Realtime channel (src/services/realtime.ts — BroadcastChannel behind an interface)
```

Rules the code follows:

- **Nothing menu-related is hard-coded in components.** Categories, items,
  prices, images, availability, ordering, veg flags, prep times, badges,
  modifier groups, stations, tables and even status labels/colors come
  from data (`src/data/seed.ts`) or config maps (`src/lib/statusMeta.ts`).
- **Components never touch persistence.** They call service functions;
  services mutate the mock DB and emit typed events (`ORDER_CREATED`,
  `ITEM_READY`, `ORDER_READY`, …).
- **Order lines are denormalised snapshots** (name, price, station, modifiers
  frozen at order time), so deleting or editing menu items never corrupts
  history. Category/item deletes are effectively archives from the order
  history's point of view.
- **Kitchen routing is in the data now.** Every item carries a `stationId`
  and every order line carries its station; one screen shows all stations
  today, and a per-station kitchen later is a filter, not a rebuild.

## Swapping in a real backend later

1. **Database**: create tables mirroring `src/types/index.ts`
   (categories, menu_items, modifier_groups, modifier_options, stations,
   tables, orders, order_items). IDs are strings ready to become UUIDs;
   timestamps are ISO strings.
2. **Services**: reimplement the function bodies in `src/services/index.ts`
   as API/Supabase calls (they will become `async`; the call sites are thin).
   `src/services/db.ts` disappears.
3. **Realtime**: implement the `RealtimeChannel` interface in
   `src/services/realtime.ts` over Supabase Realtime / WebSockets / Firebase.
   The event vocabulary is already defined in `src/types`.
4. **Auth**: replace the PIN mock in `authService` with real auth; the
   `Session` shape and route guards stay.

Components should not need edits for any of the above.

## Layout of src/

| Path | What lives there |
| --- | --- |
| `types/` | All domain models + realtime event types |
| `data/seed.ts` | Sample menu/tables/users — data only, no UI references |
| `services/` | Service layer, mock DB, realtime channel |
| `store/` | Zustand store binding the DB to React |
| `lib/` | Utilities, status metadata config, timer hook |
| `components/` | UI kit, layouts, shared order/kitchen pieces |
| `features/` | One folder per screen (admin/*, kitchen, auth) |

## Known limits of the prototype

- Realtime sync is same-browser only (BroadcastChannel); two devices need the
  real backend.
- Payments record how much came in as cash and how much as UPI, and the two
  legs always add up to the bill — but there is no UPI integration, change
  calculation or refund flow yet.
- Bills are charged at menu price: there is no tax anywhere in the system.
- Menu photos are drop-in: a file in `src/assets/menu-photos/` named after an
  item id (`paneer-pizza.webp`) replaces that item's illustration on the next
  build. Items with no photo keep the bundled illustration; items with
  neither show the category icon.
- The connection badge reports browser online/offline, standing in for socket
  state until a backend exists.

## Deploying to GitHub Pages

The repo ships with `.github/workflows/deploy.yml`. It builds with
`BASE_PATH=/Swaada-Software/` (so assets and routes work under the sub-path)
and publishes `dist/` to Pages. The build also copies `index.html` to
`404.html`, which is how deep links like `/admin/tables` survive a refresh on
Pages.

One-time setup:

1. Push the code to `main`.
2. On github.com → repo → Settings → Pages → set **Source** to
   **GitHub Actions**.

Every push to `main` then deploys to
`https://<your-username>.github.io/Swaada-Software/`. Note that this is a
static prototype: all data lives in each visitor's browser, and admin/kitchen
sync only works between tabs of the same browser.
