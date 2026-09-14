import {
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  updatePassword,
} from 'firebase/auth'
import { getDoc, onSnapshot, type Unsubscribe } from 'firebase/firestore'
import { auth } from './firebase/app'
import { staffIndexRef, staffRef } from './firebase/paths'
import { STAFF_EMAIL_DOMAIN } from '@/lib/env'
import { AppError, toAppError } from '@/lib/errors'
import type { Session } from '@/types'
import { nowISO } from '@/lib/utils'

/**
 * Staff sign in with a username, not an email.
 *
 * Firebase Auth only does email/password, so a username is mapped to a
 * synthetic address — "ramesh" becomes "ramesh@staff.swaada.local". That
 * domain receives no mail and nobody needs to own it; Firebase just needs
 * the address to be well-formed and unique. No staff member ever sees it.
 *
 * WHERE THE ROLE COMES FROM
 *
 * The role lives in the staff DOCUMENT, not in a custom claim on the token.
 * Claims can only be written by the Admin SDK, which means Cloud Functions,
 * which means a paid Firebase plan — so this app reads the role from
 * Firestore instead, and the security rules do the same with a `get()`.
 *
 * That costs one document read per request. In exchange:
 *
 *   - the whole app runs on Firebase's free plan;
 *   - a role change or a switch-off takes effect on the NEXT REQUEST rather
 *     than whenever the token happens to refresh, which with claims can be
 *     up to an hour. For sacking someone mid-shift that is the better
 *     behaviour, not a consolation.
 *
 * The client cannot promote itself by editing this in devtools, because the
 * rules read the same document server-side. Faking it in the browser changes
 * what the screen draws and changes nothing about what the database accepts.
 */

/** Lowercase, no spaces. What the admin types when creating a login. */
export function normaliseUsername(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, '')
}

export function isValidUsername(input: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{2,29}$/.test(normaliseUsername(input))
}

/** "ramesh" -> "ramesh@staff.swaada.local". Internal only. */
export function usernameToEmail(username: string): string {
  return `${normaliseUsername(username)}@${STAFF_EMAIL_DOMAIN}`
}

export const authService = {
  async signIn(username: string, password: string): Promise<void> {
    const clean = normaliseUsername(username)
    if (!clean || !password) throw new AppError('Enter your username and password.', 'auth/empty')
    try {
      await signInWithEmailAndPassword(auth, usernameToEmail(clean), password)
      // The session itself is assembled by watchSession below, which then
      // keeps following the staff document. Nothing to return here.
    } catch (error) {
      throw toAppError(error, 'Could not sign in.')
    }
  },

  async signOut(): Promise<void> {
    await fbSignOut(auth)
  },

  /**
   * Follows who is signed in, and what they are allowed to be.
   *
   * Two steps, because a freshly signed-in browser does not yet know which
   * outlet it belongs to:
   *
   *   1. read /staffIndex/{uid} once — a tiny document holding only an
   *      outlet id, readable solely by that uid;
   *   2. then SUBSCRIBE to /outlets/{outletId}/staff/{uid}, so a role change
   *      or a switch-off reaches the tablet within a second.
   *
   * An account with no index entry, or one marked inactive, yields null —
   * which is what a half-created or disabled login looks like, and it must
   * not be allowed in.
   */
  watchSession(handler: (session: Session | null) => void): () => void {
    let stopStaff: Unsubscribe | null = null

    const stopAuth = onAuthStateChanged(auth, (user) => {
      stopStaff?.()
      stopStaff = null

      if (!user) {
        handler(null)
        return
      }

      void getDoc(staffIndexRef(user.uid))
        .then((indexSnap) => {
          const entry = indexSnap.data()
          if (!entry?.outletId) {
            handler(null)
            return
          }
          stopStaff = onSnapshot(
            staffRef(entry.outletId, user.uid),
            (snap) => {
              const member = snap.data()
              if (!member || !member.isActive) {
                handler(null)
                return
              }
              handler({
                userId: user.uid,
                outletId: entry.outletId,
                username: member.username,
                name: member.displayName || member.username,
                role: member.role,
                loginAt: nowISO(),
              })
            },
            () => handler(null),
          )
        })
        .catch(() => handler(null))
    })

    return () => {
      stopStaff?.()
      stopAuth()
    }
  },

  /**
   * Why a signed-in user might still be refused, in words worth showing.
   * Called by the login screen when a sign-in succeeds but no session
   * appears, which is otherwise a silent and baffling failure.
   */
  async explainMissingSession(): Promise<string> {
    const user = auth.currentUser
    if (!user) return 'Wrong username or password.'
    try {
      const indexSnap = await getDoc(staffIndexRef(user.uid))
      const entry = indexSnap.data()
      if (!entry?.outletId) {
        return 'This login is not set up for any café yet. Ask the manager to finish creating it.'
      }
      const staffSnap = await getDoc(staffRef(entry.outletId, user.uid))
      const member = staffSnap.data()
      if (!member) return 'This login has no staff record. Ask the manager to create it again.'
      if (!member.isActive) return 'This login has been switched off. Ask the manager.'
      return 'Could not sign in.'
    } catch {
      return 'Could not reach the server. Check the internet connection.'
    }
  },

  /** A staff member changing their own password. Needs the current one. */
  async changeOwnPassword(currentPassword: string, newPassword: string): Promise<void> {
    const user = auth.currentUser
    if (!user?.email) throw new AppError('You are not signed in.', 'auth/no-user')
    if (newPassword.length < 8) {
      throw new AppError('New password must be at least 8 characters.', 'auth/weak-password')
    }
    try {
      const credential = EmailAuthProvider.credential(user.email, currentPassword)
      await reauthenticateWithCredential(user, credential)
      await updatePassword(user, newPassword)
    } catch (error) {
      throw toAppError(error, 'Could not change the password.')
    }
  },
}
