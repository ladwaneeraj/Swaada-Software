import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useAppStore } from '@/store/useAppStore'

/**
 * The kitchen's new-order alert.
 *
 * The chime is synthesised with the Web Audio API instead of shipping an
 * audio file: nothing to download, nothing to license, and it still rings
 * when the tablet has no network. Two descending bell notes — the door-chime
 * "ding-dong" this class of POS software uses — struck twice per alert.
 *
 * Browsers refuse to produce sound until the page has been touched, so the
 * module tracks whether audio is unlocked and the kitchen screen shows a
 * prompt while it is not.
 */

/* ------------------------------ Audio engine ---------------------------- */

export type SoundStatus = 'ready' | 'blocked'

/** E5 then C5: a falling major third, the classic doorbell interval. */
const NOTE_HIGH = 659.25
const NOTE_LOW = 523.25
/** Seconds between the ding and the dong. */
const NOTE_GAP = 0.4
/** Seconds between one ding-dong and the next. */
const PHRASE_GAP = 1
/** Ding-dongs per alert. Two reads as "attention", three as an alarm. */
const PHRASES = 2

/** Inharmonic partials are what make an oscillator sound like a bell. */
const PARTIALS = [
  { ratio: 1, gain: 1, decay: 1.2 },
  { ratio: 2.02, gain: 0.32, decay: 0.7 },
  { ratio: 3.01, gain: 0.12, decay: 0.4 },
]

/** Headroom so three partials across two notes never clip at volume 1. */
const MASTER = 0.45

let ctx: AudioContext | null = null
let status: SoundStatus = 'blocked'
let armed = false
const statusListeners = new Set<() => void>()

function setStatus(next: SoundStatus): void {
  if (next === status) return
  status = next
  statusListeners.forEach((notify) => notify())
}

function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  ctx ??= new Ctor()
  setStatus(ctx.state === 'running' ? 'ready' : 'blocked')
  return ctx
}

/**
 * Wait for any touch or keypress anywhere and use it to unlock audio. The
 * listeners drop off as soon as the context is running and re-attach if the
 * browser suspends it again (a backgrounded tab on iOS, for instance).
 */
function armUnlock(): void {
  if (armed || typeof window === 'undefined') return
  armed = true
  const attempt = () => {
    const audio = audioContext()
    if (!audio) return
    void audio.resume().finally(() => {
      const running = audio.state === 'running'
      setStatus(running ? 'ready' : 'blocked')
      if (!running) return
      window.removeEventListener('pointerdown', attempt)
      window.removeEventListener('keydown', attempt)
      armed = false
    })
  }
  window.addEventListener('pointerdown', attempt)
  window.addEventListener('keydown', attempt)
}

/** One bell note: partials struck together, each decaying at its own rate. */
function strike(audio: AudioContext, at: number, freq: number, volume: number): void {
  for (const partial of PARTIALS) {
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    const peak = Math.max(0.0002, volume * partial.gain * MASTER)

    osc.type = 'sine'
    osc.frequency.setValueAtTime(freq * partial.ratio, at)
    // Exponential ramps only: a linear fade to zero clicks audibly.
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(peak, at + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + partial.decay)

    osc.connect(gain)
    gain.connect(audio.destination)
    osc.start(at)
    osc.stop(at + partial.decay + 0.05)
  }
}

/**
 * Ring the alert. Resolves false when the browser is still holding audio
 * back, in which case the unlock listeners are armed and the caller can show
 * the "tap to enable" prompt.
 */
export async function playOrderChime(volume = 0.8): Promise<boolean> {
  const audio = audioContext()
  if (!audio) return false

  if (audio.state !== 'running') {
    try {
      await audio.resume()
    } catch {
      // Still locked: a user gesture is required.
    }
  }
  if (audio.state !== 'running') {
    setStatus('blocked')
    armUnlock()
    return false
  }

  setStatus('ready')
  const start = audio.currentTime + 0.03
  for (let phrase = 0; phrase < PHRASES; phrase += 1) {
    const at = start + phrase * PHRASE_GAP
    strike(audio, at, NOTE_HIGH, volume)
    strike(audio, at + NOTE_GAP, NOTE_LOW, volume)
  }
  return true
}

/* -------------------------------- Hooks --------------------------------- */

function subscribeStatus(notify: () => void): () => void {
  statusListeners.add(notify)
  return () => statusListeners.delete(notify)
}

/** Whether the browser will currently let the alert be heard. */
export function useSoundStatus(): SoundStatus {
  useEffect(() => {
    audioContext()
    armUnlock()
  }, [])
  return useSyncExternalStore(
    subscribeStatus,
    () => status,
    () => 'blocked' as SoundStatus,
  )
}

/**
 * Stop nagging after this many repeats so a round left untouched overnight
 * does not ring forever. The count resets whenever a new round arrives.
 */
const MAX_REPEATS = 8

/**
 * Rings when a round reaches the New orders lane and, while the setting is
 * on, keeps re-ringing until the kitchen taps Start preparing. Mounted by the
 * kitchen display only — the admin tab placing the order does not echo it.
 */
export function useNewOrderAlert(): void {
  const orders = useAppStore((s) => s.db.orders)
  const sound = useAppStore((s) => s.db.settings.sound)

  // A stable string of what is waiting, so effects fire on real changes only.
  const waitingKey = orders
    .filter((o) => o.status === 'placed')
    .map((o) => o.id)
    .sort()
    .join('|')

  const seen = useRef<Set<string> | null>(null)
  const repeats = useRef(0)

  const { newOrderAlert, volume, repeatUntilAcknowledged, repeatSeconds } = sound

  useEffect(() => {
    audioContext()
    armUnlock()
  }, [])

  useEffect(() => {
    const waiting = waitingKey ? waitingKey.split('|') : []

    // First pass after mount: adopt whatever is already on the board without
    // ringing, so opening the screen is quiet. The repeat timer below still
    // picks those rounds up if they stay untouched.
    if (seen.current === null) {
      seen.current = new Set(waiting)
      return
    }

    const arrived = waiting.filter((id) => !seen.current?.has(id))
    seen.current = new Set(waiting)
    if (arrived.length === 0) return

    repeats.current = 0
    if (newOrderAlert) void playOrderChime(volume)
  }, [waitingKey, newOrderAlert, volume])

  useEffect(() => {
    if (!newOrderAlert || !repeatUntilAcknowledged || !waitingKey) return
    const every = Math.max(5, repeatSeconds) * 1000
    const timer = window.setInterval(() => {
      repeats.current += 1
      if (repeats.current > MAX_REPEATS) {
        window.clearInterval(timer)
        return
      }
      void playOrderChime(volume)
    }, every)
    return () => window.clearInterval(timer)
  }, [waitingKey, newOrderAlert, repeatUntilAcknowledged, repeatSeconds, volume])
}
