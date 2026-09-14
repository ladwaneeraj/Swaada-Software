import { deleteDoc, doc, getDocs, query, where, writeBatch } from 'firebase/firestore'
import { firestore } from './firebase/app'
import {
  categoriesCol,
  categoryRef,
  itemRef,
  itemsCol,
  modifierGroupRef,
  modifierGroupsCol,
} from './firebase/paths'
import { requireOutletId } from './context'
import { record, stageAudit } from './audit'
import { toAppError } from '@/lib/errors'
import { nowISO, uid } from '@/lib/utils'
import type { CategoryInput, MenuItemInput } from './rules'
import type { ID, ItemAvailability, ModifierGroup, ModifierOption } from '@/types'
import type { StoredModifierGroup } from './firebase/converters'

/**
 * The menu: categories, items and modifier groups.
 *
 * Admin-only at the rule level, so a counter login calling any of these gets
 * a permission denied from the server rather than a polite client-side
 * refusal that a devtools console could walk around.
 *
 * Price changes and archiving are written to the audit log. Everything else
 * (renames, reordering, availability) is not: a log nobody reads because it
 * is full of drag-and-drop noise is worse than a short one.
 */

export const menuService = {
  async createCategory(input: CategoryInput): Promise<ID> {
    const outletId = requireOutletId()
    try {
      const snap = await getDocs(categoriesCol(outletId))
      const maxOrder = Math.max(0, ...snap.docs.map((d) => d.data().displayOrder))
      const id = uid('cat')
      const now = nowISO()
      const batch = writeBatch(firestore)
      batch.set(categoryRef(outletId, id), {
        id,
        ...input,
        image: null,
        displayOrder: maxOrder + 1,
        createdAt: now,
        updatedAt: now,
      })
      await batch.commit()
      return id
    } catch (error) {
      throw toAppError(error, 'Could not create the category.')
    }
  },

  async updateCategory(id: ID, patch: Partial<CategoryInput>): Promise<void> {
    const outletId = requireOutletId()
    try {
      const batch = writeBatch(firestore)
      batch.update(categoryRef(outletId, id), { ...patch, updatedAt: nowISO() })
      await batch.commit()
    } catch (error) {
      throw toAppError(error, 'Could not save the category.')
    }
  },

  /**
   * Remove a category and everything in it.
   *
   * Rounds already taken keep their denormalised category names, so history
   * still reads correctly after the category is gone. That denormalisation
   * on OrderItem is what makes this safe to do at all.
   */
  async archiveCategory(id: ID): Promise<void> {
    const outletId = requireOutletId()
    try {
      const items = await getDocs(query(itemsCol(outletId), where('categoryId', '==', id)))
      const batch = writeBatch(firestore)
      batch.delete(categoryRef(outletId, id))
      items.docs.forEach((d) => batch.delete(itemRef(outletId, d.id)))
      stageAudit(batch, {
        action: 'menu.archive',
        summary: `Removed category and its ${items.size} item(s)`,
        target: { categoryId: id },
      })
      await batch.commit()
    } catch (error) {
      throw toAppError(error, 'Could not remove the category.')
    }
  },

  async reorderCategories(orderedIds: ID[]): Promise<void> {
    const outletId = requireOutletId()
    try {
      const batch = writeBatch(firestore)
      const now = nowISO()
      orderedIds.forEach((id, index) => {
        batch.update(categoryRef(outletId, id), { displayOrder: index + 1, updatedAt: now })
      })
      await batch.commit()
    } catch (error) {
      throw toAppError(error, 'Could not save the new order.')
    }
  },

  async createItem(input: MenuItemInput): Promise<ID> {
    const outletId = requireOutletId()
    try {
      const siblings = await getDocs(
        query(itemsCol(outletId), where('categoryId', '==', input.categoryId)),
      )
      const maxOrder = Math.max(0, ...siblings.docs.map((d) => d.data().displayOrder))
      const id = uid('itm')
      const now = nowISO()
      const batch = writeBatch(firestore)
      batch.set(itemRef(outletId, id), {
        id,
        ...input,
        displayOrder: maxOrder + 1,
        createdAt: now,
        updatedAt: now,
      })
      await batch.commit()
      return id
    } catch (error) {
      throw toAppError(error, 'Could not create the item.')
    }
  },

  /**
   * `previousPrice` is passed by the caller (which already has the item on
   * screen) purely so a price change can be logged with its before value.
   * Re-reading the document just to log it would cost a read on every edit.
   */
  async updateItem(
    id: ID,
    patch: Partial<MenuItemInput>,
    context?: { name?: string; previousPrice?: number },
  ): Promise<void> {
    const outletId = requireOutletId()
    try {
      const batch = writeBatch(firestore)
      batch.update(itemRef(outletId, id), { ...patch, updatedAt: nowISO() })

      const nextPrice = patch.basePrice
      const prevPrice = context?.previousPrice
      if (nextPrice !== undefined && prevPrice !== undefined && nextPrice !== prevPrice) {
        stageAudit(batch, {
          action: 'menu.price_change',
          summary: `${context?.name ?? 'Item'} price ₹${prevPrice} → ₹${nextPrice}`,
          target: { itemId: id },
          change: { field: 'basePrice', from: prevPrice, to: nextPrice },
        })
      }
      await batch.commit()
    } catch (error) {
      throw toAppError(error, 'Could not save the item.')
    }
  },

  async setItemAvailability(id: ID, availability: ItemAvailability): Promise<void> {
    return menuService.updateItem(id, { availability })
  },

  async archiveItem(id: ID, name?: string): Promise<void> {
    const outletId = requireOutletId()
    try {
      await deleteDoc(itemRef(outletId, id))
      await record({
        action: 'menu.archive',
        summary: `Removed item ${name ?? id}`,
        target: { itemId: id },
      })
    } catch (error) {
      throw toAppError(error, 'Could not remove the item.')
    }
  },

  async reorderItems(categoryId: ID, orderedIds: ID[]): Promise<void> {
    const outletId = requireOutletId()
    try {
      const batch = writeBatch(firestore)
      const now = nowISO()
      orderedIds.forEach((id, index) => {
        batch.update(itemRef(outletId, id), {
          categoryId,
          displayOrder: index + 1,
          updatedAt: now,
        })
      })
      await batch.commit()
    } catch (error) {
      throw toAppError(error, 'Could not save the new order.')
    }
  },

  /**
   * Modifier groups carry their options inside the document. They are tiny,
   * never read without their group, and nesting turns "load the menu" from
   * N + M reads into N.
   */
  async saveModifierGroup(group: ModifierGroup, options: ModifierOption[]): Promise<void> {
    const outletId = requireOutletId()
    try {
      const stored: StoredModifierGroup = {
        ...group,
        options: options.map((o) => ({ ...o, modifierGroupId: group.id })),
      }
      const batch = writeBatch(firestore)
      batch.set(modifierGroupRef(outletId, group.id), stored)
      await batch.commit()
    } catch (error) {
      throw toAppError(error, 'Could not save the modifier group.')
    }
  },

  async deleteModifierGroup(id: ID): Promise<void> {
    const outletId = requireOutletId()
    try {
      await deleteDoc(doc(modifierGroupsCol(outletId), id))
    } catch (error) {
      throw toAppError(error, 'Could not remove the modifier group.')
    }
  },
}
