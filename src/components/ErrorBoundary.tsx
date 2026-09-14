import { Component, type ErrorInfo, type ReactNode } from 'react'
import { reportError } from '@/lib/monitoring'

/**
 * The last line before a white screen.
 *
 * A React render error unmounts the whole tree, and on a POS that means a
 * cashier mid-transaction staring at nothing. This catches it, says
 * something a person can act on, and offers the one thing that reliably
 * helps — reloading — without needing anyone to find the browser's refresh
 * button on a kiosk-mode tablet.
 */

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    reportError(error, { componentStack: info.componentStack })
  }

  override render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="grid min-h-dvh place-items-center bg-surface-50 p-6">
        <div className="w-full max-w-md rounded-card bg-white p-6 text-center shadow-card">
          <p className="text-3xl" aria-hidden>
            😵
          </p>
          <h1 className="mt-3 text-lg font-bold">Something broke on this screen</h1>
          <p className="mt-2 text-sm text-ink-500">
            Nothing was lost. Any order or bill you had already saved is safe on the server.
            Reload and carry on.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 h-11 w-full rounded-control bg-accent-600 font-bold text-white transition-colors hover:bg-accent-700"
          >
            Reload
          </button>
          <p className="mt-4 text-xs text-ink-300">
            If it keeps happening, tell the manager what you were doing when it broke.
          </p>
        </div>
      </div>
    )
  }
}
