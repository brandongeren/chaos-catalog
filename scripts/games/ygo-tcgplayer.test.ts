import { describe, expect, it } from 'vitest'
import type { YgoCard } from '../../src/games/ygo/types.ts'
import { dropPlaceholders, matchProducts, variantOf, type ProductCache } from './ygo-tcgplayer.ts'

const card = (id: number, n: string, p: [string, string][]): YgoCard => ({ id, n, t: '', f: 'effect', d: '', r: '', gp: 0, p: p.map(([c, r]) => ({ c, r, rc: '', s: 'Set' })) })

describe('TCGplayer variants', () => {
  it('reads art variants from product names', () => {
    expect(variantOf('Cyberse Code Magician (Extended Art)')).toBe('Overframe')
    expect(variantOf('Dark Magician (New Art) (Quarter Century Secret Rare)')).toBe('New Art')
    expect(variantOf('Cyberse Code Magician (GMR)')).toBeUndefined()
  })
  it('splits a variant only when the plain version is also listed', () => {
    const ccm = card(64865, 'Cyberse Code Magician', [['MAMO-EN017', 'Ultra Rare'], ['MAMO-EN017', 'Starlight Rare'], ['MAMO-EN017', 'New']])
    const cache: ProductCache = {
      '1': {
        name: 'Magnificent Monsters',
        modifiedOn: '',
        products: [
          [1, 'MAMO-EN017', 'Ultra Rare', 'Cyberse Code Magician'],
          [2, 'MAMO-EN017', 'Ultra Rare', 'Cyberse Code Magician (Extended Art)'],
          [3, 'MAMO-EN017', 'Starlight Rare', 'Cyberse Code Magician (Starlight Rare) (Extended Art)'],
        ],
      },
    }
    const { match } = matchProducts([ccm], cache)
    expect([...match.values()].map((m) => [m.rarity, m.known])).toEqual([
      ['Ultra Rare', true],
      ['Ultra Rare (Overframe)', false],
      ['Starlight Rare', true],
    ])
    expect(dropPlaceholders([ccm])).toBe(1)
    expect(ccm.p!.map((p) => p.r)).toEqual(['Ultra Rare', 'Starlight Rare'])
  })
})
