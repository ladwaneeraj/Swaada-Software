import type { ConnectionStatus, RealtimeEvent } from '@/types'

/**
 * Transport abstraction for realtime sync.
 *
 * The mock implementation uses BroadcastChannel so two browser tabs
 * (Admin + Kitchen) stay in sync with no backend. Swapping in Supabase
 * Realtime / WebSockets / Firebase later means writing another object
 * that satisfies this interface; nothing above this layer changes.
 */
export interface RealtimeChannel {
  publish(event: RealtimeEvent): void
  subscribe(handler: (event: RealtimeEvent) => void): () => void
  getStatus(): ConnectionStatus
  onStatusChange(handler: (status: ConnectionStatus) => void): () => void
}

const CHANNEL_NAME = 'swaada-realtime-v1'

function createMockRealtimeChannel(): RealtimeChannel {
  const handlers = new Set<(event: RealtimeEvent) => void>()
  const statusHandlers = new Set<(status: ConnectionStatus) => void>()

  let status: ConnectionStatus =
    typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'live'

  const setStatus = (next: ConnectionStatus) => {
    if (next === status) return
    status = next
    statusHandlers.forEach((h) => h(status))
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => setStatus('live'))
    window.addEventListener('offline', () => setStatus('offline'))
  }

  const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL_NAME) : null

  if (bc) {
    bc.onmessage = (msg: MessageEvent<RealtimeEvent>) => {
      handlers.forEach((h) => h(msg.data))
    }
  }

  return {
    publish(event) {
      bc?.postMessage(event)
    },
    subscribe(handler) {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
    getStatus() {
      return status
    },
    onStatusChange(handler) {
      statusHandlers.add(handler)
      return () => statusHandlers.delete(handler)
    },
  }
}

export const realtime: RealtimeChannel = createMockRealtimeChannel()
