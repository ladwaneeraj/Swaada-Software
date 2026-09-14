import { useCallback, useEffect, useMemo, useState } from 'react'
import { queries } from '@/services'
import { addBusinessDays, todayBusinessDate } from '@/lib/businessDate'
import { businessDayConfig } from '@/services'
import { toAppError } from '@/lib/errors'
import { useAppStore } from '@/store/useAppStore'
import type { Bill, Order, WalletEntry } from '@/types'

/**
 * Loading a stretch of the past, on demand.
 *
 * History and analytics used to be free, because the prototype kept every
 * order ever taken in memory and every screen just filtered it. Against a
 * real database that is the single most expensive habit a client can have:
 * it re-downloads the cafe's whole trading history on every app start, and
 * it gets slower and dearer every day the cafe stays open.
 *
 * So these screens pay for exactly what they ask for, once, when someone
 * opens them. A manager checking last week costs one query. A cook who never
 * opens the screen costs nothing.
 *
 * The range is a business date range (see lib/businessDate.ts), not a
 * timestamp range, so "yesterday" means the cafe's yesterday and a bill rung
 * up at 1am lands on the right day's figures.
 */

export const HISTORY_RANGES = [
  { key: 'today', label: 'Today', days: 1 },
  { key: '7d', label: 'Last 7 days', days: 7 },
  { key: '30d', label: 'Last 30 days', days: 30 },
  { key: '90d', label: 'Last 90 days', days: 90 },
] as const

export type HistoryRangeKey = (typeof HISTORY_RANGES)[number]['key']

export interface HistoryData {
  bills: Bill[]
  orders: Order[]
  walletEntries: WalletEntry[]
  loading: boolean
  error: string
  /** True when the range hit the safety cap and is not the whole story. */
  truncated: boolean
  reload: () => void
}

/** The from/to pair for a named range, in the outlet's own day boundaries. */
export function rangeBounds(
  key: HistoryRangeKey,
  timezone: string,
  dayStartHour: number,
): { from: string; to: string } {
  const days = HISTORY_RANGES.find((r) => r.key === key)?.days ?? 1
  const to = todayBusinessDate({ timezone, dayStartHour })
  return { from: addBusinessDays(to, -(days - 1)), to }
}

/** A safety cap, so a mis-set date range cannot pull down a year at once. */
const MAX_ROWS = 4000

export function useHistory(rangeKey: HistoryRangeKey, options?: { withOrders?: boolean }): HistoryData {
  const settings = useAppStore((s) => s.db.settings)
  const outletId = useAppStore((s) => s.session?.outletId)
  const withOrders = options?.withOrders ?? true

  const { from, to } = useMemo(() => {
    const config = businessDayConfig(settings)
    return rangeBounds(rangeKey, config.timezone, config.dayStartHour)
  }, [rangeKey, settings])

  const [data, setData] = useState<{ bills: Bill[]; orders: Order[]; walletEntries: WalletEntry[] }>({
    bills: [],
    orders: [],
    walletEntries: [],
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [nonce, setNonce] = useState(0)

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    if (!outletId) return
    let cancelled = false
    setLoading(true)
    setError('')

    void Promise.all([
      queries.allBills(from, to, MAX_ROWS),
      withOrders ? queries.allOrders(from, to, MAX_ROWS) : Promise.resolve([] as Order[]),
      queries.walletEntries({ from, to, pageSize: 1000 }),
    ])
      .then(([bills, orders, walletEntries]) => {
        if (cancelled) return
        setData({ bills, orders, walletEntries })
      })
      .catch((caught: unknown) => {
        if (cancelled) return
        setError(toAppError(caught, 'Could not load that period.').userMessage)
        setData({ bills: [], orders: [], walletEntries: [] })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [from, to, withOrders, outletId, nonce])

  return {
    ...data,
    loading,
    error,
    truncated: data.bills.length >= MAX_ROWS || data.orders.length >= MAX_ROWS,
    reload,
  }
}
