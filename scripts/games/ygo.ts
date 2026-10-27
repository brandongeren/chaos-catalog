// Yu-Gi-Oh! data builder: YGOPRODeck API -> catalog.json and meta.json; TCGCSV (TCGplayer) -> prices/<date>.json.
//
// YGOPRODeck: three requests per run (checkDBVer; cardinfo with format=genesys, which returns every card plus
// genesys_points; cardsets for set release dates; DESIGN.md §15). Its API guide asks for a local copy of the data and at most 20 requests/second.
// Prices come from TCGCSV instead of YGOPRODeck's set_price, which is zero for most printings and often stale.

import type { BanStatus, YgoCard, YgoCatalog, YgoMeta, YgoPriceDay, YgoPrinting } from '../../src/games/ygo/types.ts'
import {
  addTcgPrintings,
  fetchPrices,
  matchProducts,
  refreshProducts,
  tcgcsvDate,
  USER_AGENT,
  type ProductCache,
} from './ygo-tcgplayer.ts'

const API = 'https://db.ygoprodeck.com/api/v7'
const PRICE_DAYS = 28

interface ApiCard {
  id: number
  name: string
  type: string
  frameType: string
  desc: string
  race: string
  typeline?: string[]
  attribute?: string
  atk?: number
  def?: number
  level?: number
  linkval?: number
  linkmarkers?: string[]
  scale?: number
  archetype?: string
  card_sets?: { set_name: string; set_code: string; set_rarity: string; set_rarity_code?: string; set_price?: string }[]
  card_images?: { id: number }[]
  card_prices?: { tcgplayer_price?: string }[]
  banlist_info?: { ban_tcg?: BanStatus; ban_ocg?: BanStatus }
  misc_info?: { tcg_date?: string; ocg_date?: string; konami_id?: number; genesys_points?: number }[]
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
  return (await res.json()) as T
}

/** Fetch JSON that may not exist yet (first run, or a day the job didn't run). */
async function getJsonOr<T>(url: string): Promise<T | undefined> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
    return res.ok ? ((await res.json()) as T) : undefined
  } catch {
    return undefined
  }
}

const price = (s?: string): number | undefined => {
  const v = s === undefined ? NaN : Number.parseFloat(s)
  return Number.isFinite(v) && v > 0 ? v : undefined
}

const ENTITIES: Record<string, string> = { amp: '&', apos: "'", quot: '"', lt: '<', gt: '>' }
const decodeEntities = (s: string) =>
  s.replace(/&(#\d+|[a-z]+);/gi, (m, e: string) =>
    e[0] === '#' ? String.fromCodePoint(Number(e.slice(1))) : (ENTITIES[e.toLowerCase()] ?? m),
  )

function toCard(c: ApiCard): YgoCard {
  const misc = c.misc_info?.[0] ?? {}
  const card: YgoCard = { id: c.id, n: c.name, t: c.type, f: c.frameType, d: c.desc, r: c.race, gp: misc.genesys_points ?? 0 }
  // Alternate artworks have their own passcodes (decklists use them); YGOPRODeck's bulk list sometimes puts an
  // alternate first (Dark Magician comes back as 46986420, not 46986414), so every one must resolve to the card.
  const alt = (c.card_images ?? []).map((i) => i.id).filter((id) => id !== c.id)
  if (alt.length) card.alt = alt
  const tags = c.typeline?.filter((x) => x !== c.race)
  if (tags?.length) card.tl = tags
  if (c.attribute) card.a = c.attribute
  if (c.atk !== undefined && c.atk !== null) card.atk = c.atk
  if (c.def !== undefined && c.def !== null) card.def = c.def
  if (c.level !== undefined && c.level !== null) card.lv = c.level
  if (c.linkval !== undefined) card.lk = c.linkval
  if (c.linkmarkers) card.lm = c.linkmarkers
  if (c.scale !== undefined) card.sc = c.scale
  if (c.archetype) card.ar = c.archetype
  if (misc.tcg_date) card.tcg = misc.tcg_date
  if (misc.ocg_date) card.ocg = misc.ocg_date
  if (misc.konami_id) card.kid = misc.konami_id
  if (c.banlist_info?.ban_tcg) card.ban = c.banlist_info.ban_tcg
  if (c.banlist_info?.ban_ocg) card.bano = c.banlist_info.ban_ocg
  const sets: YgoPrinting[] = (c.card_sets ?? []).map((s) => ({
    c: s.set_code,
    r: s.set_rarity,
    rc: (s.set_rarity_code ?? '').replace(/[()]/g, ''),
    s: decodeEntities(s.set_name),
  }))
  if (sets.length) card.p = sets
  return card
}

/**
 * Card text names other cards in double quotes ("Dark Magician"). A quoted string that is a card name links the two
 * cards both ways; one that is an archetype name links the card to the archetype. Anything else is ignored (it's
 * usually a fragment between two quoted names).
 */
function addMentions(cards: YgoCard[]) {
  const byName = new Map(cards.map((c) => [c.n, c]))
  const archetypes = new Set(cards.flatMap((c) => (c.ar ? [c.ar] : [])))
  for (const c of cards) {
    const quoted = new Set(Array.from(c.d.matchAll(/"([^"]+)"/g), (m) => m[1].trim()))
    for (const q of quoted) {
      const target = byName.get(q)
      if (target && target !== c) {
        ;(c.m ??= []).push(target.id)
        ;(target.mb ??= []).push(c.id)
      } else if (!target && archetypes.has(q)) {
        ;(c.ma ??= []).push(q)
      }
    }
  }
}

/** Card-level price: the cheapest printing/edition on TCGplayer, else YGOPRODeck's lowest TCGplayer price. */
function cardPrices(raw: ApiCard[], printing: YgoPriceDay['printing']): Record<string, number> {
  const card: Record<string, number> = {}
  for (const [key, editions] of Object.entries(printing)) {
    const id = key.slice(0, key.indexOf('|'))
    const low = Math.min(...Object.values(editions))
    if (!(id in card) || low < card[id]) card[id] = low
  }
  for (const c of raw) {
    const p = price(c.card_prices?.[0]?.tcgplayer_price)
    if (!(c.id in card) && p !== undefined) card[c.id] = p
  }
  return card
}

export interface YgoBuildResult {
  meta: YgoMeta
  catalog: YgoCatalog
  /** Price files to write, by date (today plus the previous days kept). */
  prices: Map<string, YgoPriceDay>
  /** TCGplayer product cache to publish (read back by the next run). */
  products: ProductCache
}

/**
 * @param previousBase URL or undefined. Where the last published data lives (`<site>/data/ygo`), so the price files
 *   from earlier days can be carried forward without committing them to git.
 * @param readLocal reads an already-built file from the output folder (for local runs); returns undefined if absent.
 */
export async function buildYgo(
  previousBase: string | undefined,
  readLocal: (relPath: string) => Promise<unknown | undefined>,
): Promise<YgoBuildResult> {
  const [ver] = await getJson<{ database_version: string; last_update: string }[]>(`${API}/checkDBVer.php`)
  const { data } = await getJson<{ data: ApiCard[] }>(`${API}/cardinfo.php?format=genesys&misc=yes`)
  if (!data?.length) throw new Error('cardinfo returned no cards')

  const cards = data.map(toCard).sort((a, b) => a.n.localeCompare(b.n))
  addMentions(cards)

  const prevMeta =
    (previousBase ? await getJsonOr<YgoMeta>(`${previousBase}/meta.json`) : undefined) ??
    ((await readLocal('meta.json')) as YgoMeta | undefined)
  const loadDay = async (d: string) =>
    (previousBase ? await getJsonOr<YgoPriceDay>(`${previousBase}/prices/${d}.json`) : undefined) ??
    ((await readLocal(`prices/${d}.json`)) as YgoPriceDay | undefined)

  // Today's prices: TCGCSV's latest update, fetched only if that day isn't built yet (its once-a-day rule), and
  // never when TCGCSV_FETCH=false (code pushes: they redeploy with the published prices instead).
  // The product cache (which TCGplayer product is which printing) is always applied, so TCGplayer-only printings
  // stay in the catalog on days when prices are reused.
  const mayFetch = process.env.TCGCSV_FETCH !== 'false'
  const priceDate = mayFetch ? await tcgcsvDate() : undefined
  const prices = new Map<string, YgoPriceDay>()
  let products =
    (previousBase ? await getJsonOr<ProductCache>(`${previousBase}/tcgplayer-products.json`) : undefined) ??
    ((await readLocal('tcgplayer-products.json')) as ProductCache | undefined) ??
    {}
  const built = priceDate && prevMeta?.priceDays.includes(priceDate) ? await loadDay(priceDate) : undefined
  const fetchToday = mayFetch && !built
  if (!mayFetch) console.log('ygo: TCGCSV_FETCH=false; reusing published prices')
  else if (built) console.log(`ygo: prices for ${priceDate} already built; not re-fetching TCGCSV`)
  else {
    const refreshed = await refreshProducts(products)
    products = refreshed.products
    console.log(`ygo: TCGCSV ${priceDate}: ${refreshed.groups} sets, ${refreshed.requests} product list(s) fetched`)
  }
  const { match, stats } = matchProducts(cards, products)
  console.log(`ygo: TCGplayer products matched: ${JSON.stringify(stats)}`)
  if (fetchToday) {
    const { printing, requests, collisions } = await fetchPrices(products, match)
    prices.set(priceDate!, { date: priceDate!, source: 'tcgcsv', card: cardPrices(data, printing), printing })
    console.log(`ygo: ${Object.keys(printing).length} printings priced from ${requests} price file(s); ${collisions} duplicate listing(s)`)
  }
  console.log(`ygo: ${addTcgPrintings(products, match)} TCGplayer-only printing(s) added to the catalog`)

  // Some cards are out in the TCG but YGOPRODeck has neither their TCG date nor their English printing (e.g.
  // "Artmage Pact -Awakening-", printed as DUAD-EN075, which only TCGplayer lists). Without a date they'd be hidden
  // as OCG-only, so take the earliest release date of the sets their printings come from.
  const sets = await getJson<{ set_code: string; tcg_date?: string }[]>(`${API}/cardsets.php`)
  const setDate = new Map(sets.filter((s) => s.tcg_date).map((s) => [s.set_code, s.tcg_date!]))
  let dated = 0
  for (const c of cards) {
    if (c.tcg || !c.p?.length) continue
    // Only TCG printings count: OCG-region codes (Japanese, Asian-English, Korean, Chinese) don't make a card TCG.
    const dates = c.p
      .filter((p) => !/-(JP|JA|AE|KR|TC|SC)\d/i.test(p.c))
      .map((p) => setDate.get(p.c.split('-')[0]))
      .filter((d): d is string => !!d)
      .sort()
    if (dates.length) {
      c.tcg = dates[0]
      dated++
    }
  }
  console.log(`ygo: ${dated} card(s) without a YGOPRODeck TCG date dated from their printings' sets`)

  // Carry forward earlier days: from the published site first, else from a previous local build.
  for (const d of prevMeta?.priceDays ?? []) {
    if (prices.size >= PRICE_DAYS) break
    if (prices.has(d)) continue
    const day = await loadDay(d)
    if (day?.source === 'tcgcsv') prices.set(d, day) // older YGOPRODeck-based files have another shape
  }

  const priceDays = [...prices.keys()].sort().reverse().slice(0, PRICE_DAYS)
  const meta: YgoMeta = {
    game: 'ygo',
    dbVersion: ver.database_version,
    dbUpdated: ver.last_update,
    builtAt: new Date().toISOString(),
    cardCount: cards.length,
    printingCount: cards.reduce((n, c) => n + (c.p?.length ?? 0), 0),
    priceDays,
  }
  return {
    meta,
    catalog: { dbVersion: ver.database_version, dbUpdated: ver.last_update, cards },
    prices: new Map(priceDays.map((d) => [d, prices.get(d)!])),
    products,
  }
}
