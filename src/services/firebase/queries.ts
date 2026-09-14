import {
  getDocs,
  limit as fbLimit,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
  type Query,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { auditCol, billsCol, customersCol, ordersCol, walletEntriesCol } from './paths'
import { requireOutletId } from '../context'
import { toAppError } from '@/lib/errors'
import { normalisePhone } from '../rules'
import type { AuditEntry, Bill, Customer, Order, WalletEntry } from '@/types'

/**
 * Everything the app reads on demand instead of holding in memory.
 *
 * History, analytics and customer search used to be free because the whole
 * database was already loaded. Against Firestore that would mean carrying
 * the cafe's entire past around all day and paying for it on every app
 * start. So they became queries: a manager who opens last month's numbers
 * pays for last month's numbers, once, and nobody else pays anything.
 *
 * Every range filter is on `businessDate`, a plain YYYY-MM-DD string. String
 * ranges use Firestore's automatic single-field index, so most of these need
 * no composite index at all — and the two that do are declared in
 * firestore.indexes.json rather than discovered in production.
 */

/**
 * Where a page stopped. Opaque to callers on purpose — it is a Firestore
 * snapshot, not a number, because Firestore pages by document position
 * rather than by offset. Hand it straight back as `after`.
 */
export type PageCursor = QueryDocumentSnapshot<DocumentData, DocumentData>

/** A page of results, plus the cursor needed to ask for the next one. */
export interface Page<T> {
  rows: T[]
  /** Pass back as `after` to continue. Undefined when the end is reached. */
  cursor?: PageCursor
  hasMore: boolean
}

export interface RangeQuery {
  /** Inclusive YYYY-MM-DD. */
  from: string
  /** Inclusive YYYY-MM-DD. */
  to: string
  pageSize?: number
  /** Cursor from the previous page's result. */
  after?: PageCursor
}

const DEFAULT_PAGE = 100

async function runPage<T>(build: () => Query<T, DocumentData>, size: number): Promise<Page<T>> {
  // One extra row is fetched purely to answer "is there a next page?"
  // without a second round trip or a count query.
  const snap = await getDocs(build())
  const docs = snap.docs.slice(0, size)
  return {
    rows: docs.map((d) => d.data()),
    // The converter types the snapshot to T; the cursor is only ever fed
    // back to startAfter, which cares about position and not shape.
    cursor: docs[docs.length - 1] as PageCursor | undefined,
    hasMore: snap.docs.length > size,
  }
}

export const queries = {
  /** Settled bills across a range of cafe days, newest first. */
  async bills(range: RangeQuery): Promise<Page<Bill>> {
    const outletId = requireOutletId()
    const size = range.pageSize ?? DEFAULT_PAGE
    try {
      return await runPage<Bill>(
        () =>
          query(
            billsCol(outletId),
            where('businessDate', '>=', range.from),
            where('businessDate', '<=', range.to),
            orderBy('businessDate', 'desc'),
            ...(range.after ? [startAfter(range.after)] : []),
            fbLimit(size + 1),
          ),
        size,
      )
    } catch (error) {
      throw toAppError(error, 'Could not load bills for that period.')
    }
  },

  /**
   * Rounds across a range of cafe days. Analytics needs these for item-level
   * numbers (what sold, how long it took); the bills alone only give totals.
   */
  async orders(range: RangeQuery): Promise<Page<Order>> {
    const outletId = requireOutletId()
    const size = range.pageSize ?? DEFAULT_PAGE
    try {
      return await runPage<Order>(
        () =>
          query(
            ordersCol(outletId),
            where('businessDate', '>=', range.from),
            where('businessDate', '<=', range.to),
            orderBy('businessDate', 'desc'),
            ...(range.after ? [startAfter(range.after)] : []),
            fbLimit(size + 1),
          ),
        size,
      )
    } catch (error) {
      throw toAppError(error, 'Could not load orders for that period.')
    }
  },

  /** Every page of a range, gathered. Use for a report, not for a screen. */
  async allBills(from: string, to: string, cap = 5000): Promise<Bill[]> {
    const out: Bill[] = []
    let after: PageCursor | undefined
    for (;;) {
      const page = await queries.bills({ from, to, after, pageSize: 500 })
      out.push(...page.rows)
      if (!page.hasMore || !page.cursor || out.length >= cap) break
      after = page.cursor
    }
    return out
  },

  async allOrders(from: string, to: string, cap = 5000): Promise<Order[]> {
    const out: Order[] = []
    let after: PageCursor | undefined
    for (;;) {
      const page = await queries.orders({ from, to, after, pageSize: 500 })
      out.push(...page.rows)
      if (!page.hasMore || !page.cursor || out.length >= cap) break
      after = page.cursor
    }
    return out
  },

  /** Wallet movements in a range, for the day-end and account screens. */
  async walletEntries(range: RangeQuery): Promise<WalletEntry[]> {
    const outletId = requireOutletId()
    try {
      const snap = await getDocs(
        query(
          walletEntriesCol(outletId),
          where('businessDate', '>=', range.from),
          where('businessDate', '<=', range.to),
          fbLimit(range.pageSize ?? 1000),
        ),
      )
      return snap.docs.map((d) => d.data())
    } catch (error) {
      throw toAppError(error, 'Could not load wallet movements.')
    }
  },

  /** One guest's whole ledger. Needed in full, because a balance is its sum. */
  async ledgerFor(customerId: string): Promise<WalletEntry[]> {
    const outletId = requireOutletId()
    try {
      const snap = await getDocs(
        query(walletEntriesCol(outletId), where('customerId', '==', customerId)),
      )
      return snap.docs.map((d) => d.data())
    } catch (error) {
      throw toAppError(error, 'Could not load the guest’s account.')
    }
  },

  /** Every bill a guest has settled, for their account page. */
  async billsForCustomer(customerId: string, max = 200): Promise<Bill[]> {
    const outletId = requireOutletId()
    try {
      const snap = await getDocs(
        query(
          billsCol(outletId),
          where('customerId', '==', customerId),
          orderBy('settledAt', 'desc'),
          fbLimit(max),
        ),
      )
      return snap.docs.map((d) => d.data())
    } catch (error) {
      throw toAppError(error, 'Could not load the guest’s bills.')
    }
  },

  /**
   * Guest search.
   *
   * A ten-digit number is an exact document id, so it is one get. Anything
   * shorter is treated as a PREFIX of the number, which a string range can
   * do natively — `>= "98765"` and `<= "98765"` is every number that
   * starts with those digits. Firestore cannot search inside a string, so
   * searching by name is a client-side filter over a bounded recent page
   * rather than a real index. If name search ever needs to be exact and
   * fast, that is the point to add a search service, not to bolt more
   * queries on here.
   */
  async searchCustomers(term: string, max = 50): Promise<Customer[]> {
    const outletId = requireOutletId()
    const digits = normalisePhone(term)
    const text = term.trim().toLowerCase()
    try {
      if (digits.length >= 3) {
        const snap = await getDocs(
          query(
            customersCol(outletId),
            where('phone', '>=', digits),
            where('phone', '<=', `${digits}`),
            fbLimit(max),
          ),
        )
        return snap.docs.map((d) => d.data())
      }
      const snap = await getDocs(
        query(customersCol(outletId), orderBy('updatedAt', 'desc'), fbLimit(300)),
      )
      const rows = snap.docs.map((d) => d.data())
      if (!text) return rows.slice(0, max)
      return rows.filter((c) => c.name.toLowerCase().includes(text)).slice(0, max)
    } catch (error) {
      throw toAppError(error, 'Could not search guests.')
    }
  },

  /**
   * Guests carrying a balance, in one query.
   *
   * This is the reason Customer.balance exists as a cache. Without it,
   * answering "who owes the cafe money" would mean reading every guest's
   * whole ledger — the exact unbounded read the rest of this file avoids.
   */
  async customersWithBalance(
    direction: 'owing' | 'credit',
    max = 200,
  ): Promise<Customer[]> {
    const outletId = requireOutletId()
    try {
      const snap = await getDocs(
        query(
          customersCol(outletId),
          ...(direction === 'owing'
            ? [where('balance', '<', 0), orderBy('balance', 'asc')]
            : [where('balance', '>', 0), orderBy('balance', 'desc')]),
          fbLimit(max),
        ),
      )
      return snap.docs.map((d) => d.data())
    } catch (error) {
      throw toAppError(error, 'Could not load guest balances.')
    }
  },

  /** Recently seen guests, for the customers screen's default view. */
  async recentCustomers(max = 100): Promise<Customer[]> {
    const outletId = requireOutletId()
    try {
      const snap = await getDocs(
        query(customersCol(outletId), orderBy('updatedAt', 'desc'), fbLimit(max)),
      )
      return snap.docs.map((d) => d.data())
    } catch (error) {
      throw toAppError(error, 'Could not load guests.')
    }
  },

  /** The audit log for a range of days, newest first. Admin only. */
  async audit(range: RangeQuery): Promise<Page<AuditEntry>> {
    const outletId = requireOutletId()
    const size = range.pageSize ?? DEFAULT_PAGE
    try {
      return await runPage<AuditEntry>(
        () =>
          query(
            auditCol(outletId),
            where('businessDate', '>=', range.from),
            where('businessDate', '<=', range.to),
            orderBy('businessDate', 'desc'),
            orderBy('at', 'desc'),
            ...(range.after ? [startAfter(range.after)] : []),
            fbLimit(size + 1),
          ),
        size,
      )
    } catch (error) {
      throw toAppError(error, 'Could not load the activity log.')
    }
  },
}
