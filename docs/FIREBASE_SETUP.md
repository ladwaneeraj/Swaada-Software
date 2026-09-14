# Swaada POS — Firebase setup, empty account to production

Work top to bottom. Roughly 40 minutes of clicking, most of it waiting for
things to provision. Anything you can't finish, skip and come back; the
order only matters where it says so.

The Firebase console gets redesigned every few months, so menu labels may
have moved slightly. The names of the things you're looking for have not.

---

## Before you start: two decisions that cannot be undone

**1. The Firestore region is permanent.** Pick `asia-south1` (Mumbai). It is
the closest region to Davangere, so every read and write is roughly 30-40ms
instead of 250ms via Iowa. Changing it later means creating a new project and
migrating the data by hand.

**2. Project IDs are permanent and globally unique.** `swaada-pos-prod` may
already be taken by a stranger. Firebase will offer to append random
characters. Accept whatever it gives you and write it down, rather than
inventing a worse name.

---

## Step 1 — Create two projects

You need two, not one. The reason is simple: you will want to try things,
and you cannot try things on the database holding real bills.

1. Go to https://console.firebase.google.com
2. **Add project** → name it `swaada-pos-dev` → Continue
3. Google Analytics: **turn it off**. It is a separate product with its own
   consent obligations and this app has no use for it.
4. Wait for provisioning, then **Continue**
5. Repeat the whole step for `swaada-pos-prod`

Write down both project IDs. The console shows them under
**Project settings → General → Project ID**. They are not always the same as
the name you typed.

---

## Step 2 — Turn on Authentication (both projects)

For each project:

1. Left sidebar → **Build → Authentication** → **Get started**
2. **Sign-in method** tab → **Email/Password** → enable the first toggle
   (Email/Password). Leave "Email link (passwordless sign-in)" **off**.
3. Save

Yes, email, even though your staff will type a username. The app converts
`ramesh` into `ramesh@staff.swaada.local` behind the scenes. That domain
receives no mail and nobody needs to own it — Firebase only needs the address
to be well-formed and unique. No cook ever sees an email field.

**Also do this, in prod especially:** Authentication → **Settings** →
**User actions** → uncheck **Enable create (sign-up)** if the option is
present. Staff accounts are created by you through the admin screen, never by
someone hitting the API. The security rules already make a claimless account
useless, but shutting the door is better than relying on the lock.

---

## Step 3 — Create the Firestore database (both projects)

For each project:

1. **Build → Firestore Database** → **Create database**
2. Location: **asia-south1 (Mumbai)**. Read the warning above again.
3. Start in **production mode** (locked). Not test mode — test mode opens the
   whole database to the internet for 30 days, and people forget.
4. Create

The database will be completely locked until we deploy the rules file. That
is expected. Do not "fix" it by loosening the rules in the console; the rules
live in the repo and get deployed from there.

---

## Step 4 — Stay on the free Spark plan

Nothing to do here. This is a step so you don't go looking for the one that
used to be here.

The app was originally built assuming the paid Blaze plan, because Cloud
Functions cannot be deployed without it and functions are the normal way to
create staff accounts and run scheduled backups. Blaze turned out to be
blocked by a Google Payments problem on the India side, so the app was
rebuilt to need neither.

What that costs you, exactly one thing: **a manager cannot set a new password
for someone who has forgotten theirs.** The client SDK has no method for it.
Instead the Staff screen offers "Replace login", which makes that person a
new username and switches the old one off. Everything they have already done
keeps their name on it.

What it costs in money: nothing. The whole app runs inside the free tier —
50,000 document reads and 20,000 writes per day, against an expected use of
roughly a tenth of that.

If you do get Blaze working later, `docs/ARCHITECTURE.md` has a section on
what changes. Short version: add one Cloud Function for password resets, and
leave everything else alone.

---

## Step 5 — Register the web app and collect the config (both projects)

For each project:

1. **Project settings (⚙️) → General → Your apps → Web (`</>`)**
2. App nickname: `swaada-pos` → **Register app**
3. Do **not** tick "Firebase Hosting" here — we set that up from the CLI
4. Copy the `firebaseConfig` block it shows you

You'll get something shaped like this:

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "swaada-pos-dev.firebaseapp.com",
  projectId: "swaada-pos-dev",
  storageBucket: "swaada-pos-dev.firebasestorage.app",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abc123..."
};
```

**These values are not secret.** They identify the project; they authorise
nothing. Every Firebase web app ships them in its JavaScript bundle. What
protects your data is the security rules plus the role in the signed-in
user's token. Do not spend effort hiding them, and do not panic when you see
them in the browser's network tab.

Keep both blocks somewhere you can find them. I'll tell you exactly where to
paste them once the code is ready.

---

## Step 6 — Install the tooling (your machine, once)

```powershell
npm install -g firebase-tools
firebase login
```

`firebase login` opens a browser. Use the Google account that owns the
projects.

Check it worked:

```powershell
firebase projects:list
```

Both projects should appear. If `firebase` is not recognised after install,
close and reopen PowerShell.

---

## Step 7 — Backups

Firestore's own managed export needs the paid plan, so backups are a plain
read-everything-to-JSON job instead:

```powershell
npm run backup -- --project swaada-pos-prod --outlet swaada-main
```

It writes a dated folder under `./backups` with one JSON file per collection
and a manifest counting what it took. A few thousand reads, seconds to run,
free.

Worth being clear what a backup is for. Firestore is replicated and will not
lose your data to a disk failure. It will very happily keep a **mistake**,
though — a bad script, a menu cleared by accident, the wrong project
targeted. Replication is not a backup; a copy from before the mistake is.

Run it however suits you:

- **By hand** before anything risky. This is the one that actually matters.
- **Windows Task Scheduler**, nightly, pointed at the command above.
- **GitHub Actions** — already written in `.github/workflows/deploy.yml`.
  It fires at 03:00 India time and keeps 30 days of copies as build
  artifacts. Needs two repository secrets: `FIREBASE_SERVICE_ACCOUNT_PROD`
  and `OUTLET_ID`.

**Restoring** is deliberately manual and deliberately not a button. Read the
JSON, check it is the night you meant, and write it back with a short script
using the Admin SDK. Do it against the dev project first.

---

## Step 8 — Things you do NOT need to do

Worth saying explicitly, because every Firebase tutorial tells you to:

- **Do not enable Google Analytics.** Separate product, separate consent
  obligations, no use here.
- **Do not enable Cloud Storage for Firebase** yet. Menu photos currently
  ship in the repo as files. If you later want the manager to upload photos
  from the phone, that is when we turn it on — and that one does need Blaze.
- **Do not keep retrying the Blaze upgrade.** Each attempt places another ₹2
  hold on your card and the outcome will not change. It is a payments-profile
  problem, and only Cloud Billing Support can clear it.
- **Do not touch the Firestore rules in the console.** They live in
  `firestore.rules` in the repo and are deployed from there. A rule edited in
  the console gets silently overwritten on the next deploy, which is a very
  confusing afternoon.
- **Do not create any users by hand in the Authentication tab.** The first
  admin comes from a bootstrap script that also writes the role into the
  token. A hand-made user has no role and cannot do anything.

---

## What I need from you when you're done

Just confirm these and I'll wire them in:

1. Both project IDs
2. Both `firebaseConfig` blocks

---

## Explain like you are five

You are opening two toy shops that are exactly the same. One is a pretend
shop where you practise, and one is the real shop where real money comes in.
That way, when you want to try moving the shelves around, you do it in the
pretend shop and nobody's real money gets lost.

You tell Google to put both shops in Mumbai, because that is the closest
place and things get there fastest.

You do not give Google a card at all. The shop is small enough that Google
lets you use it for free, and everything this café does fits inside what
they give away.

Then Google gives you a name tag for each shop. The name tag is not a secret
and it is fine if people see it, because the name tag does not open any
doors. The locks on the doors are a different thing, and I am building those.
