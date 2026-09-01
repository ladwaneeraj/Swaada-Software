import { Wifi, WifiOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/useAppStore'

/**
 * Live connection indicator. The mock realtime layer reports browser
 * online/offline; a real backend adapter will report socket state through
 * the same channel interface.
 */
export function ConnectionBadge({ dark = false, compact = false }: { dark?: boolean; compact?: boolean }) {
  const connection = useAppStore((s) => s.connection)
  const live = connection === 'live'
  if (compact) {
    // Icon-only variant for the collapsed sidebar rail.
    return (
      <span
        className={cn(
          'grid size-9 place-items-center rounded-lg',
          live ? 'bg-ok-100 text-ok-600' : 'bg-danger-100 text-danger-600',
        )}
        title={live ? 'Live — realtime sync active' : 'Connection lost'}
        aria-label={live ? 'Connection live' : 'Connection lost'}
      >
        {live ? <Wifi className="size-4" /> : <WifiOff className="size-4" />}
      </span>
    )
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wide',
        live
          ? dark
            ? 'bg-ok-600/20 text-ok-100'
            : 'bg-ok-100 text-ok-600'
          : 'bg-danger-100 text-danger-600',
      )}
      title={live ? 'Realtime sync active' : 'Connection lost — changes will not sync'}
    >
      {live ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}
      {live ? 'Live' : 'Connection lost'}
    </span>
  )
}
