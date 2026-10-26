import { describe, expect, it } from 'vitest'
import { emptyQuery } from './query.ts'
import { createSearcher } from './search.ts'
import { parseSyntax, tokenize } from './syntax.ts'
import type { YgoCard } from './types.ts'

const s = createSearcher([
  { id: 1, n: 'Dark Magician', t: '', f: 'normal', d: '', r: 'Spellcaster', gp: 0, ar: 'Dark Magician', tcg: '2002-03-08' } as YgoCard,
  { id: 2, n: 'Sky Striker Ace - Raye', t: '', f: 'effect', d: '', r: 'Warrior', gp: 0, ar: 'Sky Striker', tcg: '2019-02-01' } as YgoCard,
])

describe('syntax', () => {
  it('tokenizes quotes, including after a key', () => {
    expect(tokenize('arch:"sky striker" o:"draw 2" blue eyes')).toEqual(['arch:"sky striker"', 'o:"draw 2"', 'blue', 'eyes'])
  })
  it('maps keywords to filters', () => {
    const { query, errors } = parseSyntax('blue eyes t:xyz,tuner a:dark r:spellcaster atk>=2500 def<1000 lv:4-6 gp>0 o:negate arch:"sky striker" ban:semi year:2024 is:ocg sort:atk', s)
    expect(errors).toEqual([])
    expect(query).toMatchObject({
      q: 'blue eyes',
      frames: ['Xyz'],
      abilities: ['Tuner'],
      attributes: ['DARK'],
      races: ['Spellcaster'],
      atk: { min: 2500 },
      def: { max: 999 },
      level: { min: 4, max: 6 },
      gp: { min: 1 },
      text: 'negate',
      archetype: 'Sky Striker',
      ban: ['Semi-Limited'],
      from: '2024-01-01',
      to: '2024-12-31',
      ocg: true,
      sort: 'atk',
      desc: true,
    })
  })
  it('kinds, spell/trap types, arrows, related, sort direction', () => {
    expect(parseSyntax('t:spell st:quick-play tt:counter arrow:top,bottom-left related:"dark magician" sort:name-', s).query).toMatchObject({
      kinds: ['spell'],
      spellTypes: ['Quick-Play'],
      trapTypes: ['Counter'],
      arrows: ['Top', 'Bottom-Left'],
      related: 1,
      sort: 'name',
      desc: true,
    })
  })
  it('explains mistakes and keeps going', () => {
    const { query, errors } = parseSyntax('a:purple atk>=abc foo:bar t:spel ash', s)
    expect(errors).toHaveLength(4)
    expect(query.q).toBe('ash')
  })
  it('empty input is the empty query', () => {
    expect(parseSyntax('').query).toEqual(emptyQuery())
  })
})
