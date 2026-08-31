import { create } from 'zustand'
import { db } from '@/services/db'
import { authService } from '@/services'
import { realtime } from '@/services/realtime'
import type { ConnectionStatus, DBSnapshot, ID, Session } from '@/types'

/**
 * Central application store.
 *
 * Admin and Kitchen read the SAME state: `db` mirrors the mock database and
 * is refreshed by the persistence layer on every mutation, local or from
 * another tab. Session is per-tab (sessionStorage) so one tab can be Admin
 * while another is Kitchen.
 */

interface AppState {
  db: DBSnapshot
  session: Session | null
  connection: ConnectionStatus
  login: (userId: ID, pin: string) => boolean
  logout: () => void
}

export const useAppStore = create<AppState>((set) => ({
  db: db.get(),
  session: authService.getSession(),
  connection: realtime.getStatus(),

  login: (userId, pin) => {
    const session = authService.login(userId, pin)
    if (session) set({ session })
    return session !== null
  },

  logout: () => {
    authService.logout()
    set({ session: null })
  },
}))

db.subscribe((snapshot) => useAppStore.setState({ db: snapshot }))
realtime.onStatusChange((connection) => useAppStore.setState({ connection }))
