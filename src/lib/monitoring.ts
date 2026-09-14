import * as Sentry from '@sentry/react'
import { appEnv, isProduction, sentryDsn } from '@/lib/env'

/**
 * Error reporting.
 *
 * The point of this in a cafe is narrow and specific: a cashier who hits a
 * bug at 8pm during a rush will not file a report. They will tap something
 * else, work around it, and never mention it. Without this, the first anyone
 * hears about a broken settle button is a week of takings that do not add up.
 *
 * It is off unless a DSN is configured, so local development and CI stay
 * silent and the dashboard only ever holds real incidents.
 */

export function initMonitoring(): void {
  if (!sentryDsn) return

  Sentry.init({
    dsn: sentryDsn,
    environment: appEnv,
    // A single cafe generates very little traffic, so there is no reason to
    // sample: catching every error is cheap and missing one is not.
    tracesSampleRate: isProduction ? 0.1 : 0,
    // Never record what a cashier typed. Guest names, mobile numbers and
    // amounts are all on screen, and none of it belongs in a bug tracker.
    sendDefaultPii: false,
    beforeSend(event) {
      // Offline is a normal state for this app, not an incident.
      const message = event.exception?.values?.[0]?.value ?? ''
      if (/unavailable|network-request-failed|Failed to fetch/i.test(message)) return null
      return event
    },
  })
}

/** Tag reports with who was signed in, by role and id — never by name. */
export function identifyForMonitoring(user: { userId: string; role: string; outletId: string } | null): void {
  if (!sentryDsn) return
  Sentry.setUser(user ? { id: user.userId } : null)
  Sentry.setTags(user ? { role: user.role, outletId: user.outletId } : {})
}

export function reportError(error: unknown, context?: Record<string, unknown>): void {
  console.error(error)
  if (!sentryDsn) return
  Sentry.captureException(error, context ? { extra: context } : undefined)
}
