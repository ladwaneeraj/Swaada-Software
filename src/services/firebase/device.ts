/**
 * This browser, as far as the outlet is concerned.
 *
 * The id is generated once and kept in localStorage. It scopes the reserved
 * number blocks (so two tablets never hand out the same bill number) and
 * gives the clock check something to write to.
 */

const DEVICE_KEY = 'swaada.device.v1'

interface StoredDevice {
  id: string
  label: string
}

function readStored(): StoredDevice | null {
  try {
    const raw = localStorage.getItem(DEVICE_KEY)
    return raw ? (JSON.parse(raw) as StoredDevice) : null
  } catch {
    return null
  }
}

function writeStored(device: StoredDevice): void {
  try {
    localStorage.setItem(DEVICE_KEY, JSON.stringify(device))
  } catch {
    /* private mode: the id stays in memory for this session only */
  }
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

let cached: StoredDevice | null = null

export function deviceId(): string {
  cached ??= readStored() ?? { id: newId(), label: defaultLabel() }
  writeStored(cached)
  return cached.id
}

export function deviceLabel(): string {
  cached ??= readStored() ?? { id: newId(), label: defaultLabel() }
  return cached.label
}

/** A manager renaming "Counter tablet" in Settings writes through here. */
export function setDeviceLabel(label: string): void {
  cached = { id: deviceId(), label: label.trim() || defaultLabel() }
  writeStored(cached)
}

function defaultLabel(): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  if (/android/i.test(ua)) return 'Android device'
  if (/iphone|ipad|ipod/i.test(ua)) return 'iPad / iPhone'
  if (/windows/i.test(ua)) return 'Windows PC'
  if (/mac/i.test(ua)) return 'Mac'
  return 'Device'
}
