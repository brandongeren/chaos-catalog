import { useState, type FormEvent } from 'react'
import { sendPasswordReset, signIn, signOut, signUp, useAuth } from '../core/authActions.ts'
import { supabase } from '../core/supabase.ts'

/** Sign in / sign up (with an invite code) / account settings. */
export function AccountPage({ inviteCode }: { inviteCode?: string }) {
  const { enabled, session, profile, reloadProfile } = useAuth()
  const [mode, setMode] = useState<'in' | 'up' | 'reset'>(inviteCode ? 'up' : 'in')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string }>()

  if (!enabled) return <p className="muted">Accounts aren't set up on this copy of the site yet. Card search works without one.</p>

  const run = (fn: () => Promise<string | void>) => async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setBusy(true)
    setMessage(undefined)
    try {
      const text = await fn()
      if (text) setMessage({ ok: true, text })
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  if (session && profile) return <Settings onMessage={setMessage} message={message} reload={reloadProfile} />
  if (session && !profile) return <p className="muted">Loading your profile…</p>

  const field = (name: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="field">
      <span>{label}</span>
      <input name={name} required {...props} />
    </label>
  )
  const value = (e: FormEvent<HTMLFormElement>, name: string) => String(new FormData(e.currentTarget).get(name) ?? '')

  return (
    <div className="narrow">
      <div className="chips tabs">
        <button type="button" className={mode === 'in' ? 'chip on' : 'chip'} onClick={() => setMode('in')}>
          Sign in
        </button>
        <button type="button" className={mode === 'up' ? 'chip on' : 'chip'} onClick={() => setMode('up')}>
          Sign up with an invite
        </button>
      </div>
      {mode === 'in' && (
        <form
          className="stack-form"
          onSubmit={(e) => {
            const email = value(e, 'email')
            const password = value(e, 'password')
            return run(() => signIn(email, password))(e)
          }}
        >
          {field('email', 'Email', { type: 'email', autoComplete: 'email' })}
          {field('password', 'Password', { type: 'password', autoComplete: 'current-password' })}
          <button className="primary" disabled={busy}>
            Sign in
          </button>
          <button type="button" className="link" onClick={() => setMode('reset')}>
            Forgot your password?
          </button>
        </form>
      )}
      {mode === 'reset' && (
        <form
          className="stack-form"
          onSubmit={(e) => {
            const email = value(e, 'email')
            return run(async () => {
              await sendPasswordReset(email)
              return 'Check your email for a link to set a new password.'
            })(e)
          }}
        >
          {field('email', 'Email', { type: 'email', autoComplete: 'email' })}
          <button className="primary" disabled={busy}>
            Send reset link
          </button>
        </form>
      )}
      {mode === 'up' && (
        <form
          className="stack-form"
          onSubmit={(e) => {
            const input = {
              inviteCode: value(e, 'invite'),
              username: value(e, 'username'),
              displayName: value(e, 'display'),
              email: value(e, 'email'),
              password: value(e, 'password'),
            }
            return run(async () => {
              await signUp(input)
              return 'Account created. If the site asks you to confirm your email, use the link we sent; then sign in.'
            })(e)
          }}
        >
          {field('invite', 'Invite code', { defaultValue: inviteCode, autoComplete: 'off' })}
          {field('username', 'Username (public, lowercase)', { pattern: '[a-z0-9_]{3,24}', autoComplete: 'username' })}
          {field('display', 'Display name', { required: false })}
          {field('email', 'Email (private)', { type: 'email', autoComplete: 'email' })}
          {field('password', 'Password', { type: 'password', minLength: 8, autoComplete: 'new-password' })}
          <button className="primary" disabled={busy}>
            Create account
          </button>
        </form>
      )}
      {message && <p className={message.ok ? 'ok' : 'error'}>{message.text}</p>}
    </div>
  )
}

function Settings({
  message,
  onMessage,
  reload,
}: {
  message?: { ok: boolean; text: string }
  onMessage: (m: { ok: boolean; text: string } | undefined) => void
  reload: () => Promise<void>
}) {
  const { profile, session } = useAuth()
  const [draft, setDraft] = useState(profile!)
  const [invite, setInvite] = useState<string>()
  const params = new URLSearchParams(window.location.search)

  const save = async (e: FormEvent) => {
    e.preventDefault()
    const { error } = await supabase!
      .from('profiles')
      .update({
        username: draft.username.trim().toLowerCase(),
        display_name: draft.display_name.trim(),
        city: draft.city.trim(),
        profile_public: draft.profile_public,
        show_locations: draft.show_locations,
        show_prices: draft.show_prices,
        group_ordered_default: draft.group_ordered_default,
      })
      .eq('id', draft.id)
    onMessage(error ? { ok: false, text: error.message } : { ok: true, text: 'Saved.' })
    if (!error) await reload()
  }
  const check = (key: 'profile_public' | 'show_locations' | 'show_prices' | 'group_ordered_default', label: string) => (
    <label className="check">
      <input type="checkbox" checked={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.checked })} /> {label}
    </label>
  )
  const newInvite = async () => {
    const { data, error } = await supabase!.rpc('create_invite', { note: '', valid_days: 14 })
    if (error) return onMessage({ ok: false, text: error.message })
    setInvite(`${window.location.origin}${import.meta.env.BASE_URL}?view=account&invite=${data}`)
  }
  const setPassword = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const password = String(new FormData(e.currentTarget).get('password'))
    const { error } = await supabase!.auth.updateUser({ password })
    onMessage(error ? { ok: false, text: error.message } : { ok: true, text: 'Password updated.' })
  }

  return (
    <div className="narrow">
      <h2>Your account</h2>
      <p className="muted small">Signed in as {session?.user.email}</p>
      {params.get('reset') === '1' && (
        <form className="stack-form" onSubmit={setPassword}>
          <label className="field">
            <span>New password</span>
            <input name="password" type="password" minLength={8} required autoComplete="new-password" />
          </label>
          <button className="primary">Set password</button>
        </form>
      )}
      <form className="stack-form" onSubmit={save}>
        <label className="field">
          <span>Username</span>
          <input value={draft.username} pattern="[a-z0-9_]{3,24}" onChange={(e) => setDraft({ ...draft, username: e.target.value })} />
        </label>
        <label className="field">
          <span>Display name</span>
          <input value={draft.display_name} onChange={(e) => setDraft({ ...draft, display_name: e.target.value })} />
        </label>
        <label className="field">
          <span>City (shown on your profile; helps locals find cards)</span>
          <input value={draft.city} placeholder="e.g. Seattle, WA" onChange={(e) => setDraft({ ...draft, city: e.target.value })} />
        </label>
        {check('profile_public', 'Public profile: anyone with the link can see your collection (read-only)')}
        {check('show_locations', 'Show where cards are stored (boxes and groups) to others')}
        {check('show_prices', 'Show prices and collection value to others')}
        {check('group_ordered_default', 'New groups keep cards in a set order by default')}
        <button className="primary">Save</button>
      </form>
      {message && <p className={message.ok ? 'ok' : 'error'}>{message.text}</p>}
      <p className="small">
        Your public page:{' '}
        <a href={`${import.meta.env.BASE_URL}?view=user&u=${profile!.username}`}>
          {window.location.host}
          {import.meta.env.BASE_URL}?view=user&u={profile!.username}
        </a>
      </p>
      {profile!.is_admin && (
        <section>
          <h3>Invite someone</h3>
          <button type="button" className="chip" onClick={newInvite}>
            Create an invite link (valid 14 days, one use)
          </button>
          {invite && (
            <p className="small">
              <input readOnly value={invite} onFocus={(e) => e.target.select()} style={{ width: '100%' }} />{' '}
              <button type="button" className="link" onClick={() => navigator.clipboard.writeText(invite)}>
                Copy
              </button>
            </p>
          )}
        </section>
      )}
      <p>
        <button type="button" className="chip" onClick={() => signOut()}>
          Sign out
        </button>
      </p>
    </div>
  )
}
