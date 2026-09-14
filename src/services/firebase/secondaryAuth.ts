import { deleteApp, initializeApp } from 'firebase/app'
import { getAuth, createUserWithEmailAndPassword, signOut } from 'firebase/auth'
import { firebaseEnv } from '@/lib/env'
import { toAppError } from '@/lib/errors'

/**
 * Creating a login without throwing the manager off the till.
 *
 * `createUserWithEmailAndPassword` does not just create a user — it SIGNS IN
 * as that user on whichever Firebase app instance you call it on. Called on
 * the app's main instance, a manager adding a cook would find themselves
 * logged in as the cook, mid-service.
 *
 * The Admin SDK avoids this, but it only runs server-side, which means Cloud
 * Functions, which means a paid plan. So instead: spin up a SECOND Firebase
 * app pointing at the same project, create the user there, sign that
 * instance out, and throw the instance away. The main session never notices.
 *
 * This is a well-worn workaround rather than a clever trick, and it is worth
 * knowing it is the only part of the design that would get simpler on Blaze.
 */

let counter = 0

export async function createAuthUser(email: string, password: string): Promise<string> {
  // A unique name each time: Firebase refuses to initialise two apps under
  // one name, and a failed run must not poison the next attempt.
  counter += 1
  const name = `staff-provisioner-${Date.now()}-${counter}`
  const app = initializeApp(firebaseEnv, name)

  try {
    const secondaryAuth = getAuth(app)
    const credential = await createUserWithEmailAndPassword(secondaryAuth, email, password)
    const uid = credential.user.uid
    // Sign the throwaway instance out before disposing of it, so no token
    // for the new user is left sitting in storage.
    await signOut(secondaryAuth)
    return uid
  } catch (error) {
    throw toAppError(error, 'Could not create the login.')
  } finally {
    // Always tear the instance down, including after a failure, or the next
    // attempt leaks another app and another IndexedDB handle.
    await deleteApp(app).catch(() => {
      /* already gone */
    })
  }
}
