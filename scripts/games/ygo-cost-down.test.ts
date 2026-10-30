import { describe, expect, it } from 'vitest'
import type { YgoCard, YgoCatalog } from '../../src/games/ygo/types.ts'
import { costDownFile } from './ygo-cost-down.ts'

const card = (c: Partial<YgoCard> & Pick<YgoCard, 'id' | 'n'>): YgoCard => ({ t: '', f: '', d: '', r: '', gp: 0, ...c })

describe('costDownFile', () => {
  const catalog: YgoCatalog = {
    dbVersion: '1.0',
    dbUpdated: '',
    cards: [card({ id: 14558127, n: 'Ash Blossom & Joyous Spring', kid: 12950, alt: [14558128] }), card({ id: 1, n: 'Unpriced' })],
  }

  it('keeps name, Konami id, alternates and the cheapest price', () => {
    const file = costDownFile(catalog, { date: '2026-10-29', source: 'tcgcsv', card: { 14558127: 4.24 }, printing: {} })
    expect(file).toEqual({
      date: '2026-10-29',
      dbVersion: '1.0',
      cards: [
        { id: 14558127, n: 'Ash Blossom & Joyous Spring', p: 4.24, kid: 12950, alt: [14558128] },
        { id: 1, n: 'Unpriced' },
      ],
    })
  })

  it('works before any price day exists', () => {
    expect(costDownFile(catalog, undefined).date).toBeNull()
  })
})
