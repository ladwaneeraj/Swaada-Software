import { Volume2 } from 'lucide-react'
import { useState } from 'react'
import { PageHeader } from '@/components/layout/AdminLayout'
import { useAction, useToasts } from '@/components/toast'
import { Badge, Button, Card, Field, Input, Segmented, Toggle } from '@/components/ui'
import { byDisplayOrder } from '@/lib/utils'
import { playOrderChime } from '@/lib/sound'
import { deviceLabel, remainingInBlock, setDeviceLabel, settingsService } from '@/services'
import { toAppError } from '@/lib/errors'
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

/** Café-level configuration: identity, wallets, alerts, stations, this device. */
export function SettingsPage() {
  const run = useAction()
  const settings = useAppStore((s) => s.db.settings)
  const sound = useAppStore((s) => s.db.settings.sound)
  const stations = useAppStore((s) => s.db.stations)
  const connection = useAppStore((s) => s.connection)
  const outletId = useAppStore((s) => s.session?.outletId ?? '')
  const pushToast = useToasts((s) => s.push)

  const [cafeName, setCafeName] = useState(settings.cafeName)

  const save = async () => {
    try {
      await settingsService.update({ cafeName: cafeName.trim() || settings.cafeName })
      pushToast('Settings saved', 'ok')
    } catch (error) {
      pushToast(toAppError(error, 'Could not save settings.').userMessage, 'danger')
    }
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

      </Card>

      <Card className="mb-5 p-5">
        <h2 className="mb-1 text-base font-bold">Customer wallets</h2>
        <p className="mb-4 text-sm text-ink-500">
          A guest is known by their mobile number, and each one has a wallet. It holds money they
          have paid ahead, or what they still owe. Typing the number brings all of it back.
        </p>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4 rounded-xl bg-surface-100 px-4 py-3">
            <div>
              <p className="text-sm font-semibold">Ask who is at the table</p>
              <p className="text-xs text-ink-500">
                Opens the mobile lookup when a table's first round is started. Skipping it is always
                one tap.
              </p>
            </div>
            <Toggle
              checked={settings.askCustomerInfo}
              onChange={(v) => {
                run(settingsService.update({ askCustomerInfo: v }))
                pushToast(v ? 'Guest lookup opens with every new sitting' : 'Guest lookup turned off', 'ok')
              }}
              label="Ask who is at the table"
            />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-xl bg-surface-100 px-4 py-3">
            <div>
              <p className="text-sm font-semibold">Allow pay later</p>
              <p className="text-xs text-ink-500">
                Lets a bill go out partly or fully unpaid, on the wallet of a guest with a mobile
                number. Turn this off and every bill must be settled at the table.
              </p>
            </div>
            <Toggle
              checked={settings.wallet.allowPayLater}
              onChange={(allowPayLater) => {
                run(settingsService.update({ wallet: { ...settings.wallet, allowPayLater } }))
                pushToast(allowPayLater ? 'Bills can be left on a wallet' : 'Every bill must be settled at the table', 'ok')
              }}
              label="Allow pay later"
            />
          </div>
        </div>
      </Card>

      <Card className="mb-5 p-5">
        <div className="mb-1 flex items-center justify-between gap-4">
          <h2 className="text-base font-bold">Kitchen alert sound</h2>
          <Toggle
            checked={sound.newOrderAlert}
            onChange={(newOrderAlert) => {
              run(settingsService.update({ sound: { ...sound, newOrderAlert } }))
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
              onChange={(key) => run(settingsService.update({ sound: { ...sound, volume: VOLUME_LEVELS[key] } }))}
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
                run(settingsService.update({ sound: { ...sound, repeatUntilAcknowledged } }))
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
                    run(
                      settingsService.update({
                        sound: {
                          ...sound,
                          repeatSeconds: Math.min(300, Math.max(5, Number(e.target.value) || 25)),
                        },
                      }),
                    )
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
          Every menu item routes to one of these stations. Today they share one kitchen screen; the
          data model is ready for one screen per station later. A station marked "handed over" is a
          shelf rather than a stove, so its items go straight onto the bill and never appear on the
          kitchen board.
        </p>
        <ul className="space-y-2">
          {[...stations].sort(byDisplayOrder).map((s) => (
            <li key={s.id} className="flex items-center gap-3 rounded-xl bg-surface-100 px-4 py-2.5">
              <span className="text-lg" aria-hidden>
                {s.icon}
              </span>
              <span className="flex-1 text-sm font-semibold">{s.name}</span>
              {!s.preparesFood && <Badge tone="neutral">Handed over</Badge>}
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

      {/*
        The prototype had a "reset demo data" button that wiped the mock
        database back to its seed. Against a real outlet that button would be
        a way to delete a cafe's trading history in one tap, so it is gone
        rather than guarded — a destructive action nobody needs is better
        removed than made harder to reach.

        What the counter actually needs to know is shown instead: this
        device, and how many bills it can still write if the internet drops.
      */}
      <Card className="p-5">
        <h2 className="mb-1 text-base font-bold">This device</h2>
        <p className="mb-4 text-sm text-ink-500">
          Each device reserves a block of order and bill numbers in advance, so it can keep
          working through a wifi drop. These are what is left in this device&rsquo;s block.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Device name">
            <Input
              defaultValue={deviceLabel()}
              onBlur={(e) => {
                setDeviceLabel(e.target.value)
                pushToast('Device name saved', 'ok')
              }}
              placeholder="Counter tablet"
            />
          </Field>
          <div className="rounded-card bg-surface-100 p-3.5">
            <p className="text-xs font-bold uppercase tracking-wide text-ink-500">
              Numbers left offline
            </p>
            <p className="mt-1 text-[15px] font-bold">
              {remainingInBlock(outletId, 'order')} orders · {remainingInBlock(outletId, 'bill')} bills
            </p>
          </div>
        </div>
      </Card>

    </div>
  )
}
