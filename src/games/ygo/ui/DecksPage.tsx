import { useContext, useMemo, useState } from 'react'
import { groupPath, uuid, type Section } from '../../../core/collection/model.ts'
import { PULL_STRATEGIES, pullList, type Need, type PullStrategy } from '../../../core/collection/pull.ts'
import { supabase } from '../../../core/supabase.ts'
import { CollectionContext, change, useCollection } from '../../../ui/collection/context.ts'
import {
  deckToRaw,
  detectFormat,
  lfList,
  parseDeck,
  parseKonamiPage,
  parseYgoprodeckPage,
  resolveDeck,
  SECTIONS,
  toText,
  toYdk,
  toYdke,
  type Deck,
  type RawDeck,
} from '../decks.ts'
import { stackPrice } from '../prices.ts'
import type { Searcher } from '../search.ts'
import type { YgoPriceDay } from '../types.ts'
import { WhoHasIt } from '../../../ui/social/WhoHasIt.tsx'
import { download } from '../../../lib/download.ts'

const SECTION_LABEL: Record<Section, string> = { main: 'Main deck', extra: 'Extra deck', side: 'Side deck' }
const EMPTY_STORE = {
  subscribe: () => () => {},
  getSnapshot: () => EMPTY,
} as unknown as Parameters<typeof useCollection>[0]
const EMPTY = { boxes: new Map(), groups: new Map(), custom_cards: new Map(), stacks: new Map() }

async function fetchDeckPage(url: string, searcher: Searcher): Promise<RawDeck> {
  if (!supabase) throw new Error('Importing links needs the site to have accounts set up')
  const { data, error } = await supabase.functions.invoke('fetch-deck', { body: { url } })
  if (error) throw new Error(`Couldn't fetch that page (${error.message}). Is the fetch-deck function deployed?`)
  if (data?.error) throw new Error(data.error)
  const html = String(data.html)
  if (detectFormat(url) === 'ygoprodeck') return parseYgoprodeckPage(html)
  const byKid = new Map(searcher.cards.filter((c) => c.kid).map((c) => [c.kid!, c]))
  return parseKonamiPage(html, byKid)
}

const safeName = (s: string) => s.replace(/[^\w -]+/g, '').trim() || 'deck'

export function DecksPage({ searcher, prices }: { searcher: Searcher; prices?: YgoPriceDay }) {
  const ctx = useContext(CollectionContext)
  const collection = useCollection(ctx?.store ?? EMPTY_STORE)
  const [input, setInput] = useState('')
  const [deck, setDeck] = useState<Deck>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [strategy, setStrategy] = useState<PullStrategy>('list')
  const [preferBox, setPreferBox] = useState('')
  const [target, setTarget] = useState('new')
  const [newName, setNewName] = useState('')
  const [notice, setNotice] = useState<string>()

  const read = async (text: string) => {
    setBusy(true)
    setError(undefined)
    setNotice(undefined)
    try {
      const format = detectFormat(text)
      const raw = format === 'ygoprodeck' || format === 'konami' ? await fetchDeckPage(text.trim(), searcher) : (await parseDeck(text, searcher)).raw
      const d = resolveDeck(raw, searcher)
      if (!d.main.length && !d.extra.length && !d.side.length) throw new Error("Couldn't find any cards in that")
      setDeck(d)
      setNewName(d.name ?? '')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const needs: Need[] = useMemo(
    () => (deck ? SECTIONS.flatMap((s) => deck[s].map((l) => ({ card_key: String(l.card.id), name: l.card.n, qty: l.qty, section: s }))) : []),
    [deck],
  )
  const deckGroups = [...collection.groups.values()].filter((g) => g.kind === 'deck')
  const targetGroup = target !== 'new' ? target : undefined
  const lines = useMemo(
    () => pullList(collection, needs, { strategy, targetGroup, preferBox: preferBox || undefined, priceOf: (s) => stackPrice(prices, s) }),
    [collection, needs, strategy, targetGroup, preferBox, prices],
  )
  const missing = lines.filter((l) => l.missing > 0)
  const missingByName = [...missing.reduce((m, l) => m.set(l.name, (m.get(l.name) ?? 0) + l.missing), new Map<string, number>())].map(([name, qty]) => ({ name, qty }))
  const pickedCount = lines.reduce((n, l) => n + l.picks.reduce((x, p) => x + p.qty, 0), 0)
  const canEdit = !!ctx && !ctx.readOnly

  const pull = async () => {
    if (!ctx) return
    const name = target === 'new' ? newName.trim() || deck?.name || 'New deck' : collection.groups.get(target)?.name
    let groupId = target
    const err = await change(ctx, 'pull', `Pulled ${pickedCount} cards into ${name}`, (d) => {
      if (target === 'new') groupId = d.createGroup(name!, { kind: 'deck' }).id
      for (const l of lines) for (const p of l.picks) d.move(p.stack.id, p.qty, groupId, l.section)
    }, { batch_id: uuid() })
    if (!err) setTarget(groupId)
    setNotice(err ?? `Moved ${pickedCount} cards into ${name}. They're tracked there until you put them back.`)
  }

  const copy = async (text: string, what: string) => {
    await navigator.clipboard.writeText(text)
    setNotice(`${what} copied to the clipboard.`)
  }

  return (
    <div>
      <h2>Decks</h2>
      <p className="muted small">
        Paste a decklist (.ydk text, ydke:// link, YGO Omega code, or lines like "3 Ash Blossom & Joyous Spring"), a YGOPRODeck or
        Neuron deck link, or open a .ydk file. From Duelingbook, export the deck (.ydk or ydke://) and paste or open that. You'll see where each card is in {ctx?.readOnly ? `${ctx.owner.username}'s` : 'your'} collection.
      </p>
      <form
        className="stack-form"
        onSubmit={(e) => {
          e.preventDefault()
          void read(input)
        }}
      >
        <textarea rows={5} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Paste a deck or a link" />
        <div className="chips">
          <button className="primary" disabled={busy || !input.trim()}>
            {busy ? 'Reading…' : 'Read deck'}
          </button>
          <label className="chip">
            Open a file…
            <input
              type="file"
              accept=".ydk,.txt,text/plain"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0]
                if (!f) return
                const text = await f.text()
                setInput(text)
                void read(text)
              }}
            />
          </label>
        </div>
      </form>
      {error && <p className="error">{error}</p>}

      {deck && (
        <>
          <header className="pane-head">
            <div>
              <h3>{deck.name ?? 'Imported deck'}</h3>
              <p className="muted small">
                {SECTIONS.map((s) => `${SECTION_LABEL[s]} ${deck[s].reduce((n, l) => n + l.qty, 0)}`).join(' · ')}
                {deck.unknown.length > 0 && ` · ${deck.unknown.length} not recognised`}
              </p>
            </div>
            <div className="chips">
              <button type="button" className="chip" onClick={() => download(`${safeName(deck.name ?? 'deck')}.ydk`, toYdk(deckToRaw(deck)))}>
                Download .ydk
              </button>
              <button type="button" className="chip" onClick={() => copy(toYdke(deckToRaw(deck)), 'ydke link')}>
                Copy ydke://
              </button>
              <button type="button" className="chip" onClick={() => copy(toText(deck), 'Decklist')}>
                Copy as text
              </button>
            </div>
          </header>
          {deck.unknown.length > 0 && <p className="error small">Not recognised: {deck.unknown.join('; ')}</p>}

          {ctx ? (
            <div className="bulkbar">
              <label>
                Pick copies:{' '}
                <select value={strategy} onChange={(e) => setStrategy(e.target.value as PullStrategy)}>
                  {PULL_STRATEGIES.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              {strategy === 'prefer-box' && (
                <select value={preferBox} onChange={(e) => setPreferBox(e.target.value)}>
                  <option value="">Choose a box…</option>
                  {[...collection.boxes.values()].map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              )}
              {canEdit && (
                <label>
                  Into:{' '}
                  <select value={target} onChange={(e) => setTarget(e.target.value)}>
                    <option value="new">A new deck group</option>
                    {deckGroups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {groupPath(collection, g.id)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {canEdit && target === 'new' && <input value={newName} placeholder="Deck name" onChange={(e) => setNewName(e.target.value)} />}
              {canEdit && strategy !== 'list' && (
                <button type="button" className="primary" disabled={!pickedCount} onClick={pull}>
                  Pull {pickedCount} cards
                </button>
              )}
            </div>
          ) : (
            <p className="muted">Sign in to see where these cards are in your collection.</p>
          )}
          {notice && <p className="ok">{notice}</p>}

          {SECTIONS.map((s) => {
            const sectionLines = lines.filter((l) => l.section === s)
            if (!sectionLines.length) return null
            return (
              <section key={s}>
                <h3>{SECTION_LABEL[s]}</h3>
                <ul className="results">
                  {sectionLines.map((l) => (
                    <li key={`${s}:${l.card_key}`} className="pull-line">
                      <div className="pull-head">
                        <strong>{l.qty}×</strong> {l.name}
                        {l.alreadyInDeck > 0 && <span className="badge owned">{l.alreadyInDeck} already in the deck</span>}
                        {l.missing > 0 && ctx && <span className="badge ban-banned">missing {l.missing}</span>}
                      </div>
                      {ctx && l.sources.length > 0 && (
                        <ul className="locations small">
                          {l.sources.map((src) => {
                            const pick = l.picks.find((p) => p.stack.id === src.id)
                            return (
                              <li key={src.id} className={pick ? 'picked' : undefined}>
                                {pick ? `take ${pick.qty} of ${src.qty}` : `${src.qty}`} · {groupPath(collection, src.group_id)}
                                <span className="muted"> {[src.set_code, src.rarity, src.edition, src.condition, src.note ? `“${src.note}”` : null].filter(Boolean).join(' · ')}</span>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}

          {ctx && missing.length > 0 && (
            <section className="owned-box">
              <h3>
                Missing {missingByName.reduce((n, l) => n + l.qty, 0)} cards{' '}
                <button type="button" className="chip" onClick={() => copy(lfList(missingByName), 'LF list')}>
                  Copy LF list
                </button>
              </h3>
              <pre className="lf">{lfList(missingByName)}</pre>
              {!ctx.readOnly && <WhoHasIt cards={missingByName.map((m) => ({ ...m, card_key: lines.find((l) => l.name === m.name)!.card_key }))} />}
            </section>
          )}
        </>
      )}
    </div>
  )
}
