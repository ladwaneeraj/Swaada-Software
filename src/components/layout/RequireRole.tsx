import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAppStore } from '@/store/useAppStore'
import type { UserRole } from '@/types'

/** Route guard: redirects to /login when the tab has no matching session. */
export function RequireRole({ roles }: { roles: UserRole[] }) {
  const session = useAppStore((s) => s.session)
  const location = useLocation()

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  if (!roles.includes(session.role)) {
    return <Navigate to={session.role === 'kitchen' ? '/kitchen' : '/admin/dashboard'} replace />
  }
  return <Outlet />
}

/** Where a fresh login should land, by role. */
export function homeForRole(role: UserRole): string {
  return role === 'kitchen' ? '/kitchen' : '/admin/dashboard'
}
