import { useDeferredValue, useMemo, useState } from 'react'
import { useUrlParams } from '../../../lib/useUrlParams.ts'
import { releaseDate, summary } from '../classify.ts'
import { advancedCount, emptyQuery, fromParams, toParams, type SortKey, type YgoQuery } from '../query.ts'
import type { Searcher } from '../search.ts'
import type { YgoPriceDay } from '../types.ts'
import { CardDetail } from './CardDetail.tsx'
import { Filters } from './Filters.tsx'
import { money } from './format.ts'

const PAGE = 60

const SORTS: [SortKey, string][] = [
  ['relevance', 'Best match'],
  ['date', 'Release date'],
  ['name', 'Name'],
  ['atk', 'ATK'],
  ['def', 'DEF'],
  ['level', 'Level / Rank / Link'],
  ['gp', 'Genesys points'],
  ['price', 'Price'],
]

interface Props {
  searcher: Searcher
  prices?: YgoPriceDay
}

export function SearchPage({ searcher, prices }: Props) {
  const [params, setParams] = useUrlParams()
  const query = useMemo(() => fromParams(params), [params])
  const cardId = Number(params.get('card')) || undefined
  const card = cardId ? searcher.byId.get(cardId) : undefined
  const [showFilters, setShowFilters] = useState(() => advancedCount(query) > 0)

  // Filtering 14k cards is fast, but keep typing smooth on slow phones.
  const deferred = useDeferredValue(query)
  const cardPrice = useMemo(() => (prices ? (id: number) => prices.card[id] : undefined), [prices])
  const results = useMemo(() => searcher.search(deferred, cardPrice), [searcher, deferred, cardPrice])
  // "Show more" pages reset whenever the search changes.
  const queryKey = toParams(deferred).toString()
  const [page, setPage] = useState({ key: queryKey, limit: PAGE })
  const limit = page.key === queryKey ? page.limit : PAGE
  const setLimit = (n: number) => setPage({ key: queryKey, limit: n })

  const update = (next: YgoQuery, typing = false) => setParams(toParams(next), { replace: typing })
  const open = (id: number) => {
    const p = new URLSearchParams(params)
    p.set('card', String(id))
    setParams(p)
    window.scrollTo(0, 0)
  }
  const relatedTo = query.related !== undefined ? searcher.byId.get(query.related) : undefined
  const advanced = advancedCount(query)

  if (card)
    return (
      <CardDetail
        card={card}
        searcher={searcher}
        prices={prices}
        onOpen={open}
        onBack={() => {
          const p = new URLSearchParams(params)
          p.delete('card')
          setParams(p)
        }}
        onShowRelated={(id) => update({ ...emptyQuery(), related: id })}
        onArchetype={(archetype) => update({ ...emptyQuery(), archetype })}
      />
    )

  return (
    <>
      <form className="searchbar" role="search" onSubmit={(e) => e.preventDefault()}>
        <input
          type="search"
          aria-label="Search cards"
          placeholder="Card name, passcode or set code"
          value={query.q}
          autoFocus
          onChange={(e) => update({ ...query, q: e.target.value }, true)}
        />
        <label className="toggle" title="Tolerate typos and partial words">
          <input type="checkbox" checked={query.fuzzy} onChange={(e) => update({ ...query, fuzzy: e.target.checked })} /> Fuzzy
        </label>
        <button type="button" className={showFilters ? 'chip on' : 'chip'} aria-expanded={showFilters} onClick={() => setShowFilters(!showFilters)}>
          Advanced{advanced ? ` (${advanced})` : ''}
        </button>
      </form>

      {cardId && !card && <p className="error">No card with passcode {cardId}.</p>}

      {showFilters && <Filters query={query} races={searcher.races} archetypes={searcher.archetypes} onChange={update} />}

      <div className="results-head">
        <span>
          {results.length.toLocaleString()} card{results.length === 1 ? '' : 's'}
          {relatedTo && (
            <>
              {' '}
              related to <strong>{relatedTo.n}</strong>{' '}
              <button type="button" className="link" onClick={() => update({ ...query, related: undefined })}>
                (show all)
              </button>
            </>
          )}
        </span>
        <span className="sort">
          <select aria-label="Sort by" value={query.sort} onChange={(e) => {
              const sort = e.target.value as SortKey
              // Numbers read best high-to-low; names A-Z; dates newest first.
              update({ ...query, sort, desc: !['relevance', 'name', 'date'].includes(sort) })
            }}>
            {SORTS.map(([k, label]) => (
              <option key={k} value={k} disabled={k === 'price' && !prices}>
                {label}
              </option>
            ))}
          </select>
          {query.sort !== 'relevance' && (
            <button type="button" className="chip" title="Reverse order" onClick={() => update({ ...query, desc: !query.desc })}>
              {sortDirection(query)}
            </button>
          )}
        </span>
      </div>

      <ul className="results">
        {results.slice(0, limit).map((c) => (
          <li key={c.id}>
            <button type="button" className="result" onClick={() => open(c.id)}>
              <span className="name">
                {c.n}
                {c.ban && <span className={`badge ban-${c.ban.toLowerCase()}`}>{c.ban}</span>}
                {c.gp > 0 && <span className="badge gp">{c.gp} GP</span>}
              </span>
              <span className="meta">{summary(c)}</span>
              <span className="side">
                {prices?.card[c.id] !== undefined && <span>{money(prices.card[c.id])}</span>}
                <span className="muted">{releaseDate(c) ?? ''}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {results.length > limit && (
        <button type="button" className="more" onClick={() => setLimit(limit + PAGE)}>
          Show more ({(results.length - limit).toLocaleString()} left)
        </button>
      )}
    </>
  )
}

function sortDirection(q: YgoQuery) {
  if (q.sort === 'name') return q.desc ? 'Z → A' : 'A → Z'
  if (q.sort === 'date') return q.desc ? 'Oldest first' : 'Newest first'
  return q.desc ? 'High → low' : 'Low → high'
}
