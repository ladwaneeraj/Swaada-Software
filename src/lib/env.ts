/**
 * Typed access to build-time configuration.
 *
 * Firebase web config is PUBLIC by design — it identifies the project, it
 * does not authorise anything. What protects the data is Firestore security
 * rules plus the signed-in user's custom claims. These values are still kept
 * in .env files rather than hard-coded so dev and prod can differ.
 *
 * Missing required values fail loudly at startup instead of surfacing later
 * as a confusing "permission denied" against the wrong project.
 */

interface FirebaseEnv {
  apiKey: string
  authDomain: string
  projectId: string
  storageBucket: string
  messagingSenderId: string
  appId: string
}

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env.local and fill in the Firebase web config ` +
        `(Firebase console → Project settings → Your apps → Web app).`,
    )
  }
  return value
}

export const firebaseEnv: FirebaseEnv = {
  apiKey: required('VITE_FIREBASE_API_KEY', import.meta.env.VITE_FIREBASE_API_KEY),
  authDomain: required('VITE_FIREBASE_AUTH_DOMAIN', import.meta.env.VITE_FIREBASE_AUTH_DOMAIN),
  projectId: required('VITE_FIREBASE_PROJECT_ID', import.meta.env.VITE_FIREBASE_PROJECT_ID),
  storageBucket: required('VITE_FIREBASE_STORAGE_BUCKET', import.meta.env.VITE_FIREBASE_STORAGE_BUCKET),
  messagingSenderId: required(
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  ),
  appId: required('VITE_FIREBASE_APP_ID', import.meta.env.VITE_FIREBASE_APP_ID),
}

/**
 * The domain staff usernames are turned into email addresses under. It never
 * receives mail and does not need to be a domain anyone owns; Firebase Auth
 * only needs the address to be well-formed and unique.
 */
export const STAFF_EMAIL_DOMAIN = import.meta.env.VITE_STAFF_EMAIL_DOMAIN ?? 'staff.swaada.local'

/** Set only in deployed builds. Left empty locally so dev noise stays out. */
export const sentryDsn = import.meta.env.VITE_SENTRY_DSN ?? ''

/** "development" | "staging" | "production" — shown in the UI and sent to Sentry. */
export const appEnv = import.meta.env.VITE_APP_ENV ?? import.meta.env.MODE

/** Point the SDKs at the local emulator suite instead of the real project. */
export const useEmulators = import.meta.env.VITE_USE_EMULATORS === 'true'

export const isProduction = appEnv === 'production'
