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

Login as Manager → Tables → tap L3 → add Cold Coffee, Veg Sandwich (tap the
card body to customise: extras, spice, "Cut sandwich in half"), French Fries →
Place order. In the kitchen tab: Start preparing → tap each item as it
finishes → the order flips to READY by itself. Back in admin: Mark delivered →
Mark served → L3 is available again. Also try: marking an item out of stock in
Menu (it becomes unselectable on the order screen immediately), search
("coffee" also finds Cappuccino/Latte/Mocha via configurable keywords),
drag-reordering categories, and cancelling an order.

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
  modifier groups, stations, tables, tax and even status labels/colors come
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
- One active order per table is the assumed flow; placing a second shows a
  warning but is allowed.
- Images are configurable in the data model (`image` on items/categories) but
  the seed ships without photos; cards fall back to the category icon.
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
