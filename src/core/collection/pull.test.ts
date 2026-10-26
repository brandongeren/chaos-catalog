import { describe, expect, it } from 'vitest'
import { applyOp, Draft, emptyCollection, type Collection } from './model.ts'
import { pullList, type Need } from './pull.ts'

function setup() {
  let c: Collection = emptyCollection()
  const d = new Draft(c, () => 'x')
  const box1 = d.createBox('Box 1')
  const box2 = d.createBox('Box 2')
  const a = d.createGroup('A', { box_id: box1.id })
  const b = d.createGroup('B', { box_id: box2.id })
  const deck = d.createGroup('Deck', { kind: 'deck' })
  const lent = d.createGroup('Lent', { kind: 'lent' })
  d.add({ card_key: 'ash', qty: 2, details: { condition: 'NM' } }, a.id)
  d.add({ card_key: 'ash', qty: 2, details: { condition: 'HP' } }, b.id)
  d.add({ card_key: 'called', qty: 1 }, b.id)
  d.add({ card_key: 'called', qty: 3 }, lent.id)
  d.add({ card_key: 'ash', qty: 1 }, deck.id, )
  c = applyOp(c, d.finish('setup', 'setup'))
  return { c, a, b, deck, box1 }
}

const needs: Need[] = [
  { card_key: 'ash', name: 'Ash', qty: 3, section: 'main' },
  { card_key: 'called', name: 'Called', qty: 2, section: 'main' },
  { card_key: 'nope', name: 'Missing', qty: 1, section: 'side' },
]

describe('pullList', () => {
  it('"list" shows every usable location and what is missing, skipping lent-out copies', () => {
    const { c, deck } = setup()
    const lines = pullList(c, needs, { strategy: 'list', targetGroup: deck.id })
    expect(lines.map((l) => [l.name, l.sources.length, l.picks.length, l.alreadyInDeck, l.missing])).toEqual([
      ['Ash', 2, 0, 1, 0],
      ['Called', 1, 0, 0, 1],
      ['Missing', 0, 0, 0, 1],
    ])
  })
  it('fewest stops prefers the group that has the most needed cards', () => {
    const { c, b } = setup()
    const [ash, called] = pullList(c, needs, { strategy: 'fewest-stops' })
    expect(ash.picks.map((p) => [p.stack.group_id === b.id, p.qty])).toEqual([[true, 2], [false, 1]])
    expect(called.picks.map((p) => p.qty)).toEqual([1])
    expect(called.missing).toBe(1)
  })
  it('worst condition first keeps the NM copies stored; prefer-box picks from that box', () => {
    const { c, box1, deck } = setup()
    const [ash] = pullList(c, needs.slice(0, 1), { strategy: 'worst-condition', targetGroup: deck.id })
    expect(ash.picks.map((p) => [p.stack.condition, p.qty])).toEqual([['HP', 2]])
    const [ash2] = pullList(c, needs.slice(0, 1), { strategy: 'prefer-box', preferBox: box1.id, targetGroup: deck.id })
    expect(ash2.picks.map((p) => [p.stack.condition, p.qty])).toEqual([['NM', 2]])
  })
  it('does not use the same copies twice across main and side', () => {
    const { c } = setup()
    const lines = pullList(c, [
      { card_key: 'ash', name: 'Ash', qty: 3, section: 'main' },
      { card_key: 'ash', name: 'Ash', qty: 3, section: 'side' },
    ], { strategy: 'cheapest' })
    expect(lines.map((l) => [l.picks.reduce((n, p) => n + p.qty, 0), l.missing])).toEqual([[3, 0], [2, 1]])
  })
})
