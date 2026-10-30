// A small price file for Cost Down (the deck-pricing browser extension, ~/claude/cost-down): every card's name, Konami
// id, alternate passcodes and cheapest TCGplayer market price, from the newest price day. The extension downloads
// it at most once a day instead of the 11.6 MB catalog plus a 2.7 MB price file.

import type { YgoCatalog, YgoPriceDay } from '../../src/games/ygo/types.ts'

export interface CostDownCard {
  /** Passcode. */
  id: number
  /** Name (what TCGplayer Mass Entry is given). */
  n: string
  /** Cheapest market price in USD; absent if unpriced. */
  p?: number
  /** Konami database id (Neuron / db.yugioh-card.com decks use it). */
  kid?: number
  /** Alternate-artwork passcodes. */
  alt?: number[]
}

export interface CostDownFile {
  /** Price day (TCGCSV's update date), or null before the first price build. */
  date: string | null
  dbVersion: string
  cards: CostDownCard[]
}

export function costDownFile(catalog: YgoCatalog, day: YgoPriceDay | undefined): CostDownFile {
  return {
    date: day?.date ?? null,
    dbVersion: catalog.dbVersion,
    cards: catalog.cards.map((c) => {
      const out: CostDownCard = { id: c.id, n: c.n }
      const p = day?.card[c.id]
      if (p !== undefined) out.p = p
      if (c.kid) out.kid = c.kid
      if (c.alt?.length) out.alt = c.alt
      return out
    }),
  }
}
