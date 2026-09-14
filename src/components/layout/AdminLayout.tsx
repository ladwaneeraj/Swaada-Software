import {
  BarChart3,
  BookOpenText,
  ChefHat,
  Coffee,
  History,
  LogOut,
  Settings,
  ShieldCheck,
  UsersRound,
  UtensilsCrossed,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useMemo } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { ConnectionBadge } from '@/components/ConnectionBadge'
import { FullscreenButton } from '@/components/FullscreenButton'
import { Toaster, useToasts } from '@/components/toast'
import { cn } from '@/lib/utils'
import { useOrderEvents } from '@/lib/orderEvents'
import { useAppStore } from '@/store/useAppStore'
import type { UserRole } from '@/types'

/**
 * The whole navigation, with who is allowed on each screen. This list is the
 * single source of truth: the router guards read the same roles, so a screen
 * can never be reachable by someone it is not listed for.
 */
export const NAV = [
  { to: '/admin/tables', label: 'Tables', icon: UtensilsCrossed, roles: ['admin', 'counter'] },
  { to: '/admin/kitchen', label: 'Kitchen', icon: ChefHat, roles: ['admin', 'counter'] },
  { to: '/admin/history', label: 'History', icon: History, roles: ['admin'] },
  { to: '/admin/customers', label: 'Customers', icon: UsersRound, roles: ['admin'] },
  { to: '/admin/menu', label: 'Menu', icon: BookOpenText, roles: ['admin'] },
  { to: '/admin/analytics', label: 'Analytics', icon: BarChart3, roles: ['admin'] },
  { to: '/admin/staff', label: 'Staff', icon: ShieldCheck, roles: ['admin'] },
  { to: '/admin/settings', label: 'Settings', icon: Settings, roles: ['admin'] },
] as const satisfies ReadonlyArray<{
  to: string
  label: string
  icon: LucideIcon
  roles: ReadonlyArray<UserRole>
}>

export function AdminLayout() {
  const session = useAppStore((s) => s.session)
  const signOut = useAppStore((s) => s.signOut)
  const cafeName = useAppStore((s) => s.db.settings.cafeName)
  const pushToast = useToasts((s) => s.push)

  const nav = useMemo(
    () => NAV.filter((item) => session && (item.roles as ReadonlyArray<UserRole>).includes(session.role)),
    [session],
  )

  // Surface kitchen progress to the admin without them watching the screen.
  useOrderEvents(({ type, order }) => {
    if (type === 'ready') {
      pushToast(`Order #${order.orderNumber} · ${order.tableName} is ready`, 'ok')
    }
    if (type === 'delivered') {
      pushToast(`Order #${order.orderNumber} delivered · ${order.tableName} bill open`, 'accent')
    }
  })

  // Signing out clears the auth token, which tears down every listener and
  // wipes the snapshot. The route guard sends us to /login from there, so
  // there is no navigate here to race with it.
  const handleLogout = () => {
    void signOut()
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
            {nav.map(({ to, label, icon: Icon }) => (
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
