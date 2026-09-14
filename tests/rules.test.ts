import { readFileSync } from 'node:fs'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'

/**
 * The security rules are the real permission system, so they get real tests.
 *
 * Every case here is a thing someone could actually try: a cook opening the
 * books, a counter login promoting itself, two tills settling the same
 * table, a manager quietly deleting an audit entry, a manager accidentally
 * locking the café out of its own till. Reading the rules file and believing
 * it is not the same as watching Firestore refuse.
 *
 * Note there are no custom claims here. The role lives in the staff
 * document, so these tests seed staff rows and sign in as bare uids —
 * exactly as the real app does.
 */

const OUTLET = 'swaada-main'
const OTHER_OUTLET = 'other-branch'

let testEnv: RulesTestEnvironment

const as = (uid: string) => testEnv.authenticatedContext(uid).firestore()
const asAdmin = () => as('admin-uid')
const asCounter = () => as('counter-uid')
const asKitchen = () => as('kitchen-uid')
const asDisabled = () => as('off-uid')
const asOtherOutlet = () => as('other-admin-uid')
const asStranger = () => as('nobody-uid')
const asAnonymous = () => testEnv.unauthenticatedContext().firestore()

const path = {
  item: (id: string) => `outlets/${OUTLET}/items/${id}`,
  order: (id: string) => `outlets/${OUTLET}/orders/${id}`,
  bill: (id: string) => `outlets/${OUTLET}/bills/${id}`,
  wallet: (id: string) => `outlets/${OUTLET}/walletEntries/${id}`,
  customer: (id: string) => `outlets/${OUTLET}/customers/${id}`,
  audit: (id: string) => `outlets/${OUTLET}/auditLog/${id}`,
  staff: (id: string) => `outlets/${OUTLET}/staff/${id}`,
  index: (id: string) => `staffIndex/${id}`,
  username: (name: string) => `usernames/${name}`,
  settings: `outlets/${OUTLET}/meta/settings`,
  sequences: `outlets/${OUTLET}/meta/sequences`,
}

function staffRow(username: string, role: string, isActive = true, outletId = OUTLET) {
  return { outletId, username, displayName: username, role, isActive, createdBy: 'seed' }
}

function anOrder(overrides: Record<string, unknown> = {}) {
  return {
    orderNumber: 1,
    businessDate: '2026-09-14',
    tableId: 'tbl-1',
    tableName: 'T1',
    groupNo: 1,
    items: [],
    status: 'placed',
    total: 100,
    createdByUserId: 'counter-uid',
    createdByName: 'Counter',
    placedAt: '2026-09-14T10:00:00.000Z',
    ...overrides,
  }
}

function aBill(overrides: Record<string, unknown> = {}) {
  return {
    billNumber: 1,
    businessDate: '2026-09-14',
    tableId: 'tbl-1',
    tableName: 'T1',
    groupNo: 1,
    orderIds: ['ord-1'],
    orderNumbers: [1],
    subtotal: 100,
    discountAmount: 0,
    total: 100,
    payments: { cash: 100, upi: 0 },
    walletApplied: 0,
    creditAmount: 0,
    duesCleared: 0,
    walletTopUp: 0,
    settledAt: '2026-09-14T11:00:00.000Z',
    settledByUserId: 'counter-uid',
    settledByName: 'Counter',
    ...overrides,
  }
}

function aWalletEntry(overrides: Record<string, unknown> = {}) {
  return {
    customerId: '9876543210',
    businessDate: '2026-09-14',
    amount: -50,
    kind: 'credit',
    at: '2026-09-14T11:00:00.000Z',
    byUserId: 'counter-uid',
    byName: 'Counter',
    ...overrides,
  }
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'swaada-rules-test',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  })
})

afterAll(async () => {
  await testEnv.cleanup()
})

beforeEach(async () => {
  await testEnv.clearFirestore()
  // Seeded with rules disabled, the way the bootstrap script would.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, `outlets/${OUTLET}`), { name: 'Swaada', slug: OUTLET, isActive: true })
    await setDoc(doc(db, `outlets/${OTHER_OUTLET}`), { name: 'Other', slug: OTHER_OUTLET })

    await setDoc(doc(db, path.staff('admin-uid')), staffRow('spoorthi', 'admin'))
    await setDoc(doc(db, path.staff('counter-uid')), staffRow('ramesh', 'counter'))
    await setDoc(doc(db, path.staff('kitchen-uid')), staffRow('cook', 'kitchen'))
    await setDoc(doc(db, path.staff('off-uid')), staffRow('exstaff', 'admin', false))
    await setDoc(
      doc(db, `outlets/${OTHER_OUTLET}/staff/other-admin-uid`),
      staffRow('otherboss', 'admin', true, OTHER_OUTLET),
    )

    await setDoc(doc(db, path.index('admin-uid')), { outletId: OUTLET, username: 'spoorthi' })
    await setDoc(doc(db, path.index('counter-uid')), { outletId: OUTLET, username: 'ramesh' })
    await setDoc(doc(db, path.username('spoorthi')), { uid: 'admin-uid', outletId: OUTLET })

    await setDoc(doc(db, path.item('itm-1')), { name: 'Maggi', basePrice: 60, categoryId: 'cat-1' })
    await setDoc(doc(db, path.settings), { cafeName: 'Swaada' })
    await setDoc(doc(db, path.sequences), { nextOrderNumber: 1, nextBillNumber: 1 })
    await setDoc(doc(db, path.order('ord-1')), anOrder())
    await setDoc(doc(db, path.order('ord-delivered')), anOrder({ status: 'delivered' }))
    await setDoc(doc(db, path.order('ord-settled')), anOrder({ status: 'settled', billId: 'bill-1' }))
    await setDoc(doc(db, path.bill('bill-1')), aBill())
    await setDoc(doc(db, path.wallet('wal-1')), aWalletEntry())
    await setDoc(doc(db, path.audit('aud-1')), {
      action: 'bill.settle',
      businessDate: '2026-09-14',
      byUserId: 'counter-uid',
      summary: 'Bill #1',
    })
  })
})

describe('who gets in at all', () => {
  it('refuses an anonymous visitor', async () => {
    await assertFails(getDoc(doc(asAnonymous(), path.item('itm-1'))))
  })

  it('refuses a signed-in user with no staff record', async () => {
    await assertFails(getDoc(doc(asStranger(), path.item('itm-1'))))
  })

  it('refuses a login that has been switched off, even a manager', async () => {
    await assertFails(getDoc(doc(asDisabled(), path.item('itm-1'))))
  })

  it('refuses a manager of a DIFFERENT outlet', async () => {
    await assertFails(getDoc(doc(asOtherOutlet(), path.item('itm-1'))))
    await assertFails(getDoc(doc(asOtherOutlet(), path.bill('bill-1'))))
  })
})

describe('the login bootstrap documents', () => {
  it('lets a staff member read their own outlet index entry', async () => {
    await assertSucceeds(getDoc(doc(asCounter(), path.index('counter-uid'))))
  })

  it('refuses reading someone else’s index entry', async () => {
    await assertFails(getDoc(doc(asCounter(), path.index('admin-uid'))))
  })

  it('refuses a counter login creating an index entry', async () => {
    await assertFails(
      setDoc(doc(asCounter(), path.index('new-uid')), { outletId: OUTLET, username: 'sneaky' }),
    )
  })

  it('lets a manager create one for a new login', async () => {
    await assertSucceeds(
      setDoc(doc(asAdmin(), path.index('new-uid')), { outletId: OUTLET, username: 'newbie' }),
    )
  })

  it('refuses reassigning a username claim once taken', async () => {
    await assertFails(
      updateDoc(doc(asAdmin(), path.username('spoorthi')), { uid: 'counter-uid' }),
    )
    await assertFails(deleteDoc(doc(asAdmin(), path.username('spoorthi'))))
  })

  it('lets a manager claim a fresh username', async () => {
    await assertSucceeds(
      setDoc(doc(asAdmin(), path.username('newbie')), { uid: 'new-uid', outletId: OUTLET }),
    )
  })
})

describe('the kitchen cannot see money', () => {
  it('refuses the kitchen access to bills', async () => {
    await assertFails(getDoc(doc(asKitchen(), path.bill('bill-1'))))
    await assertFails(getDocs(collection(asKitchen(), `outlets/${OUTLET}/bills`)))
  })

  it('refuses the kitchen access to guests and their wallets', async () => {
    await assertFails(getDoc(doc(asKitchen(), path.customer('9876543210'))))
    await assertFails(getDoc(doc(asKitchen(), path.wallet('wal-1'))))
  })

  it('still lets the kitchen read the menu and the orders it has to cook', async () => {
    await assertSucceeds(getDoc(doc(asKitchen(), path.item('itm-1'))))
    await assertSucceeds(getDoc(doc(asKitchen(), path.order('ord-1'))))
  })
})

describe('only a manager edits the menu', () => {
  it('refuses a price change from the counter', async () => {
    await assertFails(updateDoc(doc(asCounter(), path.item('itm-1')), { basePrice: 1 }))
  })

  it('refuses a price change from the kitchen', async () => {
    await assertFails(updateDoc(doc(asKitchen(), path.item('itm-1')), { basePrice: 1 }))
  })

  it('allows it from a manager', async () => {
    await assertSucceeds(updateDoc(doc(asAdmin(), path.item('itm-1')), { basePrice: 70 }))
  })
})

describe('nobody can promote themselves', () => {
  it('REFUSES a counter login making itself a manager', async () => {
    await assertFails(updateDoc(doc(asCounter(), path.staff('counter-uid')), { role: 'admin' }))
  })

  it('refuses a kitchen login making itself a manager', async () => {
    await assertFails(updateDoc(doc(asKitchen(), path.staff('kitchen-uid')), { role: 'admin' }))
  })

  it('refuses a counter login creating a brand new manager', async () => {
    await assertFails(
      setDoc(doc(asCounter(), path.staff('new-uid')), staffRow('sneaky', 'admin')),
    )
  })

  it('lets a manager create a login', async () => {
    await assertSucceeds(setDoc(doc(asAdmin(), path.staff('new-uid')), staffRow('newbie', 'counter')))
  })

  it('lets a manager change someone else’s role', async () => {
    await assertSucceeds(updateDoc(doc(asAdmin(), path.staff('counter-uid')), { role: 'kitchen' }))
  })

  it('REFUSES a manager demoting themselves — the lockout guard', async () => {
    await assertFails(updateDoc(doc(asAdmin(), path.staff('admin-uid')), { role: 'counter' }))
  })

  it('refuses a manager switching themselves off', async () => {
    await assertFails(updateDoc(doc(asAdmin(), path.staff('admin-uid')), { isActive: false }))
  })

  it('refuses moving a login to another outlet', async () => {
    await assertFails(
      updateDoc(doc(asAdmin(), path.staff('counter-uid')), { outletId: OTHER_OUTLET }),
    )
  })

  it('refuses deleting a login', async () => {
    await assertFails(deleteDoc(doc(asAdmin(), path.staff('counter-uid'))))
  })

  it('lets a staff member read their own row but not another’s', async () => {
    await assertSucceeds(getDoc(doc(asCounter(), path.staff('counter-uid'))))
    await assertFails(getDoc(doc(asCounter(), path.staff('admin-uid'))))
  })
})

describe('the order state machine', () => {
  it('lets the kitchen move cooking forward', async () => {
    await assertSucceeds(
      updateDoc(doc(asKitchen(), path.order('ord-1')), { status: 'preparing', items: [] }),
    )
  })

  it('refuses the kitchen changing the total', async () => {
    await assertFails(
      updateDoc(doc(asKitchen(), path.order('ord-1')), { status: 'preparing', total: 0 }),
    )
  })

  it('refuses the kitchen settling a round', async () => {
    await assertFails(updateDoc(doc(asKitchen(), path.order('ord-1')), { status: 'settled' }))
  })

  it('refuses the kitchen attaching a bill', async () => {
    await assertFails(updateDoc(doc(asKitchen(), path.order('ord-1')), { billId: 'bill-9' }))
  })

  it('lets the counter settle a delivered round', async () => {
    await assertSucceeds(
      updateDoc(doc(asCounter(), path.order('ord-delivered')), {
        status: 'settled',
        billId: 'bill-9',
      }),
    )
  })

  it('REFUSES a second settlement of the same round — the double-bill guard', async () => {
    await assertFails(
      updateDoc(doc(asCounter(), path.order('ord-settled')), {
        status: 'settled',
        billId: 'bill-2',
      }),
    )
  })

  it('refuses reopening a settled round, even for a manager', async () => {
    await assertFails(updateDoc(doc(asAdmin(), path.order('ord-settled')), { status: 'delivered' }))
  })

  it('refuses deleting a round', async () => {
    await assertFails(deleteDoc(doc(asAdmin(), path.order('ord-1'))))
  })

  it('refuses an order stamped with someone else’s name', async () => {
    await assertFails(
      setDoc(doc(asCounter(), path.order('ord-fake')), anOrder({ createdByUserId: 'admin-uid' })),
    )
  })
})

describe('bills are written once', () => {
  it('refuses editing a bill, even for a manager', async () => {
    await assertFails(updateDoc(doc(asAdmin(), path.bill('bill-1')), { total: 1 }))
  })

  it('refuses deleting a bill, even for a manager', async () => {
    await assertFails(deleteDoc(doc(asAdmin(), path.bill('bill-1'))))
  })

  it('lets the counter write a new one', async () => {
    await assertSucceeds(setDoc(doc(asCounter(), path.bill('bill-2')), aBill({ billNumber: 2 })))
  })

  it('refuses a bill stamped with someone else’s name', async () => {
    await assertFails(
      setDoc(doc(asCounter(), path.bill('bill-3')), aBill({ settledByUserId: 'admin-uid' })),
    )
  })
})

describe('the wallet ledger is append only', () => {
  it('refuses editing an entry, even for a manager', async () => {
    await assertFails(updateDoc(doc(asAdmin(), path.wallet('wal-1')), { amount: 0 }))
  })

  it('refuses deleting an entry, even for a manager', async () => {
    await assertFails(deleteDoc(doc(asAdmin(), path.wallet('wal-1'))))
  })

  it('allows a new entry from the counter', async () => {
    await assertSucceeds(
      setDoc(doc(asCounter(), path.wallet('wal-2')), aWalletEntry({ amount: 50, kind: 'repayment' })),
    )
  })
})

describe('the audit log cannot be rewritten', () => {
  it('refuses editing an entry, even for a manager', async () => {
    await assertFails(updateDoc(doc(asAdmin(), path.audit('aud-1')), { summary: 'nothing here' }))
  })

  it('refuses deleting an entry, even for a manager', async () => {
    await assertFails(deleteDoc(doc(asAdmin(), path.audit('aud-1'))))
  })

  it('lets any staff member add to it', async () => {
    await assertSucceeds(
      setDoc(doc(asKitchen(), path.audit('aud-2')), {
        action: 'order.cancel',
        businessDate: '2026-09-14',
        byUserId: 'kitchen-uid',
        summary: 'something happened',
      }),
    )
  })

  it('refuses the counter reading it', async () => {
    await assertFails(getDoc(doc(asCounter(), path.audit('aud-1'))))
  })
})

describe('settings and numbering', () => {
  it('refuses the counter changing settings', async () => {
    await assertFails(updateDoc(doc(asCounter(), path.settings), { cafeName: 'Nope' }))
  })

  it('lets the counter reserve a block of numbers', async () => {
    await assertSucceeds(updateDoc(doc(asCounter(), path.sequences), { nextBillNumber: 51 }))
  })

  it('refuses the kitchen touching numbering', async () => {
    await assertFails(updateDoc(doc(asKitchen(), path.sequences), { nextBillNumber: 999 }))
  })
})
