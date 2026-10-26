// A search query and its compact URL form (so searches can be bookmarked, shared and undone with Back).

export interface Range {
  min?: number
  max?: number
}

export type SortKey = 'relevance' | 'date' | 'name' | 'atk' | 'def' | 'level' | 'gp' | 'price'

export interface YgoQuery {
  /** Name, passcode, Konami id or set code. */
  q: string
  fuzzy: boolean
  /** Card text contains. */
  text: string
  kinds: string[]
  frames: string[]
  abilities: string[]
  spellTypes: string[]
  trapTypes: string[]
  attributes: string[]
  races: string[]
  level: Range
  rank: Range
  link: Range
  scale: Range
  atk: Range
  def: Range
  gp: Range
  arrows: string[]
  /** TCG release date window, YYYY-MM-DD, inclusive. */
  from: string
  to: string
  archetype: string
  /** Set code prefix (e.g. "LOB") or part of a set name. */
  set: string
  ban: string[]
  /** Include OCG-only cards. Off by default (TCG collections). */
  ocg: boolean
  /** Show cards related to this passcode (same archetype, mentions either way). */
  related?: number
  sort: SortKey
  desc: boolean
}

export const emptyQuery = (): YgoQuery => ({
  q: '',
  fuzzy: false,
  text: '',
  kinds: [],
  frames: [],
  abilities: [],
  spellTypes: [],
  trapTypes: [],
  attributes: [],
  races: [],
  level: {},
  rank: {},
  link: {},
  scale: {},
  atk: {},
  def: {},
  gp: {},
  arrows: [],
  from: '',
  to: '',
  archetype: '',
  set: '',
  ban: [],
  ocg: false,
  sort: 'relevance',
  desc: false,
})

// URL parameter names. Short, but readable when someone pastes a link.
const LISTS = {
  kinds: 'k',
  frames: 'fr',
  abilities: 'ab',
  spellTypes: 'st',
  trapTypes: 'tt',
  attributes: 'at',
  races: 'race',
  arrows: 'arrows',
  ban: 'ban',
} as const
const RANGES = { level: 'lv', rank: 'rank', link: 'link', scale: 'sc', atk: 'atk', def: 'def', gp: 'gp' } as const
const TEXTS = { q: 'q', text: 'text', from: 'from', to: 'to', archetype: 'arch', set: 'set' } as const

const rangeToString = (r: Range) =>
  r.min === undefined && r.max === undefined ? '' : r.min === r.max ? String(r.min) : `${r.min ?? ''}-${r.max ?? ''}`

export function parseRange(s: string | null): Range {
  if (!s) return {}
  const m = /^(\d*)(-?)(\d*)$/.exec(s.trim())
  if (!m) return {}
  const num = (x: string) => (x === '' ? undefined : Number(x))
  return m[2] ? { min: num(m[1]), max: num(m[3]) } : { min: num(m[1]), max: num(m[1]) }
}

export function toParams(query: YgoQuery): URLSearchParams {
  const p = new URLSearchParams()
  for (const [field, key] of Object.entries(TEXTS)) {
    const v = query[field as keyof typeof TEXTS]
    if (v) p.set(key, v)
  }
  if (query.fuzzy) p.set('fuzzy', '1')
  for (const [field, key] of Object.entries(LISTS)) {
    const v = query[field as keyof typeof LISTS]
    if (v.length) p.set(key, v.join(','))
  }
  for (const [field, key] of Object.entries(RANGES)) {
    const v = rangeToString(query[field as keyof typeof RANGES])
    if (v) p.set(key, v)
  }
  if (query.ocg) p.set('ocg', '1')
  if (query.related !== undefined) p.set('related', String(query.related))
  if (query.sort !== 'relevance') p.set('sort', query.sort)
  if (query.desc) p.set('desc', '1')
  return p
}

export function fromParams(p: URLSearchParams): YgoQuery {
  const query = emptyQuery()
  for (const [field, key] of Object.entries(TEXTS)) query[field as keyof typeof TEXTS] = p.get(key) ?? ''
  query.fuzzy = p.get('fuzzy') === '1'
  for (const [field, key] of Object.entries(LISTS))
    query[field as keyof typeof LISTS] = (p.get(key) ?? '').split(',').filter(Boolean)
  for (const [field, key] of Object.entries(RANGES)) query[field as keyof typeof RANGES] = parseRange(p.get(key))
  query.ocg = p.get('ocg') === '1'
  const related = Number(p.get('related'))
  if (p.get('related') && Number.isInteger(related)) query.related = related
  const sort = p.get('sort') as SortKey | null
  if (sort && ['relevance', 'date', 'name', 'atk', 'def', 'level', 'gp', 'price'].includes(sort)) query.sort = sort
  query.desc = p.get('desc') === '1'
  return query
}

/** True when any filter other than the name box, sort and fuzzy toggle is set (to badge the Advanced button). */
export function advancedCount(query: YgoQuery): number {
  const e = emptyQuery()
  let n = 0
  for (const k of Object.keys(e) as (keyof YgoQuery)[]) {
    if (k === 'q' || k === 'fuzzy' || k === 'sort' || k === 'desc' || k === 'related') continue
    if (JSON.stringify(query[k]) !== JSON.stringify(e[k])) n++
  }
  return n
}
