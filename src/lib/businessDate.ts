/**
 * A cafe's "day" is not a UTC day, and it is not the device's day either.
 *
 * Every order, bill and wallet entry is stamped with the business date it
 * belongs to, as YYYY-MM-DD in the OUTLET's timezone. Two reasons:
 *
 *  - it is the field the day-scoped listeners and the history queries filter
 *    on, which is what keeps reads bounded and the bill near zero;
 *  - a tablet with its clock set to the wrong timezone would otherwise file
 *    the evening's takings under tomorrow.
 *
 * `dayStartHour` handles a kitchen that serves past midnight: with it set to
 * 4, anything rung up before 4am still belongs to the previous day, which is
 * how the cash in the drawer actually reconciles.
 */

export interface BusinessDayConfig {
  /** IANA zone, e.g. "Asia/Kolkata". */
  timezone: string
  /** 0-11. Orders before this hour count as the previous business day. */
  dayStartHour: number
}

export const DEFAULT_BUSINESS_DAY: BusinessDayConfig = {
  timezone: 'Asia/Kolkata',
  dayStartHour: 0,
}

/** Wall-clock parts of `date` as they read in `timezone`. */
function zonedParts(date: Date, timezone: string): { y: number; m: number; d: number; h: number } {
  // en-CA gives ISO-ordered parts, which is the cheapest way to read a
  // wall clock in another zone without pulling in a date library.
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(date)

  const part = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = formatted.find((p) => p.type === type)
    return found ? Number(found.value) : 0
  }
  // Some runtimes render midnight as hour 24 in hour12:false.
  const hour = part('hour') % 24
  return { y: part('year'), m: part('month'), d: part('day'), h: hour }
}

/** "2026-09-14" for the business day the given instant falls in. */
export function businessDateOf(
  date: Date = new Date(),
  config: BusinessDayConfig = DEFAULT_BUSINESS_DAY,
): string {
  const { y, m, d, h } = zonedParts(date, config.timezone)
  // Date.UTC here is arithmetic on the already-localised calendar parts, not
  // a timezone conversion: it just gives a safe way to roll back a day.
  const asUtc = new Date(Date.UTC(y, m - 1, d))
  if (h < config.dayStartHour) asUtc.setUTCDate(asUtc.getUTCDate() - 1)
  return asUtc.toISOString().slice(0, 10)
}

/** Today's business date, for the common case. */
export function todayBusinessDate(config: BusinessDayConfig = DEFAULT_BUSINESS_DAY): string {
  return businessDateOf(new Date(), config)
}

/** `days` business dates ending today, oldest first. Drives range queries. */
export function recentBusinessDates(
  days: number,
  config: BusinessDayConfig = DEFAULT_BUSINESS_DAY,
): string[] {
  const today = todayBusinessDate(config)
  const cursor = new Date(`${today}T00:00:00.000Z`)
  const out: string[] = []
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(cursor)
    d.setUTCDate(d.getUTCDate() - i)
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

/** Shift a business date by whole days. Negative goes backwards. */
export function addBusinessDays(businessDate: string, days: number): string {
  const d = new Date(`${businessDate}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** "14 Sep 2026" for a YYYY-MM-DD business date. */
export function businessDateLabel(businessDate: string): string {
  return new Date(`${businessDate}T00:00:00.000Z`).toLocaleDateString('en-IN', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}
