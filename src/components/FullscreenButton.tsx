import { Maximize, Minimize } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * Toggles browser full screen — one tap turns the app into a kiosk-style
 * POS with no browser chrome. Available on the admin shell and the kitchen
 * display.
 */
export function FullscreenButton({ dark = false }: { dark?: boolean }) {
  const [isFull, setIsFull] = useState(() => Boolean(document.fullscreenElement))

  useEffect(() => {
    const onChange = () => setIsFull(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggle = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {})
    } else {
      void document.documentElement.requestFullscreen().catch(() => {})
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={isFull ? 'Exit full screen' : 'Full screen'}
      aria-label={isFull ? 'Exit full screen' : 'Full screen'}
      className={cn(
        'grid size-9 place-items-center rounded-lg transition-colors',
        dark ? 'text-cream-300 hover:bg-white/10' : 'text-ink-500 hover:bg-cream-100 hover:text-ink-900',
      )}
    >
      {isFull ? <Minimize className="size-[18px]" /> : <Maximize className="size-[18px]" />}
    </button>
  )
}
