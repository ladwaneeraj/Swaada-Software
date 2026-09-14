import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AdminLayout } from '@/components/layout/AdminLayout'
import { RequireRole, homeForRole } from '@/components/layout/RequireRole'
import { LoginPage } from '@/features/auth/LoginPage'
import { AnalyticsPage } from '@/features/admin/AnalyticsPage'
import { CustomersPage } from '@/features/admin/CustomersPage'
import { HistoryPage } from '@/features/admin/HistoryPage'
import { KitchenMonitorPage } from '@/features/admin/KitchenMonitorPage'
import { MenuPage } from '@/features/admin/MenuPage'
import { SettingsPage } from '@/features/admin/SettingsPage'
import { StaffPage } from '@/features/admin/StaffPage'
import { TablesPage } from '@/features/admin/TablesPage'
import { TakeOrderPage } from '@/features/admin/TakeOrderPage'
import { KitchenPage } from '@/features/kitchen/KitchenPage'
import { useAppStore } from '@/store/useAppStore'

function RootRedirect() {
  const session = useAppStore((s) => s.session)
  return <Navigate to={session ? homeForRole(session.role) : '/login'} replace />
}

/**
 * Firebase restores a saved session asynchronously, so for the first moment
 * after a reload nobody is signed in as far as the store is concerned.
 * Rendering the routes during that moment would bounce a signed-in cashier
 * to the login screen and back, which looks exactly like being logged out.
 * So nothing renders until Firebase has answered.
 */
function AuthGate({ children }: { children: React.ReactNode }) {
  const authReady = useAppStore((s) => s.authReady)
  if (authReady) return <>{children}</>
  return (
    <div className="grid min-h-dvh place-items-center bg-surface-50">
      <div className="flex flex-col items-center gap-3">
        <span
          className="size-8 animate-spin rounded-full border-[3px] border-surface-300 border-t-accent-600"
          aria-hidden
        />
        <p className="text-sm font-semibold text-ink-500">Starting up…</p>
      </div>
    </div>
  )
}

/**
 * Shown when a listener is refused. In practice this almost always means the
 * security rules and the client disagree about what a role may read, which
 * is worth saying out loud rather than leaving as a silently empty screen.
 */
function SyncBanner() {
  const syncError = useAppStore((s) => s.syncError)
  if (!syncError) return null
  return (
    <div className="sticky top-0 z-50 bg-danger-600 px-4 py-2 text-center text-sm font-semibold text-white">
      {syncError}
    </div>
  )
}

// Follows Vite's base path so the app works at a sub-path (GitHub Pages).
const basename = import.meta.env.BASE_URL.replace(/\/+$/, '') || '/'

export default function App() {
  return (
    <BrowserRouter basename={basename}>
      <AuthGate>
        <SyncBanner />
        <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/login" element={<LoginPage />} />

        {/* The counter shares the admin shell but only reaches the two
            screens it is listed for in NAV: taking orders, and the board. */}
        <Route element={<RequireRole roles={['admin', 'counter']} />}>
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<Navigate to="tables" replace />} />
            <Route path="tables" element={<TablesPage />} />
            <Route path="take-order/:tableId" element={<TakeOrderPage />} />
            <Route path="kitchen" element={<KitchenMonitorPage />} />

            <Route element={<RequireRole roles={['admin']} />}>
              <Route path="menu" element={<MenuPage />} />
              <Route path="customers" element={<CustomersPage />} />
              <Route path="history" element={<HistoryPage />} />
              <Route path="analytics" element={<AnalyticsPage />} />
              <Route path="staff" element={<StaffPage />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>
          </Route>
        </Route>

        <Route element={<RequireRole roles={['kitchen', 'admin', 'counter']} />}>
          <Route path="/kitchen" element={<KitchenPage />} />
        </Route>

          <Route path="*" element={<RootRedirect />} />
        </Routes>
      </AuthGate>
    </BrowserRouter>
  )
}
