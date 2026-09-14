import { getDoc, writeBatch } from 'firebase/firestore'
import { firestore } from './firebase/app'
import { staffIndexRef, staffRef, usernameRef } from './firebase/paths'
import { createAuthUser } from './firebase/secondaryAuth'
import { isValidUsername, normaliseUsername, usernameToEmail } from './auth'
import { requireOutletId, requireSession } from './context'
import { stageAudit } from './audit'
import { AppError, toAppError } from '@/lib/errors'
import { nowISO } from '@/lib/utils'
import type { ID, StaffMember, UserRole } from '@/types'

/**
 * Creating and managing staff logins, entirely from the browser.
 *
 * Three of the four operations a manager needs work fine client-side:
 * creating a login, changing someone's role, and switching them off. The
 * fourth — setting a new password for someone who forgot theirs — genuinely
 * cannot be done without the Admin SDK. There is no workaround; the client
 * SDK has no such method and never will, for obvious reasons.
 *
 * So the recovery path is `replaceLogin`: create a new username for the
 * person, switch the old one off, and record the link between them. Clunkier
 * than a password reset, honest about what is possible, and it leaves a
 * clearer trail than a silent password change would.
 *
 * Switching a login off sets `isActive: false` on their staff document. The
 * security rules check that field on every request, so it bites on the very
 * next one. A disabled person can still authenticate — the auth user is
 * untouched — but every read and write is refused and the app signs them out.
 */

function assertPassword(password: string): void {
  if (password.length < 8) {
    throw new AppError('Password must be at least 8 characters.', 'staff/weak-password')
  }
}

function assertAdmin(): void {
  if (requireSession().role !== 'admin') {
    throw new AppError('Only a manager can manage staff logins.', 'permission-denied')
  }
}

export const staffService = {
  async create(input: {
    username: string
    displayName: string
    role: UserRole
    password: string
  }): Promise<ID> {
    assertAdmin()
    const outletId = requireOutletId()
    const admin = requireSession()
    const username = normaliseUsername(input.username)
    const displayName = input.displayName.trim()

    if (!isValidUsername(username)) {
      throw new AppError(
        'Username must be 3-30 characters: lowercase letters, numbers, dot, dash or underscore.',
        'staff/bad-username',
      )
    }
    if (!displayName) throw new AppError('Enter the person’s name.', 'staff/no-name')
    assertPassword(input.password)

    // Checked BEFORE the auth account is created. Creating first and reading
    // the error back would leave a real, unusable Firebase user behind on
    // every typo, and those cannot be deleted from a browser.
    const claimed = await getDoc(usernameRef(username))
    if (claimed.exists()) {
      throw new AppError(`The username "${username}" is already taken.`, 'staff/username-taken')
    }

    // Created on a throwaway app instance so this manager stays signed in.
    const uid = await createAuthUser(usernameToEmail(username), input.password)

    try {
      const now = nowISO()
      const member: StaffMember = {
        id: uid,
        outletId,
        username,
        displayName,
        role: input.role,
        isActive: true,
        createdBy: admin.userId,
        createdAt: now,
        updatedAt: now,
      }

      // The staff row and the index go in one batch. A row without an index
      // entry is a login that can authenticate and then find nothing, which
      // is the most confusing possible half-state.
      const batch = writeBatch(firestore)
      batch.set(staffRef(outletId, uid), member)
      batch.set(staffIndexRef(uid), { id: uid, outletId, username })
      batch.set(usernameRef(username), { id: username, uid, outletId })
      stageAudit(batch, {
        action: 'staff.create',
        summary: `Created ${input.role} login "${username}" for ${displayName}`,
        target: { uid, username },
      })
      await batch.commit()
      return uid
    } catch (error) {
      // The auth user now exists with no staff row. It can sign in and do
      // nothing, which the rules enforce, but the username is taken — so say
      // so rather than leaving the manager to guess why a retry fails.
      throw toAppError(
        error,
        `The login "${username}" was created but its record could not be saved. ` +
          `Use a different username, or ask for this one to be cleaned up in the Firebase console.`,
      )
    }
  },

  async update(
    uid: ID,
    patch: { displayName?: string; role?: UserRole; isActive?: boolean },
  ): Promise<void> {
    assertAdmin()
    const outletId = requireOutletId()
    const admin = requireSession()

    const snap = await getDoc(staffRef(outletId, uid))
    const current = snap.data()
    if (!current) throw new AppError('That login is not in this café.', 'not-found')

    const next = {
      displayName: patch.displayName?.trim() || current.displayName,
      role: patch.role ?? current.role,
      isActive: patch.isActive ?? current.isActive,
    }

    // A café that has locked itself out of its own till has a very bad
    // morning. Checked here AND in the rules, because this one is worth
    // refusing twice.
    const losingAdmin = current.role === 'admin' && (next.role !== 'admin' || !next.isActive)
    if (losingAdmin && uid === admin.userId) {
      throw new AppError(
        'You cannot remove your own manager access. Make someone else a manager first.',
        'staff/last-admin',
      )
    }

    const changes: string[] = []
    if (next.role !== current.role) changes.push(`role ${current.role} → ${next.role}`)
    if (next.isActive !== current.isActive) {
      changes.push(next.isActive ? 'switched on' : 'switched off')
    }
    if (next.displayName !== current.displayName) changes.push(`renamed to ${next.displayName}`)
    if (changes.length === 0) return

    try {
      const batch = writeBatch(firestore)
      batch.update(staffRef(outletId, uid), { ...next, updatedAt: nowISO() })
      stageAudit(batch, {
        action: next.isActive ? 'staff.update' : 'staff.disable',
        summary: `${current.username}: ${changes.join(', ')}`,
        target: { uid, username: current.username },
      })
      await batch.commit()
    } catch (error) {
      throw toAppError(error, 'Could not save the login.')
    }
  },

  /**
   * The password-recovery path, given a manager cannot set someone else's
   * password without a server.
   *
   * Makes a fresh login for the same person, switches the old one off, and
   * records on the old row which username replaced it. Their name on past
   * rounds and bills is untouched, because those carry the name as text
   * rather than a link.
   */
  async replaceLogin(input: {
    uid: ID
    newUsername: string
    password: string
  }): Promise<ID> {
    assertAdmin()
    const outletId = requireOutletId()

    const snap = await getDoc(staffRef(outletId, input.uid))
    const current = snap.data()
    if (!current) throw new AppError('That login is not in this café.', 'not-found')

    const newUid = await staffService.create({
      username: input.newUsername,
      displayName: current.displayName,
      role: current.role,
      password: input.password,
    })

    try {
      const batch = writeBatch(firestore)
      batch.update(staffRef(outletId, input.uid), {
        isActive: false,
        replacedByUsername: normaliseUsername(input.newUsername),
        updatedAt: nowISO(),
      })
      stageAudit(batch, {
        action: 'staff.password_reset',
        summary: `${current.username} could not sign in; replaced by "${normaliseUsername(input.newUsername)}"`,
        target: { uid: input.uid, username: current.username },
      })
      await batch.commit()
    } catch (error) {
      throw toAppError(
        error,
        'The new login was created, but the old one could not be switched off. Switch it off by hand.',
      )
    }

    return newUid
  },

  async disable(uid: ID): Promise<void> {
    return staffService.update(uid, { isActive: false })
  },

  async enable(uid: ID): Promise<void> {
    return staffService.update(uid, { isActive: true })
  },

  /**
   * Is this username free? One get by document id.
   *
   * Two managers typing the same name at the same second could both see
   * "free" here. That race is caught a moment later: the auth account
   * creation itself fails with "email already in use", because Firebase Auth
   * enforces uniqueness for real. This check exists to give a good answer
   * fast, not to be the guarantee.
   */
  async isUsernameFree(username: string): Promise<boolean> {
    const clean = normaliseUsername(username)
    if (!isValidUsername(clean)) return false
    try {
      const claimed = await getDoc(usernameRef(clean))
      return !claimed.exists()
    } catch {
      // Offline: do not block the manager on a check that is only advisory.
      return true
    }
  },
}
