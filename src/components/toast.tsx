import { useCallback } from 'react'
import { create } from 'zustand'
import { cn } from '@/lib/utils'
import { toAppError } from '@/lib/errors'
import type { Tone } from '@/lib/statusMeta'

/** Lightweight toast notifications (order ready, item 86'd, etc.). */

interface Toast {
  id: number
  title: string
  tone: Tone
}

interface ToastState {
  toasts: Toast[]
  push: (title: string, tone?: Tone) => void
  dismiss: (id: number) => void
}

let nextId = 1

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (title, tone = 'neutral') => {
    const id = nextId++
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, title, tone }] }))
    window.setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, 4000)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

const toneBar: Record<Tone, string> = {
  neutral: 'bg-ink-300',
  info: 'bg-info-600',
  warn: 'bg-warn-600',
  ok: 'bg-ok-600',
  accent: 'bg-accent-500',
  danger: 'bg-danger-600',
}

export function Toaster() {
  const toasts = useToasts((s) => s.toasts)
  const dismiss = useToasts((s) => s.dismiss)
  return (
    // Top-centre keeps toasts clear of sheet headers, the cart panel and the
    // sidebar on every screen size.
    <div className="pointer-events-none fixed left-1/2 top-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismiss(t.id)}
          className="rise-in pointer-events-auto flex items-center gap-3 overflow-hidden rounded-xl bg-white p-3 text-left shadow-pop"
        >
          <span className={cn('h-8 w-1 shrink-0 rounded-full', toneBar[t.tone])} aria-hidden />
          <span className="text-sm font-semibold text-ink-900">{t.title}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * Fire a service call and say something if it fails.
 *
 * Every write is async now, and a fire-and-forget promise swallows its
 * rejection. That is how a permission denied or a lost connection turns into
 * "I tapped it and nothing happened", which is the worst possible failure
 * for a cashier mid-service. This makes the quiet cases loud.
 *
 *   const run = useAction()
 *   run(menuService.setItemAvailability(id, 'out_of_stock'), `${name} is off`)
 */
export function useAction(): (promise: Promise<unknown>, onSuccess?: string) => void {
  const push = useToasts((s) => s.push)
  return useCallback(
    (promise, onSuccess) => {
      void promise
        .then(() => {
          if (onSuccess) push(onSuccess, 'ok')
        })
        .catch((error: unknown) => {
          push(toAppError(error).userMessage, 'danger')
        })
    },
    [push],
  )
}
