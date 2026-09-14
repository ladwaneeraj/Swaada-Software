import { setDoc } from 'firebase/firestore'
import { settingsRef } from './firebase/paths'
import { requireOutletId } from './context'
import { record } from './audit'
import { toAppError } from '@/lib/errors'
import type { CafeSettings } from '@/types'

/**
 * The one settings document per outlet. Admin-only.
 *
 * Settings changes are logged because two of them change what money the cafe
 * can take: turning pay-later on or off, and moving the day-start hour,
 * which decides which day's drawer a late-night bill lands in.
 */
export const settingsService = {
  async update(patch: Partial<CafeSettings>): Promise<void> {
    const outletId = requireOutletId()
    try {
      await setDoc(settingsRef(outletId), patch as CafeSettings, { merge: true })
      const notable = Object.keys(patch).filter((k) => k === 'wallet' || k === 'dayStartHour')
      if (notable.length > 0) {
        await record({
          action: 'settings.update',
          summary: `Changed ${notable.join(', ')}`,
          change: Object.fromEntries(
            notable.map((k) => [k, JSON.stringify(patch[k as keyof CafeSettings] ?? null)]),
          ),
        })
      }
    } catch (error) {
      throw toAppError(error, 'Could not save settings.')
    }
  },
}

/** Used before the settings document has loaded, and by the bootstrap script. */
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

/** The two settings the business-date helpers need, in the shape they take. */
export function businessDayConfig(settings: CafeSettings): {
  timezone: string
  dayStartHour: number
} {
  return {
    timezone: settings.timezone || DEFAULT_SETTINGS.timezone,
    dayStartHour: settings.dayStartHour ?? DEFAULT_SETTINGS.dayStartHour,
  }
}
