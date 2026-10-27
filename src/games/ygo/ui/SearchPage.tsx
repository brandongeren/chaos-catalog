import { useContext, useDeferredValue, useMemo, useState } from 'react'
import { groupPath } from '../../../core/collection/model.ts'
import { CollectionContext, ownedIndex, useCollection } from '../../../ui/collection/context.ts'
import { AddCardDialog } from '../../../ui/collection/dialogs.tsx'
import type { YgoCard } from '../types.ts'
import { parseSyntax } from '../syntax.ts'
import { CardSocial } from '../../../ui/social/CardSocial.tsx'
import { useUrlParams } from '../../../lib/useUrlParams.ts'
import { releaseDate, summary } from '../classify.ts'
import { advancedCount, emptyQuery, fromParams, toParams, type SortKey, type YgoQuery } from '../query.ts'
import type { Searcher } from '../search.ts'
import type { YgoPriceDay } from '../types.ts'
import { CardDetail } from './CardDetail.tsx'
import { Filters } from './Filters.tsx'
import { money } from './format.ts'

const PAGE = 60
const KEEP = ['view', 'add', 'u', 'syntax']
const NO_STORE = { subscribe: () => () => {}, getSnapshot: () => EMPTY } as unknown as Parameters<typeof useCollection>[0]
const EMPTY = { boxes: new Map(), groups: new Map(), custom_cards: new Map(), stacks: new Map() }

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
  // Syntax mode: the search box holds Scryfall-style syntax, parsed into the same filters.
  const syntaxOn = params.get('syntax') === '1'
  const parsed = useMemo(() => (syntaxOn ? parseSyntax(query.q, searcher) : undefined), [syntaxOn, query.q, searcher])
  const effective = useMemo(
    () => (parsed ? { ...parsed.query, mine: parsed.query.mine || query.mine, related: parsed.query.related ?? query.related } : query),
    [parsed, query],
  )
  const deferred = useDeferredValue(effective)
  const cardPrice = useMemo(() => (prices ? (id: number) => prices.card[id] : undefined), [prices])
  // The collection being viewed (yours, or a public profile's), if any.
  const coll = useContext(CollectionContext)
  const collection = useCollection(coll?.store ?? NO_STORE)
  const owned = useMemo(() => (coll ? ownedIndex(collection) : undefined), [coll, collection])
  const ownedSet = useMemo(() => (owned ? new Set(owned.keys()) : undefined), [owned])
  const addTo = params.get('add') ?? undefined
  const [adding, setAdding] = useState<YgoCard>()
  const canAdd = !!coll && !coll.readOnly
  const exact = useMemo(() => searcher.search(deferred, cardPrice, ownedSet), [searcher, deferred, cardPrice, ownedSet])
  // Nothing found by name: show close matches (a typo, "Quantum" for "Quantal", …) instead of an empty page.
  const suggestions = useMemo(
    () => (!exact.length && deferred.q.trim() && !deferred.fuzzy && !syntaxOn ? searcher.search({ ...deferred, fuzzy: true }, cardPrice, ownedSet).slice(0, 20) : []),
    [exact, deferred, syntaxOn, searcher, cardPrice, ownedSet],
  )
  const results = exact.length ? exact : suggestions
  // "Show more" pages reset whenever the search changes.
  const queryKey = toParams(deferred).toString()
  const [page, setPage] = useState({ key: queryKey, limit: PAGE })
  const limit = page.key === queryKey ? page.limit : PAGE
  const setLimit = (n: number) => setPage({ key: queryKey, limit: n })

  // Keeps the page's own parameters (which view, adding to which group) across searches.
  const update = (next: YgoQuery, typing = false) => {
    const p = toParams(next)
    for (const k of KEEP) if (params.get(k)) p.set(k, params.get(k)!)
    setParams(p, { replace: typing })
  }
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
        owned={coll ? owned?.get(card.id) ?? [] : undefined}
        locationOf={(groupId) => groupPath(collection, groupId)}
        onAdd={canAdd ? () => setAdding(card) : undefined}
        addDialog={adding && <AddCardDialog card={adding} initialGroup={addTo} onClose={() => setAdding(undefined)} />}
        social={canAdd && <CardSocial card={card} />}
      />
    )

  return (
    <>
      <form className="searchbar" role="search" onSubmit={(e) => e.preventDefault()}>
        <input
          type="search"
          aria-label="Search cards"
          placeholder={syntaxOn ? 't:link a:dark atk>=2500 o:negate' : 'Card name, passcode or set code'}
          value={query.q}
          autoFocus
          onChange={(e) => update({ ...query, q: e.target.value }, true)}
        />
        <label className="toggle" title="Tolerate typos and partial words">
          <input type="checkbox" checked={query.fuzzy} onChange={(e) => update({ ...query, fuzzy: e.target.checked })} /> Fuzzy
        </label>
        <label className="toggle" title="Type filters as text, like Scryfall">
          <input
            type="checkbox"
            checked={syntaxOn}
            onChange={(e) => {
              const p = new URLSearchParams(params)
              if (e.target.checked) p.set('syntax', '1')
              else p.delete('syntax')
              setParams(p)
            }}
          />{' '}
          Syntax
        </label>
        {!syntaxOn && (
          <button type="button" className={showFilters ? 'chip on' : 'chip'} aria-expanded={showFilters} onClick={() => setShowFilters(!showFilters)}>
            Advanced{advanced ? ` (${advanced})` : ''}
          </button>
        )}
        {coll && (
          <label className="toggle" title="Only cards in this collection">
            <input type="checkbox" checked={query.mine} onChange={(e) => update({ ...query, mine: e.target.checked })} />{' '}
            {coll.readOnly ? `Only ${coll.owner.username}'s cards` : 'Only my cards'}
          </label>
        )}
      </form>
      {addTo && collection.groups.get(addTo) && (
        <p className="bulkbar">
          Adding cards to <strong>{groupPath(collection, addTo)}</strong>: use + on any card.
          <button type="button" className="link" onClick={() => setParams(new URLSearchParams({ view: 'collection', g: addTo }))}>
            Done
          </button>
        </p>
      )}

      {cardId && !card && <p className="error">No card with passcode {cardId}.</p>}

      {syntaxOn && (
        <p className="small">
          {parsed?.errors.map((e) => (
            <span key={e} className="error">
              {e}.{' '}
            </span>
          ))}
          <a href="?view=syntax" onClick={(e) => (e.preventDefault(), setParams(new URLSearchParams({ view: 'syntax' })))}>
            Syntax guide
          </a>
        </p>
      )}

      {showFilters && !syntaxOn && <Filters query={query} races={searcher.races} archetypes={searcher.archetypes} onChange={update} />}

      {!exact.length && (
        <p className="muted small">
          {suggestions.length ? <>No cards named “{deferred.q.trim()}”. Close matches:</> : 'No cards match.'}
          {(advanced > 0 || query.mine || query.related !== undefined) && (
            <>
              {' '}
              Filters are on{query.mine ? ' (only cards in the collection)' : ''}.{' '}
              <button type="button" className="link" onClick={() => update({ ...emptyQuery(), q: query.q, fuzzy: query.fuzzy })}>
                Clear filters
              </button>
            </>
          )}
        </p>
      )}
      <div className="results-head">
        <span>
          {exact.length.toLocaleString()} card{exact.length === 1 ? '' : 's'}
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
          <li key={c.id} className={canAdd ? 'row-with-check' : undefined}>
            {canAdd && (
              <button type="button" className="add-btn" aria-label={`Add ${c.n}`} title="Add to collection" onClick={() => setAdding(c)}>
                +
              </button>
            )}
            <button type="button" className="result" onClick={() => open(c.id)}>
              <span className="name">
                {c.n}
                {c.ban && <span className={`badge ban-${c.ban.toLowerCase()}`}>{c.ban}</span>}
                {c.gp > 0 && <span className="badge gp">{c.gp} GP</span>}
                {owned?.get(c.id) && <span className="badge owned">{owned.get(c.id)!.reduce((n, s) => n + s.qty, 0)} owned</span>}
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
      {adding && <AddCardDialog card={adding} initialGroup={addTo} onClose={() => setAdding(undefined)} />}
    </>
  )
}

function sortDirection(q: YgoQuery) {
  if (q.sort === 'name') return q.desc ? 'Z → A' : 'A → Z'
  if (q.sort === 'date') return q.desc ? 'Oldest first' : 'Newest first'
  return q.desc ? 'High → low' : 'Low → high'
}
