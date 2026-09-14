# Swaada POS — architecture

Written for whoever picks this up next, including future us. It explains the
decisions that are not obvious from reading the code, and the ones that would
look like mistakes without the reasoning attached.

---

## The shape of it

A React app talking straight to Firestore. Nothing else.

```
  Browser (React + Zustand)
      |
      |  reads   : scoped onSnapshot listeners, plus one-off queries
      |  writes  : writeBatch, straight to Firestore
      v
  Firestore  ──  security rules enforce roles and the order state machine
```

There is **no API server and no Cloud Functions**. Every read and write the
counter makes goes direct, which is what makes the app fast and, more
importantly, what lets it keep working when the café's wifi drops.

That is partly a preference and partly a constraint. Cloud Functions cannot
be deployed on Firebase's free plan, and this café is on the free plan. A few
decisions below look unusual on their own and only make sense read as
"the browser has to do this, because there is no server" — each of those is
marked, along with what it would become on a paid plan. See **Moving to
Blaze** at the end.

---

## The decision that shaped everything else

The prototype kept the entire database in one object in memory. Every screen
filtered it. That was the right call for a mock — and the wrong one against a
real database, because it means downloading the cafe's whole trading history
on every app start, getting slower and dearer every day it stays open.

So the app holds only what is happening **now**:

| Held in memory | Queried on demand |
|---|---|
| The menu, tables, stations, staff, settings | History |
| Unsettled rounds | Analytics |
| Today's bills and wallet movements | Customer search |
| The ledgers of guests currently seated | A guest's own bills |

Steady-state reads are therefore roughly constant no matter how long the cafe
has been open. A manager who opens last month's numbers pays for last month's
numbers, once. A cook who never opens that screen pays nothing.

Everything hangs off a `businessDate` field (`YYYY-MM-DD`, in the outlet's
timezone). It is what every bounded query filters on, and it is what makes a
1am bill land in the right day's drawer.

---

## Why batches and not transactions

Every write in the app is a `writeBatch`. Not one is a transaction, and that
is on purpose.

A Firestore transaction needs a live round trip. A batch is queued locally,
applied to the on-device cache immediately, and synced when the connection
returns. For a POS that difference is the whole product: the counter must be
able to take an order and settle a bill during an outage, not watch a spinner.

The correctness a transaction would have given is enforced **on the server by
the security rules instead** — they implement the order state machine:

```
placed → preparing → ready → delivered → settled
                                      ↘  cancelled
```

A settled round cannot be edited by anyone. That single rule is what makes
the offline settle path safe: if two devices somehow close the same table,
the second batch is rejected by Firestore rather than quietly writing a
second bill.

**Bills and wallet entries are immutable.** No update rule, no delete rule,
not even for a manager. A receipt that can be edited afterwards is not a
receipt, and a balance is the signed sum of a ledger, so an editable ledger
means an untraceable balance. Corrections are new rows with a required note,
which also land in the audit log.

---

## Order and bill numbers that survive an outage

The obvious design — read a counter, add one, write it back inside a
transaction — breaks the moment the wifi drops.

So each device **reserves a block** of numbers while it is online (100 order
numbers, 50 bill numbers) and hands them out locally, topping the block up in
the background once it is three-quarters used. Reserving costs one
transaction and then covers roughly a day of offline trading.

The trade-off, stated plainly: a device retired or storage-cleared mid-block
leaves a gap in the sequence. That is acceptable **because no GST is charged
anywhere in this app**, so there is no legal requirement for a gapless
invoice series. If that ever changes, `src/services/firebase/sequences.ts` is
the file to revisit.

---

## Roles live in a document, read by the rules

The obvious place for a role is a **custom claim** on the auth token: free to
check, impossible to forge. Custom claims can only be written by the Admin
SDK, which needs a server, which needs a paid plan. So the role lives in
`/outlets/{id}/staff/{uid}` instead, and the security rules read it with a
`get()` on every request.

What that costs: one document read per request. At this café's volume, a few
thousand a day against a free allowance of fifty thousand.

What it buys, beyond running for nothing:

- **A role change lands on the next request.** With claims, a demoted
  manager keeps their old powers until their token refreshes, which can be
  most of an hour. For sacking someone mid-shift, re-reading is the better
  behaviour, not the consolation prize.
- Same for switching a login off. `isActive: false` bites immediately.

The client still cannot promote itself, because the rules read the same
document server-side. A counter login editing its own staff row is refused by
a rule that checks the *current* document — the write cannot vouch for
itself. There is a test for exactly that.

Three documents make a login work, and all three are written in one batch:

| | |
|---|---|
| `/outlets/{id}/staff/{uid}` | the role. This IS the permission. |
| `/staffIndex/{uid}` | which outlet a uid belongs to. A freshly signed-in browser must read this *before* it knows which outlet path it may look in, so it sits outside every outlet and holds no role. |
| `/usernames/{username}` | the claim on the name. A browser cannot ask Firebase Auth whether an account exists, so without this the only way to find a clash is to try creating it — burning a real, undeletable auth user on every typo. |

Staff sign in with a **username**, not an email. Firebase Auth only does
email/password, so `ramesh` becomes `ramesh@staff.swaada.local` internally.
That domain receives no mail and nobody needs to own it. No staff member ever
sees it.

### Creating a login from a browser

`createUserWithEmailAndPassword` does not merely create a user — it signs in
as that user. Called normally, a manager adding a cook would find themselves
logged in as the cook, mid-service. So `secondaryAuth.ts` spins up a second
Firebase app instance pointed at the same project, creates the account there,
signs that instance out and disposes of it. The main session never notices.

A well-worn workaround rather than a clever one, and the part of this design
that would get simplest on a paid plan.

### The one thing that genuinely cannot be done

**A manager cannot set another person's password.** The client SDK has no
such method and never will. So the recovery path for a forgotten password is
`replaceLogin`: a new username for the same person, the old one switched off,
and a note on the old row pointing at the new one. Their name on past rounds
and bills is untouched, because those store the name as text rather than as a
link.

### What each role can actually do

Enforced by `firestore.rules`, not by hiding buttons:

| | Manager | Counter | Kitchen |
|---|---|---|---|
| Menu, tables, settings | edit | read | read |
| Take orders, correct rounds | yes | yes | no |
| Mark items cooking / ready | yes | yes | yes |
| Bills, guests, wallets | yes | yes | **no access at all** |
| Analytics, audit log | yes | no | no |
| Staff logins | yes | no | no |

A kitchen tablet on a wall physically cannot be used to read what the café
took today. A manager also cannot demote or switch off *themselves* — that
is the one edit that can leave a café with no way back into its own till, so
the rules refuse it. Hand the role over first, then step down.

---

## The one cache in the system

`Customer.balance` is a cached copy of the wallet balance. Everything else in
this app refuses to store a derived number, so it needs justifying.

Without it, "who owes me money" would mean reading every guest's whole ledger
— the exact unbounded read the rest of the design avoids. With it, that
question is one query.

It stays honest because it is **never assigned**. Every wallet entry is
written in the same atomic batch as an `increment()` on this field, so the
two move together or not at all, offline included. Every screen showing a
single guest recomputes their balance from the ledger, so if it ever does
drift, the cheap number is the one that looks wrong.

---

## Layout

```
src/
  lib/                 pure helpers — dates, money formatting, errors
  services/
    rules.ts           ALL the cafe's arithmetic. No network, no clock.
    <domain>.ts        one module per thing that writes
    firebase/          app, paths, converters, listeners, queries, sequences
    context.ts         who is signed in, so services need fewer arguments
  store/               one Zustand store, fed by the listeners
  features/            screens
  components/          shared UI
tests/                 money arithmetic, business dates, security rules
scripts/bootstrap.ts   creates an outlet and its first manager
scripts/backup.ts      dumps everything to dated JSON
```

`rules.ts` being separate is load-bearing: the bill and wallet arithmetic did
not have to be rewritten when the backend changed, and it can be tested with
plain objects in milliseconds rather than against an emulator.

---

## What is deliberately not built

- **Archiving old orders.** Because queries are scoped by `businessDate`, old
  rounds are never read and cost nothing but storage — which is fractions of
  a rupee a year at this volume. Moving them would be work with no benefit.
  If it is ever wanted, a Firestore TTL policy is the mechanism, not a job.
- **An "all time" analytics view.** It is the one query whose cost grows
  without limit. A yearly total belongs in a nightly rollup document, not in
  something a manager can fire by tapping a chip.
- **Automated restore.** Rare, destructive, and a button for it is a button
  that gets pressed by accident. The procedure is in `FIREBASE_SETUP.md`.
- **Firestore's managed export.** It needs a paid plan. `scripts/backup.ts`
  does the same job by reading every collection and writing JSON — a few
  thousand reads, seconds to run, free.
- **Deleting staff.** Every round and bill carries the name of who took it.
  Logins are switched off, which revokes the session and leaves history
  readable.

---

## Known limitations

Worth knowing before they surprise someone:

1. **One signed-in staff member per browser profile.** Firebase Auth stores
   the session per origin, not per tab. To run the kitchen display beside the
   counter on one machine, open `/kitchen` in a second window under the same
   login (managers and counter staff may both view it), or use a second
   browser profile.
2. **Two devices touching the same round in the same second** can overwrite
   each other's item statuses, because the kitchen writes the whole `items`
   array. The consequence is a tick flipping back and a cook tapping again.
   Money-affecting writes are guarded by the rules; this one is not worth the
   reads a subcollection-per-item would cost.
3. **Guest search cannot match names exactly.** Firestore can range over a
   string prefix but cannot search inside one. A number is a prefix query; a
   name is a client-side filter over a bounded recent page. If that stops
   being good enough, the answer is a search service, not more queries.
4. **A manager cannot reset someone else's password** (see above). The
   recovery path is a replacement login.
5. **Rules cost one document read per request**, for the staff lookup. Fine
   at this volume; worth revisiting if the café ever runs several busy
   branches off one project.
6. **A creation that half-fails leaves an orphan auth user.** If the account
   is created but the Firestore batch then fails, the username is taken by a
   login that can sign in and do nothing. The app says so plainly; clearing
   it needs the Firebase console. Pre-checking the username claim makes this
   rare rather than impossible.
5. **The JS bundle is about 1.1 MB (320 KB gzipped)**, most of it the
   Firebase SDK. Fine over wifi, worth code-splitting if the cafe ever runs
   this on a phone over mobile data.

---

## Moving to Blaze later

Nothing here has to be undone to upgrade. The paid plan would buy three
things, in order of how much they are worth:

1. **A manager resetting someone's password.** A single callable using
   `auth.updateUser()`. This is the only capability currently missing.
2. **Firestore's managed export** instead of the JSON dump — mainly better
   restore ergonomics, not better safety.
3. **Roles back in custom claims**, saving one document read per request.
   Worth doing only if the read volume ever becomes interesting, and it costs
   the instant-revocation property, so it is not obviously an upgrade.

The contained change for (1) is: add a `functions/` folder with one callable,
point `staffService.replaceLogin` at a `resetPassword` call instead, and
leave everything else alone. Nothing about the data model or the rules moves.

---

## Explain like you are five

The old version was like carrying every notebook the cafe has ever filled,
everywhere, all day. The new version keeps today's notebook in your hand and
leaves the rest on a shelf. When you want an old one, you go and get it.

Each person gets their own key. The key itself says what doors it opens, and
the doors check the key — so nobody can draw themselves a new key on paper
and walk in. The cook's key opens the kitchen and does not open the money
drawer, and that is true even if the cook is very clever with a computer.

Once a bill is written down, nobody can rub it out. Not even the boss. If it
was wrong, you write a new line saying so, and both lines stay.

And if the internet stops, the cafe keeps working. Everything gets written
down on paper in your pocket and copied into the big book when the internet
comes back.
