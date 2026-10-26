// Decklist formats: read .ydk, ydke://, YGO Omega codes, plain text, and the deck pages of YGOPRODeck and Konami's
// database (Neuron links redirect there); write .ydk, ydke:// and text. Formats verified 2026-10-26 (DESIGN.md §16).
// Pure functions (no network), so they're unit-tested; page HTML is fetched by the fetch-deck Edge Function.

import { normalize, type Searcher } from './search.ts'
import type { YgoCard } from './types.ts'

export type DeckSection = 'main' | 'extra' | 'side'
export const SECTIONS: DeckSection[] = ['main', 'extra', 'side']

/** A decklist as passcodes, one entry per copy (the way .ydk and ydke store it). */
export interface RawDeck {
  main: number[]
  extra: number[]
  side: number[]
  /** Lines of a text list that couldn't be matched to a card. */
  unknown?: string[]
  name?: string
}

export interface DeckLine {
  card: YgoCard
  qty: number
}

export interface Deck {
  name?: string
  main: DeckLine[]
  extra: DeckLine[]
  side: DeckLine[]
  /** Passcodes or text lines we couldn't match. */
  unknown: string[]
}

export type DeckFormat = 'ydk' | 'ydke' | 'omega' | 'text' | 'ygoprodeck' | 'konami'

const isExtraDeckCard = (c: YgoCard) => /^(fusion|synchro|xyz|link)/.test(c.f)

// ------------------------------------------------------------------ detection

export function detectFormat(input: string): DeckFormat {
  const s = input.trim()
  if (/^ydke:\/\//i.test(s)) return 'ydke'
  if (/^https?:\/\/(www\.)?ygoprodeck\.com\/deck\//i.test(s)) return 'ygoprodeck'
  if (/^https?:\/\/(neuron\.konami\.net\/link\/|www\.db\.yugioh-card\.com\/yugiohdb\/member_deck\.action)/i.test(s)) return 'konami'
  if (/^\s*(#created|#main|#extra|!side)/im.test(s) && /^\d{3,9}\s*$/m.test(s)) return 'ydk'
  if (/^[A-Za-z0-9+/=_-]{16,}$/.test(s)) return 'omega'
  return 'text'
}

// ------------------------------------------------------------------ readers

export function parseYdk(text: string): RawDeck {
  const deck: RawDeck = { main: [], extra: [], side: [] }
  let section: DeckSection = 'main'
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (/^#main/i.test(line)) section = 'main'
    else if (/^#extra/i.test(line)) section = 'extra'
    else if (/^!side/i.test(line)) section = 'side'
    else if (/^\d+$/.test(line)) deck[section].push(Number(line))
  }
  return deck
}

const fromBase64 = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0))
}
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))

const readUint32s = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return Array.from({ length: Math.floor(bytes.length / 4) }, (_, i) => view.getUint32(i * 4, true))
}
const writeUint32s = (ids: number[]) => {
  const out = new Uint8Array(ids.length * 4)
  const view = new DataView(out.buffer)
  ids.forEach((id, i) => view.setUint32(i * 4, id, true))
  return out
}

/** ydke://<main>!<extra>!<side>! each base64 of little-endian uint32 passcodes (EDOPro, YGOPRODeck, Duelingbook). */
export function parseYdke(url: string): RawDeck {
  const parts = url.trim().replace(/^ydke:\/\//i, '').split('!')
  if (parts.length < 3) throw new Error('That ydke:// link is incomplete')
  const [main, extra, side] = parts.map((p) => (p ? readUint32s(fromBase64(p)) : []))
  return { main, extra, side }
}

export const toYdke = (d: RawDeck) =>
  `ydke://${[d.main, d.extra, d.side].map((ids) => (ids.length ? toBase64(writeUint32s(ids)) : '')).join('!')}!`

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes.slice().buffer as ArrayBuffer]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * YGO Omega deck code: base64 of raw-deflated bytes: [main+extra count][side count] then little-endian uint32
 * passcodes (main and extra together, then side). Main vs Extra is decided by card type.
 */
export async function parseOmega(code: string, byId: Map<number, YgoCard>): Promise<RawDeck> {
  let bytes: Uint8Array
  try {
    bytes = await inflateRaw(fromBase64(code.trim()))
  } catch {
    throw new Error("That doesn't look like a YGO Omega deck code")
  }
  const mainExtra = bytes[0]
  const side = bytes[1]
  const ids = readUint32s(bytes.subarray(2))
  if (ids.length < mainExtra + side) throw new Error('That YGO Omega deck code is incomplete')
  const deck: RawDeck = { main: [], extra: [], side: ids.slice(mainExtra, mainExtra + side) }
  for (const id of ids.slice(0, mainExtra)) {
    const c = byId.get(id)
    ;(c && isExtraDeckCard(c) ? deck.extra : deck.main).push(id)
  }
  return deck
}

/** Plain text: "3 Ash Blossom", "3x Ash Blossom", "Ash Blossom x3", with optional Main/Extra/Side headings. */
export function parseText(text: string, searcher: Searcher): RawDeck {
  const deck: RawDeck = { main: [], extra: [], side: [], unknown: [] }
  const byName = new Map<string, YgoCard>()
  for (const c of searcher.cards) byName.set(normalize(c.n), c)
  let section: DeckSection | undefined
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || /^(\/\/|#(?!\w))/.test(line)) continue
    const heading = /^(main|extra|side)(\s*deck)?\s*:?(\s*\(\d+\))?\s*$/i.exec(line)
    if (heading) {
      section = heading[1].toLowerCase() as DeckSection
      continue
    }
    if (/^(lf|monsters?|spells?|traps?)\s*:?\s*(\(\d+\))?$/i.test(line)) continue
    const m = /^(\d+)\s*x?\s+(.+)$/i.exec(line) ?? /^(.+?)\s+x\s*(\d+)$/i.exec(line)
    const [qty, name] = m ? (/^\d+$/.test(m[1]) ? [Number(m[1]), m[2]] : [Number(m[2]), m[1]]) : [1, line]
    const card = byName.get(normalize(name)) ?? (/^\d{4,9}$/.test(name) ? searcher.byId.get(Number(name)) : undefined)
    if (!card) {
      deck.unknown!.push(line)
      continue
    }
    const target = section ?? (isExtraDeckCard(card) ? 'extra' : 'main')
    for (let i = 0; i < Math.min(qty, 60); i++) deck[target].push(card.id)
  }
  return deck
}

/** YGOPRODeck deck page: `var maindeckjs = '["123", ...]'` (and extradeckjs, sidedeckjs). */
export function parseYgoprodeckPage(html: string): RawDeck {
  const list = (name: string) => {
    const m = new RegExp(`var ${name}\\s*=\\s*'(\\[[^']*\\])'`).exec(html)
    return m ? (JSON.parse(m[1]) as string[]).map(Number) : []
  }
  const deck = { main: list('maindeckjs'), extra: list('extradeckjs'), side: list('sidedeckjs') }
  if (!deck.main.length && !deck.extra.length) throw new Error("Couldn't find a deck on that YGOPRODeck page")
  const title = /<title>([^<]+)/.exec(html)?.[1]?.replace(/\s*[-|]\s*YGOPRODeck\s*$/i, '').trim()
  return { ...deck, name: title }
}

/**
 * Konami card database deck page (Neuron links redirect here): card rows carry a hidden `cid` (Konami id) and a
 * `cards_num_set` count, inside the detailtext_main / detailtext_ext / detailtext_side blocks.
 */
export function parseKonamiPage(html: string, byKonamiId: Map<number, YgoCard>): RawDeck {
  const deck: RawDeck = { main: [], extra: [], side: [], unknown: [] }
  const marks = [...html.matchAll(/id="detailtext_(main|ext|side)"/g)].map((m) => ({
    at: m.index!,
    section: (m[1] === 'ext' ? 'extra' : m[1]) as DeckSection,
  }))
  if (!marks.length) throw new Error("Couldn't find a deck on that page (is the deck public?)")
  const end = html.search(/id="(main|extra|side)"/) // the image view repeats the list after the text view
  for (const m of html.matchAll(/<div class="t_row[\s\S]*?(?=<div class="t_row|$)/g)) {
    const at = m.index!
    if (end > 0 && at > end) break
    const section = [...marks].reverse().find((x) => x.at < at)?.section
    const cid = /class="cid" value="(\d+)"/.exec(m[0])?.[1]
    const qty = Number(/cards_num_set">\s*<span>(\d+)/.exec(m[0])?.[1] ?? 0)
    if (!section || !cid || !qty) continue
    const card = byKonamiId.get(Number(cid))
    if (!card) {
      deck.unknown!.push(/class="card_name">([^<]*)/.exec(m[0])?.[1] ?? `Konami id ${cid}`)
      continue
    }
    for (let i = 0; i < qty; i++) deck[section].push(card.id)
  }
  const title = (/<meta property="og:title" content="([^"]+)"/.exec(html)?.[1] ?? /<title>([^<]+)/.exec(html)?.[1])?.split(' | ')[0].trim()
  return { ...deck, name: title }
}

// ------------------------------------------------------------------ resolve and write

export function resolveDeck(raw: RawDeck, searcher: Searcher): Deck {
  const deck: Deck = { name: raw.name, main: [], extra: [], side: [], unknown: [...(raw.unknown ?? [])] }
  for (const s of SECTIONS) {
    const counts = new Map<YgoCard, number>()
    for (const id of raw[s]) {
      const card = searcher.byId.get(id)
      if (!card) deck.unknown.push(`passcode ${id}`)
      else counts.set(card, (counts.get(card) ?? 0) + 1)
    }
    deck[s] = [...counts].map(([card, qty]) => ({ card, qty }))
  }
  return deck
}

export const deckToRaw = (d: Deck): RawDeck => ({
  name: d.name,
  main: d.main.flatMap((l) => Array(l.qty).fill(l.card.id)),
  extra: d.extra.flatMap((l) => Array(l.qty).fill(l.card.id)),
  side: d.side.flatMap((l) => Array(l.qty).fill(l.card.id)),
})

export const toYdk = (d: RawDeck) =>
  ['#created by Chaos Catalog', '#main', ...d.main, '#extra', ...d.extra, '!side', ...d.side, ''].join('\n')

export function toText(d: Deck): string {
  const out: string[] = []
  for (const s of SECTIONS) {
    if (!d[s].length) continue
    out.push(`${s === 'main' ? 'Main' : s === 'extra' ? 'Extra' : 'Side'} (${d[s].reduce((n, l) => n + l.qty, 0)})`)
    for (const l of d[s]) out.push(`${l.qty} ${l.card.n}`)
    out.push('')
  }
  return out.join('\n').trim() + '\n'
}

/** The "looking for" post: "LF:" then one "<qty>x <name>" per line. */
export const lfList = (lines: { name: string; qty: number }[]) => ['LF:', ...lines.map((l) => `${l.qty}x ${l.name}`)].join('\n')

/** Reads any supported pasted text (not links: those need fetchDeckPage first). */
export async function parseDeck(input: string, searcher: Searcher): Promise<{ format: DeckFormat; raw: RawDeck }> {
  const format = detectFormat(input)
  switch (format) {
    case 'ydke':
      return { format, raw: parseYdke(input) }
    case 'ydk':
      return { format, raw: parseYdk(input) }
    case 'omega':
      return { format, raw: await parseOmega(input, searcher.byId) }
    case 'text':
      return { format, raw: parseText(input, searcher) }
    default:
      throw new Error('Links are fetched first')
  }
}
