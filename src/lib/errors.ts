/**
 * One error shape for everything the UI has to show a person.
 *
 * Firebase throws codes like `auth/invalid-credential` and
 * `permission-denied`. A cashier should never see those, and a developer
 * should never lose them, so AppError carries both: a sentence for the
 * screen and the original for the console and Sentry.
 */
export class AppError extends Error {
  readonly userMessage: string
  readonly code: string
  readonly cause?: unknown

  constructor(userMessage: string, code = 'unknown', cause?: unknown) {
    super(`${code}: ${userMessage}`)
    this.name = 'AppError'
    this.userMessage = userMessage
    this.code = code
    this.cause = cause
  }
}

function codeOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return String((error as { code: unknown }).code)
  }
  return 'unknown'
}

const AUTH_MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'Wrong username or password.',
  'auth/invalid-email': 'That username is not valid.',
  'auth/user-not-found': 'Wrong username or password.',
  'auth/wrong-password': 'Wrong username or password.',
  'auth/user-disabled': 'This login has been switched off. Ask the manager.',
  'auth/too-many-requests': 'Too many tries. Wait a minute and try again.',
  'auth/network-request-failed': 'No internet. Check the connection and try again.',
  'auth/requires-recent-login': 'Please sign in again before changing the password.',
}

const FIRESTORE_MESSAGES: Record<string, string> = {
  'permission-denied': 'Your login is not allowed to do that.',
  unavailable: 'No internet. The change is saved here and will sync when you reconnect.',
  'failed-precondition': 'Something changed while you were working. Reload and try again.',
  aborted: 'Two people saved at the same time. Try again.',
  'deadline-exceeded': 'The connection is very slow. Try again.',
  'not-found': 'That record no longer exists.',
  'already-exists': 'That already exists.',
  'resource-exhausted': 'The system is busy. Wait a moment and try again.',
  unauthenticated: 'You have been signed out. Sign in again.',
}

/** Turn anything thrown into an AppError with a sentence worth showing. */
export function toAppError(error: unknown, fallback = 'Something went wrong.'): AppError {
  if (error instanceof AppError) return error
  const code = codeOf(error)
  const message =
    AUTH_MESSAGES[code] ??
    FIRESTORE_MESSAGES[code] ??
    (error instanceof Error && !code.includes('/') && code === 'unknown' ? error.message : fallback)
  return new AppError(message, code, error)
}

/** True when the failure is only that the device is offline. */
export function isOfflineError(error: unknown): boolean {
  const code = codeOf(error)
  return code === 'unavailable' || code === 'auth/network-request-failed'
}
