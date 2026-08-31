import {
  BarChart3,
  ChefHat,
  ClipboardList,
  Coffee,
  History,
  LayoutDashboard,
  LogOut,
  Settings,
  UtensilsCrossed,
  BookOpenText,
} from 'lucide-react'
import { useEffect } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { ConnectionBadge } from '@/components/ConnectionBadge'
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
      if (event.type === 'ORDER_READY') {
        const order = useAppStore.getState().db.orders.find((o) => o.id === event.orderId)
        if (order) pushToast(`Order #${order.orderNumber} · ${order.tableName} is ready`, 'ok')
      }
    })
  }, [pushToast])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="flex min-h-dvh">
      {/* Sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-cream-200 bg-white lg:flex">
        <div className="flex items-center gap-3 px-5 py-5">
          <div className="grid size-10 place-items-center rounded-xl bg-ink-900" aria-hidden>
            <Coffee className="size-5 text-cream-100" />
          </div>
          <div>
            <p className="text-[15px] font-bold leading-tight tracking-tight">{cafeName}</p>
            <p className="text-xs text-ink-500">Admin</p>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3" aria-label="Main">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-colors',
                  isActive ? 'bg-accent-50 text-accent-600' : 'text-ink-700 hover:bg-cream-100',
                )
              }
            >
              <Icon className="size-[18px]" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-cream-200 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">{session?.name}</p>
              <p className="text-xs capitalize text-ink-500">{session?.role}</p>
            </div>
            <ConnectionBadge />
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-cream-300 text-sm font-semibold text-ink-700 hover:bg-cream-100"
          >
            <LogOut className="size-4" /> Log out
          </button>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar (mobile / tablet) */}
        <header className="sticky top-0 z-40 border-b border-cream-200 bg-white/90 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <div className="grid size-9 place-items-center rounded-lg bg-ink-900" aria-hidden>
                <Coffee className="size-4 text-cream-100" />
              </div>
              <p className="text-[15px] font-bold tracking-tight">{cafeName}</p>
            </div>
            <div className="flex items-center gap-2">
              <ConnectionBadge />
              <button
                type="button"
                onClick={handleLogout}
                aria-label="Log out"
                className="grid size-9 place-items-center rounded-lg text-ink-500 hover:bg-cream-200"
              >
                <LogOut className="size-[18px]" />
              </button>
            </div>
          </div>
          <nav className="no-scrollbar flex gap-1 overflow-x-auto px-3 pb-2" aria-label="Main">
            {NAV.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    'flex h-10 shrink-0 items-center gap-2 rounded-xl px-3.5 text-sm font-semibold',
                    isActive ? 'bg-ink-900 text-white' : 'text-ink-700 hover:bg-cream-200',
                  )
                }
              >
                <Icon className="size-4" />
                {label}
              </NavLink>
            ))}
          </nav>
        </header>

        <main className="min-w-0 flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
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
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {sub && <p className="mt-0.5 text-sm text-ink-500">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
