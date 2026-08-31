import { X } from 'lucide-react'
import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { cn } from '@/lib/utils'
import type { Tone } from '@/lib/statusMeta'

/* ------------------------------- Button -------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'dark'
type ButtonSize = 'sm' | 'md' | 'lg'

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-accent-500 text-white hover:bg-accent-600 shadow-card',
  secondary:
    'bg-white text-ink-900 border border-cream-300 hover:border-cream-400 hover:bg-cream-50',
  ghost: 'bg-transparent text-ink-700 hover:bg-cream-200',
  danger: 'bg-danger-600 text-white hover:opacity-90',
  success: 'bg-ok-600 text-white hover:opacity-90',
  dark: 'bg-ink-900 text-cream-50 hover:bg-ink-700',
}

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-sm rounded-lg gap-1.5',
  md: 'h-11 px-4 text-sm rounded-xl gap-2',
  lg: 'h-13 px-6 text-base rounded-xl gap-2',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export function Button({ variant = 'primary', size = 'md', className, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex select-none items-center justify-center font-semibold transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500',
        'disabled:pointer-events-none disabled:opacity-45',
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...props}
    />
  )
}

/* -------------------------------- Badge --------------------------------- */

const toneStyles: Record<Tone, string> = {
  neutral: 'bg-cream-200 text-ink-700',
  info: 'bg-info-100 text-info-600',
  warn: 'bg-warn-100 text-warn-600',
  ok: 'bg-ok-100 text-ok-600',
  accent: 'bg-accent-100 text-accent-600',
  danger: 'bg-danger-100 text-danger-600',
}

const toneDots: Record<Tone, string> = {
  neutral: 'bg-ink-300',
  info: 'bg-info-600',
  warn: 'bg-warn-600',
  ok: 'bg-ok-600',
  accent: 'bg-accent-500',
  danger: 'bg-danger-600',
}

export function Badge({
  tone = 'neutral',
  dot = false,
  className,
  children,
}: {
  tone?: Tone
  dot?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold',
        toneStyles[tone],
        className,
      )}
    >
      {dot && <span className={cn('size-1.5 rounded-full', toneDots[tone])} aria-hidden />}
      {children}
    </span>
  )
}

/* ------------------------- Veg / non-veg marker -------------------------- */

export function VegMark({ isVeg, className }: { isVeg: boolean; className?: string }) {
  const color = isVeg ? 'border-veg' : 'border-nonveg'
  const dotColor = isVeg ? 'bg-veg' : 'bg-nonveg'
  return (
    <span
      role="img"
      aria-label={isVeg ? 'Vegetarian' : 'Non-vegetarian'}
      title={isVeg ? 'Vegetarian' : 'Non-vegetarian'}
      className={cn('inline-flex size-4 shrink-0 items-center justify-center border-2 bg-white', color, className)}
    >
      <span className={cn('size-1.5 rounded-full', dotColor)} />
    </span>
  )
}

/* --------------------------------- Card ---------------------------------- */

export function Card({
  className,
  children,
  testId,
}: {
  className?: string
  children: ReactNode
  testId?: string
}) {
  return (
    <div data-testid={testId} className={cn('rounded-card bg-white shadow-card', className)}>
      {children}
    </div>
  )
}

/* --------------------------------- Modal --------------------------------- */

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  /** center = dialog; sheet = right-side panel (bottom sheet on mobile). */
  position?: 'center' | 'sheet'
  wide?: boolean
}

export function Modal({ open, onClose, title, children, footer, position = 'center', wide }: ModalProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    panelRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex bg-ink-900/40 backdrop-blur-[2px]',
        position === 'center' ? 'items-center justify-center p-4' : 'items-end justify-center sm:items-stretch sm:justify-end',
      )}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'flex flex-col bg-white shadow-pop outline-none',
          position === 'center' &&
            cn('max-h-[90vh] w-full rounded-card', wide ? 'max-w-2xl' : 'max-w-md'),
          position === 'sheet' &&
            'max-h-[92vh] w-full rounded-t-card sm:max-h-none sm:w-[26.5rem] sm:rounded-l-card sm:rounded-tr-none',
        )}
      >
        <div className="flex items-center justify-between gap-4 border-b border-cream-200 px-5 py-4">
          <h2 id={titleId} className="text-lg font-bold tracking-tight">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-9 place-items-center rounded-lg text-ink-500 hover:bg-cream-200"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-cream-200 px-5 py-4">{footer}</div>}
      </div>
    </div>
  )
}

/* -------------------------------- Inputs --------------------------------- */

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-ink-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-500">{hint}</span>}
    </label>
  )
}

const inputBase =
  'w-full rounded-xl border border-cream-300 bg-white px-3.5 text-[15px] text-ink-900 placeholder:text-ink-300 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/20'

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(inputBase, 'h-11', props.className)} />
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(inputBase, 'min-h-20 py-2.5', props.className)} />
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(inputBase, 'h-11', props.className)} />
}

/* -------------------------------- Toggle --------------------------------- */

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-7 w-12 shrink-0 rounded-full transition-colors',
        checked ? 'bg-ok-600' : 'bg-cream-300',
      )}
    >
      <span
        className={cn(
          'absolute top-1 size-5 rounded-full bg-white shadow transition-all',
          checked ? 'left-6' : 'left-1',
        )}
      />
    </button>
  )
}

/* --------------------------- Segmented control --------------------------- */

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
}: {
  value: T
  onChange: (next: T) => void
  options: Array<{ value: T; label: string }>
  size?: 'sm' | 'md'
}) {
  return (
    <div className="inline-flex rounded-xl bg-cream-200 p-1" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-lg font-semibold transition-colors',
            size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm',
            value === o.value ? 'bg-white text-ink-900 shadow-card' : 'text-ink-500 hover:text-ink-700',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ------------------------------ Empty state ------------------------------ */

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: ReactNode
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-card border border-dashed border-cream-300 bg-cream-50 px-6 py-14 text-center">
      <div className="text-4xl" aria-hidden>
        {icon}
      </div>
      <p className="text-base font-bold text-ink-900">{title}</p>
      {hint && <p className="max-w-sm text-sm text-ink-500">{hint}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

/* ------------------------------- Stat tile ------------------------------- */

export function Stat({
  label,
  value,
  sub,
  icon,
}: {
  label: string
  value: string
  sub?: string
  icon?: ReactNode
}) {
  return (
    <Card className="flex items-center gap-4 p-5">
      {icon && (
        <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent-50 text-accent-600">
          {icon}
        </div>
      )}
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold uppercase tracking-wide text-ink-500">{label}</p>
        <p className="text-2xl font-bold tracking-tight">{value}</p>
        {sub && <p className="text-xs text-ink-500">{sub}</p>}
      </div>
    </Card>
  )
}
