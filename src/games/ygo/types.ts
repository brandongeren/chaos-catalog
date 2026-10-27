// Shapes of the static Yu-Gi-Oh! data files built daily by scripts/build-data.ts.
// Keys are short because the catalog ships to every device; see DESIGN.md §15 for sizes.

export type BanStatus = 'Banned' | 'Limited' | 'Semi-Limited'

/** One printing of a card: set code + rarity. */
export interface YgoPrinting {
  /** Set code, e.g. "LOB-EN001". */
  c: string
  /** Rarity name, e.g. "Ultra Rare". */
  r: string
  /** Rarity code without parentheses, e.g. "UR". Empty when YGOPRODeck has none. */
  rc: string
  /** Set name, e.g. "Legend of Blue Eyes White Dragon". */
  s: string
  /** True when only TCGplayer lists this printing (not YGOPRODeck), e.g. a Prismatic Collector's Rare. */
  tcg?: true
}

export interface YgoCard {
  /** Passcode (YGOPRODeck id). Card key in the app is `ygo:<id>`. */
  id: number
  /** Other passcodes of this card (alternate artworks). */
  alt?: number[]
  /** Name. */
  n: string
  /** Other names: earlier names of renamed cards (YGOPRODeck beta_name) and TCGplayer's when it differs. */
  an?: string[]
  /** Type line as YGOPRODeck names it, e.g. "Effect Monster", "Spell Card". */
  t: string
  /** Frame type, e.g. "effect", "xyz", "spell", "effect_pendulum". */
  f: string
  /** Card text. */
  d: string
  /** Race: monster type ("Spellcaster") or Spell/Trap subtype ("Quick-Play"). */
  r: string
  /** Typeline tags without the race, e.g. ["Tuner", "Effect"] or ["Xyz", "Pendulum", "Effect"] (monsters only). */
  tl?: string[]
  /** Attribute (monsters only), e.g. "DARK". */
  a?: string
  /** -1 means "?". */
  atk?: number
  /** -1 means "?". */
  def?: number
  /** Level or Rank (YGOPRODeck stores both in `level`; the frame type tells which). */
  lv?: number
  /** Link rating. */
  lk?: number
  /** Link arrows, e.g. ["Top", "Bottom-Left"]. */
  lm?: string[]
  /** Pendulum scale. */
  sc?: number
  /** Archetype. */
  ar?: string
  /** TCG release date (YYYY-MM-DD). Missing = OCG-only. */
  tcg?: string
  /** OCG release date (YYYY-MM-DD). */
  ocg?: string
  /** Genesys points (0 when none). */
  gp: number
  /** Konami database card id (cid), used for Neuron deck links. */
  kid?: number
  /** TCG banlist status; missing = unlimited. */
  ban?: BanStatus
  /** OCG banlist status. */
  bano?: BanStatus
  /** Cards this card's text names (passcodes). */
  m?: number[]
  /** Cards whose text names this card (passcodes). */
  mb?: number[]
  /** Archetypes this card's text names (quoted names that are archetypes, not cards). */
  ma?: string[]
  /** Printings. */
  p?: YgoPrinting[]
}

export interface YgoCatalog {
  dbVersion: string
  dbUpdated: string
  cards: YgoCard[]
}

/** One day of USD TCGplayer market prices (via TCGCSV). `date` is TCGCSV's update date. */
export interface YgoPriceDay {
  date: string
  source: 'tcgcsv'
  /** Cheapest printing/edition, by passcode (falls back to YGOPRODeck's lowest TCGplayer price). */
  card: Record<string, number>
  /** Per printing (key from printingKey(), e.g. "14558127|DUDE-EN003|Ultra Rare"), per edition ("1st Edition", ...). */
  printing: Record<string, Record<string, number>>
}

export interface YgoMeta {
  game: 'ygo'
  dbVersion: string
  dbUpdated: string
  builtAt: string
  cardCount: number
  printingCount: number
  /** Dates (YYYY-MM-DD) with a price file in prices/, newest first; at most 28. */
  priceDays: string[]
}
