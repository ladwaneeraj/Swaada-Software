/**
 * Create a new outlet and its first manager.
 *
 * This is the one thing that cannot be done from inside the app, for a
 * simple reason: only a manager can create a login, and until this runs
 * there is no manager. A user made by hand in the Firebase console can sign
 * in and then do precisely nothing, because it has no staff record — which
 * is the correct behaviour, and baffling if you don't know why.
 *
 * So the first manager is made here, with a service account, once per
 * environment. Every login after that is created by that manager inside the
 * app, on the Staff screen.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./sa.json \
 *   npm run bootstrap -- \
 *     --project swaada-pos-dev \
 *     --outlet swaada-main \
 *     --name "Swaada Café" \
 *     --admin spoorthi \
 *     --admin-name "Spoorthi" \
 *     --password "a-real-password"
 *
 * Against the emulator, set FIRESTORE_EMULATOR_HOST and
 * FIREBASE_AUTH_EMULATOR_HOST instead of credentials.
 */

import { cert, initializeApp, applicationDefault } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { readFileSync } from 'node:fs'
import { seedCatalogue } from '../src/data/seed'
import { DEFAULT_SETTINGS } from '../src/data/defaultSettings'
import type { ModifierOption } from '../src/types'

/* ------------------------------ arguments ------------------------------ */

function arg(name: string, fallback?: string): string {
  const index = process.argv.indexOf(`--${name}`)
  const value = index === -1 ? undefined : process.argv[index + 1]
  if (value === undefined || value.startsWith('--')) {
    if (fallback !== undefined) return fallback
    throw new Error(`Missing --${name}`)
  }
  return value
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

const projectId = arg('project')
const outletId = arg('outlet')
const outletName = arg('name')
const adminUsername = arg('admin').trim().toLowerCase()
const adminName = arg('admin-name')
const adminPassword = arg('password')
const emailDomain = arg('email-domain', 'staff.swaada.local')
const force = flag('force')

if (adminPassword.length < 8) {
  throw new Error('--password must be at least 8 characters')
}
if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(adminUsername)) {
  throw new Error('--admin must be 3-30 chars: lowercase letters, numbers, dot, dash, underscore')
}

/* ------------------------------ credentials ---------------------------- */

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
const usingEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST)

initializeApp({
  projectId,
  credential: usingEmulator
    ? undefined
    : keyPath
      ? cert(JSON.parse(readFileSync(keyPath, 'utf8')) as Record<string, string>)
      : applicationDefault(),
})

const db = getFirestore()
const auth = getAuth()

/* -------------------------------- main --------------------------------- */

async function main(): Promise<void> {
  console.log(`\nOutlet  : ${outletId} (${outletName})`)
  console.log(`Project : ${projectId}${usingEmulator ? '  [EMULATOR]' : ''}`)
  console.log(`Manager : ${adminUsername} (${adminName})\n`)

  const outletRef = db.collection('outlets').doc(outletId)
  const existing = await outletRef.get()
  if (existing.exists && !force) {
    throw new Error(
      `Outlet "${outletId}" already exists. Re-running would overwrite its menu and reset its ` +
        `numbering. Pass --force only if that is genuinely what you want.`,
    )
  }

  const now = new Date().toISOString()
  const seed = seedCatalogue()

  /* 1. the outlet itself */
  await outletRef.set({
    name: outletName,
    slug: outletId,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })

  /* 2. settings and numbering */
  await outletRef.collection('meta').doc('settings').set({
    ...DEFAULT_SETTINGS,
    cafeName: outletName,
  })
  await outletRef.collection('meta').doc('sequences').set(seed.sequences)

  /* 3. the starting catalogue, in batches of 400 (the limit is 500) */
  const optionsByGroup = new Map<string, ModifierOption[]>()
  for (const option of seed.modifierOptions) {
    optionsByGroup.set(option.modifierGroupId, [
      ...(optionsByGroup.get(option.modifierGroupId) ?? []),
      option,
    ])
  }

  const writes: Array<[string, string, Record<string, unknown>]> = [
    ...seed.stations.map((r) => ['stations', r.id, r] as [string, string, Record<string, unknown>]),
    ...seed.categories.map((r) => ['categories', r.id, r] as [string, string, Record<string, unknown>]),
    ...seed.items.map((r) => ['items', r.id, r] as [string, string, Record<string, unknown>]),
    ...seed.tables.map((r) => ['tables', r.id, r] as [string, string, Record<string, unknown>]),
    ...seed.modifierGroups.map(
      (g) =>
        ['modifierGroups', g.id, { ...g, options: optionsByGroup.get(g.id) ?? [] }] as [
          string,
          string,
          Record<string, unknown>,
        ],
    ),
  ]

  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch()
    for (const [collection, id, data] of writes.slice(i, i + 400)) {
      // The id lives in the path, not in the document — same as the client's
      // converters, so a row written here reads back identically.
      const { id: _drop, ...rest } = data as { id?: string }
      batch.set(outletRef.collection(collection).doc(id), rest)
    }
    await batch.commit()
  }
  console.log(`Wrote ${writes.length} catalogue rows.`)

  /* 4. the first manager */
  const email = `${adminUsername}@${emailDomain}`
  let uid: string
  try {
    const found = await auth.getUserByEmail(email)
    uid = found.uid
    await auth.updateUser(uid, { password: adminPassword, displayName: adminName })
    console.log(`Manager "${adminUsername}" already existed — password and name updated.`)
  } catch {
    const created = await auth.createUser({ email, password: adminPassword, displayName: adminName })
    uid = created.uid
    console.log(`Created manager "${adminUsername}".`)
  }

  /**
   * Three documents, and all three matter:
   *
   *   staff        the role itself. The security rules read this on every
   *                request, so this document IS the permission.
   *   staffIndex   how a freshly signed-in browser discovers which outlet it
   *                belongs to, before it is allowed to read anything else.
   *   usernames    the claim on the name, so nobody else can take it later.
   *
   * Without the index entry, this manager could sign in and the app would
   * have no idea where to look for them.
   */
  const batch = db.batch()
  batch.set(outletRef.collection('staff').doc(uid), {
    outletId,
    username: adminUsername,
    displayName: adminName,
    role: 'admin',
    isActive: true,
    createdBy: 'bootstrap',
    createdAt: now,
    updatedAt: now,
  })
  batch.set(db.collection('staffIndex').doc(uid), {
    outletId,
    username: adminUsername,
  })
  batch.set(db.collection('usernames').doc(adminUsername), {
    uid,
    outletId,
  })
  await batch.commit()

  console.log(`\nDone. Sign in with username "${adminUsername}".`)
  console.log('Create the rest of the staff from Settings → Staff inside the app.\n')
}

main().catch((error: unknown) => {
  console.error('\nBootstrap failed:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
