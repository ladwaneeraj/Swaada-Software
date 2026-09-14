import { describe, expect, it } from 'vitest'
import {
  addBusinessDays,
  businessDateOf,
  recentBusinessDates,
  todayBusinessDate,
} from '../src/lib/businessDate'

/**
 * Which day a bill belongs to.
 *
 * This decides two things that are easy to get wrong and painful to notice:
 * which day's drawer a late-night bill lands in, and what the history and
 * analytics queries actually fetch. Both are wrong in a way nobody spots for
 * weeks if the device's own timezone leaks in, so the cases below deliberately
 * include a device set to New York.
 */

const IST = { timezone: 'Asia/Kolkata', dayStartHour: 0 }
const IST_4AM = { timezone: 'Asia/Kolkata', dayStartHour: 4 }

describe('the cafe day is measured in the cafe timezone', () => {
  it('rolls over at IST midnight, not UTC midnight', () => {
    // 18:30 UTC is exactly 00:00 IST the next day.
    expect(businessDateOf(new Date('2026-09-14T18:30:00.000Z'), IST)).toBe('2026-09-15')
    expect(businessDateOf(new Date('2026-09-14T17:00:00.000Z'), IST)).toBe('2026-09-14')
  })

  it('ignores the device timezone entirely', () => {
    // Same instant, and the answer must not depend on where the tablet thinks
    // it is. Node's own TZ is irrelevant because the formatter is pinned.
    const instant = new Date('2026-09-14T18:30:00.000Z')
    expect(businessDateOf(instant, IST)).toBe('2026-09-15')
    expect(businessDateOf(instant, { timezone: 'America/New_York', dayStartHour: 0 })).toBe(
      '2026-09-14',
    )
  })

  it('crosses a month boundary correctly', () => {
    expect(businessDateOf(new Date('2026-08-31T20:00:00.000Z'), IST)).toBe('2026-09-01')
  })
})

describe('a late-night kitchen', () => {
  it('files a 1am bill under the previous day when the day starts at 4am', () => {
    // 22:00 UTC = 03:30 IST on the 15th — still the 14th's trade.
    expect(businessDateOf(new Date('2026-09-14T22:00:00.000Z'), IST_4AM)).toBe('2026-09-14')
  })

  it('starts the new day once the cutoff passes', () => {
    // 23:00 UTC = 04:30 IST on the 15th — past the 4am cutoff.
    expect(businessDateOf(new Date('2026-09-14T23:00:00.000Z'), IST_4AM)).toBe('2026-09-15')
  })

  it('leaves an ordinary evening on its own day', () => {
    expect(businessDateOf(new Date('2026-09-14T17:00:00.000Z'), IST_4AM)).toBe('2026-09-14')
  })
})

describe('date ranges for queries', () => {
  it('returns ascending dates ending today', () => {
    const range = recentBusinessDates(4, IST)
    expect(range).toHaveLength(4)
    expect([...range].sort()).toEqual(range)
    expect(range[3]).toBe(todayBusinessDate(IST))
  })

  it('steps backwards across a leap-year February', () => {
    expect(addBusinessDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addBusinessDays('2024-03-01', -1)).toBe('2024-02-29')
  })

  it('steps forward across a year boundary', () => {
    expect(addBusinessDays('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('is a no-op for zero', () => {
    expect(addBusinessDays('2026-09-14', 0)).toBe('2026-09-14')
  })
})
