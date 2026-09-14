import { ArrowDownLeft, ArrowUpRight, Phone, Scale, User, UserPlus, Wallet } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useToasts } from '@/components/toast'
import { Badge, Button, Field, Input, Modal, Segmented, Textarea } from '@/components/ui'
import { PAYMENT_METHOD_META, WALLET_ENTRY_META } from '@/lib/statusMeta'
import { cn, dateTimeLabel, formatINR, parseAmount } from '@/lib/utils'
import {
  walletHeld,
  walletOwed,
  customerAccounts,
  customerProfiles,
  customerService,
  isCompletePhone,
  normalisePhone,
  queries,
  walletBalance,
  walletLedger,
  walletService,
} from '@/services'
import { toAppError } from '@/lib/errors'
import { useAppStore } from '@/store/useAppStore'
import type { CustomerAccount } from '@/services'
import type { Customer, PaymentMethod, WalletEntry } from '@/types'
import { PAYMENT_METHODS } from '@/types'

/**
 * Everything the counter uses to work with a guest: the mobile-first lookup
 * that opens an order, the balance badge, the account ledger, and the sheets
 * for taking or returning money. Shared by Tables, Take order and Customers
 * so a guest looks and behaves the same wherever they turn up.
 */

/* ------------------------------- Reading -------------------------------- */

/**
 * The guests currently SEATED, with their visits, spend and balance.
 *
 * This is not every guest the cafe has ever served — that list lives in
 * Firestore and is queried, not held. The store follows the ledgers of the
 * people actually sitting in the cafe right now, which is what the floor and
 * the settle sheet need, and is a handful of records rather than thousands.
 */
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

/**
 * A guest's account whether or not they are seated.
 *
 * If they are on the floor, the store already follows their ledger live and
 * this costs nothing. If they are not — someone walking in to clear an old
 * due — their ledger and bills are fetched once. A balance is the sum of a
 * guest's WHOLE ledger, so it has to be the whole thing; there is no useful
 * partial answer to "what do they owe".
 */
export function useGuestAccount(customer: Customer | null): {
  account: CustomerAccount | undefined
  loading: boolean
} {
  const local = useAccount(customer?.id)
  const seated = useAppStore((s) => s.db.customers.some((c) => c.id === customer?.id))
  const [remote, setRemote] = useState<{ id: string; account: CustomerAccount } | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!customer || seated) return
    let cancelled = false
    setLoading(true)
    void Promise.all([queries.ledgerFor(customer.id), queries.billsForCustomer(customer.id)])
      .then(([entries, bills]) => {
        if (cancelled) return
        const profile = customerProfiles(bills)[0]
        setRemote({
          id: customer.id,
          account: {
            customer,
            visits: profile?.visits ?? 0,
            totalSpent: profile?.totalSpent ?? 0,
            lastVisitAt: profile?.lastVisitAt,
            balance: walletBalance(entries, customer.id),
          },
        })
      })
      .catch(() => {
        if (!cancelled) setRemote(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [customer, seated])

  // Derived rather than reset in an effect: a fetched account is only good
  // for the guest it was fetched for, so tag it with that id and ignore it
  // the moment the id on screen changes. No clearing render in between.
  const fetched = remote && customer && remote.id === customer.id ? remote.account : undefined
  return {
    account: seated ? local : fetched,
    loading: loading && !fetched,
  }
}

/**
 * Guest lookup at the counter, against Firestore rather than memory.
 *
 * Ten digits is an exact document id, so it is a single get that usually
 * comes straight from the offline cache for anyone seen before. Four to nine
 * digits runs a prefix query. Under four, nothing: a cafe's book is not
 * worth scanning for two digits, and the counter is mid-conversation with a
 * guest anyway.
 */
function useCustomerSearch(phone: string): {
  match: Customer | null
  suggestions: Customer[]
  searching: boolean
} {
  const [match, setMatch] = useState<Customer | null>(null)
  const [suggestions, setSuggestions] = useState<Customer[]>([])
  const [searching, setSearching] = useState(false)
  // Rising counter, so a slow early response cannot overwrite a fast later one.
  const request = useRef(0)

  useEffect(() => {
    const digits = normalisePhone(phone)
    const ticket = (request.current += 1)

    if (digits.length < 4) {
      setMatch(null)
      setSuggestions([])
      setSearching(false)
      return
    }

    setSearching(true)
    // Typing ten digits fires ten renders; waiting a moment turns that into
    // one query instead of seven.
    const timer = window.setTimeout(() => {
      const run =
        digits.length === 10
          ? customerService.get(digits).then((found) => ({ found, list: [] as Customer[] }))
          : queries.searchCustomers(digits).then((list) => ({ found: null, list }))

      void run
        .then(({ found, list }) => {
          if (ticket !== request.current) return
          setMatch(found)
          setSuggestions(list.slice(0, 6))
        })
        .catch(() => {
          if (ticket !== request.current) return
          setMatch(null)
          setSuggestions([])
        })
        .finally(() => {
          if (ticket === request.current) setSearching(false)
        })
    }, 250)

    return () => window.clearTimeout(timer)
  }, [phone])

  return { match, suggestions, searching }
}

/* ------------------------------ Balance pill ----------------------------- */

/**
 * One badge for both directions of the same number: red when the guest owes
 * the cafe, green when the cafe is holding their money. Nothing at all at
 * zero, so a square wallet adds no noise to a busy screen.
 */
export function BalancePill({ balance, className }: { balance: number; className?: string }) {
  const owed = walletOwed(balance)
  const held = walletHeld(balance)
  if (owed === 0 && held === 0) return null
  return (
    <Badge tone={owed > 0 ? 'danger' : 'ok'} dot className={className}>
      {owed > 0 ? `Owes ${formatINR(owed)}` : `Wallet ${formatINR(held)}`}
    </Badge>
  )
}

/* ----------------------------- Account summary --------------------------- */

export function AccountSummary({ account }: { account: CustomerAccount }) {
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
      </div>
      {account.customer.note && (
        <p className="mt-2 text-xs italic text-ink-500">“{account.customer.note}”</p>
      )}
    </div>
  )
}

/* ------------------------------ The ledger ------------------------------- */

/**
 * A guest's account movements.
 *
 * `entries` is passed in by screens that have already fetched the guest's
 * whole ledger; screens showing someone who is seated right now can leave it
 * out and the live store answers, because the store follows the ledgers of
 * everyone currently in the cafe.
 */
export function WalletHistory({
  customer,
  limit,
  entries: provided,
}: {
  customer: Customer
  limit?: number
  entries?: WalletEntry[]
}) {
  const live = useAppStore((s) => s.db.walletEntries)
  const entries = provided ?? live
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
  const [phone, setPhone] = useState('')
  const [typedName, setTypedName] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const pushLookupToast = useToasts((s) => s.push)

  const { match, suggestions: found, searching } = useCustomerSearch(phone)
  const { account } = useGuestAccount(match)

  /**
   * Nobody at a counter wants to type ten digits to find a regular. Four is
   * enough to narrow a small cafe's book down to a handful, and the last four
   * are what people actually remember — but Firestore can only range over a
   * PREFIX, so the query matches the start of the number and the rest is
   * ordered here.
   */
  const suggestions = useMemo(
    () =>
      found
        .map((customer) => ({ customer, visits: 0, totalSpent: 0, balance: 0 }) as CustomerAccount)
        .sort(
          (a, b) =>
            Number(b.customer.phone.startsWith(phone)) -
              Number(a.customer.phone.startsWith(phone)) ||
            a.customer.name.localeCompare(b.customer.name),
        ),
    [found, phone],
  )
  // The name follows the number until someone edits it, so correcting a
  // spelling sticks but switching numbers never leaves the old name behind.
  const name = typedName ?? match?.name ?? ''
  const ready = isCompletePhone(phone)

  const reset = () => {
    setPhone('')
    setTypedName(null)
  }

  const confirm = async () => {
    if (!ready || saving) return
    setSaving(true)
    try {
      const customer = await customerService.upsert({ phone, name })
      if (!customer) return
      reset()
      onPick(customer)
    } catch (error) {
      pushLookupToast(toAppError(error, 'Could not save the guest.').userMessage, 'danger')
    } finally {
      setSaving(false)
    }
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
            role="combobox"
            aria-expanded={suggestions.length > 0}
            aria-controls="guest-suggestions"
          />
        </Field>

        {suggestions.length > 0 && (
          <ul
            id="guest-suggestions"
            role="listbox"
            aria-label="Matching guests"
            className="-mt-1 divide-y divide-surface-100 overflow-hidden rounded-card bg-white ring-1 ring-surface-200"
          >
            {suggestions.map((a) => (
              <li key={a.customer.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => {
                    setPhone(a.customer.phone)
                    setTypedName(null)
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold">{a.customer.name}</span>
                    <span className="block text-[11px] tabular-nums text-ink-500">
                      <MatchedPhone phone={a.customer.phone} typed={phone} />
                    </span>
                  </span>
                  <BalancePill balance={a.balance} />
                </button>
              </li>
            ))}
          </ul>
        )}

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
        ) : searching ? (
          // The lookup is a query now, not a scan of memory, so there is a
          // real moment between typing and knowing. Saying so beats
          // flashing "new guest" at a regular for half a second.
          <p className="rounded-card bg-surface-100 px-3.5 py-2.5 text-[13px] font-semibold text-ink-500">
            Looking up this number…
          </p>
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

/** The digits that were typed, picked out of the full number. */
function MatchedPhone({ phone, typed }: { phone: string; typed: string }) {
  const at = phone.indexOf(typed)
  if (at === -1) return <>{phone}</>
  return (
    <>
      {phone.slice(0, at)}
      <b className="text-ink-900">{phone.slice(at, at + typed.length)}</b>
      {phone.slice(at + typed.length)}
    </>
  )
}

/* ------------------------- Money at the counter -------------------------- */

export type MoneyMode = 'take' | 'return' | 'adjust'

const MONEY_COPY: Record<MoneyMode, { title: string; action: string; hint: string }> = {
  take: {
    title: 'Add money',
    action: 'Add to wallet',
    hint: 'Clears what the guest owes first; anything beyond that stays in their wallet.',
  },
  return: {
    title: 'Give money back',
    action: 'Record return',
    hint: 'Hands wallet money back. Never more than the cafe is holding.',
  },
  adjust: {
    title: 'Fix the balance',
    action: 'Save correction',
    hint: 'Writing off what someone owes, or fixing a mistake. The reason is kept.',
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
  const [submitting, setSubmitting] = useState(false)
  const [note, setNote] = useState('')

  const copy = MONEY_COPY[mode]
  const amount = parseAmount(amountText)
  const held = account ? walletHeld(account.balance) : 0
  const owed = account ? walletOwed(account.balance) : 0
  const capped = mode === 'return' ? Math.min(amount, held) : amount
  const valid = capped > 0 && (mode !== 'adjust' || note.trim().length > 0)

  const close = () => {
    setAmountText('')
    setNote('')
    setMethod('cash')
    setDirection('remove')
    onClose()
  }

  /**
   * The balance is passed in rather than re-read. It decides only how the
   * entry is LABELLED (clearing a due versus topping up) and how far a
   * refund can go; the balance itself is always recomputed from the ledger,
   * so a few seconds of staleness cannot make the money wrong.
   */
  const submit = async () => {
    if (!account || !session || !valid || submitting) return
    const { customer, balance } = account
    setSubmitting(true)
    try {
      if (mode === 'take') {
        await walletService.takeMoney({ customerId: customer.id, amount: capped, method, balance, note })
        pushToast(`${formatINR(capped)} received from ${customer.name}`, 'ok')
      } else if (mode === 'return') {
        await walletService.returnMoney({ customerId: customer.id, amount: capped, method, balance, note })
        pushToast(`${formatINR(capped)} returned to ${customer.name}`, 'ok')
      } else {
        await walletService.adjust({
          customerId: customer.id,
          amount: direction === 'add' ? capped : -capped,
          note,
        })
        pushToast(`${customer.name}'s balance adjusted`, 'warn')
      }
      close()
    } catch (error) {
      pushToast(toAppError(error, 'Could not record that.').userMessage, 'danger')
    } finally {
      setSubmitting(false)
    }
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
          <span className="text-[13px] font-semibold text-ink-500">Wallet now</span>
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
              ? `In the wallet: ${formatINR(held)}`
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
            placeholder={mode === 'adjust' ? 'e.g. Wrote off ₹40 rounding on bill #512' : 'e.g. Paid ahead for Sunday'}
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
        <ArrowDownLeft className="size-4" /> Add money
      </Button>
      <Button size="sm" variant="secondary" onClick={onReturn} disabled={held <= 0}>
        <ArrowUpRight className="size-4" /> Give back
      </Button>
      <Button size="sm" variant="secondary" onClick={onAdjust}>
        <Scale className="size-4" /> Fix balance
      </Button>
    </div>
  )
}

/**
 * One line for the guest on a sitting. Who they are comes first and never
 * gets squeezed out; the wallet only rides along where money is being taken,
 * because on the order screen it is the name and number that matter.
 */
export function GuestChip({
  account,
  onChange,
  showBalance = false,
}: {
  account: CustomerAccount
  onChange?: () => void
  showBalance?: boolean
}) {
  return (
    <div className="flex items-center gap-2 rounded-full bg-surface-100 py-1 pl-2.5 pr-1.5 text-[12px]">
      {showBalance ? (
        <Wallet className="size-3.5 shrink-0 text-ink-300" />
      ) : (
        <User className="size-3.5 shrink-0 text-ink-300" />
      )}
      <span className="min-w-0 flex-1 truncate font-semibold">{account.customer.name}</span>
      <span className="shrink-0 tabular-nums text-ink-500">{account.customer.phone}</span>
      {showBalance && <BalancePill balance={account.balance} />}
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
