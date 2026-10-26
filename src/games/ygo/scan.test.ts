import { describe, expect, it } from 'vitest'
import { codeIndex, findCards, setCodeCandidates } from './scan.ts'
import { createSearcher } from './search.ts'
import type { YgoCard } from './types.ts'

const card = (id: number, n: string, p: [string, string][]): YgoCard => ({
  id,
  n,
  t: '',
  f: 'effect',
  d: '',
  r: '',
  gp: 0,
  tcg: '2020-01-01',
  p: p.map(([c, r]) => ({ c, r, rc: '', s: 'Set' })),
})
const s = createSearcher([
  card(14558127, 'Ash Blossom & Joyous Spring', [['DUDE-EN003', 'Ultra Rare'], ['MP22-EN257', 'Prismatic Secret Rare'], ['RA01-EN008', 'Secret Rare'], ['RA01-EN008', 'Ultra Rare']]),
  card(46986414, 'Dark Magician', [['LOB-005', 'Ultra Rare'], ['L5DD-ENC09', 'Common']]),
])
const index = codeIndex(s)
const words = (...texts: string[]) => texts.map((text, i) => ({ text, bbox: { x0: i * 10, y0: 0, x1: i * 10 + 9, y1: 5 } }))

describe('setCodeCandidates', () => {
  it('fixes letter/digit confusions only in the number part', () => {
    expect(setCodeCandidates('DUDE-ENOO3')).toContain('DUDE-EN003')
    expect(setCodeCandidates('MP22-EN2S7')).toContain('MP22-EN257')
    expect(setCodeCandidates('mp22–en257')).toContain('MP22-EN257')
  })
  it('handles a missing dash and short old codes', () => {
    expect(setCodeCandidates('DUDEEN003')).toContain('DUDE-EN003')
    expect(setCodeCandidates('LOB-0O5')).toContain('LOB-005')
    expect(setCodeCandidates('L5DD-ENC09')).toContain('L5DD-ENC09')
  })
  it('ignores ordinary words', () => {
    expect(setCodeCandidates('ATK')).toEqual([])
    expect(setCodeCandidates('Spellcaster')).toEqual([])
  })
})

describe('findCards', () => {
  it('finds every copy, accepts only real codes, joins split tokens, reads passcodes without double counting', () => {
    const found = findCards(words('DUDE-ENOO3', 'noise', 'DUDE-EN003', 'FAKE-EN999', 'RA01-', 'EN008', '46986414', '14558127', '14558127', '14558127', '14558127'), index, s)
    expect(found.map((d) => [d.code, d.card.n, d.rarities.length, d.kind])).toEqual([
      ['DUDE-EN003', 'Ash Blossom & Joyous Spring', 1, 'set-code'],
      ['DUDE-EN003', 'Ash Blossom & Joyous Spring', 1, 'set-code'],
      ['RA01-EN008', 'Ash Blossom & Joyous Spring', 2, 'set-code'],
      ['46986414', 'Dark Magician', 0, 'passcode'],
      ['14558127', 'Ash Blossom & Joyous Spring', 0, 'passcode'],
    ])
  })
})
