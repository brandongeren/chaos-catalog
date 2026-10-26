import { describe, expect, it, vi } from 'vitest'

vi.mock('idb-keyval', () => ({ get: async () => undefined, set: async () => {}, del: async () => {}, keys: async () => [] }))
const { dayBefore } = await import('./data.ts')
const { stackPrice } = await import('./prices.ts')

const day = {
  date: '2026-10-26',
  source: 'tcgcsv' as const,
  card: { '14558127': 0.5 },
  printing: { '14558127|DUDE-EN003|Ultra Rare': { '1st Edition': 4.24, Unlimited: 3.1 } },
}

describe('prices', () => {
  it('uses the exact edition, else the printing, else the card', () => {
    const s = { card_key: '14558127', set_code: 'DUDE-EN003', rarity: 'Ultra Rare', edition: '1st Edition' }
    expect(stackPrice(day, s)).toBe(4.24)
    expect(stackPrice(day, { ...s, edition: 'Limited' })).toBe(3.1)
    expect(stackPrice(day, { ...s, set_code: null })).toBe(0.5)
    expect(stackPrice(day, { ...s, card_key: '1' })).toBeUndefined()
  })
  it('finds the newest day at least N days back', () => {
    const days = ['2026-10-26', '2026-10-25', '2026-10-19', '2026-10-17']
    expect(dayBefore(days, '2026-10-26', 7)).toBe('2026-10-19')
    expect(dayBefore(days, '2026-10-26', 8)).toBe('2026-10-17')
    expect(dayBefore(days, '2026-10-26', 14)).toBeUndefined()
  })
})
