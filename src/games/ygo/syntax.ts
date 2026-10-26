// Scryfall-style search syntax for Yu-Gi-Oh!: `t:link a:dark atk>=2500 arch:"sky striker" o:negate`.
// Parses into the same YgoQuery the filter panel uses, so both always agree. The guide is SYNTAX_GUIDE below.

import { ABILITIES, ARROWS, ATTRIBUTES, FRAMES, KINDS, SPELL_TYPES, TRAP_TYPES } from './classify.ts'
import { emptyQuery, type Range, type SortKey, type YgoQuery } from './query.ts'
import { normalize, type Searcher } from './search.ts'

export interface SyntaxResult {
  query: YgoQuery
  errors: string[]
}

/** Splits into tokens, keeping "quoted text" (also after key:) together. */
export function tokenize(input: string): string[] {
  return [...input.matchAll(/(?:[^\s"]+:)?"[^"]*"?|[^\s"]+/g)].map((m) => m[0])
}

const unquote = (s: string) => s.replace(/^"|"$/g, '')
const lower = (s: string) => s.toLowerCase()
const findIn = (list: readonly string[], v: string) => list.find((x) => normalize(x) === normalize(v))

const RANGE_KEYS: Record<string, keyof Pick<YgoQuery, 'level' | 'rank' | 'link' | 'scale' | 'atk' | 'def' | 'gp'>> = {
  lv: 'level',
  level: 'level',
  rank: 'rank',
  rk: 'rank',
  link: 'link',
  lk: 'link',
  sc: 'scale',
  scale: 'scale',
  atk: 'atk',
  def: 'def',
  gp: 'gp',
  genesys: 'gp',
}

const SORTS: Record<string, SortKey> = {
  name: 'name',
  date: 'date',
  released: 'date',
  atk: 'atk',
  def: 'def',
  level: 'level',
  lv: 'level',
  gp: 'gp',
  price: 'price',
}

function applyRange(r: Range, op: string, raw: string): Range | string {
  const range = /^(\d+)-(\d+)$/.exec(raw)
  if (range && (op === ':' || op === '=')) return { min: Number(range[1]), max: Number(range[2]) }
  if (!/^\d+$/.test(raw)) return `"${raw}" isn't a number`
  const n = Number(raw)
  switch (op) {
    case ':':
    case '=':
      return { min: n, max: n }
    case '>=':
      return { ...r, min: n }
    case '>':
      return { ...r, min: n + 1 }
    case '<=':
      return { ...r, max: n }
    case '<':
      return { ...r, max: n - 1 }
    default:
      return `unknown comparison ${op}`
  }
}

export function parseSyntax(input: string, searcher?: Searcher): SyntaxResult {
  const q = emptyQuery()
  const errors: string[] = []
  const words: string[] = []
  const add = <K extends 'kinds' | 'frames' | 'abilities' | 'spellTypes' | 'trapTypes' | 'attributes' | 'races' | 'arrows' | 'ban'>(k: K, v: string) => {
    if (!q[k].includes(v)) q[k].push(v)
  }

  for (const token of tokenize(input)) {
    const m = /^([a-z]+)(>=|<=|!=|:|=|>|<)(.*)$/i.exec(token)
    if (!m) {
      words.push(unquote(token))
      continue
    }
    const key = lower(m[1])
    const op = m[2]
    const value = unquote(m[3])
    if (!value) {
      errors.push(`${key}${op} needs a value`)
      continue
    }
    if (key in RANGE_KEYS) {
      const field = RANGE_KEYS[key]
      const r = applyRange(q[field], op, value)
      if (typeof r === 'string') errors.push(`${key}: ${r}`)
      else q[field] = r
      continue
    }
    switch (key) {
      case 't':
      case 'type': {
        for (const v of value.split(',')) {
          const kind = KINDS.find((k) => k === lower(v))
          const frame = findIn(FRAMES, v)
          const ability = findIn(ABILITIES, v)
          if (kind) add('kinds', kind)
          else if (frame) add('frames', frame)
          else if (ability) add('abilities', ability)
          else errors.push(`t:${v} isn't a card type (try monster, spell, trap, effect, xyz, link, tuner…)`)
        }
        break
      }
      case 'st':
      case 'spell': {
        const v = findIn(SPELL_TYPES, value)
        if (v) add('spellTypes', v)
        else errors.push(`st:${value}: spell types are ${SPELL_TYPES.join(', ')}`)
        break
      }
      case 'tt':
      case 'trap': {
        const v = findIn(TRAP_TYPES, value)
        if (v) add('trapTypes', v)
        else errors.push(`tt:${value}: trap types are ${TRAP_TYPES.join(', ')}`)
        break
      }
      case 'a':
      case 'attr':
      case 'attribute': {
        const v = findIn(ATTRIBUTES, value)
        if (v) add('attributes', v)
        else errors.push(`a:${value}: attributes are ${ATTRIBUTES.join(', ').toLowerCase()}`)
        break
      }
      case 'r':
      case 'race':
      case 'mt': {
        const v = searcher ? findIn(searcher.races, value) : value
        if (v) add('races', v)
        else errors.push(`r:${value} isn't a monster type`)
        break
      }
      case 'o':
      case 'text':
      case 'oracle':
        q.text = q.text ? `${q.text} ${value}` : value
        break
      case 'arch':
      case 'archetype': {
        const v = searcher ? findIn(searcher.archetypes, value) : value
        if (v) q.archetype = v
        else errors.push(`arch:${value} isn't an archetype`)
        break
      }
      case 'set':
      case 's':
        q.set = value
        break
      case 'ban':
      case 'banlist': {
        const map: Record<string, string> = { banned: 'Banned', forbidden: 'Banned', limited: 'Limited', semi: 'Semi-Limited', 'semi-limited': 'Semi-Limited', unlimited: 'Unlimited' }
        const v = map[lower(value)]
        if (v) add('ban', v)
        else errors.push(`ban:${value}: use banned, limited, semi or unlimited`)
        break
      }
      case 'arrow':
      case 'arrows':
        for (const v of value.split(',')) {
          const a = findIn(ARROWS, v)
          if (a) add('arrows', a)
          else errors.push(`arrow:${v}: arrows are ${ARROWS.join(', ').toLowerCase()}`)
        }
        break
      case 'date':
      case 'released':
      case 'year': {
        const isYear = /^\d{4}$/.test(value)
        if (!isYear && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          errors.push(`${key}: use a year (2020) or a date (2020-05-31)`)
          break
        }
        const start = isYear ? `${value}-01-01` : value
        const end = isYear ? `${value}-12-31` : value
        if (op === ':' || op === '=') {
          q.from = start
          q.to = end
        } else if (op === '>=') q.from = start
        else if (op === '>') q.from = isYear ? `${Number(value) + 1}-01-01` : value
        else if (op === '<=') q.to = end
        else if (op === '<') q.to = isYear ? `${Number(value) - 1}-12-31` : value
        break
      }
      case 'is':
      case 'in':
        if (['ocg'].includes(lower(value))) q.ocg = true
        else if (['mine', 'collection', 'owned'].includes(lower(value))) q.mine = true
        else errors.push(`${key}:${value}: try is:ocg or is:mine`)
        break
      case 'related':
      case 'rel': {
        const card = searcher?.cards.find((c) => normalize(c.n) === normalize(value)) ?? searcher?.byId.get(Number(value))
        if (card) q.related = card.id
        else errors.push(`related:${value}: no card with that name`)
        break
      }
      case 'sort':
      case 'order': {
        const desc = value.endsWith('-')
        const s = SORTS[lower(value.replace(/[-+]$/, ''))]
        if (s) {
          q.sort = s
          // numbers default to high-to-low; "-" flips name/date to Z-A / oldest first
          q.desc = s === 'name' || s === 'date' ? desc : !value.endsWith('+')
        } else errors.push(`sort:${value}: try name, date, atk, def, level, gp, price`)
        break
      }
      default:
        errors.push(`unknown keyword ${key}${op} (see the syntax guide)`)
    }
  }
  q.q = words.join(' ')
  return { query: q, errors }
}

export const SYNTAX_GUIDE: { keys: string; meaning: string; examples: string[] }[] = [
  { keys: 'words, "quoted words"', meaning: 'Name contains all of these', examples: ['blue eyes', '"dark magician girl"'] },
  { keys: 't: type:', meaning: 'Card kind (monster, spell, trap, skill, token), monster class (normal, effect, ritual, fusion, synchro, xyz, pendulum, link) or ability (tuner, flip, gemini, union, spirit, toon). Commas mean "any of".', examples: ['t:spell', 't:xyz,link', 't:tuner'] },
  { keys: 'st: tt:', meaning: 'Spell type / Trap type', examples: ['st:quick-play', 'tt:counter'] },
  { keys: 'a: attr:', meaning: 'Attribute', examples: ['a:dark'] },
  { keys: 'r: race:', meaning: 'Monster type', examples: ['r:spellcaster', 'r:"winged beast"'] },
  { keys: 'lv: rank: link: sc:', meaning: 'Level, Rank, Link rating, Pendulum scale; use = > >= < <= or a range', examples: ['lv:4', 'rank>=8', 'link:2-3', 'sc<=3'] },
  { keys: 'atk: def:', meaning: 'ATK / DEF ("?" never matches a number)', examples: ['atk>=2500', 'def:0', 'atk:1500-2000'] },
  { keys: 'gp:', meaning: 'Genesys points', examples: ['gp>0', 'gp>=20'] },
  { keys: 'o: text:', meaning: 'Card text contains', examples: ['o:negate', 'o:"draw 2"'] },
  { keys: 'arch:', meaning: 'Archetype', examples: ['arch:"sky striker"'] },
  { keys: 'set:', meaning: 'Set code prefix or set name', examples: ['set:LOB', 'set:"rarity collection"'] },
  { keys: 'ban:', meaning: 'TCG banlist status: banned, limited, semi, unlimited', examples: ['ban:limited'] },
  { keys: 'arrow:', meaning: 'Has all of these Link arrows', examples: ['arrow:top,bottom-left'] },
  { keys: 'year: date:', meaning: 'TCG release date (a year or YYYY-MM-DD)', examples: ['year:2024', 'date>=2025-01-01'] },
  { keys: 'is:ocg  is:mine', meaning: 'Include OCG-only cards / only cards in the collection you are viewing', examples: ['is:ocg', 'is:mine t:link'] },
  { keys: 'related:', meaning: 'Same archetype or mentions either way', examples: ['related:"dark magician"'] },
  { keys: 'sort:', meaning: 'Order by name, date, atk, def, level, gp, price; add - to reverse names/dates, + for low-to-high numbers', examples: ['sort:atk', 'sort:price+', 'sort:date-'] },
]
