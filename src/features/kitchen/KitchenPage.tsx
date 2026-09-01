import { ChefHat, LogOut } from 'lucide-react'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ConnectionBadge } from '@/components/ConnectionBadge'
import { FullscreenButton } from '@/components/FullscreenButton'
import { KitchenBoard } from '@/components/kitchen/KitchenBoard'
import { Toaster, useToasts } from '@/components/toast'
import { timeLabel } from '@/lib/utils'
import { useNow } from '@/lib/useNow'
import { realtime } from '@/services/realtime'
import { useAppStore } from '@/store/useAppStore'

/**
 * Standalone kitchen display, deliberately unlike the admin UI: dark,
 * loud typography, zero navigation — built to be read from a metre away
 * on a wall-mounted tablet.
 */
export function KitchenPage() {
  const logout = useAppStore((s) => s.logout)
  const cafeName = useAppStore((s) => s.db.settings.cafeName)
  const navigate = useNavigate()
  const pushToast = useToasts((s) => s.push)
  const now = useNow(30_000)

  useEffect(() => {
    return realtime.subscribe((event) => {
      const orders = useAppStore.getState().db.orders
      if (event.type === 'ORDER_CREATED') {
        const order = orders.find((o) => o.id === event.orderId)
        if (order) pushToast(`New order #${order.orderNumber} · Table ${order.tableName}`, 'info')
      }
      if (event.type === 'ORDER_CANCELLED') {
        const order = orders.find((o) => o.id === event.orderId)
        if (order) pushToast(`Order #${order.orderNumber} was cancelled`, 'danger')
      }
    })
  }, [pushToast])

  return (
    <div className="flex h-dvh flex-col bg-ink-900">
      <header className="flex items-center justify-between gap-4 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-white/10" aria-hidden>
            <ChefHat className="size-5 text-cream-100" />
          </div>
          <div>
            <p className="font-display text-xl font-semibold text-white">Kitchen</p>
            <p className="text-xs text-cream-400">{cafeName}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold tabular-nums text-cream-300">{timeLabel(new Date(now).toISOString())}</span>
          <ConnectionBadge dark />
          <FullscreenButton dark />
          <button
            type="button"
            onClick={() => {
              logout()
              navigate('/login')
            }}
            aria-label="Log out"
            className="grid size-10 place-items-center rounded-xl text-cream-300 hover:bg-white/10"
          >
            <LogOut className="size-5" />
          </button>
        </div>
      </header>
      <main className="min-h-0 flex-1 px-5 pb-5">
        <KitchenBoard dark />
      </main>
      <Toaster />
    </div>
  )
}
