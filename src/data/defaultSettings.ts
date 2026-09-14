import type { CafeSettings } from '../types'

/**
 * What a brand new outlet starts with.
 *
 * Deliberately a leaf module: it imports nothing at runtime, only a type,
 * which TypeScript erases. That matters because this is shared between the
 * browser app and the Node bootstrap script, and the two have very little
 * in common — the app's settings service reaches Firestore and reads
 * `import.meta.env`, neither of which exists in Node.
 *
 * Keeping the values here rather than duplicating them means a default
 * changed for a new café is the same default the running app falls back to.
 */
export const DEFAULT_SETTINGS: CafeSettings = {
  cafeName: 'Swaada Café',
  currency: 'INR',
  timezone: 'Asia/Kolkata',
  dayStartHour: 0,
  askCustomerInfo: true,
  wallet: { allowPayLater: true },
  sound: {
    newOrderAlert: true,
    volume: 0.7,
    repeatUntilAcknowledged: true,
    repeatSeconds: 25,
  },
}
