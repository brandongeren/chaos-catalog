import { summary } from '../classify.ts'
import { printingKey } from '../keys.ts'
import type { Searcher } from '../search.ts'
import type { ReactNode } from 'react'
import { availabilityTag, type Stack } from '../../../core/collection/model.ts'
import type { YgoCard, YgoPriceDay } from '../types.ts'
import { money } from './format.ts'

interface Props {
  card: YgoCard
  searcher: Searcher
  prices?: YgoPriceDay
  onOpen: (id: number) => void
  onShowRelated: (id: number) => void
  onArchetype: (archetype: string) => void
  onBack: () => void
  /** Copies in the viewed collection (undefined = no collection loaded). */
  owned?: Stack[]
  locationOf?: (groupId: string) => string
  onAdd?: () => void
  addDialog?: ReactNode
  /** Signed in: show "Want" and who among friends/locals has it. */
  social?: ReactNode
}

const EDITIONS = ['1st Edition', 'Unlimited', 'Limited']

export function CardDetail({ card, searcher, prices, onOpen, onShowRelated, onArchetype, onBack, owned, locationOf, onAdd, addDialog, social }: Props) {
  const list = (ids: number[] | undefined) => (ids ?? []).map((id) => searcher.byId.get(id)).filter((c): c is YgoCard => !!c)
  const mentions = list(card.m)
  const mentionedBy = list(card.mb)
  const related = searcher.related(card.id)
  const sameArchetype = card.ar ? related.filter((c) => c.ar === card.ar) : []
  const printings = [...(card.p ?? [])].sort((a, b) => a.c.localeCompare(b.c))
  const cardLinks = (cards: YgoCard[], max = 12) => (
    <ul className="links">
      {cards.slice(0, max).map((c) => (
        <li key={c.id}>
          <button type="button" className="link" onClick={() => onOpen(c.id)}>
            {c.n}
          </button>
        </li>
      ))}
      {cards.length > max && <li className="muted">and {cards.length - max} more</li>}
    </ul>
  )

  return (
    <article className="detail">
      <button type="button" className="link back" onClick={onBack}>
        ← Back to results
      </button>
      <h2>{card.n}</h2>
      <p className="muted">{summary(card)}</p>
      {card.an?.length ? <p className="muted small">Also known as {card.an.map((n) => `“${n}”`).join(', ')}</p> : null}
      <p className="card-text">{card.d}</p>

      {(owned || onAdd) && (
        <section className="owned-box">
          <h3>
            {owned?.length ? `In the collection: ${owned.reduce((n, s) => n + s.qty, 0)}` : 'Not in the collection'}{' '}
            {onAdd && (
              <button type="button" className="chip" onClick={onAdd}>
                + Add
              </button>
            )}
          </h3>
          {owned && owned.length > 0 && (
            <ul className="locations">
              {owned.map((s) => (
                <li key={s.id}>
                  <strong>{s.qty}×</strong> {locationOf?.(s.group_id)}
                  <span className="muted small">
                    {' '}
                    {[s.set_code, s.rarity, s.edition, s.condition, s.note ? `“${s.note}”` : null, s.availability !== 'none' ? availabilityTag(s.availability) : null].filter(Boolean).join(' · ')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {addDialog}
      {social}

      <dl className="facts">
        <dt>TCG release</dt>
        <dd>{card.tcg ?? 'not released in the TCG'}</dd>
        {card.ocg && (
          <>
            <dt>OCG release</dt>
            <dd>{card.ocg}</dd>
          </>
        )}
        <dt>TCG banlist</dt>
        <dd>{card.ban ?? 'Unlimited'}</dd>
        <dt>Genesys points</dt>
        <dd>{card.gp}</dd>
        {card.ar && (
          <>
            <dt>Archetype</dt>
            <dd>
              <button type="button" className="link" onClick={() => onArchetype(card.ar!)}>
                {card.ar}
              </button>
            </dd>
          </>
        )}
        <dt>Passcode</dt>
        <dd>
          {card.id}
          {card.alt?.length ? <span className="muted"> (alternate art: {card.alt.join(', ')})</span> : null}
        </dd>
        {prices?.card[card.id] !== undefined && (
          <>
            <dt>Lowest price</dt>
            <dd>
              {money(prices.card[card.id])} <span className="muted">(TCGplayer market, {prices.date})</span>
            </dd>
          </>
        )}
      </dl>

      {printings.length > 0 && (
        <section>
          <h3>Printings ({printings.length})</h3>
          <div className="table-scroll">
            <table className="printings">
              <thead>
                <tr>
                  <th>Set code</th>
                  <th>Rarity</th>
                  <th className="wide-only">Set</th>
                  {EDITIONS.map((e) => (
                    <th key={e} className="num">
                      {e}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {printings.map((p) => {
                  const editions = prices?.printing[printingKey(card.id, p.c, p.r)]
                  return (
                    <tr key={`${p.c}|${p.r}`}>
                      <td>{p.c}</td>
                      <td>
                        {p.r}
                        {p.tcg && <span className="muted" title="Listed on TCGplayer but not in YGOPRODeck"> *</span>}
                      </td>
                      <td className="wide-only">{p.s}</td>
                      {EDITIONS.map((e) => (
                        <td key={e} className="num">
                          {editions?.[e] !== undefined ? money(editions[e]) : ''}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {prices && <p className="muted small">TCGplayer market prices (USD) from {prices.date}, via TCGCSV.</p>}
        </section>
      )}

      {related.length > 0 && (
        <section>
          <h3>
            Related cards ({related.length}){' '}
            <button type="button" className="link small" onClick={() => onShowRelated(card.id)}>
              search and filter them
            </button>
          </h3>
          {mentions.length > 0 && (
            <>
              <h4>Mentioned in this card's text</h4>
              {cardLinks(mentions)}
            </>
          )}
          {mentionedBy.length > 0 && (
            <>
              <h4>Cards that mention {card.n}</h4>
              {cardLinks(mentionedBy)}
            </>
          )}
          {sameArchetype.length > 0 && (
            <>
              <h4>Same archetype ({card.ar})</h4>
              {cardLinks(sameArchetype)}
            </>
          )}
          {card.ma?.length ? (
            <p className="muted small">This card's text also names the archetype{card.ma.length > 1 ? 's' : ''} {card.ma.join(', ')}.</p>
          ) : null}
        </section>
      )}

      {card.kid && (
        <p className="small">
          <a href={`https://www.db.yugioh-card.com/yugiohdb/card_search.action?ope=2&cid=${card.kid}&request_locale=en`} target="_blank" rel="noreferrer">
            Official card database (Neuron) ↗
          </a>
        </p>
      )}
    </article>
  )
}
