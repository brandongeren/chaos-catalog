import { useContext, useEffect, useMemo, useState } from 'react'
import { CollectionContext, useCollection } from '../../../ui/collection/context.ts'
import { dayBefore, loadPriceDay } from '../data.ts'
import { printingKey } from '../keys.ts'
import { stackPrice } from '../prices.ts'
import type { Searcher } from '../search.ts'
import type { YgoMeta, YgoPriceDay } from '../types.ts'
import { money } from './format.ts'

const WINDOWS = [7, 14, 21, 28]
const EMPTY = { boxes: new Map(), groups: new Map(), custom_cards: new Map(), stacks: new Map() }
const NO_STORE = { subscribe: () => () => {}, getSnapshot: () => EMPTY } as unknown as Parameters<typeof useCollection>[0]

interface Mover {
  key: string
  cardId: number
  name: string
  printing: string
  qty: number
  now: number
  before: number
}

export function PricesPage({ searcher, meta, today }: { searcher: Searcher; meta: YgoMeta; today?: YgoPriceDay }) {
  const ctx = useContext(CollectionContext)
  const c = useCollection(ctx?.store ?? NO_STORE)
  const [days, setDays] = useState(7)
  const [byPercent, setByPercent] = useState(false)
  const [scope, setScope] = useState<'mine' | 'all'>(ctx ? 'mine' : 'all')
  const [minPrice, setMinPrice] = useState(1)
  const [rising, setRising] = useState(true)
  const [old, setOld] = useState<YgoPriceDay>()
  const [error, setError] = useState<string>()
  const hidden = ctx?.readOnly && !ctx.owner.show_prices
  const oldDay = today ? dayBefore(meta.priceDays, today.date, days) : undefined

  useEffect(() => {
    if (!oldDay) return
    let live = true
    loadPriceDay(oldDay).then(
      (d) => live && setOld(d),
      (e: Error) => live && setError(e.message),
    )
    return () => {
      live = false
    }
  }, [oldDay])

  const value = useMemo(() => {
    if (!today) return undefined
    let total = 0
    let priced = 0
    let cards = 0
    for (const s of c.stacks.values()) {
      cards += s.qty
      const p = stackPrice(today, s)
      if (p !== undefined) {
        total += p * s.qty
        priced += s.qty
      }
    }
    return { total, priced, cards }
  }, [c, today])

  const movers = useMemo(() => {
    if (!today || !old || old.date === today.date) return []
    const list: Mover[] = []
    if (scope === 'mine') {
      const agg = new Map<string, Mover>()
      for (const s of c.stacks.values()) {
        if (!s.card_key) continue
        const now = stackPrice(today, s)
        const before = stackPrice(old, s)
        if (now === undefined || before === undefined) continue
        const key = [s.card_key, s.set_code, s.rarity, s.edition].join('|')
        const m = agg.get(key)
        if (m) m.qty += s.qty
        else
          agg.set(key, {
            key,
            cardId: Number(s.card_key),
            name: searcher.byId.get(Number(s.card_key))?.n ?? s.card_key,
            printing: [s.set_code, s.rarity, s.edition].filter(Boolean).join(' · ') || 'cheapest printing',
            qty: s.qty,
            now,
            before,
          })
      }
      list.push(...agg.values())
    } else {
      for (const [key, editions] of Object.entries(today.printing)) {
        const [id, set, rarity] = key.split('|')
        const was = old.printing[printingKey(Number(id), set, rarity)]
        if (!was) continue
        for (const [edition, now] of Object.entries(editions)) {
          const before = was[edition]
          if (before === undefined) continue
          list.push({ key: `${key}|${edition}`, cardId: Number(id), name: searcher.byId.get(Number(id))?.n ?? id, printing: `${set} · ${rarity} · ${edition}`, qty: 1, now, before })
        }
      }
    }
    const score = (m: Mover) => (byPercent ? (m.now - m.before) / m.before : m.now - m.before)
    return list
      .filter((m) => Math.max(m.now, m.before) >= minPrice && m.now !== m.before)
      .sort((a, b) => (rising ? score(b) - score(a) : score(a) - score(b)))
      .slice(0, 200)
  }, [today, old, scope, c, searcher, byPercent, minPrice, rising])

  if (hidden) return <p className="muted">{ctx?.owner.username} keeps prices private.</p>
  if (!today) return <p className="muted">No prices published yet. They're added by the daily update.</p>

  return (
    <div>
      <h2>Prices</h2>
      {ctx && value && (
        <p>
          {ctx.readOnly ? `${ctx.owner.username}'s` : 'Your'} collection is worth about <strong>{money(value.total)}</strong>
          <span className="muted small">
            {' '}
            (TCGplayer market, {today.date}; {value.priced.toLocaleString()} of {value.cards.toLocaleString()} cards have a price. Cards without a recorded printing use their cheapest one.)
          </span>
        </p>
      )}
      <div className="bulkbar">
        {ctx && (
          <select value={scope} onChange={(e) => setScope(e.target.value as 'mine' | 'all')}>
            <option value="mine">{ctx.readOnly ? `${ctx.owner.username}'s cards` : 'My cards'}</option>
            <option value="all">All cards</option>
          </select>
        )}
        <select value={rising ? 'up' : 'down'} onChange={(e) => setRising(e.target.value === 'up')}>
          <option value="up">Rising</option>
          <option value="down">Falling</option>
        </select>
        <span>over</span>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {WINDOWS.map((w) => (
            <option key={w} value={w}>
              {w} days
            </option>
          ))}
        </select>
        <span className="chips">
          <button type="button" className={!byPercent ? 'chip on' : 'chip'} onClick={() => setByPercent(false)}>
            $
          </button>
          <button type="button" className={byPercent ? 'chip on' : 'chip'} onClick={() => setByPercent(true)}>
            %
          </button>
        </span>
        <label>
          ignore under $<input type="number" min={0} step={0.5} value={minPrice} className="qty-input" onChange={(e) => setMinPrice(Number(e.target.value) || 0)} />
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      {!oldDay ? (
        <p className="muted">
          Not enough history for {days} days yet: prices start {meta.priceDays.at(-1)} ({meta.priceDays.length} day{meta.priceDays.length === 1 ? '' : 's'} so far; the last 28 are kept).
        </p>
      ) : (
        <>
          <p className="muted small">
            {old?.date ?? oldDay} → {today.date}
          </p>
          <ul className="results">
            {movers.map((m) => {
              const diff = m.now - m.before
              const pct = (diff / m.before) * 100
              return (
                <li key={m.key}>
                  <a className="result" href={`?view=search&card=${m.cardId}`}>
                    <span className="name">
                      {m.name}
                      {scope === 'mine' && m.qty > 1 && <span className="muted"> ×{m.qty}</span>}
                    </span>
                    <span className="meta">{m.printing}</span>
                    <span className="side">
                      <span className={diff > 0 ? 'up' : 'down'}>
                        {diff > 0 ? '+' : '−'}
                        {byPercent ? `${Math.abs(pct).toFixed(0)}%` : money(Math.abs(diff))}
                      </span>
                      <span className="muted">
                        {money(m.before)} → {money(m.now)}
                      </span>
                    </span>
                  </a>
                </li>
              )
            })}
          </ul>
          {!movers.length && old && <p className="muted">No changes over this window.</p>}
        </>
      )}
    </div>
  )
}
