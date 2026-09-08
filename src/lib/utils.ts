/** Tiny class-name joiner (clsx-style, no dependency). */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

const inrWhole = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })
const inrPaise = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** ₹1,249 for whole amounts, ₹1,249.50 (never .5) when paise are involved. */
export function formatINR(amount: number): string {
  const v = round2(amount)
  return `₹${Number.isInteger(v) ? inrWhole.format(v) : inrPaise.format(v)}`
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Keep a number inside [min, max]; NaN falls back to min. */
export function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.min(Math.max(n, min), max)
}

/** Parse a rupee text input ("", "1,200", "abc") into a usable number. */
export function parseAmount(text: string): number {
  const n = Number(text.replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) ? n : 0
}

let uidCounter = 0

/** Collision-safe id for client-created rows; a DB will assign UUIDs later. */
export function uid(prefix: string): string {
  uidCounter += 1
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}${uidCounter.toString(36)}`
}

export function nowISO(): string {
  return new Date().toISOString()
}

/** "0:42" / "12:05" elapsed since an ISO timestamp. */
export function elapsedLabel(sinceISO: string, now: number): string {
  const secs = Math.max(0, Math.floor((now - new Date(sinceISO).getTime()) / 1000))
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function minutesSince(sinceISO: string, now: number): number {
  return Math.floor((now - new Date(sinceISO).getTime()) / 60000)
}

/** "2:41 pm" local time. */
export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** "31 Aug, 2:41 pm" */
export function dateTimeLabel(iso: string): string {
  const d = new Date(iso)
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${timeLabel(iso)}`
}

export function isToday(iso: string): boolean {
  const d = new Date(iso)
  const t = new Date()
  return (
    d.getFullYear() === t.getFullYear() &&
    d.getMonth() === t.getMonth() &&
    d.getDate() === t.getDate()
  )
}

export function byDisplayOrder<T extends { displayOrder: number }>(a: T, b: T): number {
  return a.displayOrder - b.displayOrder
}

/**
 * Resolve an item/category image reference to something an <img> can load:
 *
 *  - full http(s)/data URLs (photos from a DB later) pass through,
 *  - bundled photos already carry the deploy base (Vite resolves them),
 *  - site-relative paths (/menu/….svg) get the base path added so they work
 *    under a sub-path deploy like GitHub Pages.
 */
export function assetUrl(path: string): string {
  if (/^(https?:)?\/\//.test(path) || path.startsWith('data:')) return path
  const base = import.meta.env.BASE_URL.replace(/\/$/, '')
  if (!base || path.startsWith(`${base}/`)) return path
  return base + path
}
