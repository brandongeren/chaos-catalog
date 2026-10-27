// Yu-Gi-Oh! prices from TCGCSV (https://tcgcsv.com), a free daily mirror of TCGplayer's catalog and market prices.
//
// TCGCSV's rules (FAQ + its archive notice, 2026-10-26): identify yourself with a clear User-Agent, pause between
// requests (its sample code sleeps 0.25 s), and don't request the same price file more than once in 24 hours. So:
// - requests run one at a time, 250 ms apart;
// - a price day is keyed by TCGCSV's own update date (last-updated.txt; it refreshes around 20:00 UTC), and the
//   caller skips this module entirely when that day is already built;
// - product lists (which card each TCGplayer product is) are cached and only re-fetched for sets whose
//   `modifiedOn` changed.

import type { YgoCard } from '../../src/games/ygo/types.ts'
import { isPlaceholderRarity, printingKey } from '../../src/games/ygo/keys.ts'

const BASE = 'https://tcgcsv.com'
const CATEGORY = 2 // YuGiOh
const PAUSE_MS = 250
export const USER_AGENT = 'chaos-catalog-data-builder/0.1 (+https://github.com/brandongeren/chaos-catalog)'

/** Per TCGplayer group (≈ a set): when it last changed, and its single-card products. */
export interface ProductCache {
  [groupId: string]: {
    name: string
    modifiedOn: string
    products: [productId: number, number: string, rarity: string, name: string][]
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
let lastRequest = 0

async function politeGet(path: string, as: 'json' | 'text' = 'json'): Promise<any> {
  for (let attempt = 1; ; attempt++) {
    const wait = lastRequest + PAUSE_MS - Date.now()
    if (wait > 0) await sleep(wait)
    lastRequest = Date.now()
    const res = await fetch(`${BASE}${path}`, { headers: { 'User-Agent': USER_AGENT } })
    if (res.ok) return as === 'json' ? res.json() : res.text()
    if (attempt >= 3 || (res.status < 500 && res.status !== 429)) throw new Error(`${res.status} for ${BASE}${path}`)
    await sleep(5000 * attempt)
  }
}

/** Date (YYYY-MM-DD, UTC) of TCGCSV's latest daily update. */
export async function tcgcsvDate(): Promise<string> {
  const text: string = await politeGet('/last-updated.txt', 'text')
  const d = new Date(text.trim())
  if (Number.isNaN(d.getTime())) throw new Error(`unexpected last-updated.txt: ${text.slice(0, 80)}`)
  return d.toISOString().slice(0, 10)
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
/**
 * A different look of the same printing, which TCGplayer lists separately under the same set code and rarity:
 * "(Extended Art)" (overframe: the art covers the frame, e.g. MAMO-EN017 Ultra Rare), "(Alternate Art)", "(New Art)".
 * Returned as the label used in the rarity, e.g. "Ultra Rare (Overframe)".
 */
export function variantOf(productName: string): string | undefined {
  const labels = [...productName.matchAll(/\(([^()]+)\)/g)].map((m) => m[1].trim().toLowerCase())
  if (labels.some((l) => l === 'extended art' || l === 'overframe')) return 'Overframe'
  if (labels.some((l) => l === 'alternate art' || l === 'alt art')) return 'Alternate Art'
  if (labels.some((l) => l === 'new art')) return 'New Art'
  return undefined
}

/** The part of a name before its first quote or colon, normalized, if it has two or more words ("layer 19"). */
const titleOf = (s: string) => {
  const m = /^([^":]+)["':]/.exec(s)
  const head = m ? norm(m[1]).trim() : ''
  return m && m[1].trim().split(/\s+/).length >= 2 ? head : ''
}

/** "Dark Magician (New Art) (Quarter Century Secret Rare)" -> "Dark Magician". */
const baseName = (s: string) =>
  s
    .replace(/\s*\((German|French|Italian|Spanish|Portuguese)\)\s*-\s*".*"$/i, '') // `X (German) - "Y"`
    .replace(/(\s*\([^()]*\))+$/, '')

interface ApiProduct {
  productId: number
  name: string
  extendedData?: { name: string; value: string }[]
}
interface ApiPrice {
  productId: number
  marketPrice: number | null
  midPrice: number | null
  subTypeName: string
}

export interface ProductMatch {
  card: YgoCard
  number: string
  rarity: string
  /** False when YGOPRODeck doesn't list this set code + rarity (TCGplayer-only rarity or printing). */
  known: boolean
}

/**
 * Which card each TCGplayer product is. Tries, in order: set code + rarity (case-insensitive) as YGOPRODeck lists it;
 * the set code alone when it belongs to one card (TCGplayer has rarities YGOPRODeck lacks, e.g. Prismatic Collector's
 * Rare, and YGOPRODeck has placeholders like "2" or "New"); the card name when it's unique (set codes YGOPRODeck
 * doesn't have). Misprint listings are skipped: they share a set code and rarity with the real card.
 */
export function matchProducts(cards: YgoCard[], cache: ProductCache) {
  const bySetRarity = new Map<string, Set<YgoCard>>()
  const bySet = new Map<string, Set<YgoCard>>()
  const byName = new Map<string, YgoCard[]>()
  const add = <K>(m: Map<K, Set<YgoCard>>, k: K, c: YgoCard) => (m.get(k) ?? m.set(k, new Set()).get(k)!).add(c)
  const byTitle = new Map<string, YgoCard[]>()
  for (const c of cards) {
    const head = titleOf(c.n)
    if (head) (byTitle.get(head) ?? byTitle.set(head, []).get(head)!).push(c)
  }
  for (const c of cards) {
    ;(byName.get(norm(c.n)) ?? byName.set(norm(c.n), []).get(norm(c.n))!).push(c)
    for (const p of c.p ?? []) {
      add(bySetRarity, `${p.c}|${p.r.toLowerCase()}`, c)
      add(bySet, p.c, c)
    }
  }
  // A variant only counts as its own printing when TCGplayer also lists the plain one (MAMO-EN017 Ultra Rare comes
  // both ways; its Starlight Rare is only sold as "(Extended Art)", so that listing simply is the Starlight Rare).
  const plain = new Set<string>()
  for (const g of Object.values(cache))
    for (const [, number, rarity, name] of g.products)
      if (!variantOf(name) && !/misprint/i.test(name)) plain.add(`${number}|${rarity.toLowerCase()}`)
  const match = new Map<number, ProductMatch>()
  const stats = { exact: 0, bySetCode: 0, byName: 0, byTitle: 0, variants: 0, unmatched: 0, misprints: 0 }
  for (const g of Object.values(cache))
    for (const [productId, number, rarity, name] of g.products) {
      if (/misprint/i.test(name)) {
        stats.misprints++
        continue
      }
      const want = norm(baseName(name))
      const pick = (set?: Set<YgoCard>) => {
        const list = [...(set ?? [])]
        return list.length === 1 ? list[0] : list.find((c) => norm(c.n) === want)
      }
      const variant = plain.has(`${number}|${rarity.toLowerCase()}`) ? variantOf(name) : undefined
      let card = pick(bySetRarity.get(`${number}|${rarity.toLowerCase()}`))
      if (card && variant) {
        // same set code and rarity as the plain printing, but a different card to own and price
        stats.variants++
        match.set(productId, { card, number, rarity: `${rarity} (${variant})`, known: false })
        continue
      }
      if (card) {
        stats.exact++
        match.set(productId, { card, number, rarity: card.p!.find((p) => p.c === number && p.r.toLowerCase() === rarity.toLowerCase())!.r, known: true })
        continue
      }
      card = pick(bySet.get(number))
      if (card) stats.bySetCode++
      else {
        const named = byName.get(want)
        card = named?.length === 1 ? named[0] : undefined
        if (card) stats.byName++
        else {
          // Translated names differ after the title (TCG `Layer 19 "Sudden Incursion! ..."` vs YGOPRODeck
          // `Layer 19: "Preventing the Invasion! ..."`): match on the part before the quote/colon when exactly one card
          // has it and it's at least two words.
          const head = titleOf(baseName(name))
          const byHead = head ? byTitle.get(head) : undefined
          if (byHead?.length === 1) {
            card = byHead[0]
            stats.byTitle++
          }
        }
      }
      if (card) match.set(productId, { card, number, rarity: variant ? `${rarity} (${variant})` : rarity, known: false })
      else stats.unmatched++
    }
  return { match, stats }
}

/** Adds printings TCGplayer has but YGOPRODeck doesn't, so they can be picked when adding a card. */
export function addTcgPrintings(cache: ProductCache, match: Map<number, ProductMatch>) {
  const setName = new Map<number, string>()
  const productName = new Map<number, string>()
  for (const g of Object.values(cache))
    for (const [productId, , , name] of g.products) {
      setName.set(productId, g.name)
      productName.set(productId, baseName(name))
    }
  let added = 0
  for (const [productId, m] of match) {
    if (m.known) continue
    const list = (m.card.p ??= [])
    if (list.some((p) => p.c === m.number && p.r === m.rarity)) continue
    list.push({ c: m.number, r: m.rarity, rc: '', s: setName.get(productId) ?? '', tcg: true })
    added++
    // Keep TCGplayer's English name when it differs (translated names), so searching it finds the card.
    const tcgName = productName.get(productId)
    if (tcgName && norm(tcgName) !== norm(m.card.n) && !(m.card.an ?? []).includes(tcgName)) (m.card.an ??= []).push(tcgName)
  }
  return added
}


/** Drops placeholder rarities where the same set code has real ones (from YGOPRODeck or TCGplayer). */
export function dropPlaceholders(cards: YgoCard[]) {
  let dropped = 0
  for (const c of cards) {
    if (!c.p) continue
    const before = c.p.length
    c.p = c.p.filter((p) => !isPlaceholderRarity(p.r) || !c.p!.some((o) => o !== p && o.c === p.c && !isPlaceholderRarity(o.r)))
    dropped += before - c.p.length
  }
  return dropped
}

/** Fetches the product lists that changed since `previous`, keeping the rest from the cache. */
export async function refreshProducts(previous: ProductCache | undefined) {
  const groups: { groupId: number; name: string; modifiedOn: string }[] = (await politeGet(`/tcgplayer/${CATEGORY}/groups`)).results
  const products: ProductCache = {}
  let requests = 0
  // TCGCSV_MAX_GROUPS=<n> limits a local test run to the first n sets, so testing doesn't use up the day's one
  // request per price file before the real (published) run.
  const max = Number(process.env.TCGCSV_MAX_GROUPS) || Infinity
  for (const g of groups.slice(0, max)) {
    const id = String(g.groupId)
    const cached = previous?.[id]
    if (cached && cached.modifiedOn === g.modifiedOn) {
      products[id] = { ...cached, name: g.name }
      continue
    }
    const list: ApiProduct[] = (await politeGet(`/tcgplayer/${CATEGORY}/${id}/products`)).results
    requests++
    products[id] = {
      name: g.name,
      modifiedOn: g.modifiedOn,
      products: list.flatMap((p) => {
        const ext = (n: string) => p.extendedData?.find((e) => e.name === n)?.value
        const number = ext('Number')
        const rarity = ext('Rarity')
        return number && rarity ? [[p.productId, number, rarity, p.name] as ProductCache[string]['products'][0]] : []
      }),
    }
  }
  return { products, requests, groups: groups.length }
}

/** Market price (else mid) per printing and edition, one price request per set that has matched cards. */
export async function fetchPrices(cache: ProductCache, match: Map<number, ProductMatch>) {
  const printing: Record<string, Record<string, number>> = {}
  let requests = 0
  let collisions = 0
  for (const [id, g] of Object.entries(cache)) {
    if (!g.products.some(([productId]) => match.has(productId))) continue // sealed-only or unmatched set
    const prices: ApiPrice[] = (await politeGet(`/tcgplayer/${CATEGORY}/${id}/prices`)).results
    requests++
    for (const p of prices) {
      const m = match.get(p.productId)
      const value = p.marketPrice ?? p.midPrice
      if (!m || value === null || value <= 0) continue
      const editions = (printing[printingKey(m.card.id, m.number, m.rarity)] ??= {})
      // Alternate-art listings can share a set code + rarity; keep the cheaper (the common version).
      if (p.subTypeName in editions) {
        collisions++
        if (editions[p.subTypeName] <= value) continue
      }
      editions[p.subTypeName] = value
    }
  }
  return { printing, requests, collisions }
}
