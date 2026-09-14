import { AppError } from '@/lib/errors'
import type { LiveSnapshot, Session } from '@/types'

/**
 * Who is signed in, and which outlet they are working in.
 *
 * Every write needs both: the outlet to build the Firestore path, and the
 * staff member to stamp on the record. Threading two extra arguments through
 * forty call sites would be noise, so the store sets this once when the auth
 * state changes and the services read it.
 *
 * This is a convenience for the CLIENT only. It is not a security boundary —
 * the outletId and role that actually matter are the ones in the signed auth
 * token, which the Firestore rules read and which this process cannot forge.
 * Tampering with the value here gets you a permission-denied, not access.
 */

let current: Session | null = null

export function setServiceSession(session: Session | null): void {
  current = session
}

export function currentSession(): Session | null {
  return current
}

export function requireSession(): Session {
  if (!current) throw new AppError('You have been signed out. Sign in again.', 'unauthenticated')
  return current
}

export function requireOutletId(): string {
  return requireSession().outletId
}

/**
 * A live read of what the app currently holds: the menu, stations, tables
 * and the rounds on the floor.
 *
 * Placing a round has to denormalise a category name and a station name onto
 * every line, and the store already has both from its listeners. Re-reading
 * them from Firestore on every order would be a handful of pointless reads
 * per order; passing them down through the UI would be five extra arguments
 * at every call site. So the store registers a getter here once.
 *
 * It is a GETTER, not a copy, so a service always sees the current snapshot
 * rather than whatever was true when it was registered.
 */

let catalogue: (() => LiveSnapshot) | null = null

export function setCatalogueSource(source: (() => LiveSnapshot) | null): void {
  catalogue = source
}

export function requireCatalogue(): LiveSnapshot {
  if (!catalogue) throw new AppError('The app is still loading. Try again in a moment.', 'no-catalogue')
  return catalogue()
}
