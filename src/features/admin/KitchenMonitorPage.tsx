import { ExternalLink } from 'lucide-react'
import { Link } from 'react-router-dom'
import { PageHeader } from '@/components/layout/AdminLayout'
import { KitchenBoard } from '@/components/kitchen/KitchenBoard'

/**
 * Admin's window into the kitchen: the same live board the kitchen works
 * from (same store, same services), embedded in the admin shell.
 */
export function KitchenMonitorPage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Kitchen"
        sub="Live view of the kitchen board — actions here update the kitchen screen instantly"
        actions={
          <Link
            to="/kitchen"
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-surface-300 bg-white px-4 text-sm font-semibold text-ink-700 hover:bg-surface-50"
          >
            <ExternalLink className="size-4" /> Open kitchen display
          </Link>
        }
      />
      <div className="min-h-0 flex-1">
        <KitchenBoard />
      </div>
    </div>
  )
}
