import { ChefHat, Coffee, Delete, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { homeForRole } from '@/components/layout/RequireRole'
import { cn } from '@/lib/utils'
import { authService } from '@/services'
import { useAppStore } from '@/store/useAppStore'
import type { User } from '@/types'

/**
 * Mock PIN login. Sessions are per-tab, so Admin and Kitchen can run side
 * by side in two tabs — that is the demo setup for realtime sync.
 */
export function LoginPage() {
  const session = useAppStore((s) => s.session)
  const login = useAppStore((s) => s.login)
  const cafeName = useAppStore((s) => s.db.settings.cafeName)
  const navigate = useNavigate()

  const users = authService.listUsers()
  const [selected, setSelected] = useState<User | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState(false)

  if (session) return <Navigate to={homeForRole(session.role)} replace />

  const pressDigit = (d: string) => {
    if (!selected || pin.length >= 4) return
    const next = pin + d
    setPin(next)
    setError(false)
    if (next.length === 4) {
      if (login(selected.id, next)) {
        navigate(homeForRole(selected.role))
      } else {
        setError(true)
        window.setTimeout(() => setPin(''), 350)
      }
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-ink-900 p-10 text-cream-50 lg:flex">
        <div className="flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-xl bg-cream-50/10">
            <Coffee className="size-6 text-cream-100" />
          </div>
          <p className="text-lg font-bold tracking-tight">{cafeName}</p>
        </div>
        <div>
          <h1 className="max-w-md text-4xl font-bold leading-tight tracking-tight">
            One system for the floor and the kitchen.
          </h1>
          <p className="mt-4 max-w-sm text-cream-300">
            Take orders in seconds, route them to the right station, and watch
            them move from placed to served in real time.
          </p>
        </div>
        <p className="text-sm text-cream-400">Prototype build · mock data, no backend yet</p>
        <div className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-accent-500/20 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-32 -left-16 size-96 rounded-full bg-accent-500/10 blur-3xl" aria-hidden />
      </div>

      {/* Login panel */}
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center lg:text-left">
            <h2 className="text-2xl font-bold tracking-tight">Sign in</h2>
            <p className="mt-1 text-sm text-ink-500">Choose your role, then enter your PIN.</p>
          </div>

          <div className="mb-6 grid grid-cols-2 gap-3">
            {users.map((u) => {
              const Icon = u.role === 'kitchen' ? ChefHat : ShieldCheck
              const active = selected?.id === u.id
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => {
                    setSelected(u)
                    setPin('')
                    setError(false)
                  }}
                  className={cn(
                    'flex flex-col items-center gap-2 rounded-card border-2 bg-white p-5 transition-colors',
                    active ? 'border-accent-500 shadow-card' : 'border-cream-200 hover:border-cream-300',
                  )}
                >
                  <Icon className={cn('size-7', active ? 'text-accent-600' : 'text-ink-500')} />
                  <span className="text-sm font-bold">{u.name}</span>
                  <span className="text-xs capitalize text-ink-500">{u.role}</span>
                </button>
              )
            })}
          </div>

          {/* PIN dots */}
          <div className="mb-4 flex justify-center gap-3" aria-label="PIN entry" role="status">
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className={cn(
                  'size-3.5 rounded-full border-2 transition-colors',
                  error
                    ? 'border-danger-600 bg-danger-100'
                    : i < pin.length
                      ? 'border-accent-500 bg-accent-500'
                      : 'border-cream-300 bg-white',
                )}
              />
            ))}
          </div>
          {error && <p className="mb-3 text-center text-sm font-semibold text-danger-600">Wrong PIN, try again</p>}

          <div className="grid grid-cols-3 gap-2">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => pressDigit(d)}
                disabled={!selected}
                className="h-14 rounded-xl bg-white text-lg font-bold shadow-card transition-colors hover:bg-cream-50 disabled:opacity-40"
              >
                {d}
              </button>
            ))}
            <span aria-hidden />
            <button
              type="button"
              onClick={() => pressDigit('0')}
              disabled={!selected}
              className="h-14 rounded-xl bg-white text-lg font-bold shadow-card transition-colors hover:bg-cream-50 disabled:opacity-40"
            >
              0
            </button>
            <button
              type="button"
              onClick={() => setPin((p) => p.slice(0, -1))}
              disabled={!selected || pin.length === 0}
              aria-label="Delete digit"
              className="grid h-14 place-items-center rounded-xl bg-white shadow-card transition-colors hover:bg-cream-50 disabled:opacity-40"
            >
              <Delete className="size-5" />
            </button>
          </div>

          <p className="mt-6 text-center text-xs text-ink-500">
            Demo PINs — Manager: 1234 · Kitchen: 5678
          </p>
        </div>
      </div>
    </div>
  )
}
