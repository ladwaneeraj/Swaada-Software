import {
  BarChart3,
  BookOpenText,
  ChefHat,
  ClipboardList,
  Coffee,
  History,
  LayoutDashboard,
  LogOut,
  Settings,
  UsersRound,
  UtensilsCrossed,
} from 'lucide-react'
import { useEffect } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { ConnectionBadge } from '@/components/ConnectionBadge'
import { FullscreenButton } from '@/components/FullscreenButton'
import { Toaster, useToasts } from '@/components/toast'
import { cn } from '@/lib/utils'
import { realtime } from '@/services/realtime'
import { useAppStore } from '@/store/useAppStore'

const NAV = [
  { to: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/admin/tables', label: 'Tables', icon: UtensilsCrossed },
  { to: '/admin/orders', label: 'Orders', icon: ClipboardList },
  { to: '/admin/menu', label: 'Menu', icon: BookOpenText },
  { to: '/admin/kitchen', label: 'Kitchen', icon: ChefHat },
  { to: '/admin/customers', label: 'Customers', icon: UsersRound },
  { to: '/admin/history', label: 'History', icon: History },
  { to: '/admin/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/admin/settings', label: 'Settings', icon: Settings },
]

export function AdminLayout() {
  const session = useAppStore((s) => s.session)
  const logout = useAppStore((s) => s.logout)
  const cafeName = useAppStore((s) => s.db.settings.cafeName)
  const navigate = useNavigate()
  const pushToast = useToasts((s) => s.push)

  // Surface kitchen progress to the admin without them watching the screen.
  useEffect(() => {
    return realtime.subscribe((event) => {
      const orders = useAppStore.getState().db.orders
      if (event.type === 'ORDER_READY') {
        const order = orders.find((o) => o.id === event.orderId)
        if (order) pushToast(`Order #${order.orderNumber} · ${order.tableName} is ready`, 'ok')
      }
      if (event.type === 'ORDER_DELIVERED') {
        const order = orders.find((o) => o.id === event.orderId)
        if (order) pushToast(`Order #${order.orderNumber} delivered · ${order.tableName} bill open`, 'accent')
      }
    })
  }, [pushToast])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="flex min-h-dvh flex-col">
      {/* One top bar for the whole app: identity on the left, every screen as
          an icon across the middle, session controls on the right. Nothing
          eats horizontal space, which is what the floor plan and the billing
          screen both want. */}
      <header className="sticky top-0 z-40 bg-white/90 shadow-card backdrop-blur-md">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="flex shrink-0 items-center gap-2">
            <div className="grid size-9 place-items-center rounded-xl bg-gradient-to-b from-accent-500 to-accent-600 shadow-accent" aria-hidden>
              <Coffee className="size-4.5 text-white" />
            </div>
            <p className="hidden text-sm font-bold leading-tight sm:block">{cafeName}</p>
          </div>

          <nav className="no-scrollbar flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto" aria-label="Main">
            {NAV.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                title={label}
                className={({ isActive }) =>
                  cn(
                    'flex h-[3.25rem] w-[4.5rem] shrink-0 flex-col items-center justify-center gap-1 rounded-2xl text-[10px] font-semibold transition-all duration-150',
                    isActive
                      ? 'bg-accent-50 text-accent-600 shadow-[inset_0_0_0_1px_rgb(232_57_74/0.14)]'
                      : 'text-ink-500 hover:bg-surface-100 hover:text-ink-900',
                  )
                }
              >
                <Icon className="size-[18px]" />
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-1.5 border-l border-surface-200 pl-3">
            <ConnectionBadge compact />
            <FullscreenButton />
            <div className="hidden text-right leading-tight md:block">
              <p className="text-[13px] font-bold">{session?.name}</p>
              <p className="text-[11px] capitalize text-ink-500">{session?.role}</p>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              title="Log out"
              aria-label="Log out"
              className="grid size-9 place-items-center rounded-full text-ink-500 transition-colors hover:bg-surface-100 hover:text-ink-900"
            >
              <LogOut className="size-[18px]" />
            </button>
          </div>
        </div>
      </header>

      <main className="min-w-0 flex-1 p-4 sm:p-5">
        <Outlet />
      </main>
      <Toaster />
    </div>
  )
}

/** Shared page heading with optional right-side actions. */
export function PageHeader({
  title,
  sub,
  actions,
}: {
  title: string
  sub?: string
  actions?: React.ReactNode
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="font-display text-[1.375rem] font-bold leading-tight">{title}</h1>
        {sub && <p className="mt-0.5 text-[13px] text-ink-500">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
