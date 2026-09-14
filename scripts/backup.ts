/**
 * A dated copy of everything, written to disk.
 *
 * Firestore's own managed export needs the paid plan, so this does the same
 * job the plain way: read every collection, write it out as JSON. At a
 * café's volume that is a few thousand reads, well inside the free daily
 * allowance, and it finishes in seconds.
 *
 * Worth being clear about what a backup is FOR. Firestore is replicated and
 * will not lose your data to a disk failure. It will very happily keep a
 * mistake, though — a bad script, a menu cleared by accident, the wrong
 * project targeted. Replication is not a backup. A backup is a copy from
 * BEFORE the mistake, and that is this.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./sa.json npm run backup -- \
 *     --project swaada-pos-dev --outlet swaada-main
 *
 * Run it nightly from Windows Task Scheduler, or from a free GitHub Action.
 * Restoring is deliberately manual: see docs/FIREBASE_SETUP.md.
 */

import { applicationDefault, cert, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

function arg(name: string, fallback?: string): string {
  const index = process.argv.indexOf(`--${name}`)
  const value = index === -1 ? undefined : process.argv[index + 1]
  if (value === undefined || value.startsWith('--')) {
    if (fallback !== undefined) return fallback
    throw new Error(`Missing --${name}`)
  }
  return value
}

const projectId = arg('project')
const outletId = arg('outlet')
const outDir = arg('out', './backups')

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
initializeApp({
  projectId,
  credential: keyPath
    ? cert(JSON.parse(readFileSync(keyPath, 'utf8')) as Record<string, string>)
    : applicationDefault(),
})

const db = getFirestore()

/**
 * Everything under an outlet. Listed explicitly rather than discovered, so a
 * collection added later shows up as an obvious omission in this file rather
 * than silently going un-backed-up.
 */
const OUTLET_COLLECTIONS = [
  'staff',
  'stations',
  'categories',
  'items',
  'modifierGroups',
  'tables',
  'orders',
  'bills',
  'customers',
  'walletEntries',
  'auditLog',
  'devices',
  'meta',
] as const

async function dumpCollection(
  firestore: Firestore,
  path: string,
): Promise<Record<string, unknown>[]> {
  const snap = await firestore.collection(path).get()
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

async function main(): Promise<void> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = join(outDir, `${projectId}_${outletId}_${stamp}`)
  mkdirSync(dir, { recursive: true })

  const summary: Record<string, number> = {}

  const outlet = await db.collection('outlets').doc(outletId).get()
  if (!outlet.exists) {
    throw new Error(`Outlet "${outletId}" not found in project "${projectId}". Nothing written.`)
  }
  writeFileSync(
    join(dir, 'outlet.json'),
    JSON.stringify({ id: outlet.id, ...outlet.data() }, null, 2),
  )

  for (const name of OUTLET_COLLECTIONS) {
    const rows = await dumpCollection(db, `outlets/${outletId}/${name}`)
    writeFileSync(join(dir, `${name}.json`), JSON.stringify(rows, null, 2))
    summary[name] = rows.length
  }

  // The two root collections that live outside any outlet.
  for (const name of ['staffIndex', 'usernames'] as const) {
    const rows = await dumpCollection(db, name)
    writeFileSync(join(dir, `${name}.json`), JSON.stringify(rows, null, 2))
    summary[name] = rows.length
  }

  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({ projectId, outletId, takenAt: new Date().toISOString(), counts: summary }, null, 2),
  )

  console.log(`\nBackup written to ${dir}\n`)
  for (const [name, count] of Object.entries(summary)) {
    console.log(`  ${String(count).padStart(6)}  ${name}`)
  }
  const total = Object.values(summary).reduce((a, b) => a + b, 0)
  console.log(`\n  ${total} documents in total.\n`)
  if (total === 0) {
    console.warn('That is suspiciously empty. Check the project and outlet ids.\n')
  }
}

main().catch((error: unknown) => {
  console.error('\nBackup failed:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
