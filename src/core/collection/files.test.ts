import { describe, expect, it } from 'vitest'
import { importCsvOps, importJsonOps, parseCsv, parseJsonFile, toCsv, toJsonFile } from './files.ts'
import { applyOp, Draft, emptyCollection, type Collection } from './model.ts'

const nameOf = (s: { card_key: string | null }) => ({ '1': 'Ash Blossom & Joyous Spring', '2': 'Called by the Grave' })[s.card_key ?? ''] ?? 'Custom'

function sample() {
  let c: Collection = emptyCollection()
  const d = new Draft(c, nameOf)
  d.createGroup('Unsorted', { kind: 'holding' })
  const box = d.createBox('Box 1')
  const g = d.createGroup('Fire, "hot" ones', { box_id: box.id, row_label: 'Row 2' })
  const deck = d.createGroup('Snake-Eye', { kind: 'deck' })
  d.add({ card_key: '1', qty: 3, details: { set_code: 'DUDE-EN003', rarity: 'Ultra Rare', condition: 'LP' }, availability: 'trade' }, g.id)
  d.add({ card_key: '2', qty: 1, details: { note: 'misprint, "Grave" spelled "Grove"' } }, deck.id)
  const custom = d.createCustomCard('Proxy Thing', { kind: 'Proxy' })
  d.add({ custom_card_id: custom.id, qty: 2 }, g.id)
  c = applyOp(c, d.finish('setup', 'setup'))
  return c
}

const summarize = (c: Collection) =>
  [...c.stacks.values()]
    .map((s) => {
      const g = c.groups.get(s.group_id)!
      return [nameOf(s) === 'Custom' ? c.custom_cards.get(s.custom_card_id!)?.name : nameOf(s), s.qty, g.name, g.row_label, g.box_id ? c.boxes.get(g.box_id)!.name : null, s.condition, s.availability, s.section, s.note].join('|')
    })
    .sort()

describe('JSON backup', () => {
  it('round-trips into an empty collection with new ids', () => {
    const c = sample()
    const file = parseJsonFile(toJsonFile(c))
    let target: Collection = emptyCollection()
    const d = new Draft(target, nameOf)
    d.createGroup('Unsorted', { kind: 'holding' })
    target = applyOp(target, d.finish('setup', 'setup'))
    for (const op of importJsonOps(target, file, nameOf)) target = applyOp(target, op)
    expect(summarize(target)).toEqual(summarize(c))
    expect([...target.stacks.keys()].some((id) => c.stacks.has(id))).toBe(false)
    expect([...target.groups.values()].filter((g) => g.name === 'Unsorted')).toHaveLength(1)
  })
  it('rejects other files', () => {
    expect(() => parseJsonFile('{"a":1}')).toThrow(/Chaos Catalog/)
    expect(() => parseJsonFile('nope')).toThrow(/JSON/)
  })
})

describe('CSV', () => {
  it('parses quotes, commas and CRLF', () => {
    expect(parseCsv('Name,QTY\r\n"Ash, ""the"" Blossom",3\r\n\r\nX,1')).toEqual([
      { name: 'Ash, "the" Blossom', qty: '3' },
      { name: 'X', qty: '1' },
    ])
  })
  it('round-trips cards and locations (custom cards are listed but not re-imported)', () => {
    const c = sample()
    const rows = parseCsv(toCsv(c, (s) => (s.custom_card_id ? 'Proxy Thing' : nameOf(s))))
    expect(rows).toHaveLength(3)
    let target = emptyCollection()
    const resolve = (passcode: string, name: string) => (passcode ? passcode : name === 'Called by the Grave' ? '2' : undefined)
    const plan = importCsvOps(target, rows, resolve, nameOf)
    expect(plan.cards).toBe(4)
    expect(plan.unmatched).toEqual([{ line: 3, name: 'Proxy Thing' }])
    for (const op of plan.ops) target = applyOp(target, op)
    expect(summarize(target)).toEqual(summarize(c).filter((x) => !x.startsWith('Proxy')))
  })
})
