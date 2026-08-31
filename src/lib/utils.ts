/** Tiny class-name joiner (clsx-style, no dependency). */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 })

/** ₹1,249 style formatting. */
export function formatINR(amount: number): string {
  return `₹${inr.format(round2(amount))}`
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
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
