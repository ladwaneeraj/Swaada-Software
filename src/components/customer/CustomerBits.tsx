import { ArrowDownLeft, ArrowUpRight, Phone, Scale, Sparkles, UserPlus, Wallet } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useToasts } from '@/components/toast'
import { Badge, Button, Field, Input, Modal, Segmented, Textarea } from '@/components/ui'
import { PAYMENT_METHOD_META, WALLET_ENTRY_META } from '@/lib/statusMeta'
import { cn, dateTimeLabel, formatINR, parseAmount } from '@/lib/utils'
import {
  advanceHeld,
  amountOwed,
  customerAccounts,
  customerService,
  isCompletePhone,
  normalisePhone,
  walletLedger,
  walletService,
} from '@/services'
import { useAppStore } from '@/store/useAppStore'
import type { CustomerAccount } from '@/services'
import type { Customer, PaymentMethod } from '@/types'
import { PAYMENT_METHODS } from '@/types'

/**
 * Everything the counter uses to work with a guest: the mobile-first lookup
 * that opens an order, the balance badge, the account ledger, and the sheets
 * for taking or returning money. Shared by Tables, Take order and Customers
 * so a guest looks and behaves the same wherever they turn up.
 */

/* ------------------------------- Reading -------------------------------- */

/** Every guest with their visits, spend and account balance. */
export function useAccounts(): CustomerAccount[] {
  const customers = useAppStore((s) => s.db.customers)
  const bills = useAppStore((s) => s.db.bills)
  const walletEntries = useAppStore((s) => s.db.walletEntries)
  return useMemo(
    () => customerAccounts({ customers, bills, walletEntries }),
    [customers, bills, walletEntries],
  )
}

export function useAccount(customerId: string | undefined): CustomerAccount | undefined {
  const accounts = useAccounts()
  return customerId ? accounts.find((a) => a.customer.id === customerId) : undefined
}

/* ------------------------------ Balance pill ----------------------------- */

/**
 * One badge for both directions of the same number: red when the guest owes
 * the cafe, green when the cafe is holding their money. Nothing at all at
 * zero, so a settled account adds no noise to a busy screen.
 */
export function BalancePill({ balance, className }: { balance: number; className?: string }) {
  const owed = amountOwed(balance)
  const held = advanceHeld(balance)
  if (owed === 0 && held === 0) return null
  return (
    <Badge tone={owed > 0 ? 'danger' : 'ok'} dot className={className}>
      {owed > 0 ? `Owes ${formatINR(owed)}` : `Advance ${formatINR(held)}`}
    </Badge>
  )
}

/* ----------------------------- Account summary --------------------------- */

export function AccountSummary({ account }: { account: CustomerAccount }) {
  const loyalty = useAppStore((s) => s.db.settings.loyalty)
  return (
    <div className="rounded-card bg-surface-100 p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold">{account.customer.name}</p>
          <p className="flex items-center gap-1 text-xs text-ink-500">
            <Phone className="size-3" /> {account.customer.phone}
          </p>
        </div>
        <BalancePill balance={account.balance} />
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-500">
        <span>
          <b className="text-ink-900">{account.visits}</b> visit{account.visits === 1 ? '' : 's'}
        </span>
        <span>
          <b className="text-ink-900 tabular-nums">{formatINR(account.totalSpent)}</b> spent
        </span>
        {account.lastVisitAt && <span>last {dateTimeLabel(account.lastVisitAt)}</span>}
        {loyalty.enabled && account.pointsBalance > 0 && (
          <span className="flex items-center gap-1 font-semibold text-accent-600">
            <Sparkles className="size-3" /> {account.pointsBalance} pts
          </span>
        )}
      </div>
      {account.customer.note && (
        <p className="mt-2 text-xs italic text-ink-500">“{account.customer.note}”</p>
      )}
    </div>
  )
}

/* ------------------------------ The ledger ------------------------------- */

export function WalletHistory({ customer, limit }: { customer: Customer; limit?: number }) {
  const entries = useAppStore((s) => s.db.walletEntries)
  const ledger = useMemo(() => walletLedger(entries, customer.id), [entries, customer.id])
  const shown = limit ? ledger.slice(0, limit) : ledger

  if (ledger.length === 0) {
    return <p className="py-3 text-center text-xs text-ink-500">No account activity yet.</p>
  }

  return (
    <ul className="divide-y divide-surface-100">
      {shown.map((entry) => {
        const meta = WALLET_ENTRY_META[entry.kind]
        const credit = entry.amount > 0
        return (
          <li key={entry.id} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold">
                {meta.label}
                {entry.billNumber ? <span className="font-normal text-ink-500"> · bill #{entry.billNumber}</span> : null}
                {entry.method ? <span className="font-normal text-ink-500"> · {PAYMENT_METHOD_META[entry.method].label}</span> : null}
              </p>
              <p className="text-[11px] text-ink-500">
                {dateTimeLabel(entry.at)} · {entry.byName}
                {entry.note ? ` · ${entry.note}` : ''}
              </p>
            </div>
            <span
              className={cn(
                'shrink-0 text-sm font-bold tabular-nums',
                credit ? 'text-ok-600' : 'text-danger-600',
              )}
            >
              {credit ? '+' : '−'}
              {formatINR(Math.abs(entry.amount))}
            </span>
          </li>
        )
      })}
      {limit && ledger.length > limit && (
        <li className="pt-2 text-center text-[11px] text-ink-500">
          {ledger.length - limit} older entr{ledger.length - limit === 1 ? 'y' : 'ies'}
        </li>
      )}
    </ul>
  )
}

/* --------------------------- Mobile-first lookup ------------------------- */

/**
 * The sheet that opens before a table's first round. A mobile number is the
 * only identity a guest has here: type it and the name, history and balance
 * come back; type a new one and the account is created on the spot. Skip is
 * always one tap away, because a walk-in who does not want to give a number
 * must never be slower to serve than one who does.
 */
export function CustomerSheet({
  open,
  onClose,
  onPick,
  title = 'Who is at the table?',
  actionLabel = 'Start order',
  skipLabel = 'Skip',
}: {
  open: boolean
  onClose: () => void
  /** null means the counter skipped the guest for this sitting. */
  onPick: (customer: Customer | null) => void
  title?: string
  actionLabel?: string
  skipLabel?: string
}) {
  const customers = useAppStore((s) => s.db.customers)
  const [phone, setPhone] = useState('')
  const [typedName, setTypedName] = useState<string | null>(null)

  const match = customerService.find(customers, phone)
  const account = useAccount(match?.id)
  // The name follows the number until someone edits it, so correcting a
  // spelling sticks but switching numbers never leaves the old name behind.
  const name = typedName ?? match?.name ?? ''
  const ready = isCompletePhone(phone)

  const reset = () => {
    setPhone('')
    setTypedName(null)
  }

  const confirm = () => {
    if (!ready) return
    const customer = customerService.upsert({ phone, name })
    if (!customer) return
    reset()
    onPick(customer)
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset()
        onClose()
      }}
      title={title}
      footer={
        <div className="flex gap-2">
          <Button
            variant="secondary"
            className="flex-1"
            onClick={() => {
              reset()
              onPick(null)
            }}
          >
            {skipLabel}
          </Button>
          <Button className="flex-[2]" disabled={!ready} onClick={confirm}>
            {match ? actionLabel : (
              <>
                <UserPlus className="size-4" /> {actionLabel}
              </>
            )}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label="Mobile number" hint="10 digits. This is how the guest is recognised next time.">
          <Input
            value={phone}
            onChange={(e) => {
              setPhone(normalisePhone(e.target.value))
              setTypedName(null)
            }}
            type="tel"
            inputMode="numeric"
            autoComplete="off"
            maxLength={10}
            placeholder="98765 43210"
            aria-label="Customer mobile number"
            className="h-12 text-base font-semibold tracking-wide"
            autoFocus
          />
        </Field>

        <Field label="Name">
          <Input
            value={name}
            onChange={(e) => setTypedName(e.target.value)}
            placeholder={ready ? 'Guest' : 'Fills in for a returning guest'}
            aria-label="Customer name"
          />
        </Field>

        {account ? (
          <>
            <AccountSummary account={account} />
            {Math.abs(account.balance) >= 0.01 && (
              <div className="rounded-card bg-white px-3.5 py-1 ring-1 ring-surface-200">
                <WalletHistory customer={account.customer} limit={3} />
              </div>
            )}
          </>
        ) : (
          ready && (
            <p className="rounded-card bg-ok-100 px-3.5 py-2.5 text-[13px] font-semibold text-ok-600">
              New guest — the account starts with this order.
            </p>
          )
        )}
      </div>
    </Modal>
  )
}

/* ------------------------- Money at the counter -------------------------- */

export type MoneyMode = 'take' | 'return' | 'adjust'

const MONEY_COPY: Record<MoneyMode, { title: string; action: string; hint: string }> = {
  take: {
    title: 'Take money',
    action: 'Record payment',
    hint: 'Clears what the guest owes first; anything beyond that stays as advance.',
  },
  return: {
    title: 'Return money',
    action: 'Record return',
    hint: 'Hands an advance back. Never more than the cafe is holding.',
  },
  adjust: {
    title: 'Adjust balance',
    action: 'Save adjustment',
    hint: 'Writing off a due or fixing a mistake. The reason is kept on the account.',
  },
}

/**
 * Money moving at the counter with no bill attached. Kept as one sheet so
 * the three cases read the same way and all land in the same ledger.
 */
export function MoneySheet({
  account,
  mode,
  onClose,
}: {
  account: CustomerAccount | null
  mode: MoneyMode
  onClose: () => void
}) {
  const session = useAppStore((s) => s.session)
  const pushToast = useToasts((s) => s.push)
  const [amountText, setAmountText] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [direction, setDirection] = useState<'add' | 'remove'>('remove')
  const [note, setNote] = useState('')

  const copy = MONEY_COPY[mode]
  const amount = parseAmount(amountText)
  const held = account ? advanceHeld(account.balance) : 0
  const owed = account ? amountOwed(account.balance) : 0
  const capped = mode === 'return' ? Math.min(amount, held) : amount
  const valid = capped > 0 && (mode !== 'adjust' || note.trim().length > 0)

  const close = () => {
    setAmountText('')
    setNote('')
    setMethod('cash')
    setDirection('remove')
    onClose()
  }

  const submit = () => {
    if (!account || !session || !valid) return
    const { customer } = account
    if (mode === 'take') {
      walletService.takeMoney({ customerId: customer.id, amount: capped, method, session, note })
      pushToast(`${formatINR(capped)} received from ${customer.name}`, 'ok')
    } else if (mode === 'return') {
      walletService.returnMoney({ customerId: customer.id, amount: capped, method, session, note })
      pushToast(`${formatINR(capped)} returned to ${customer.name}`, 'ok')
    } else {
      walletService.adjust({
        customerId: customer.id,
        amount: direction === 'add' ? capped : -capped,
        note,
        session,
      })
      pushToast(`${customer.name}'s balance adjusted`, 'warn')
    }
    close()
  }

  return (
    <Modal
      open={account !== null}
      onClose={close}
      title={account ? `${copy.title} · ${account.customer.name}` : copy.title}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button disabled={!valid} onClick={submit}>
            {copy.action}
          </Button>
        </div>
      }
    >
      {account && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-card bg-surface-100 px-3.5 py-2.5">
          <span className="text-[13px] font-semibold text-ink-500">Account now</span>
          <BalancePill balance={account.balance} />
        </div>
      )}
      <p className="mb-3 text-[13px] text-ink-500">{copy.hint}</p>

      <div className="space-y-3">
        {mode === 'adjust' && (
          <Segmented
            value={direction}
            onChange={setDirection}
            options={[
              { value: 'remove', label: 'Reduce balance' },
              { value: 'add', label: 'Increase balance' },
            ]}
          />
        )}

        <Field
          label="Amount"
          hint={
            mode === 'return' && held > 0
              ? `Advance held: ${formatINR(held)}`
              : mode === 'take' && owed > 0
                ? `Owes ${formatINR(owed)} right now`
                : undefined
          }
        >
          <Input
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            inputMode="decimal"
            placeholder="0"
            aria-label="Amount in rupees"
            className="h-12 text-base font-bold tabular-nums"
            autoFocus
          />
        </Field>

        {mode !== 'adjust' && (
          <Field label={mode === 'take' ? 'Received as' : 'Returned as'}>
            <Segmented
              value={method}
              onChange={setMethod}
              options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_META[m].label }))}
            />
          </Field>
        )}

        <Field label={mode === 'adjust' ? 'Reason' : 'Note (optional)'}>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={mode === 'adjust' ? 'e.g. Wrote off ₹40 rounding on bill #512' : 'e.g. Advance for Sunday booking'}
            aria-label={mode === 'adjust' ? 'Reason for the adjustment' : 'Note'}
          />
        </Field>
      </div>
    </Modal>
  )
}

/** The three counter actions, as one row of buttons. */
export function AccountActions({
  onTake,
  onReturn,
  onAdjust,
  held,
}: {
  onTake: () => void
  onReturn: () => void
  onAdjust: () => void
  held: number
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="secondary" onClick={onTake}>
        <ArrowDownLeft className="size-4" /> Take money
      </Button>
      <Button size="sm" variant="secondary" onClick={onReturn} disabled={held <= 0}>
        <ArrowUpRight className="size-4" /> Return money
      </Button>
      <Button size="sm" variant="secondary" onClick={onAdjust}>
        <Scale className="size-4" /> Adjust
      </Button>
    </div>
  )
}

/** Small inline marker for a sitting that has a guest attached. */
export function GuestChip({ account, onChange }: { account: CustomerAccount; onChange?: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-full bg-surface-100 py-1 pl-2.5 pr-1.5 text-[12px]">
      <Wallet className="size-3.5 shrink-0 text-ink-300" />
      <span className="min-w-0 truncate font-semibold">{account.customer.name}</span>
      <span className="shrink-0 text-ink-500">{account.customer.phone}</span>
      <BalancePill balance={account.balance} />
      {onChange && (
        <button
          type="button"
          onClick={onChange}
          className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold text-accent-600 hover:bg-white"
        >
          Change
        </button>
      )}
    </div>
  )
}
