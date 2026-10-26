// Card search over the catalog, run on the device. Pure: no network or DOM, so it's unit-tested and could move to a
// worker if phones need it.

import MiniSearch from 'minisearch'
import { kindOf, levelOf, rankOf, releaseDate, isLink } from './classify.ts'
import type { Range, YgoQuery } from './query.ts'
import type { YgoCard } from './types.ts'

/** Lowercase, accents and punctuation removed: "Ash Blossom & Joyous Spring" -> "ash blossom joyous spring". */
export const normalize = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const SET_CODE = /^[a-z0-9]{2,5}-[a-z]{0,2}\d{2,3}$/i

const inRange = (v: number | undefined, r: Range) =>
  r.min === undefined && r.max === undefined
    ? true
    : v !== undefined && v >= 0 && (r.min === undefined || v >= r.min) && (r.max === undefined || v <= r.max)

const rangeSet = (r: Range) => r.min !== undefined || r.max !== undefined

export interface Searcher {
  cards: YgoCard[]
  byId: Map<number, YgoCard>
  archetypes: string[]
  races: string[]
  /** Cards related to `id`: same archetype, archetypes its text names, cards it names, cards that name it. */
  related(id: number): YgoCard[]
  /** `owned`: passcodes in the viewed collection, used by the "only my cards" filter. */
  search(query: YgoQuery, cardPrice?: (id: number) => number | undefined, owned?: Set<number>): YgoCard[]
}

export function createSearcher(cards: YgoCard[]): Searcher {
  // Includes alternate-art passcodes, so any passcode a decklist or link uses finds the card.
  const byId = new Map(cards.flatMap((c) => [c.id, ...(c.alt ?? [])].map((id) => [id, c] as const)))
  const names = new Map(cards.map((c) => [c.id, normalize(c.n)]))
  const texts = new Map<number, string>()
  const textOf = (c: YgoCard) => texts.get(c.id) ?? (texts.set(c.id, normalize(c.d)), texts.get(c.id)!)
  const byArchetype = new Map<string, YgoCard[]>()
  for (const c of cards) if (c.ar) (byArchetype.get(c.ar) ?? byArchetype.set(c.ar, []).get(c.ar)!).push(c)

  let fuzzyIndex: MiniSearch | undefined // built on first fuzzy search
  const fuzzy = (q: string) => {
    fuzzyIndex ??= (() => {
      const ms = new MiniSearch({ fields: ['n'], storeFields: [], idField: 'id' })
      ms.addAll(cards.map((c) => ({ id: c.id, n: c.n })))
      return ms
    })()
    return fuzzyIndex.search(q, { fuzzy: 0.25, prefix: true, combineWith: 'AND' })
  }

  const related = (id: number) => {
    const c = byId.get(id)
    if (!c) return []
    const out = new Set<YgoCard>()
    for (const a of [c.ar, ...(c.ma ?? [])]) for (const x of (a && byArchetype.get(a)) || []) out.add(x)
    for (const x of [...(c.m ?? []), ...(c.mb ?? [])]) {
      const r = byId.get(x)
      if (r) out.add(r)
    }
    out.delete(c)
    return [...out]
  }

  function search(query: YgoQuery, cardPrice?: (id: number) => number | undefined, owned?: Set<number>): YgoCard[] {
    const q = query.q.trim()
    const nq = normalize(q)
    // Relevance: 0 exact name, 1 name starts with the query, 2 other match; fuzzy uses its own score.
    const rank = new Map<number, number>()
    let pool: YgoCard[] = query.related !== undefined ? related(query.related) : cards

    if (q) {
      if (/^\d{4,9}$/.test(q)) {
        // Passcode or Konami id
        const n = Number(q)
        pool = pool.filter((c) => c.id === n || c.kid === n || c.alt?.includes(n) || names.get(c.id)!.includes(nq))
      } else if (SET_CODE.test(q)) {
        const code = q.toUpperCase()
        pool = pool.filter((c) => c.p?.some((p) => p.c === code))
      } else if (query.fuzzy) {
        const hits = fuzzy(q)
        const allowed = new Set(pool)
        pool = []
        hits.forEach((h, i) => {
          const c = byId.get(h.id as number)
          if (c && allowed.has(c)) {
            pool.push(c)
            rank.set(c.id, i)
          }
        })
      } else {
        const words = nq.split(' ')
        pool = pool.filter((c) => {
          const n = names.get(c.id)!
          if (!words.every((w) => n.includes(w))) return false
          rank.set(c.id, n === nq ? 0 : n.startsWith(nq) ? 1 : 2)
          return true
        })
      }
    }

    const text = normalize(query.text)
    const set = query.set.trim().toLowerCase()
    const races = new Set(query.races)
    const result = pool.filter((c) => {
      if (query.mine && !owned?.has(c.id)) return false
      const kind = kindOf(c)
      // OCG-only cards still show when you own them
      if (!query.ocg && !c.tcg && !owned?.has(c.id)) return false
      if (query.frames.length && !query.frames.some((f) => c.tl?.includes(f))) return false
      if (query.abilities.length && !query.abilities.every((a) => c.tl?.includes(a))) return false
      // A Spell/Trap subtype narrows its own kind. With only Spell subtypes chosen, Traps and Monsters drop out
      // unless their kind is ticked too ("Quick-Play" + kind "Trap" = Quick-Play Spells and all Traps).
      if (query.spellTypes.length || query.trapTypes.length) {
        const sub = kind === 'spell' ? query.spellTypes : kind === 'trap' ? query.trapTypes : []
        if (sub.length ? !sub.includes(c.r) : !query.kinds.includes(kind)) return false
      } else if (query.kinds.length && !query.kinds.includes(kind)) return false
      if (query.attributes.length && !(c.a && query.attributes.includes(c.a))) return false
      if (races.size && !(kind === 'monster' && races.has(c.r))) return false
      if (!inRange(levelOf(c), query.level)) return false
      if (!inRange(rankOf(c), query.rank)) return false
      if (!inRange(isLink(c) ? c.lk : undefined, query.link)) return false
      if (!inRange(c.sc, query.scale)) return false
      if (!inRange(c.atk, query.atk)) return false
      if (!inRange(isLink(c) ? undefined : c.def, query.def)) return false
      if (rangeSet(query.gp) && !inRange(c.gp, query.gp)) return false
      if (query.arrows.length && !query.arrows.every((a) => c.lm?.includes(a))) return false
      const date = releaseDate(c)
      if (query.from && !(date && date >= query.from)) return false
      if (query.to && !(date && date <= query.to)) return false
      if (query.archetype && c.ar !== query.archetype) return false
      if (query.ban.length && !query.ban.includes(c.ban ?? 'Unlimited')) return false
      if (set && !c.p?.some((p) => p.c.toLowerCase().startsWith(set) || p.s.toLowerCase().includes(set))) return false
      if (text && !textOf(c).includes(text)) return false
      return true
    })

    return sortCards(result, query, rank, cardPrice)
  }

  return {
    cards,
    byId,
    archetypes: [...byArchetype.keys()].sort((a, b) => a.localeCompare(b)),
    races: [...new Set(cards.filter((c) => kindOf(c) === 'monster' && c.r).map((c) => c.r))].sort(),
    related,
    search,
  }
}

function sortCards(
  list: YgoCard[],
  query: YgoQuery,
  rank: Map<number, number>,
  cardPrice?: (id: number) => number | undefined,
): YgoCard[] {
  const byName = (a: YgoCard, b: YgoCard) => a.n.localeCompare(b.n)
  // Missing values (no date, "?" ATK, no price) always sort last, whichever direction.
  const numeric = (get: (c: YgoCard) => number | undefined) => (a: YgoCard, b: YgoCard) => {
    const x = get(a)
    const y = get(b)
    const okx = x !== undefined && x >= 0
    const oky = y !== undefined && y >= 0
    if (okx !== oky) return okx ? -1 : 1
    if (!okx || x === y) return byName(a, b)
    return query.desc ? y! - x! : x! - y!
  }
  const newestFirst = (a: YgoCard, b: YgoCard) => {
    const x = releaseDate(a) ?? ''
    const y = releaseDate(b) ?? ''
    if (!x !== !y) return x ? -1 : 1
    return x === y ? byName(a, b) : query.desc ? x.localeCompare(y) : y.localeCompare(x)
  }
  let cmp: (a: YgoCard, b: YgoCard) => number
  switch (query.sort) {
    case 'name':
      cmp = (a, b) => (query.desc ? -byName(a, b) : byName(a, b))
      break
    case 'date':
      cmp = newestFirst
      break
    case 'atk':
      cmp = numeric((c) => c.atk)
      break
    case 'def':
      cmp = numeric((c) => (isLink(c) ? undefined : c.def))
      break
    case 'level':
      cmp = numeric((c) => (isLink(c) ? c.lk : c.lv))
      break
    case 'gp':
      cmp = numeric((c) => c.gp)
      break
    case 'price':
      cmp = numeric((c) => cardPrice?.(c.id))
      break
    default:
      // relevance: best name match first, then newest
      cmp = rank.size ? (a, b) => (rank.get(a.id) ?? 9) - (rank.get(b.id) ?? 9) || newestFirst(a, b) : newestFirst
  }
  return [...list].sort(cmp)
}
