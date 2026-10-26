import { useEffect, useState } from 'react'
import { sendRequest, whoHas, type Holder } from '../../core/social.ts'
import { Modal } from '../Modal.tsx'

/** For cards you're missing: which friends and locals have copies, and a way to ask them. */
export function WhoHasIt({ cards }: { cards: { card_key: string; name: string; qty: number }[] }) {
  const [holders, setHolders] = useState<Holder[]>()
  const [error, setError] = useState<string>()
  const [asking, setAsking] = useState<{ holder: Holder; name: string; qty: number }>()
  const [sent, setSent] = useState<string>()
  const keys = cards.map((c) => c.card_key).join(',')

  useEffect(() => {
    let live = true
    whoHas(keys.split(',').filter(Boolean)).then(
      (h) => live && setHolders(h),
      (e: Error) => live && setError(e.message),
    )
    return () => {
      live = false
    }
  }, [keys])

  if (error) return <p className="error small">Couldn't check friends and locals: {error}</p>
  if (!holders) return <p className="muted small">Checking friends and locals…</p>
  if (!holders.length) return <p className="muted small">None of your friends or locals has these (or marked them available).</p>

  return (
    <div>
      <h4>Friends and locals who have them</h4>
      <ul className="locations small">
        {cards
          .filter((c) => holders.some((h) => h.card_key === c.card_key))
          .map((c) => (
            <li key={c.card_key}>
              <strong>{c.name}</strong>:{' '}
              {holders
                .filter((h) => h.card_key === c.card_key)
                .map((h) => (
                  <span key={h.user_id + h.availability} className="holder">
                    <a href={`?view=user&u=${h.username}`}>{h.display_name || h.username}</a>
                    {h.is_friend ? ' (friend)' : h.city ? ` (${h.city})` : ''} has {h.qty}
                    {h.availability !== 'none' ? `, for ${h.availability}` : ''}{' '}
                    <button type="button" className="link" onClick={() => setAsking({ holder: h, name: c.name, qty: Math.min(c.qty, h.qty) })}>
                      ask
                    </button>
                  </span>
                ))}
            </li>
          ))}
      </ul>
      {sent && <p className="ok small">{sent}</p>}
      {asking && (
        <AskDialog
          {...asking}
          onClose={(msg) => {
            setAsking(undefined)
            if (msg) setSent(msg)
          }}
        />
      )}
    </div>
  )
}

export function AskDialog({ holder, name, qty, onClose }: { holder: Pick<Holder, 'user_id' | 'username' | 'card_key' | 'availability'>; name: string; qty: number; onClose: (sent?: string) => void }) {
  const [kind, setKind] = useState<'borrow' | 'trade'>(holder.availability === 'trade' ? 'trade' : 'borrow')
  const [n, setN] = useState(qty)
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string>()
  return (
    <Modal title={`Ask ${holder.username} for ${name}`} onClose={() => onClose()}>
      <form
        className="stack-form"
        onSubmit={async (e) => {
          e.preventDefault()
          try {
            await sendRequest({ to_user: holder.user_id, kind, card_key: holder.card_key, qty: n, message })
            onClose(`Asked ${holder.username}. You'll see the answer under Friends → Requests.`)
          } catch (err) {
            setError((err as Error).message)
          }
        }}
      >
        <label className="field">
          <span>To</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as 'borrow' | 'trade')}>
            <option value="borrow">Borrow</option>
            <option value="trade">Trade for</option>
          </select>
        </label>
        <label className="field">
          <span>How many</span>
          <input type="number" min={1} max={99} value={n} onChange={(e) => setN(Math.max(1, Number(e.target.value) || 1))} />
        </label>
        <label className="field">
          <span>Message (optional)</span>
          <textarea rows={3} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. for locals on Friday, can return Sunday" />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button className="primary">Send</button>
        </div>
      </form>
    </Modal>
  )
}
