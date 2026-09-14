import { getDoc, setDoc, writeBatch } from 'firebase/firestore'
import { firestore } from './firebase/app'
import { customerRef } from './firebase/paths'
import { requireOutletId } from './context'
import { normalisePhone } from './rules'
import { toAppError } from '@/lib/errors'
import { nowISO } from '@/lib/utils'
import type { Customer, ID } from '@/types'

/**
 * A guest is identified by their mobile number and nothing else.
 *
 * The document id IS the ten-digit number, which is worth more than it
 * looks: looking a guest up at the counter is a single get by id rather
 * than a query, so it is fast, it costs one read, and it works straight out
 * of the offline cache for anyone seen before. It also makes a duplicate
 * guest record impossible — same number, same document.
 */
export const customerService = {
  /**
   * Look a guest up, creating the record the first time that number is seen.
   * A name given later fills in or corrects the one on file, so the counter
   * never has to visit a separate "add customer" screen.
   */
  async upsert(input: { phone: string; name?: string }): Promise<Customer | null> {
    const phone = normalisePhone(input.phone)
    if (phone.length !== 10) return null
    const outletId = requireOutletId()
    const name = input.name?.trim()
    const now = nowISO()

    try {
      const ref = customerRef(outletId, phone)
      const existing = await getDoc(ref)

      if (existing.exists()) {
        const current = existing.data()
        if (name && name !== current.name) {
          await setDoc(ref, { name, updatedAt: now }, { merge: true })
          return { ...current, name, updatedAt: now }
        }
        return current
      }

      const created: Customer = {
        id: phone,
        phone,
        name: name || 'Guest',
        createdAt: now,
        updatedAt: now,
      }
      await setDoc(ref, created)
      return created
    } catch (error) {
      throw toAppError(error, 'Could not save the guest.')
    }
  },

  /** One guest by mobile. Serves from the offline cache when it can. */
  async get(phone: string): Promise<Customer | null> {
    const key = normalisePhone(phone)
    if (key.length !== 10) return null
    try {
      const snap = await getDoc(customerRef(requireOutletId(), key))
      return snap.data() ?? null
    } catch (error) {
      throw toAppError(error, 'Could not look up that number.')
    }
  },

  async update(id: ID, patch: { name?: string; note?: string }): Promise<void> {
    const outletId = requireOutletId()
    try {
      const next: Record<string, string> = { updatedAt: nowISO() }
      if (patch.name !== undefined && patch.name.trim()) next.name = patch.name.trim()
      if (patch.note !== undefined) next.note = patch.note.trim()
      await writeBatch(firestore).set(customerRef(outletId, id), next, { merge: true }).commit()
    } catch (error) {
      throw toAppError(error, 'Could not save the guest.')
    }
  },
}
