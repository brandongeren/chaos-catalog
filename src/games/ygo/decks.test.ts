import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  deckToRaw,
  detectFormat,
  lfList,
  parseKonamiPage,
  parseOmega,
  parseText,
  parseYdk,
  parseYdke,
  parseYgoprodeckPage,
  resolveDeck,
  toText,
  toYdk,
  toYdke,
} from './decks.ts'
import { createSearcher } from './search.ts'
import type { YgoCard } from './types.ts'

const card = (id: number, n: string, f = 'effect', kid?: number): YgoCard => ({ id, n, t: '', f, d: '', r: '', gp: 0, tcg: '2020-01-01', kid })
const CARDS = [
  card(89631139, 'Blue-Eyes White Dragon', 'normal', 4007),
  card(36996508, 'Dark Magician Girl', 'effect'),
  card(44508094, 'Stardust Dragon', 'synchro'),
  card(5318639, 'Mystical Space Typhoon', 'spell'),
  card(14558127, 'Ash Blossom & Joyous Spring', 'effect', 12950),
]
CARDS[1].alt = [36996509]
const searcher = createSearcher(CARDS)

describe('ydke', () => {
  it('reads the reference example from ydke.js', () => {
    expect(parseYdke('ydke://o6lXBZyFNAI=!viOnAg==!7ydRAA==!')).toEqual({ main: [89631139, 36996508], extra: [44508094], side: [5318639] })
  })
  it('round-trips', () => {
    const raw = { main: [89631139, 89631139, 14558127], extra: [44508094], side: [] }
    expect(parseYdke(toYdke(raw))).toEqual(raw)
    expect(toYdke({ main: [89631139, 36996508], extra: [44508094], side: [5318639] })).toBe('ydke://o6lXBZyFNAI=!viOnAg==!7ydRAA==!')
  })
})

describe('ydk', () => {
  it('reads sections and ignores comments', () => {
    const text = '#created by YGO Omega\r\n#tags=Genesys\r\n#main\r\n89631139\r\n89631139\r\n#extra\r\n44508094\r\n!side\r\n5318639\r\n'
    expect(detectFormat(text)).toBe('ydk')
    expect(parseYdk(text)).toEqual({ main: [89631139, 89631139], extra: [44508094], side: [5318639] })
  })
  it('round-trips', () => {
    const raw = { main: [1, 2], extra: [3], side: [4] }
    expect(parseYdk(toYdk(raw))).toEqual(raw)
  })
})

describe('YGO Omega code', () => {
  it('decodes header counts and splits main/extra by card type', async () => {
    const ids = [89631139, 44508094, 14558127, 5318639]
    const bytes = new Uint8Array(2 + ids.length * 4)
    bytes[0] = 3 // main + extra
    bytes[1] = 1 // side
    const view = new DataView(bytes.buffer)
    ids.forEach((id, i) => view.setUint32(2 + i * 4, id, true))
    const code = deflateRawSync(bytes).toString('base64')
    expect(detectFormat(code)).toBe('omega')
    expect(await parseOmega(code, searcher.byId)).toEqual({ main: [89631139, 14558127], extra: [44508094], side: [5318639] })
  })
  it('rejects garbage', async () => {
    await expect(parseOmega('notadeckcodeatall!!', searcher.byId)).rejects.toThrow()
  })
})

describe('text lists', () => {
  it('reads common shapes, headings and unknown lines', () => {
    const raw = parseText('Main\n3x Ash Blossom & Joyous Spring\nBlue-Eyes White Dragon x2\n1 dark magician girl\nExtra:\n1 Stardust Dragon\nSide (1)\n1 Mystical Space Typhoon\n2 Not A Card\n', searcher)
    expect(raw.main).toEqual([14558127, 14558127, 14558127, 89631139, 89631139, 36996508])
    expect(raw.extra).toEqual([44508094])
    expect(raw.side).toEqual([5318639])
    expect(raw.unknown).toEqual(['2 Not A Card'])
  })
  it('puts Extra Deck monsters in the Extra Deck when there are no headings', () => {
    expect(parseText('1 Stardust Dragon\n2 Ash Blossom & Joyous Spring', searcher)).toMatchObject({ main: [14558127, 14558127], extra: [44508094] })
  })
})

describe('deck pages', () => {
  it('YGOPRODeck: reads the embedded passcode lists', () => {
    const html = `<title>My Deck | YGOPRODeck</title><script>var maindeckjs = '["89631139","89631139"]';\n var extradeckjs = '["44508094"]';\n var sidedeckjs = '[]';</script>`
    expect(detectFormat('https://ygoprodeck.com/deck/my-deck-123')).toBe('ygoprodeck')
    expect(parseYgoprodeckPage(html)).toEqual({ main: [89631139, 89631139], extra: [44508094], side: [], name: 'My Deck' })
  })
  it('Konami/Neuron: reads cid and counts per section, ignoring the repeated image view', () => {
    const row = (cid: number, name: string, n: number) =>
      `<div class="t_row c_normal"><span class="card_name">${name}</span><input type="hidden" class="cid" value="${cid}"><div class="cards_num_set">\n<span>${n}</span></div></div>`
    const html = `<meta property="og:title" content="Neuron Deck">
      <div id="detailtext_main">${row(12950, 'Ash Blossom', 3)}${row(4007, 'Blue-Eyes', 1)}</div>
      <div id="detailtext_ext">${row(99999, 'Unknown Thing', 1)}</div>
      <div id="detailtext_side">${row(12950, 'Ash Blossom', 0)}</div>
      <div id="main">${row(12950, 'Ash Blossom', 3)}</div>`
    expect(detectFormat('https://neuron.konami.net/link/ftxszr4z0w4b701l')).toBe('konami')
    const byKid = new Map(CARDS.filter((c) => c.kid).map((c) => [c.kid!, c]))
    expect(parseKonamiPage(html, byKid)).toEqual({ main: [14558127, 14558127, 14558127, 89631139], extra: [], side: [], unknown: ['Unknown Thing'], name: 'Neuron Deck' })
  })
})

describe('resolve and write', () => {
  it('groups copies, accepts alternate-art passcodes, and writes text and LF lists', () => {
    const deck = resolveDeck({ main: [14558127, 14558127, 36996509, 777], extra: [44508094], side: [] }, searcher)
    expect(deck.main.map((l) => [l.card.n, l.qty])).toEqual([
      ['Ash Blossom & Joyous Spring', 2],
      ['Dark Magician Girl', 1],
    ])
    expect(deck.unknown).toEqual(['passcode 777'])
    expect(deckToRaw(deck).main).toEqual([14558127, 14558127, 36996508])
    expect(toText(deck)).toBe('Main (3)\n2 Ash Blossom & Joyous Spring\n1 Dark Magician Girl\n\nExtra (1)\n1 Stardust Dragon\n')
    expect(lfList([{ name: 'Ash Blossom & Joyous Spring', qty: 3 }, { name: 'Called by the Grave', qty: 1 }])).toBe(
      'LF:\n3x Ash Blossom & Joyous Spring\n1x Called by the Grave',
    )
  })
})
