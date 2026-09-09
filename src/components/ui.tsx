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
  primary:
    'bg-gradient-to-b from-accent-500 to-accent-600 text-white shadow-accent hover:brightness-105',
  secondary: 'bg-white text-ink-700 shadow-card ring-1 ring-surface-200 hover:text-ink-900 hover:shadow-lift',
  ghost: 'bg-transparent text-ink-700 hover:bg-surface-200',
  danger: 'bg-danger-600 text-white shadow-card hover:brightness-110',
  success: 'bg-ok-600 text-white shadow-card hover:brightness-110',
  dark: 'bg-ink-900 text-white shadow-card hover:bg-ink-700',
}

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-[13px] rounded-[0.625rem] gap-1.5',
  md: 'h-10 px-4 text-[13px] rounded-control gap-2',
  lg: 'h-12 px-5 text-sm rounded-control gap-2',
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
        'inline-flex select-none items-center justify-center font-semibold transition-all duration-150',
        'active:scale-[0.97]',
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
  neutral: 'bg-surface-200 text-ink-700',
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
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-[11px] font-bold',
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
    <div data-testid={testId} className={cn('rounded-card bg-white shadow-card ring-1 ring-surface-200/70', className)}>
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

  // Hold the close handler in a ref so it is NOT an effect dependency.
  // Callers pass an inline arrow, so its identity changes on every parent
  // render — and parents with a live timer (the tables floor) re-render every
  // second. As a dependency it would re-run the effect on each tick and pull
  // focus back to the panel, out of whatever field is being typed in.
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // Move focus into the dialog once, when it opens, and never again.
  useEffect(() => {
    if (open) panelRef.current?.focus()
  }, [open])

  if (!open) return null

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex bg-ink-900/35 backdrop-blur-[3px]',
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
            cn('max-h-[90vh] w-full rounded-2xl', wide ? 'max-w-2xl' : 'max-w-md'),
          position === 'sheet' &&
            'max-h-[92vh] w-full rounded-t-2xl sm:max-h-none sm:w-[27rem] sm:rounded-l-2xl sm:rounded-tr-none',
        )}
      >
        <div className="flex items-center justify-between gap-4 border-b border-surface-200 px-5 py-3.5">
          <h2 id={titleId} className="text-[15px] font-bold tracking-tight">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-9 place-items-center rounded-full text-ink-500 transition-colors hover:bg-surface-200"
          >
            <X className="size-4.5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-surface-200 bg-surface-100/60 px-5 py-4">{footer}</div>}
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

/* Fields deliberately do NOT set a width: a caller passing w-44 would lose to
   a baked-in w-full, so width belongs to whoever places the field. */
const inputBase =
  'block rounded-control border border-surface-200 bg-surface-100 px-3.5 text-[13px] text-ink-900 transition-colors placeholder:text-ink-300 focus:border-accent-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-accent-500/10'

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(inputBase, 'h-10 w-full', props.className)} />
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(inputBase, 'min-h-20 w-full py-2', props.className)} />
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(inputBase, 'h-10 w-full', props.className)} />
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
        checked ? 'bg-ok-600' : 'bg-surface-300',
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
    <div className="inline-flex rounded-full bg-surface-200 p-1" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-full font-semibold transition-all',
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
    <div className="flex flex-col items-center justify-center gap-2 rounded-card border border-dashed border-surface-300 bg-white/60 px-6 py-16 text-center">
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

const statTones: Record<Tone, string> = {
  neutral: 'text-ink-900',
  info: 'text-info-600',
  warn: 'text-warn-600',
  ok: 'text-ok-600',
  accent: 'text-accent-600',
  danger: 'text-danger-600',
}

export function Stat({
  label,
  value,
  sub,
  icon,
  tone = 'neutral',
}: {
  label: string
  value: string
  sub?: string
  icon?: ReactNode
  /** Colours the number when it carries a warning ("owed to the cafe"). */
  tone?: Tone
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
        <p className={cn('font-display text-2xl font-bold leading-tight tabular-nums', statTones[tone])}>
          {value}
        </p>
        {sub && <p className="text-xs text-ink-500">{sub}</p>}
      </div>
    </Card>
  )
}
