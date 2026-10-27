import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../core/authActions.ts'
import {
  answerRequest,
  myFriends,
  myRequests,
  removeWant,
  requestFriend,
  respondFriend,
  setWant,
  tradeMatches,
  usernames,
  wantsOf,
  type CardRequest,
  type Friend,
  type TradeMatch,
  type Want,
} from '../../core/social.ts'
import { lfList } from '../../games/ygo/decks.ts'
import type { Searcher } from '../../games/ygo/search.ts'
import { AskDialog } from './WhoHasIt.tsx'
import { QtyInput, validQty } from '../QtyInput.tsx'

type Tab = 'friends' | 'requests' | 'trades' | 'wants'

export function FriendsPage({ searcher, tab: initialTab }: { searcher: Searcher; tab?: string }) {
  const { profile } = useAuth()
  const [tab, setTab] = useState<Tab>((initialTab as Tab) ?? 'friends')
  if (!profile) return <p className="muted">Sign in to add friends.</p>
  const button = (t: Tab, label: string) => (
    <button type="button" className={tab === t ? 'chip on' : 'chip'} onClick={() => setTab(t)}>
      {label}
    </button>
  )
  return (
    <div>
      <div className="chips tabs">
        {button('friends', 'Friends')}
        {button('requests', 'Requests')}
        {button('trades', 'Trade matches')}
        {button('wants', 'Wants list')}
      </div>
      {tab === 'friends' && <Friends />}
      {tab === 'requests' && <Requests searcher={searcher} me={profile.id} />}
      {tab === 'trades' && <Trades searcher={searcher} />}
      {tab === 'wants' && <Wants searcher={searcher} ownerId={profile.id} />}
    </div>
  )
}

const name = (searcher: Searcher, key: string) => searcher.byId.get(Number(key))?.n ?? `card ${key}`

function Friends() {
  const [friends, setFriends] = useState<Friend[]>([])
  const [username, setUsername] = useState('')
  const [message, setMessage] = useState<{ ok: boolean; text: string }>()
  const load = useCallback(() => myFriends().then(setFriends, (e: Error) => setMessage({ ok: false, text: e.message })), [])
  useEffect(() => void load(), [load])
  return (
    <div>
      <form
        className="searchbar"
        onSubmit={async (e) => {
          e.preventDefault()
          try {
            const r = await requestFriend(username)
            setMessage({ ok: true, text: r === 'accepted' ? `You and ${username} are now friends.` : r === 'requested' ? `Asked ${username}.` : `Already ${r}.` })
            setUsername('')
            void load()
          } catch (err) {
            setMessage({ ok: false, text: (err as Error).message })
          }
        }}
      >
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Add a friend by username" required />
        <button className="primary">Add</button>
      </form>
      {message && <p className={message.ok ? 'ok' : 'error'}>{message.text}</p>}
      <ul className="results">
        {friends.map((f) => (
          <li key={f.id} className="friend-row">
            <a href={`?view=user&u=${f.username}`}>
              <strong>{f.display_name || f.username}</strong> <span className="muted">@{f.username}</span>
            </a>
            <span className="muted small">{f.city}</span>
            {f.status === 'pending' && f.incoming && (
              <span className="row-actions">
                <button type="button" className="link" onClick={() => respondFriend(f.id, true).then(load)}>
                  Accept
                </button>
                <button type="button" className="link" onClick={() => respondFriend(f.id, false).then(load)}>
                  Decline
                </button>
              </span>
            )}
            {f.status === 'pending' && !f.incoming && <span className="muted small">waiting for them</span>}
            {f.status === 'accepted' && (
              <button type="button" className="link small" onClick={() => confirm(`Remove ${f.username} as a friend?`) && respondFriend(f.id, false).then(load)}>
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      {!friends.length && <p className="muted">No friends yet. Friends can see your collection even when it's private, and show up in "who has it".</p>}
    </div>
  )
}

function Requests({ searcher, me }: { searcher: Searcher; me: string }) {
  const [requests, setRequests] = useState<CardRequest[]>([])
  const [names, setNames] = useState<Map<string, string>>(new Map())
  const [error, setError] = useState<string>()
  const load = useCallback(async () => {
    try {
      const r = await myRequests()
      setRequests(r)
      setNames(await usernames([...new Set(r.flatMap((x) => [x.from_user, x.to_user]))]))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])
  useEffect(() => void load(), [load])
  const act = async (id: string, status: CardRequest['status']) => {
    const reply = status === 'accepted' || status === 'declined' ? (prompt('Add a reply (optional)') ?? '') : ''
    await answerRequest(id, status, reply).catch((e: Error) => setError(e.message))
    void load()
  }
  return (
    <div>
      {error && <p className="error">{error}</p>}
      <p className="muted small">
        Accepting a request doesn't move any cards. When you hand them over, use Lend on the cards in your collection (for a
        loan) or Remove (for a trade).
      </p>
      <ul className="results">
        {requests.map((r) => {
          const incoming = r.to_user === me
          const other = names.get(incoming ? r.from_user : r.to_user) ?? 'someone'
          return (
            <li key={r.id} className="request-row">
              <div>
                {incoming ? (
                  <>
                    <strong>{other}</strong> wants to {r.kind} your {r.qty}× {name(searcher, r.card_key)}
                  </>
                ) : (
                  <>
                    You asked <strong>{other}</strong> to {r.kind} {r.qty}× {name(searcher, r.card_key)}
                  </>
                )}
                <span className={`badge status-${r.status}`}>{r.status}</span>
              </div>
              {r.message && <p className="small">“{r.message}”</p>}
              {r.reply && <p className="small muted">Reply: “{r.reply}”</p>}
              <span className="row-actions">
                {incoming && r.status === 'pending' && (
                  <>
                    <button type="button" className="link" onClick={() => act(r.id, 'accepted')}>
                      Accept
                    </button>
                    <button type="button" className="link" onClick={() => act(r.id, 'declined')}>
                      Decline
                    </button>
                  </>
                )}
                {incoming && r.status === 'accepted' && (
                  <button type="button" className="link" onClick={() => act(r.id, 'done')}>
                    Mark done
                  </button>
                )}
                {!incoming && r.status === 'pending' && (
                  <button type="button" className="link" onClick={() => act(r.id, 'cancelled')}>
                    Cancel
                  </button>
                )}
              </span>
            </li>
          )
        })}
      </ul>
      {!requests.length && <p className="muted">No requests yet.</p>}
    </div>
  )
}

function Trades({ searcher }: { searcher: Searcher }) {
  const [matches, setMatches] = useState<TradeMatch[]>()
  const [error, setError] = useState<string>()
  const [asking, setAsking] = useState<TradeMatch>()
  const [sent, setSent] = useState<string>()
  useEffect(() => {
    tradeMatches().then(setMatches, (e: Error) => setError(e.message))
  }, [])
  if (error) return <p className="error">{error}</p>
  if (!matches) return <p className="muted">Looking for matches…</p>
  const have = matches.filter((m) => m.direction === 'they_have')
  const want = matches.filter((m) => m.direction === 'they_want')
  const who = (m: TradeMatch) => (
    <>
      <a href={`?view=user&u=${m.username}`}>{m.username}</a>
      {m.is_friend ? ' (friend)' : m.city ? ` (${m.city})` : ''}
    </>
  )
  return (
    <div>
      <p className="muted small">Matches your wants list against cards friends and locals marked "for trade", and the other way round.</p>
      <h3>They have what you want ({have.length})</h3>
      <ul className="locations">
        {have.map((m) => (
          <li key={`h${m.user_id}${m.card_key}`}>
            {who(m)} has {m.qty}× {name(searcher, m.card_key)} for trade{' '}
            <button type="button" className="link small" onClick={() => setAsking(m)}>
              ask
            </button>
          </li>
        ))}
      </ul>
      <h3>They want what you have for trade ({want.length})</h3>
      <ul className="locations">
        {want.map((m) => (
          <li key={`w${m.user_id}${m.card_key}`}>
            {who(m)} wants {name(searcher, m.card_key)} (you have {m.qty} for trade)
          </li>
        ))}
      </ul>
      {!matches.length && <p className="muted">No matches yet. Add cards to your wants list, and mark spare cards "for trade".</p>}
      {sent && <p className="ok">{sent}</p>}
      {asking && (
        <AskDialog
          holder={{ user_id: asking.user_id, username: asking.username, card_key: asking.card_key, availability: 'trade' }}
          name={name(searcher, asking.card_key)}
          qty={1}
          onClose={(msg) => {
            setAsking(undefined)
            if (msg) setSent(msg)
          }}
        />
      )}
    </div>
  )
}

function Wants({ searcher, ownerId }: { searcher: Searcher; ownerId: string }) {
  const [wants, setWants] = useState<Want[]>([])
  const [error, setError] = useState<string>()
  const [copied, setCopied] = useState(false)
  const [edits, setEdits] = useState<Map<string, number | null>>(new Map())
  const load = useCallback(() => wantsOf(ownerId).then(setWants, (e: Error) => setError(e.message)), [ownerId])
  useEffect(() => void load(), [load])
  const text = lfList(wants.map((w) => ({ name: name(searcher, w.card_key), qty: w.qty })))
  return (
    <div>
      <p className="muted small">Add cards from any card's page (“Want”). Friends and locals see this list, and it drives trade matches.</p>
      {error && <p className="error">{error}</p>}
      <ul className="results">
        {wants.map((w) => (
          <li key={w.card_key} className="friend-row">
            <QtyInput
              className="qty-input"
              max={99}
              value={edits.has(w.card_key) ? edits.get(w.card_key)! : w.qty}
              onChange={(n) => setEdits(new Map(edits).set(w.card_key, n))}
              // saved when you leave the box, and only if it's a valid number
              onBlur={() => {
                const n = edits.get(w.card_key)
                setEdits((m) => (m.delete(w.card_key), new Map(m)))
                if (validQty(n, 99) && n !== w.qty) void setWant(w.card_key, n, w.note).then(load)
              }}
            />
            <a href={`?view=search&card=${w.card_key}`}>{name(searcher, w.card_key)}</a>
            <button type="button" className="link small" onClick={() => removeWant(w.card_key).then(load)}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      {wants.length > 0 && (
        <>
          <button
            type="button"
            className="chip"
            onClick={async () => {
              await navigator.clipboard.writeText(text)
              setCopied(true)
            }}
          >
            {copied ? 'Copied!' : 'Copy LF list'}
          </button>
          <pre className="lf">{text}</pre>
        </>
      )}
      {!wants.length && <p className="muted">Your wants list is empty.</p>}
    </div>
  )
}
