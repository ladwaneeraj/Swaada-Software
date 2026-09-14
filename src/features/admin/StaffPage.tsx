import { Power, RefreshCw, ShieldCheck, UserPlus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PageHeader } from '@/components/layout/AdminLayout'
import { useToasts } from '@/components/toast'
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select } from '@/components/ui'
import { cn, dateTimeLabel } from '@/lib/utils'
import { toAppError } from '@/lib/errors'
import { staffService } from '@/services'
import { useAppStore } from '@/store/useAppStore'
import { ROLE_LABELS, USER_ROLES, type StaffMember, type UserRole } from '@/types'

/**
 * Staff logins: who can sign in, as what, and who is switched off.
 *
 * Creating a login, changing a role and switching someone off all happen
 * straight from here. Setting a new password for someone ELSE does not, and
 * cannot: the browser SDK has no such method, and the server-side one needs
 * a paid Firebase plan. So the recovery path is "Replace login" — a fresh
 * username for the same person, the old one switched off, and a note linking
 * the two.
 *
 * Nobody is ever deleted. Every round and every bill carries the name of the
 * person who took it; deleting them would leave that history pointing at
 * nothing. Switching a login off takes effect on their very next action,
 * because the security rules re-read this record on every request.
 */

const ROLE_NOTE: Record<UserRole, string> = {
  admin: 'Everything: the menu, the books, the money and these logins.',
  counter: 'Takes orders and settles bills. Cannot edit the menu or see analytics.',
  kitchen: 'The kitchen display only. Cannot see any money at all.',
}

export function StaffPage() {
  const staff = useAppStore((s) => s.db.staff)
  const session = useAppStore((s) => s.session)
  const pushToast = useToasts((s) => s.push)

  const [creating, setCreating] = useState(false)
  const [replacing, setReplacing] = useState<StaffMember | null>(null)

  const sorted = useMemo(
    () =>
      [...staff].sort(
        (a, b) =>
          Number(b.isActive) - Number(a.isActive) ||
          USER_ROLES.indexOf(a.role) - USER_ROLES.indexOf(b.role) ||
          a.displayName.localeCompare(b.displayName),
      ),
    [staff],
  )

  const activeAdmins = staff.filter((s) => s.role === 'admin' && s.isActive).length

  const change = async (member: StaffMember, patch: Parameters<typeof staffService.update>[1]) => {
    try {
      await staffService.update(member.id, patch)
      pushToast(`${member.displayName} updated`, 'ok')
    } catch (error) {
      pushToast(toAppError(error, 'Could not save that.').userMessage, 'danger')
    }
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Staff"
        sub="Who can sign in, and what each of them is allowed to do"
        actions={
          <Button onClick={() => setCreating(true)} className="w-full justify-center sm:w-auto">
            <UserPlus className="size-4" /> Add login
          </Button>
        }
      />

      {sorted.length === 0 ? (
        <EmptyState
          icon="👥"
          title="No logins yet"
          hint="Add one for the counter and one for the kitchen to get started."
        />
      ) : (
        <div className="space-y-2">
          {sorted.map((member) => {
            const isSelf = member.id === session?.userId
            const lastAdmin = member.role === 'admin' && member.isActive && activeAdmins === 1
            return (
              <Card key={member.id} className={cn('p-4', !member.isActive && 'opacity-60')}>
                {/* Identity first and always full width. Cramming the role
                    picker and two icon buttons onto this line works at
                    desktop and collapses into a jumble on a phone, so the
                    controls get their own row below until sm. */}
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-50 text-sm font-bold text-accent-600">
                    {member.displayName.trim().charAt(0).toUpperCase() || '?'}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
                      <span className="min-w-0 break-words">{member.displayName}</span>
                      {isSelf && <Badge tone="accent">You</Badge>}
                      {!member.isActive && <Badge tone="danger">Switched off</Badge>}
                    </p>
                    <p className="break-words text-xs text-ink-500">
                      signs in as <b className="text-ink-700">{member.username}</b>
                      {member.replacedByUsername
                        ? ` · replaced by ${member.replacedByUsername}`
                        : ` · added ${dateTimeLabel(member.createdAt)}`}
                    </p>
                    <p className="mt-1 text-xs text-ink-500">{ROLE_NOTE[member.role]}</p>
                  </div>
                </div>

                <div className="mt-3 flex flex-col gap-2 border-t border-surface-100 pt-3 sm:flex-row sm:items-center">
                  <div className="w-full sm:w-40">
                    <Select
                      value={member.role}
                      aria-label={`Role for ${member.displayName}`}
                      disabled={lastAdmin}
                      onChange={(e) => void change(member, { role: e.target.value as UserRole })}
                    >
                      {USER_ROLES.map((role) => (
                        <option key={role} value={role}>
                          {ROLE_LABELS[role]}
                        </option>
                      ))}
                    </Select>
                  </div>

                  {/* Labelled on a phone, icon-only once space is tight. An
                      unlabelled circular arrow is not a guessable way to say
                      "they forgot their password". */}
                  <div className="flex gap-2 sm:ml-auto">
                    <Button
                      variant="secondary"
                      className="flex-1 justify-center sm:flex-none"
                      aria-label={`Replace the login for ${member.displayName}`}
                      title="They forgot their password — make them a new login"
                      disabled={!member.isActive}
                      onClick={() => setReplacing(member)}
                    >
                      <RefreshCw className="size-4" />
                      <span className="sm:hidden">New login</span>
                    </Button>

                    <Button
                      variant="secondary"
                      className={cn(
                        'flex-1 justify-center sm:flex-none',
                        member.isActive ? 'text-danger-600' : 'text-ok-600',
                      )}
                      disabled={lastAdmin || isSelf}
                      aria-label={member.isActive ? `Switch off ${member.displayName}` : `Switch on ${member.displayName}`}
                      onClick={() => void change(member, { isActive: !member.isActive })}
                    >
                      <Power className="size-4" />
                      <span className="sm:hidden">{member.isActive ? 'Switch off' : 'Switch on'}</span>
                    </Button>
                  </div>
                </div>

                {lastAdmin && (
                  <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-surface-100 px-2 py-1.5 text-[11px] font-semibold text-ink-500">
                    <ShieldCheck className="mt-px size-3.5 shrink-0" aria-hidden />
                    The only manager left. Make someone else a manager before changing this one, so
                    the café cannot lock itself out.
                  </p>
                )}
              </Card>
            )
          })}
        </div>
      )}

      <CreateLoginSheet open={creating} onClose={() => setCreating(false)} />
      <ReplaceLoginSheet member={replacing} onClose={() => setReplacing(null)} />
    </div>
  )
}

/* ------------------------------ Add a login ----------------------------- */

function CreateLoginSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pushToast = useToasts((s) => s.push)
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [role, setRole] = useState<UserRole>('counter')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const reset = () => {
    setUsername('')
    setDisplayName('')
    setRole('counter')
    setPassword('')
    setError('')
  }

  const submit = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await staffService.create({ username, displayName, role, password })
      pushToast(`${displayName} can now sign in as "${username}"`, 'ok')
      reset()
      onClose()
    } catch (caught) {
      setError(toAppError(caught, 'Could not create the login.').userMessage)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset()
        onClose()
      }}
      title="Add a login"
      footer={
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              reset()
              onClose()
            }}
          >
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !username || !displayName || password.length < 8}>
            {busy ? 'Creating…' : 'Create login'}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label="Their name" hint="Shown on rounds and bills they take">
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Ramesh"
          />
        </Field>

        <Field label="Username" hint="What they type to sign in. Lowercase, no spaces.">
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s+/g, ''))}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="ramesh"
          />
        </Field>

        <Field label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
            {USER_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        </Field>
        <p className="-mt-1 text-xs text-ink-500">{ROLE_NOTE[role]}</p>

        <Field label="Password" hint="At least 8 characters. Tell them in person; there is no email to send it to.">
          <Input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            placeholder="••••••••"
          />
        </Field>

        {error && (
          <p className="rounded-card bg-danger-100 px-3 py-2 text-sm font-semibold text-danger-600">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}
/* ---------------------------- Replace a login --------------------------- */

/**
 * What happens when somebody forgets their password.
 *
 * A manager cannot set another person's password from a browser — the client
 * SDK has no method for it, and the server-side one needs a paid plan. So
 * instead the person gets a NEW login with the same name and role, and the
 * old one is switched off and marked as replaced.
 *
 * Their name on past rounds and bills does not move, because those store the
 * name as text rather than as a link to this record.
 */
function ReplaceLoginSheet({
  member,
  onClose,
}: {
  member: StaffMember | null
  onClose: () => void
}) {
  const pushToast = useToasts((s) => s.push)
  const [newUsername, setNewUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const reset = () => {
    setNewUsername('')
    setPassword('')
    setError('')
  }

  const close = () => {
    reset()
    onClose()
  }

  // A predictable suggestion, so the manager does not have to invent one
  // under pressure: ramesh becomes ramesh2, then ramesh3.
  const suggestion = member
    ? (() => {
        const match = /^(.*?)(\d*)$/.exec(member.username)
        const stem = match?.[1] ?? member.username
        const n = Number(match?.[2] ?? '') || 1
        return `${stem}${n + 1}`
      })()
    : ''

  const submit = async () => {
    if (!member || busy) return
    setBusy(true)
    setError('')
    try {
      await staffService.replaceLogin({
        uid: member.id,
        newUsername: newUsername || suggestion,
        password,
      })
      pushToast(
        `${member.displayName} now signs in as "${newUsername || suggestion}"`,
        'ok',
      )
      close()
    } catch (caught) {
      setError(toAppError(caught, 'Could not replace the login.').userMessage)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={member !== null}
      onClose={close}
      title={member ? `New login for ${member.displayName}` : 'New login'}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy || password.length < 8}>
            {busy ? 'Creating…' : 'Create and switch over'}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="rounded-card bg-surface-100 px-3.5 py-2.5 text-[13px] text-ink-500">
          Passwords cannot be reset from here, so {member?.displayName ?? 'they'} get a new
          username instead. The old one (<b className="text-ink-700">{member?.username}</b>) stops
          working, and everything they have already done keeps their name on it.
        </p>

        <Field label="New username" hint="Tell them this one in person, along with the password">
          <Input
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value.toLowerCase().replace(/\s+/g, ''))}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder={suggestion}
          />
        </Field>

        <Field label="Password" hint="At least 8 characters">
          <Input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            placeholder="••••••••"
          />
        </Field>

        {error && (
          <p className="rounded-card bg-danger-100 px-3 py-2 text-sm font-semibold text-danger-600">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}
