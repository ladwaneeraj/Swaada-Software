import { deleteDoc, getDocs, writeBatch } from 'firebase/firestore'
import { firestore } from './firebase/app'
import { tableRef, tablesCol } from './firebase/paths'
import { requireOutletId } from './context'
import { toAppError } from '@/lib/errors'
import { uid } from '@/lib/utils'
import type { TableInput } from './rules'
import type { ID } from '@/types'

/** The floor plan. Admin-only at the rule level, like the menu. */
export const tableService = {
  async createTable(input: TableInput): Promise<ID> {
    const outletId = requireOutletId()
    try {
      const snap = await getDocs(tablesCol(outletId))
      const maxOrder = Math.max(0, ...snap.docs.map((d) => d.data().displayOrder))
      const id = uid('tbl')
      await writeBatch(firestore)
        .set(tableRef(outletId, id), { id, ...input, displayOrder: maxOrder + 1 })
        .commit()
      return id
    } catch (error) {
      throw toAppError(error, 'Could not add the table.')
    }
  },

  async updateTable(id: ID, patch: Partial<TableInput>): Promise<void> {
    const outletId = requireOutletId()
    try {
      await writeBatch(firestore).update(tableRef(outletId, id), { ...patch }).commit()
    } catch (error) {
      throw toAppError(error, 'Could not save the table.')
    }
  },

  /**
   * Settled rounds keep their denormalised `tableName`, so removing a table
   * never damages history. Rounds still open on it are the caller's problem
   * to settle first; the floor screen does not offer delete while a table is
   * occupied.
   */
  async archiveTable(id: ID): Promise<void> {
    const outletId = requireOutletId()
    try {
      await deleteDoc(tableRef(outletId, id))
    } catch (error) {
      throw toAppError(error, 'Could not remove the table.')
    }
  },
}
