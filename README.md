# Swaada Café POS

Order management for a small family-run café: take orders at the table in
rounds, route them to the right kitchen station, settle one bill at the end,
and keep a guest's wallet and dues straight.

React + TypeScript + Vite on the front, Firebase (Firestore, Auth, Hosting)
behind it. Works offline, and runs entirely on Firebase's free plan.

---

## Getting it running

You need a Firebase project first. `docs/FIREBASE_SETUP.md` walks through
that from an empty Google account; it takes about 40 minutes, most of it
waiting.

Then:

```bash
npm install
cp .env.example .env.local        # paste your Firebase web config in
```

Create the first outlet and its manager. This is the one thing that cannot be
done inside the app, because only the Admin SDK can set the custom claims the
whole permission system rests on:

```bash
# Download a service account key: Firebase console -> Project settings
# -> Service accounts -> Generate new private key
GOOGLE_APPLICATION_CREDENTIALS=./sa.json npm run bootstrap -- \
  --project swaada-pos-dev \
  --outlet swaada-main \
  --name "Swaada Café" \
  --admin spoorthi \
  --admin-name "Spoorthi" \
  --password "pick-a-real-one"
```

Deploy the rules and indexes, or every read will be denied:

```bash
npm run deploy:rules
```

Then:

```bash
npm run dev
```

Sign in with the username and password you just set. Create the counter and
kitchen logins from **Staff** inside the app.

---

## Commands

| | |
|---|---|
| `npm run dev` | Local dev server |
| `npm run build` | Typecheck, then production build |
| `npm run typecheck` | Types only |
| `npm run lint` | oxlint |
| `npm test` | Money arithmetic and business-date tests. No emulator needed. |
| `npm run test:rules` | Security rules, against the Firestore emulator. Needs Java. |
| `npm run emulators` | The full emulator suite |
| `npm run bootstrap` | Create an outlet and its first manager |
| `npm run backup` | Dump every collection to dated JSON |
| `npm run deploy:rules` | Rules and indexes only |
| `npm run deploy:dev` / `deploy:prod` | Everything, to that project |

---

## How it is put together

`docs/ARCHITECTURE.md` has the reasoning. The short version:

- **The app holds only what is happening now** — the menu, the floor,
  unsettled rounds, today's money. History is queried on demand, so read cost
  stays flat however long the café has been open.
- **Every write is a batch, never a transaction**, so the counter keeps
  working through a wifi drop. Correctness is enforced server-side by the
  security rules, which implement the order state machine.
- **Roles live in the staff document**, read by the security rules on every
  request. Costs one read; in exchange, demoting or switching someone off
  takes effect on their next action rather than an hour later.
- **Bills and wallet entries cannot be edited or deleted by anyone.**
  Corrections are new rows.

Two things worth knowing before they surprise you: one signed-in staff
member per browser profile, and a manager cannot reset someone else's
forgotten password — they issue a replacement login instead. Both are
explained in `docs/ARCHITECTURE.md`.

---

## Layout

```
src/
  lib/          pure helpers — dates, money formatting, errors, monitoring
  services/
    rules.ts    all the café's arithmetic. No network, no clock.
    <domain>.ts one module per thing that writes
    firebase/   app, paths, converters, listeners, queries, number blocks
  store/        one Zustand store, fed by the listeners
  features/     screens
  components/   shared UI
tests/          money, dates, security rules
scripts/        bootstrap, backup
```

Screens import from `@/services` and nothing deeper.
