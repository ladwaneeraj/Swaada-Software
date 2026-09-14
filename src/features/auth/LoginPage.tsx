import { Coffee, Eye, EyeOff, LoaderCircle, LogIn } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { homeForRole } from '@/components/layout/RequireRole'
import { cn } from '@/lib/utils'
import { toAppError } from '@/lib/errors'
import { useAppStore } from '@/store/useAppStore'

/**
 * Username and password, not a PIN and not an email.
 *
 * Behind this form the username is turned into a synthetic address so
 * Firebase Auth can hold it, but nothing about that reaches the person
 * typing. The manager creates these logins on the Staff screen; there is
 * deliberately no "sign up" here, because a cafe does not want anyone
 * making themselves an account.
 *
 * The form does NOT navigate on success. Signing in changes the auth token,
 * the store picks that up, and the route guard moves the person to the right
 * home screen for their role. One path in, whether they just signed in or
 * arrived with a session already alive.
 */
export function LoginPage() {
  const session = useAppStore((s) => s.session)
  const authReady = useAppStore((s) => s.authReady)
  const signIn = useAppStore((s) => s.signIn)
  const cafeName = useAppStore((s) => s.db.settings.cafeName)

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (session) return <Navigate to={homeForRole(session.role)} replace />

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await signIn(username, password)
      // No navigate here on purpose: the session arriving in the store is
      // what moves us, via the redirect above.
    } catch (caught) {
      setError(toAppError(caught, 'Could not sign in.').userMessage)
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-ink-900 p-10 text-surface-50 lg:flex">
        <div className="flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-xl bg-surface-50/10">
            <Coffee className="size-6 text-surface-100" />
          </div>
          <p className="text-lg font-bold tracking-tight">{cafeName}</p>
        </div>
        <div>
          <h1 className="font-display max-w-md text-[2.75rem] font-medium leading-[1.15]">
            One system for the floor <em className="text-accent-100">and</em> the kitchen.
          </h1>
          <p className="mt-4 max-w-sm text-surface-300">
            Take orders in seconds, route them to the right station, and watch
            them move from placed to paid in real time.
          </p>
        </div>
        <p className="text-sm text-surface-400">
          Ask your manager for a login. Accounts are created on the Staff screen.
        </p>
        <div
          className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-accent-500/20 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-32 -left-16 size-96 rounded-full bg-accent-500/10 blur-3xl"
          aria-hidden
        />
      </div>

      {/* Login panel */}
      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm">
          <div className="mb-8 text-center lg:text-left">
            <h2 className="font-display text-3xl font-semibold">Sign in</h2>
            <p className="mt-1 text-sm text-ink-500">Use the username your manager gave you.</p>
          </div>

          <label className="mb-4 block">
            <span className="mb-1.5 block text-sm font-bold text-ink-700">Username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              disabled={busy}
              className="h-12 w-full rounded-control border-2 border-surface-200 bg-white px-3.5 text-[15px] font-semibold outline-none transition-colors focus:border-accent-500 disabled:opacity-60"
              placeholder="ramesh"
            />
          </label>

          <label className="mb-2 block">
            <span className="mb-1.5 block text-sm font-bold text-ink-700">Password</span>
            <span className="relative block">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                disabled={busy}
                className="h-12 w-full rounded-control border-2 border-surface-200 bg-white pl-3.5 pr-12 text-[15px] font-semibold outline-none transition-colors focus:border-accent-500 disabled:opacity-60"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute inset-y-0 right-0 grid w-12 place-items-center text-ink-500 transition-colors hover:text-ink-700"
              >
                {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
              </button>
            </span>
          </label>

          <div aria-live="polite" className="min-h-[1.75rem]">
            {error && <p className="py-1 text-sm font-semibold text-danger-600">{error}</p>}
          </div>

          <button
            type="submit"
            disabled={busy || !authReady || !username.trim() || !password}
            className={cn(
              'mt-1 flex h-12 w-full items-center justify-center gap-2 rounded-control bg-accent-600 text-[15px] font-bold text-white shadow-accent transition-colors',
              'hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            {busy ? (
              <>
                <LoaderCircle className="size-5 animate-spin" />
                Signing in
              </>
            ) : (
              <>
                <LogIn className="size-5" />
                Sign in
              </>
            )}
          </button>

          <p className="mt-6 text-center text-xs text-ink-500">
            Forgot your password? Your manager can set a new one for you on the Staff screen.
          </p>
        </form>
      </div>
    </div>
  )
}
