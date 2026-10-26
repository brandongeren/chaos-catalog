import type { Stack } from '../../core/collection/model.ts'
import { printingKey } from './keys.ts'
import type { YgoPriceDay } from './types.ts'

/**
 * Market price of one copy: the exact printing and edition when recorded; else that printing's cheapest edition;
 * else the card's cheapest printing. Undefined for custom cards and unpriced cards.
 */
export function stackPrice(day: YgoPriceDay | undefined, s: Pick<Stack, 'card_key' | 'set_code' | 'rarity' | 'edition'>): number | undefined {
  if (!day || !s.card_key) return undefined
  if (s.set_code && s.rarity) {
    const editions = day.printing[printingKey(Number(s.card_key), s.set_code, s.rarity)]
    if (editions) {
      if (s.edition && editions[s.edition] !== undefined) return editions[s.edition]
      const values = Object.values(editions)
      if (values.length) return Math.min(...values)
    }
  }
  return day.card[s.card_key]
}
