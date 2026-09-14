import { initializeApp, type FirebaseApp } from 'firebase/app'
import {
  browserLocalPersistence,
  connectAuthEmulator,
  initializeAuth,
  type Auth,
} from 'firebase/auth'
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore'
import { connectFunctionsEmulator, getFunctions, type Functions } from 'firebase/functions'
import { firebaseEnv, useEmulators } from '@/lib/env'

/**
 * One Firebase app for the whole client, wired up once at module load.
 *
 * Two choices here carry most of the weight:
 *
 * 1. `persistentLocalCache` with `persistentMultipleTabManager()`.
 *    Firestore keeps a full IndexedDB mirror of everything this device has
 *    read, serves reads from it, and queues writes made while offline. That
 *    is what lets the counter keep taking orders when the cafe's wifi drops.
 *    The multi-tab manager also broadcasts changes between tabs on the same
 *    device, which is exactly what the old BroadcastChannel layer did by
 *    hand — so that file is gone.
 *
 * 2. `browserLocalPersistence` for auth. A POS tablet must stay signed in
 *    across power cuts and browser restarts; asking a cook to type a
 *    password every morning is how PINs end up taped to the monitor.
 *    The trade-off: one signed-in staff member per browser profile. To run
 *    the kitchen display beside the counter on ONE machine, open /kitchen in
 *    a second window under the same login (admin and counter may both view
 *    it), or use a second browser profile for a separate kitchen login.
 */

export const firebaseApp: FirebaseApp = initializeApp(firebaseEnv)

export const auth: Auth = initializeAuth(firebaseApp, {
  persistence: browserLocalPersistence,
})

export const firestore: Firestore = initializeFirestore(firebaseApp, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  /**
   * The domain types use optional fields heavily (a round with no guest has
   * no customerId, a queued item has no readyAt). Without this, Firestore
   * throws on every such write and the alternative is stripping undefined
   * by hand at ~40 call sites.
   */
  ignoreUndefinedProperties: true,
})

/**
 * Mumbai, so a callable from a cafe in Karnataka is not a round trip to
 * Iowa. Must match the region the functions are deployed to.
 */
export const FUNCTIONS_REGION = 'asia-south1'

export const functions: Functions = getFunctions(firebaseApp, FUNCTIONS_REGION)

if (useEmulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(firestore, '127.0.0.1', 8080)
  connectFunctionsEmulator(functions, '127.0.0.1', 5001)
}
