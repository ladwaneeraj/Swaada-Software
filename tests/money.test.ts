import { describe, expect, it } from 'vitest'
import {
  billBreakdown,
  computeBillPreview,
  moneyForDay,
  orderTotal,
  planSettlement,
  walletBalance,
  walletHeld,
  walletOwed,
} from '../src/services/rules'
import type { Bill, Order, OrderItem, WalletEntry } from '../src/types'

/**
 * The arithmetic a cafe's money depends on.
 *
 * These need no emulator and no network, which is exactly why the pure
 * rules were kept in their own module: the part most expensive to get wrong
 * is the part that can be tested with plain objects in milliseconds.
 *
 * The invariant everything here protects:
 *
 *   cash + UPI  =  total − fromWallet − leftUnpaid + duesCleared + keptInWallet
 */

function item(overrides: Partial<OrderItem> = {}): OrderItem {
  return {
    id: 'oi-1',
    menuItemId: 'itm-1',
    name: 'Maggi',
    categoryId: 'cat-1',
    categoryName: 'Maggi',
    stationId: 'st-kitchen',
    stationName: 'Kitchen',
    isVegetarian: true,
    basePrice: 60,
    unitPrice: 60,
    quantity: 1,
    modifiers: [],
    specialInstructions: '',
    status: 'ready',
    queuedAt: '2026-09-14T10:00:00.000Z',
    ...overrides,
  }
}

function round(total: number, items: OrderItem[] = [item()]): Order {
  return {
    id: `ord-${total}`,
    orderNumber: 1,
    businessDate: '2026-09-14',
    tableId: 'tbl-1',
    tableName: 'T1',
    groupNo: 1,
    items,
    status: 'delivered',
    total,
    createdByUserId: 'u1',
    createdByName: 'Counter',
    placedAt: '2026-09-14T10:00:00.000Z',
  }
}

let walletSeq = 0
function entry(amount: number, overrides: Partial<WalletEntry> = {}): WalletEntry {
  walletSeq += 1
  return {
    id: `w-${walletSeq}`,
    customerId: 'cus-1',
    businessDate: '2026-09-14',
    amount,
    kind: amount > 0 ? 'topup' : 'spend',
    at: '2026-09-14T11:00:00.000Z',
    byUserId: 'u1',
    byName: 'Counter',
    ...overrides,
  }
}

describe('a round total', () => {
  it('ignores cancelled lines', () => {
    const items = [
      item({ id: 'a', quantity: 2, unitPrice: 60 }),
      item({ id: 'b', quantity: 1, unitPrice: 40, status: 'cancelled' }),
    ]
    expect(orderTotal(items)).toBe(120)
  })

  it('multiplies by quantity, with modifier pricing already in unitPrice', () => {
    expect(orderTotal([item({ quantity: 3, unitPrice: 75 })])).toBe(225)
  })

  it('is zero for a round with nothing live on it', () => {
    expect(orderTotal([item({ status: 'cancelled' })])).toBe(0)
  })
})

describe('the bill preview', () => {
  it('sums the rounds', () => {
    expect(computeBillPreview({ rounds: [round(120), round(80)] }).subtotal).toBe(200)
  })

  it('never discounts more than the subtotal', () => {
    const preview = computeBillPreview({ rounds: [round(100)], discountAmount: 500 })
    expect(preview.discountAmount).toBe(100)
    expect(preview.total).toBe(0)
  })

  it('treats a negative discount as no discount', () => {
    expect(computeBillPreview({ rounds: [round(100)], discountAmount: -50 }).total).toBe(100)
  })
})

describe('a wallet balance is the sum of its entries', () => {
  it('nets credits against debits', () => {
    expect(walletBalance([entry(500), entry(-200), entry(-100)], 'cus-1')).toBe(200)
  })

  it('ignores another guest entries', () => {
    const mixed = [entry(500), entry(900, { customerId: 'cus-2' })]
    expect(walletBalance(mixed, 'cus-1')).toBe(500)
  })

  it('reads a negative balance as money owed, not money held', () => {
    const balance = walletBalance([entry(-350)], 'cus-1')
    expect(walletOwed(balance)).toBe(350)
    expect(walletHeld(balance)).toBe(0)
  })

  it('is zero for a guest with no entries', () => {
    expect(walletBalance([], 'cus-1')).toBe(0)
    expect(walletBalance([entry(100)], undefined)).toBe(0)
  })
})

describe('planning a settlement', () => {
  const base = { hasCustomer: true, allowPayLater: true }

  it('takes nothing from a wallet that is empty', () => {
    const plan = planSettlement({ ...base, total: 200, balance: 0, walletApplied: 150 })
    expect(plan.walletApplied).toBe(0)
    expect(plan.tenderTarget).toBe(200)
  })

  it('never takes more from the wallet than the bill', () => {
    const plan = planSettlement({ ...base, total: 100, balance: 500, walletApplied: 500 })
    expect(plan.walletApplied).toBe(100)
    expect(plan.tenderTarget).toBe(0)
  })

  it('refuses pay-later when the setting is off', () => {
    const plan = planSettlement({
      ...base,
      allowPayLater: false,
      total: 200,
      balance: 0,
      creditAmount: 200,
    })
    expect(plan.creditAmount).toBe(0)
    expect(plan.tenderTarget).toBe(200)
  })

  it('refuses wallet and credit entirely when no guest is attached', () => {
    const plan = planSettlement({
      total: 200,
      balance: 500,
      hasCustomer: false,
      allowPayLater: true,
      walletApplied: 100,
      creditAmount: 100,
      extraTendered: 100,
    })
    expect(plan.walletApplied).toBe(0)
    expect(plan.creditAmount).toBe(0)
    expect(plan.tenderTarget).toBe(200)
  })

  it('clears an old due before topping a wallet up', () => {
    // Owes 300, bill is 200, hands over 700 on top of the bill.
    const plan = planSettlement({ ...base, total: 200, balance: -300, extraTendered: 700 })
    expect(plan.duesCleared).toBe(300)
    expect(plan.walletTopUp).toBe(400)
    expect(plan.tenderTarget).toBe(900)
    expect(plan.balanceAfter).toBe(400)
  })

  it('treats the whole extra as a top-up when nothing is owed', () => {
    const plan = planSettlement({ ...base, total: 200, balance: 0, extraTendered: 500 })
    expect(plan.duesCleared).toBe(0)
    expect(plan.walletTopUp).toBe(500)
  })

  it('splits a bill across wallet, cash and credit and still balances', () => {
    const plan = planSettlement({
      ...base,
      total: 1000,
      balance: 300,
      walletApplied: 300,
      creditAmount: 200,
    })
    expect(plan.walletApplied).toBe(300)
    expect(plan.creditAmount).toBe(200)
    expect(plan.tenderTarget).toBe(500)
    expect(plan.balanceAfter).toBe(-200)
  })

  it('never lets credit exceed what is left after the wallet', () => {
    const plan = planSettlement({
      ...base,
      total: 100,
      balance: 80,
      walletApplied: 80,
      creditAmount: 100,
    })
    expect(plan.creditAmount).toBe(20)
    expect(plan.tenderTarget).toBe(0)
  })
})

describe('a written bill balances', () => {
  function billFrom(overrides: Partial<Bill>): Bill {
    return {
      id: 'bill-1',
      billNumber: 1,
      businessDate: '2026-09-14',
      tableId: 'tbl-1',
      tableName: 'T1',
      groupNo: 1,
      orderIds: ['ord-1'],
      orderNumbers: [1],
      subtotal: 1000,
      discountAmount: 0,
      total: 1000,
      payments: { cash: 1000, upi: 0 },
      walletApplied: 0,
      creditAmount: 0,
      duesCleared: 0,
      walletTopUp: 0,
      settledAt: '2026-09-14T12:00:00.000Z',
      settledByUserId: 'u1',
      settledByName: 'Counter',
      ...overrides,
    }
  }

  it('balances a plain cash bill', () => {
    expect(billBreakdown(billFrom({})).balances).toBe(true)
  })

  it('balances a cash and UPI split', () => {
    expect(billBreakdown(billFrom({ payments: { cash: 400, upi: 600 } })).balances).toBe(true)
  })

  it('balances when part came from a wallet', () => {
    const bill = billFrom({ walletApplied: 300, payments: { cash: 700, upi: 0 } })
    expect(billBreakdown(bill).balances).toBe(true)
    expect(billBreakdown(bill).towardsThisBill).toBe(700)
  })

  it('balances when part was left unpaid', () => {
    const bill = billFrom({ creditAmount: 250, payments: { cash: 750, upi: 0 } })
    expect(billBreakdown(bill).balances).toBe(true)
  })

  it('balances when old dues were cleared on top of the bill', () => {
    const bill = billFrom({ duesCleared: 300, payments: { cash: 1300, upi: 0 } })
    expect(billBreakdown(bill).balances).toBe(true)
    expect(billBreakdown(bill).towardsThisBill).toBe(1000)
  })

  it('FLAGS a bill whose legs do not add up', () => {
    const bill = billFrom({ walletApplied: 300, payments: { cash: 1000, upi: 0 } })
    expect(billBreakdown(bill).balances).toBe(false)
  })
})

describe('the day money', () => {
  const onDay = (iso: string) => iso.startsWith('2026-09-14')

  function bill(overrides: Partial<Bill>): Bill {
    return {
      id: `b-${Math.random()}`,
      billNumber: 1,
      businessDate: '2026-09-14',
      tableId: null,
      tableName: 'T1',
      groupNo: 1,
      orderIds: [],
      orderNumbers: [],
      subtotal: 0,
      discountAmount: 0,
      total: 0,
      payments: { cash: 0, upi: 0 },
      walletApplied: 0,
      creditAmount: 0,
      duesCleared: 0,
      walletTopUp: 0,
      settledAt: '2026-09-14T12:00:00.000Z',
      settledByUserId: 'u1',
      settledByName: 'Counter',
      ...overrides,
    }
  }

  it('keeps what was SOLD apart from what was COLLECTED', () => {
    // A 1000 bill: 300 from a wallet, 200 left unpaid, 500 in cash.
    const money = moneyForDay({
      bills: [
        bill({
          total: 1000,
          walletApplied: 300,
          creditAmount: 200,
          payments: { cash: 500, upi: 0 },
        }),
      ],
      walletEntries: [],
      onDay,
    })
    expect(money.sales).toBe(1000)
    expect(money.collected).toBe(500)
    expect(money.fromWallet).toBe(300)
    expect(money.leftUnpaid).toBe(200)
    // The drawer reconciles: sold = collected + wallet + unpaid.
    expect(money.collected + money.fromWallet + money.leftUnpaid).toBe(money.sales)
  })

  it('counts money taken at the counter outside any bill', () => {
    const money = moneyForDay({
      bills: [],
      walletEntries: [entry(500, { kind: 'topup', method: 'upi' })],
      onDay,
    })
    expect(money.sales).toBe(0)
    expect(money.upi).toBe(500)
    expect(money.collected).toBe(500)
    expect(money.walletTopUps).toBe(500)
  })

  it('ignores yesterday', () => {
    const money = moneyForDay({
      bills: [
        bill({
          total: 999,
          settledAt: '2026-09-13T12:00:00.000Z',
          payments: { cash: 999, upi: 0 },
        }),
      ],
      walletEntries: [],
      onDay,
    })
    expect(money.sales).toBe(0)
    expect(money.collected).toBe(0)
  })

  it('adds dues cleared on top of a bill to the drawer but not to sales', () => {
    const money = moneyForDay({
      bills: [bill({ total: 200, duesCleared: 300, payments: { cash: 500, upi: 0 } })],
      walletEntries: [],
      onDay,
    })
    expect(money.sales).toBe(200)
    expect(money.collected).toBe(500)
    expect(money.duesCleared).toBe(300)
  })
})
