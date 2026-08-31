import { useEffect, useState } from 'react'

/**
 * Ticking clock for live timers. Kept out of the global store so only
 * timer-bearing components re-render each second.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}
