import { RotateCcw, Volume2 } from 'lucide-react'
import { useState } from 'react'
import { PageHeader } from '@/components/layout/AdminLayout'
import { useToasts } from '@/components/toast'
import { Badge, Button, Card, Field, Input, Modal, Segmented, Toggle } from '@/components/ui'
import { byDisplayOrder } from '@/lib/utils'
import { playOrderChime } from '@/lib/sound'
import { settingsService } from '@/services'
import { useAppStore } from '@/store/useAppStore'

/* Three named steps read better than a slider on a touch screen, and they
   keep the stored value inside the 0-1 range the chime expects. */
const VOLUME_LEVELS = { low: 0.45, medium: 0.8, loud: 1 } as const
type VolumeKey = keyof typeof VOLUME_LEVELS

function volumeKey(volume: number): VolumeKey {
  if (volume <= 0.55) return 'low'
  if (volume <= 0.9) return 'medium'
  return 'loud'
}

/** Café-level configuration: identity, loyalty, stations, demo data. */
export function SettingsPage() {
  const settings = useAppStore((s) => s.db.settings)
  const sound = useAppStore((s) => s.db.settings.sound)
  const stations = useAppStore((s) => s.db.stations)
  const connection = useAppStore((s) => s.connection)
  const pushToast = useToasts((s) => s.push)

  const [cafeName, setCafeName] = useState(settings.cafeName)
  const [confirmReset, setConfirmReset] = useState(false)

  const save = () => {
    settingsService.update({ cafeName: cafeName.trim() || settings.cafeName })
    pushToast('Settings saved', 'ok')
  }

  return (
    <div className="max-w-2xl">
      <PageHeader title="Settings" sub="Changes apply everywhere immediately" />

      <Card className="mb-5 p-5">
        <h2 className="mb-4 text-base font-bold">Café</h2>
        <Field label="Café name">
          <Input value={cafeName} onChange={(e) => setCafeName(e.target.value)} />
        </Field>
        <p className="mt-2 text-xs text-ink-500">
          Bills are charged at menu price. No tax is added anywhere in the app.
        </p>
        <Button className="mt-4" onClick={save}>
          Save settings
        </Button>

        <div className="mt-5 flex items-center justify-between gap-4 rounded-xl bg-surface-100 px-4 py-3">
          <div>
            <p className="text-sm font-semibold">Ask for customer name &amp; mobile</p>
            <p className="text-xs text-ink-500">
              Shown on a table's first order. Always optional for the customer.
            </p>
          </div>
          <Toggle
            checked={settings.askCustomerInfo}
            onChange={(v) => {
              settingsService.update({ askCustomerInfo: v })
              pushToast(v ? 'Customer details will be asked on first orders' : 'Customer details prompt turned off', 'ok')
            }}
            label="Ask for customer details"
          />
        </div>
      </Card>

      <Card className="mb-5 p-5">
        <div className="mb-1 flex items-center justify-between gap-4">
          <h2 className="text-base font-bold">Loyalty points</h2>
          <Toggle
            checked={settings.loyalty.enabled}
            onChange={(enabled) => {
              settingsService.update({ loyalty: { ...settings.loyalty, enabled } })
              pushToast(enabled ? 'Loyalty points on' : 'Loyalty points off', 'ok')
            }}
            label="Loyalty enabled"
          />
        </div>
        <p className="mb-4 text-sm text-ink-500">
          Guests with a mobile number earn points on every settled bill and can redeem them as a
          discount at payment.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Points per ₹100">
            <Input
              type="number"
              min={0}
              value={settings.loyalty.pointsPer100}
              onChange={(e) =>
                settingsService.update({
                  loyalty: { ...settings.loyalty, pointsPer100: Math.max(0, Number(e.target.value) || 0) },
                })
              }
            />
          </Field>
          <Field label="₹ value per point">
            <Input
              type="number"
              min={0}
              step="0.5"
              value={settings.loyalty.rupeesPerPoint}
              onChange={(e) =>
                settingsService.update({
                  loyalty: { ...settings.loyalty, rupeesPerPoint: Math.max(0, Number(e.target.value) || 0) },
                })
              }
            />
          </Field>
        </div>
      </Card>

      <Card className="mb-5 p-5">
        <div className="mb-1 flex items-center justify-between gap-4">
          <h2 className="text-base font-bold">Kitchen alert sound</h2>
          <Toggle
            checked={sound.newOrderAlert}
            onChange={(newOrderAlert) => {
              settingsService.update({ sound: { ...sound, newOrderAlert } })
              pushToast(newOrderAlert ? 'Kitchen rings on every new order' : 'Kitchen alert sound off', 'ok')
            }}
            label="New order alert sound"
          />
        </div>
        <p className="mb-4 text-sm text-ink-500">
          A door chime plays on the kitchen display the moment a round is sent. The display stays
          silent until someone touches it once after opening it — that is a browser rule, not a
          setting, and the kitchen screen shows a prompt when it applies.
        </p>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4 rounded-xl bg-surface-100 px-4 py-3">
            <p className="text-sm font-semibold">Volume</p>
            <Segmented<VolumeKey>
              size="sm"
              value={volumeKey(sound.volume)}
              onChange={(key) => settingsService.update({ sound: { ...sound, volume: VOLUME_LEVELS[key] } })}
              options={[
                { value: 'low', label: 'Low' },
                { value: 'medium', label: 'Medium' },
                { value: 'loud', label: 'Loud' },
              ]}
            />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-xl bg-surface-100 px-4 py-3">
            <div>
              <p className="text-sm font-semibold">Keep ringing until the kitchen starts the order</p>
              <p className="text-xs text-ink-500">
                Rings again every {sound.repeatSeconds}s while a round is still sitting in New
                orders, and stops on "Start preparing".
              </p>
            </div>
            <Toggle
              checked={sound.repeatUntilAcknowledged}
              onChange={(repeatUntilAcknowledged) =>
                settingsService.update({ sound: { ...sound, repeatUntilAcknowledged } })
              }
              label="Repeat until acknowledged"
            />
          </div>

          {sound.repeatUntilAcknowledged && (
            <div className="w-44">
              <Field label="Seconds between repeats">
                <Input
                  type="number"
                  min={5}
                  max={300}
                  value={sound.repeatSeconds}
                  onChange={(e) =>
                    settingsService.update({
                      sound: { ...sound, repeatSeconds: Math.min(300, Math.max(5, Number(e.target.value) || 25)) },
                    })
                  }
                />
              </Field>
            </div>
          )}

          <Button
            variant="secondary"
            onClick={() => {
              void playOrderChime(sound.volume).then((played) => {
                if (!played) pushToast('The browser is holding sound back — tap the kitchen screen once', 'warn')
              })
            }}
          >
            <Volume2 className="size-4" /> Play test sound
          </Button>
        </div>
      </Card>

      <Card className="mb-5 p-5">
        <h2 className="mb-1 text-base font-bold">Kitchen stations</h2>
        <p className="mb-4 text-sm text-ink-500">
          Every menu item routes to one of these stations. Today all stations share one kitchen
          screen; the data model is ready for one screen per station later.
        </p>
        <ul className="space-y-2">
          {[...stations].sort(byDisplayOrder).map((s) => (
            <li key={s.id} className="flex items-center gap-3 rounded-xl bg-surface-100 px-4 py-2.5">
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
