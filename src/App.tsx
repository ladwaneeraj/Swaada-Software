import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AdminLayout } from '@/components/layout/AdminLayout'
import { RequireRole, homeForRole } from '@/components/layout/RequireRole'
import { LoginPage } from '@/features/auth/LoginPage'
import { AnalyticsPage } from '@/features/admin/AnalyticsPage'
import { CustomersPage } from '@/features/admin/CustomersPage'
import { DashboardPage } from '@/features/admin/DashboardPage'
import { HistoryPage } from '@/features/admin/HistoryPage'
import { KitchenMonitorPage } from '@/features/admin/KitchenMonitorPage'
import { MenuPage } from '@/features/admin/MenuPage'
import { OrdersPage } from '@/features/admin/OrdersPage'
import { SettingsPage } from '@/features/admin/SettingsPage'
import { TablesPage } from '@/features/admin/TablesPage'
import { TakeOrderPage } from '@/features/admin/TakeOrderPage'
import { KitchenPage } from '@/features/kitchen/KitchenPage'
import { useAppStore } from '@/store/useAppStore'

function RootRedirect() {
  const session = useAppStore((s) => s.session)
  return <Navigate to={session ? homeForRole(session.role) : '/login'} replace />
}

// Follows Vite's base path so the app works at a sub-path (GitHub Pages).
const basename = import.meta.env.BASE_URL.replace(/\/+$/, '') || '/'

export default function App() {
  return (
    <BrowserRouter basename={basename}>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/login" element={<LoginPage />} />

        <Route element={<RequireRole roles={['admin']} />}>
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="orders" element={<OrdersPage />} />
            <Route path="tables" element={<TablesPage />} />
            <Route path="take-order/:tableId" element={<TakeOrderPage />} />
            <Route path="menu" element={<MenuPage />} />
            <Route path="kitchen" element={<KitchenMonitorPage />} />
            <Route path="customers" element={<CustomersPage />} />
            <Route path="history" element={<HistoryPage />} />
            <Route path="analytics" element={<AnalyticsPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Route>

        <Route element={<RequireRole roles={['kitchen', 'admin']} />}>
          <Route path="/kitchen" element={<KitchenPage />} />
        </Route>

        <Route path="*" element={<RootRedirect />} />
      </Routes>
    </BrowserRouter>
  )
}
