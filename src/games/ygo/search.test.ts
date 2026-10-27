import { describe, expect, it } from 'vitest'
import { emptyQuery, fromParams, parseRange, toParams, type YgoQuery } from './query.ts'
import { createSearcher, normalize } from './search.ts'
import type { YgoCard } from './types.ts'

const card = (c: Partial<YgoCard> & Pick<YgoCard, 'id' | 'n'>): YgoCard => ({
  t: 'Effect Monster',
  f: 'effect',
  d: '',
  r: 'Spellcaster',
  gp: 0,
  tcg: '2010-01-01',
  ...c,
})

const CARDS: YgoCard[] = [
  card({ id: 46986414, alt: [46986420], n: 'Dark Magician', t: 'Normal Monster', f: 'normal', tl: ['Normal'], a: 'DARK', atk: 2500, def: 2100, lv: 7, ar: 'Dark Magician', tcg: '2002-03-08', p: [{ c: 'LOB-005', r: 'Ultra Rare', rc: 'UR', s: 'Legend of Blue Eyes White Dragon' }] }),
  card({ id: 38033121, n: 'Dark Magician Girl', tl: ['Effect'], a: 'DARK', atk: 2000, def: 1700, lv: 6, ar: 'Dark Magician', d: 'Gains 300 ATK for every "Dark Magician" in the GYs.', m: [46986414], tcg: '2002-06-26' }),
  card({ id: 14558127, n: 'Ash Blossom & Joyous Spring', t: 'Tuner Monster', r: 'Zombie', tl: ['Tuner', 'Effect'], a: 'FIRE', atk: 0, def: 1800, lv: 3, gp: 18, d: 'When a card or effect is activated that includes...', tcg: '2017-05-04', kid: 12950, p: [{ c: 'DUDE-EN003', r: 'Ultra Rare', rc: 'UR', s: 'Duel Devastator' }] }),
  card({ id: 84013237, n: 'Number 39: Utopia', t: 'XYZ Monster', f: 'xyz', r: 'Warrior', tl: ['Xyz', 'Effect'], a: 'LIGHT', atk: 2500, def: 2000, lv: 4, tcg: '2011-07-19' }),
  card({ id: 1861629, n: 'Decode Talker', t: 'Link Monster', f: 'link', r: 'Cyberse', tl: ['Link', 'Effect'], a: 'DARK', atk: 2300, lk: 3, lm: ['Top', 'Bottom-Left', 'Bottom-Right'], tcg: '2017-04-27' }),
  card({ id: 24224830, n: 'Called by the Grave', t: 'Spell Card', f: 'spell', r: 'Quick-Play', gp: 0, ban: 'Limited', tcg: '2018-05-24' }),
  card({ id: 40605147, n: 'Solemn Strike', t: 'Trap Card', f: 'trap', r: 'Counter', tcg: '2016-02-04' }),
  card({ id: 98349765, n: 'Layer 19: "Preventing the Invasion! The Pitch-Black Super Quantum!!"', an: ['Layer 19 "Sudden Incursion! Super Quantum Black!!"'], t: 'Spell Card', f: 'spell', r: 'Normal', tcg: '2005-01-01' }),
  card({ id: 777, n: 'Nervedo the Shadebeast Power Patron', ar: 'Artmage', tcg: '2004-01-01' }),
  card({ id: 778, n: 'Artmage Finmel', ar: 'Artmage', tcg: '2003-01-01' }),
  card({ id: 779, n: 'Cipher Soldier', an: ['Kinetic Soldier'], tcg: '2002-01-01' }),
  card({ id: 99999999, n: 'OCG Only Monster', tl: ['Effect'], a: 'WIND', atk: -1, def: 0, lv: 4, tcg: undefined, ocg: '2026-01-01' }),
]

const s = createSearcher(CARDS)
const q = (over: Partial<YgoQuery>) => ({ ...emptyQuery(), ...over })
const names = (list: YgoCard[]) => list.map((c) => c.n)

describe('normalize', () => {
  it('drops punctuation, case and accents', () => {
    expect(normalize('Ash Blossom & Joyous Spring')).toBe('ash blossom joyous spring')
    expect(normalize('Élite')).toBe('elite')
  })
})

describe('name search', () => {
  it('matches every word, exact name first', () => {
    expect(names(s.search(q({ q: 'dark magician' })))).toEqual(['Dark Magician', 'Dark Magician Girl'])
  })
  it('finds by passcode, Konami id and set code', () => {
    expect(names(s.search(q({ q: '14558127' })))).toEqual(['Ash Blossom & Joyous Spring'])
    expect(names(s.search(q({ q: '12950' })))).toEqual(['Ash Blossom & Joyous Spring'])
    expect(names(s.search(q({ q: 'dude-en003' })))).toEqual(['Ash Blossom & Joyous Spring'])
  })
  it('lists archetype members after name matches, also in fuzzy mode', () => {
    expect(names(s.search(q({ q: 'artmage' })))).toEqual(['Artmage Finmel', 'Nervedo the Shadebeast Power Patron'])
    expect(names(s.search(q({ q: 'artmage', fuzzy: true }))).at(-1)).toBe('Nervedo the Shadebeast Power Patron')
  })
  it('finds renamed cards by their old name', () => {
    expect(names(s.search(q({ q: 'kinetic soldier' })))).toEqual(['Cipher Soldier'])
  })
  it('finds alternate English names', () => {
    expect(names(s.search(q({ q: 'sudden incursion' })))).toEqual(['Layer 19: "Preventing the Invasion! The Pitch-Black Super Quantum!!"'])
    expect(names(s.search(q({ q: 'layer 19' })))).toHaveLength(1)
  })
  it('finds alternate-art passcodes', () => {
    expect(names(s.search(q({ q: '46986420' })))).toEqual(['Dark Magician'])
    expect(s.byId.get(46986420)?.n).toBe('Dark Magician')
  })
  it('fuzzy mode tolerates typos', () => {
    expect(names(s.search(q({ q: 'dark magican', fuzzy: false })))).toEqual([])
    expect(names(s.search(q({ q: 'dark magican', fuzzy: true }))).slice(0, 1)).toEqual(['Dark Magician'])
  })
})

describe('filters', () => {
  it('hides OCG-only cards unless asked', () => {
    expect(names(s.search(q({ q: 'ocg only' })))).toEqual([])
    expect(names(s.search(q({ q: 'ocg only', ocg: true })))).toEqual(['OCG Only Monster'])
  })
  it('kind, frame and ability', () => {
    expect(names(s.search(q({ kinds: ['trap'] })))).toEqual(['Solemn Strike'])
    expect(names(s.search(q({ frames: ['Xyz', 'Link'] })))).toEqual(['Decode Talker', 'Number 39: Utopia'])
    expect(names(s.search(q({ abilities: ['Tuner'] })))).toEqual(['Ash Blossom & Joyous Spring'])
  })
  it('spell/trap subtypes narrow their own kind', () => {
    expect(names(s.search(q({ spellTypes: ['Quick-Play'] })))).toEqual(['Called by the Grave'])
    expect(names(s.search(q({ spellTypes: ['Quick-Play'], kinds: ['trap'] })))).toEqual(['Called by the Grave', 'Solemn Strike'])
  })
  it('level vs rank vs link', () => {
    expect(names(s.search(q({ level: { min: 4, max: 4 } })))).toEqual([])
    expect(names(s.search(q({ rank: { min: 4, max: 4 } })))).toEqual(['Number 39: Utopia'])
    expect(names(s.search(q({ link: { min: 3 } })))).toEqual(['Decode Talker'])
  })
  it('ATK ignores "?" and DEF ignores Link monsters', () => {
    expect(names(s.search(q({ atk: { min: 2500 }, sort: 'name' })))).toEqual(['Dark Magician', 'Number 39: Utopia'])
    expect(names(s.search(q({ def: { max: 0 }, ocg: true })))).toEqual(['OCG Only Monster'])
  })
  it('attribute, monster type, arrows, archetype, banlist, Genesys points, set, text', () => {
    expect(names(s.search(q({ attributes: ['FIRE'] })))).toEqual(['Ash Blossom & Joyous Spring'])
    expect(names(s.search(q({ races: ['Cyberse'] })))).toEqual(['Decode Talker'])
    expect(names(s.search(q({ arrows: ['Top', 'Bottom-Left'] })))).toEqual(['Decode Talker'])
    expect(names(s.search(q({ archetype: 'Dark Magician', sort: 'name' })))).toEqual(['Dark Magician', 'Dark Magician Girl'])
    expect(names(s.search(q({ ban: ['Limited'] })))).toEqual(['Called by the Grave'])
    expect(names(s.search(q({ gp: { min: 1 } })))).toEqual(['Ash Blossom & Joyous Spring'])
    expect(names(s.search(q({ set: 'LOB' })))).toEqual(['Dark Magician'])
    expect(names(s.search(q({ text: 'activated that' })))).toEqual(['Ash Blossom & Joyous Spring'])
  })
  it('release date window', () => {
    expect(names(s.search(q({ from: '2017-01-01', to: '2017-12-31', sort: 'name' })))).toEqual(['Ash Blossom & Joyous Spring', 'Decode Talker'])
  })
})

describe('collection filter', () => {
  it('only my cards; OCG-only cards show when owned', () => {
    const owned = new Set([14558127, 99999999])
    expect(names(s.search(q({ mine: true, sort: 'name' }), undefined, owned))).toEqual(['Ash Blossom & Joyous Spring', 'OCG Only Monster'])
  })
})

describe('related cards and sorting', () => {
  it('related = same archetype plus mentions both ways', () => {
    expect(names(s.related(46986414))).toEqual(['Dark Magician Girl'])
    expect(names(s.related(38033121))).toEqual(['Dark Magician'])
  })
  it('sorts newest first by default, missing values last', () => {
    expect(names(s.search(q({}))).slice(0, 2)).toEqual(['Called by the Grave', 'Ash Blossom & Joyous Spring'])
    const byAtk = names(s.search(q({ sort: 'atk', desc: true, ocg: true })))
    expect(byAtk.slice(0, 2)).toEqual(['Dark Magician', 'Number 39: Utopia'])
    expect(byAtk.at(-1)).toBe('Solemn Strike')
  })
  it('sorts by price when given prices', () => {
    const price = (id: number) => ({ 14558127: 0.5, 24224830: 2 })[id]
    expect(names(s.search(q({ sort: 'price', desc: true }), price)).slice(0, 2)).toEqual(['Called by the Grave', 'Ash Blossom & Joyous Spring'])
  })
})

describe('query URL form', () => {
  it('round-trips', () => {
    const query = q({ q: 'ash', fuzzy: true, kinds: ['monster'], atk: { min: 2000 }, level: { min: 4, max: 4 }, related: 46986414, sort: 'atk', desc: true })
    expect(fromParams(toParams(query))).toEqual(fromParams(new URLSearchParams(toParams(query).toString())))
    expect(fromParams(toParams(query))).toMatchObject({ q: 'ash', fuzzy: true, kinds: ['monster'], atk: { min: 2000 }, level: { min: 4, max: 4 }, related: 46986414, sort: 'atk', desc: true })
    expect(toParams(emptyQuery()).toString()).toBe('')
  })
  it('parses ranges', () => {
    expect(parseRange('2500-')).toEqual({ min: 2500, max: undefined })
    expect(parseRange('-1000')).toEqual({ min: undefined, max: 1000 })
    expect(parseRange('4')).toEqual({ min: 4, max: 4 })
    expect(parseRange('x')).toEqual({})
  })
})
