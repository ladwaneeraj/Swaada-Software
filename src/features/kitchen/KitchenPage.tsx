import { BellRing, ChefHat, LogOut, Volume2, VolumeX } from 'lucide-react'
import { ConnectionBadge } from '@/components/ConnectionBadge'
import { FullscreenButton } from '@/components/FullscreenButton'
import { KitchenBoard } from '@/components/kitchen/KitchenBoard'
import { Toaster, useToasts } from '@/components/toast'
import { cn, timeLabel } from '@/lib/utils'
import { useNow } from '@/lib/useNow'
import { playOrderChime, useNewOrderAlert, useSoundStatus } from '@/lib/sound'
import { useOrderEvents } from '@/lib/orderEvents'
import { settingsService } from '@/services'
import { useAppStore } from '@/store/useAppStore'

/**
 * Standalone kitchen display, deliberately unlike the admin UI: dark,
 * loud typography, zero navigation — built to be read from a metre away
 * on a wall-mounted tablet.
 *
 * This is the only screen that rings. The admin tab placing the order does
 * not need its own order echoed back at it.
 */
export function KitchenPage() {
  const signOut = useAppStore((s) => s.signOut)
  const cafeName = useAppStore((s) => s.db.settings.cafeName)
  const sound = useAppStore((s) => s.db.settings.sound)
  const pushToast = useToasts((s) => s.push)
  const now = useNow(30_000)

  useNewOrderAlert()
  const soundStatus = useSoundStatus()

  useOrderEvents(({ type, order }) => {
    if (type === 'created') {
      pushToast(`New order #${order.orderNumber} · Table ${order.tableName}`, 'info')
    }
    if (type === 'cancelled') {
      pushToast(`Order #${order.orderNumber} was cancelled — stop cooking it`, 'danger')
    }
  })

  const toggleSound = () => {
    const on = !sound.newOrderAlert
    void settingsService.update({ sound: { ...sound, newOrderAlert: on } })
    // Turning it on is itself the tap the browser wants, so ring once to
    // prove it works and to unlock audio for the rest of the shift.
    if (on) void playOrderChime(sound.volume)
    pushToast(on ? 'Order alerts on' : 'Order alerts muted', on ? 'ok' : 'warn')
  }

  return (
    <div className="flex h-dvh flex-col bg-ink-900">
      <header className="flex items-center justify-between gap-4 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-white/10" aria-hidden>
            <ChefHat className="size-5 text-surface-100" />
          </div>
          <div>
            <p className="font-display text-xl font-semibold text-white">Kitchen</p>
            <p className="text-xs text-surface-400">{cafeName}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold tabular-nums text-surface-300">{timeLabel(new Date(now).toISOString())}</span>
          <ConnectionBadge dark />
          <button
            type="button"
            onClick={toggleSound}
            aria-label={sound.newOrderAlert ? 'Mute new order alerts' : 'Turn new order alerts on'}
            className={cn(
              'grid size-10 place-items-center rounded-xl transition-colors',
              sound.newOrderAlert ? 'text-surface-300 hover:bg-white/10' : 'bg-accent-500/15 text-accent-500',
            )}
          >
            {sound.newOrderAlert ? <Volume2 className="size-5" /> : <VolumeX className="size-5" />}
          </button>
          <FullscreenButton dark />
          <button
            type="button"
            onClick={() => void signOut()}
            aria-label="Log out"
            className="grid size-10 place-items-center rounded-xl text-surface-300 hover:bg-white/10"
          >
            <LogOut className="size-5" />
          </button>
        </div>
      </header>

      {sound.newOrderAlert && soundStatus === 'blocked' && (
        <button
          type="button"
          onClick={() => void playOrderChime(sound.volume)}
          className="mx-5 mb-3 flex items-center justify-center gap-2 rounded-control bg-warn-100 px-4 py-2.5 text-sm font-bold text-warn-600"
        >
          <BellRing className="size-4" />
          Tap once to switch the alert sound on — browsers keep a page silent until it is touched
        </button>
      )}

      <main className="min-h-0 flex-1 px-5 pb-5">
        <KitchenBoard dark />
      </main>
      <Toaster />
    </div>
  )
}
