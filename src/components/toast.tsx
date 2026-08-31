import { create } from 'zustand'
import { cn } from '@/lib/utils'
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
    <div className="pointer-events-none fixed right-4 top-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite">
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
