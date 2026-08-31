import { RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { PageHeader } from '@/components/layout/AdminLayout'
import { useToasts } from '@/components/toast'
import { Badge, Button, Card, Field, Input, Modal } from '@/components/ui'
import { byDisplayOrder } from '@/lib/utils'
import { settingsService } from '@/services'
import { useAppStore } from '@/store/useAppStore'

/** Café-level configuration: identity, tax, stations, demo data. */
export function SettingsPage() {
  const settings = useAppStore((s) => s.db.settings)
  const stations = useAppStore((s) => s.db.stations)
  const connection = useAppStore((s) => s.connection)
  const pushToast = useToasts((s) => s.push)

  const [cafeName, setCafeName] = useState(settings.cafeName)
  const [taxLabel, setTaxLabel] = useState(settings.taxLabel)
  const [taxRate, setTaxRate] = useState(String(settings.taxRatePercent))
  const [confirmReset, setConfirmReset] = useState(false)

  const save = () => {
    const rate = Math.max(0, Math.min(100, Number(taxRate) || 0))
    settingsService.update({
      cafeName: cafeName.trim() || settings.cafeName,
      taxLabel: taxLabel.trim() || 'Tax',
      taxRatePercent: rate,
    })
    pushToast('Settings saved', 'ok')
  }

  return (
    <div className="max-w-2xl">
      <PageHeader title="Settings" sub="Applies everywhere immediately — new orders pick up the new tax rate" />

      <Card className="mb-5 p-5">
        <h2 className="mb-4 text-base font-bold">Café</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Café name">
            <Input value={cafeName} onChange={(e) => setCafeName(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tax label">
              <Input value={taxLabel} onChange={(e) => setTaxLabel(e.target.value)} placeholder="GST" />
            </Field>
            <Field label="Tax rate (%)">
              <Input type="number" min={0} max={100} step="0.5" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} />
            </Field>
          </div>
        </div>
        <Button className="mt-4" onClick={save}>
          Save settings
        </Button>
      </Card>

      <Card className="mb-5 p-5">
        <h2 className="mb-1 text-base font-bold">Kitchen stations</h2>
        <p className="mb-4 text-sm text-ink-500">
          Every menu item routes to one of these stations. Today all stations share one kitchen
          screen; the data model is ready for one screen per station later.
        </p>
        <ul className="space-y-2">
          {[...stations].sort(byDisplayOrder).map((s) => (
            <li key={s.id} className="flex items-center gap-3 rounded-xl bg-cream-100 px-4 py-2.5">
              <span className="text-lg" aria-hidden>
                {s.icon}
              </span>
              <span className="flex-1 text-sm font-semibold">{s.name}</span>
              <Badge tone={s.isActive ? 'ok' : 'neutral'} dot>
                {s.isActive ? 'Active' : 'Off'}
              </Badge>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="mb-5 p-5">
        <h2 className="mb-1 text-base font-bold">Connection</h2>
        <p className="mb-3 text-sm text-ink-500">
          Realtime sync between Admin and Kitchen currently runs locally in your browser (mock
          mode). When a backend is connected this panel will show the live socket state.
        </p>
        <Badge tone={connection === 'live' ? 'ok' : 'danger'} dot>
          {connection === 'live' ? 'Live — tabs on this device stay in sync' : 'Connection lost'}
        </Badge>
      </Card>

      <Card className="border border-danger-100 p-5">
        <h2 className="mb-1 text-base font-bold text-danger-600">Demo data</h2>
        <p className="mb-4 text-sm text-ink-500">
          Reset the menu, tables and all orders back to the sample seed. This cannot be undone.
        </p>
        <Button variant="secondary" className="text-danger-600" onClick={() => setConfirmReset(true)}>
          <RotateCcw className="size-4" /> Reset demo data
        </Button>
      </Card>

      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Reset all demo data?"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmReset(false)}>
              Keep my data
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                settingsService.resetDemoData()
                setConfirmReset(false)
                pushToast('Demo data reset to the sample seed', 'warn')
              }}
            >
              Reset everything
            </Button>
          </div>
        }
      >
        <p className="text-sm text-ink-500">
          All orders, menu edits and table changes will be replaced by the original sample data.
        </p>
      </Modal>
    </div>
  )
}
