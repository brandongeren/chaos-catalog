import { describe, expect, it } from 'vitest'
import { applyOp, conflictOf, Draft, emptyCollection, groupPath, suggestPlaces, type Collection, type Stack } from './model.ts'

const nameOf = (s: Pick<Stack, 'card_key' | 'custom_card_id'>) => (s.card_key === '14558127' ? 'Ash Blossom' : s.card_key ?? 'custom')

function setup() {
  let c: Collection = emptyCollection()
  const d = new Draft(c, nameOf)
  const box = d.createBox('Box 1')
  const a = d.createGroup('Group A', { box_id: box.id })
  const b = d.createGroup('Group B', { box_id: box.id, row_label: 'Row 2' })
  const deck = d.createGroup('Snake-Eye', { kind: 'deck' })
  const ordered = d.createGroup('Binder', { ordered: true })
  c = applyOp(c, d.finish('setup', 'setup'))
  return { c, box, a, b, deck, ordered }
}

const stacksIn = (c: Collection, groupId: string) => [...c.stacks.values()].filter((s) => s.group_id === groupId)

describe('Draft', () => {
  it('adding identical copies to an unordered group merges them', () => {
    let { c, a } = setup()
    for (const qty of [2, 1]) {
      const d = new Draft(c, nameOf)
      d.add({ card_key: '14558127', qty }, a.id)
      c = applyOp(c, d.finish('add', 'add'))
    }
    expect(stacksIn(c, a.id).map((s) => s.qty)).toEqual([3])
  })

  it('notes are details: different notes stay separate and travel with moves', () => {
    let { c, a, b } = setup()
    let d = new Draft(c, nameOf)
    const signed = d.add({ card_key: '14558127', qty: 1, details: { note: 'signed' } }, a.id)
    d.add({ card_key: '14558127', qty: 2 }, a.id)
    c = applyOp(c, d.finish('add', 'add'))
    expect(stacksIn(c, a.id)).toHaveLength(2)
    d = new Draft(c, nameOf)
    const moved = d.move(signed.id, 1, b.id)
    const op = d.finish('move', 'move')
    expect(op.summary.cards?.[0].details.note).toBe('signed')
    c = applyOp(c, op)
    expect(c.stacks.get(moved.id)?.note).toBe('signed')
  })

  it('different details stay separate; ordered groups never auto-merge', () => {
    let { c, a, ordered } = setup()
    const d = new Draft(c, nameOf)
    d.add({ card_key: '14558127', qty: 1, details: { condition: 'NM' } }, a.id)
    d.add({ card_key: '14558127', qty: 1, details: { condition: 'LP' } }, a.id)
    d.add({ card_key: '14558127', qty: 1 }, a.id)
    d.add({ card_key: '14558127', qty: 1 }, ordered.id)
    d.add({ card_key: '14558127', qty: 1 }, ordered.id)
    c = applyOp(c, d.finish('add', 'add'))
    expect(stacksIn(c, a.id)).toHaveLength(3)
    expect(stacksIn(c, ordered.id).map((s) => s.position)).toEqual([1, 2])
  })

  it('moving some copies splits; details travel; merges at the target', () => {
    let { c, a, b } = setup()
    let d = new Draft(c, nameOf)
    const s = d.add({ card_key: '14558127', qty: 3, details: { set_code: 'DUDE-EN003', rarity: 'Ultra Rare', edition: '1st Edition' } }, a.id)
    d.add({ card_key: '14558127', qty: 1, details: { set_code: 'DUDE-EN003', rarity: 'Ultra Rare', edition: '1st Edition' } }, b.id)
    c = applyOp(c, d.finish('add', 'add'))
    d = new Draft(c, nameOf)
    d.move(s.id, 1, b.id)
    const op = d.finish('move', 'move')
    expect(op.summary.cards).toEqual([expect.objectContaining({ name: 'Ash Blossom', qty: 1, from: a.id, to: b.id })])
    c = applyOp(c, op)
    expect(stacksIn(c, a.id).map((x) => x.qty)).toEqual([2])
    expect(stacksIn(c, b.id).map((x) => [x.qty, x.set_code, x.edition])).toEqual([[2, 'DUDE-EN003', '1st Edition']])
  })

  it('moving into a deck sets a section, out of it clears it', () => {
    let { c, a, deck } = setup()
    let d = new Draft(c, nameOf)
    const s = d.add({ card_key: '14558127', qty: 3 }, a.id)
    c = applyOp(c, d.finish('add', 'add'))
    d = new Draft(c, nameOf)
    const inDeck = d.move(s.id, 3, deck.id, 'side')
    c = applyOp(c, d.finish('move', 'move'))
    expect(c.stacks.get(inDeck.id)?.section).toBe('side')
    d = new Draft(c, nameOf)
    const back = d.move(inDeck.id, 3, a.id)
    c = applyOp(c, d.finish('move', 'move'))
    expect(c.stacks.get(back.id)?.section).toBeNull()
  })

  it('remove records the copies for history; edit splits and merges', () => {
    let { c, a } = setup()
    let d = new Draft(c, nameOf)
    const s = d.add({ card_key: '14558127', qty: 3 }, a.id)
    c = applyOp(c, d.finish('add', 'add'))
    d = new Draft(c, nameOf)
    d.edit(s.id, 1, { condition: 'HP' })
    c = applyOp(c, d.finish('edit', 'edit'))
    expect(stacksIn(c, a.id).map((x) => [x.qty, x.condition]).sort()).toEqual([[1, 'HP'], [2, null]])
    const hp = stacksIn(c, a.id).find((x) => x.condition === 'HP')!
    d = new Draft(c, nameOf)
    d.remove(hp.id, 1)
    const op = d.finish('remove', 'remove')
    expect(op.summary.cards?.[0]).toMatchObject({ qty: 1, from: a.id, to: null, details: { condition: 'HP' } })
    c = applyOp(c, op)
    expect(stacksIn(c, a.id).map((x) => x.qty)).toEqual([2])
  })

  it('split and merge in an ordered group', () => {
    let { c, ordered } = setup()
    let d = new Draft(c, nameOf)
    const s = d.add({ card_key: '14558127', qty: 3 }, ordered.id)
    d.add({ card_key: '1', qty: 1 }, ordered.id)
    c = applyOp(c, d.finish('add', 'add'))
    d = new Draft(c, nameOf)
    const part = d.split(s.id, 1)
    c = applyOp(c, d.finish('split', 'split'))
    expect(stacksIn(c, ordered.id).sort((x, y) => x.position! - y.position!).map((x) => [x.card_key, x.qty])).toEqual([
      ['14558127', 2],
      ['14558127', 1],
      ['1', 1],
    ])
    d = new Draft(c, nameOf)
    d.merge(s.id, part.id)
    c = applyOp(c, d.finish('merge', 'merge'))
    expect(stacksIn(c, ordered.id).map((x) => x.qty).sort()).toEqual([1, 3])
  })

  it('lend moves copies to Lent out with the borrower; give back returns them', () => {
    let { c, a } = setup()
    let d = new Draft(c, nameOf)
    const s = d.add({ card_key: '14558127', qty: 3 }, a.id)
    c = applyOp(c, d.finish('add', 'add'))
    d = new Draft(c, nameOf)
    const lent = d.lend(s.id, 2, { name: 'Dawson', due: '2026-11-30' })
    c = applyOp(c, d.finish('lend', 'lend'))
    const area = [...c.groups.values()].find((g) => g.kind === 'lent')!
    expect(c.stacks.get(lent.id)).toMatchObject({ group_id: area.id, qty: 2, lent_to_name: 'Dawson', lent_due: '2026-11-30', lent_from_group: a.id })
    d = new Draft(c, nameOf)
    d.giveBack(lent.id, 2)
    c = applyOp(c, d.finish('return', 'return'))
    expect(stacksIn(c, a.id).map((x) => [x.qty, x.lent_to_name])).toEqual([[3, null]])
  })

  it('suggests groups with room, emptiest first', () => {
    let c: Collection = emptyCollection()
    const d = new Draft(c, nameOf)
    const small = d.createGroup('Small', { capacity: 10 })
    const big = d.createGroup('Big', { capacity: 100 })
    d.createGroup('No limit')
    d.add({ card_key: '1', qty: 8 }, small.id)
    d.add({ card_key: '1', qty: 30 }, big.id)
    c = applyOp(c, d.finish('setup', 'setup'))
    expect(suggestPlaces(c, 2).map((x) => [x.group.name, x.free])).toEqual([['Big', 70], ['Small', 2]])
    expect(suggestPlaces(c, 5).map((x) => x.group.name)).toEqual(['Big'])
  })

  it('sub-groups: nested paths, shared box, order with cards, no loops', () => {
    let { c, box, ordered } = setup()
    let d = new Draft(c, nameOf)
    const binder = d.createGroup('Binder 2', { box_id: box.id, row_label: 'Row 3', ordered: true })
    d.add({ card_key: '1', qty: 1 }, binder.id)
    const page = d.createGroup('Page 1', { parent_id: binder.id })
    const pocket = d.createGroup('Pocket A', { parent_id: page.id })
    d.add({ card_key: '2', qty: 1 }, binder.id)
    c = applyOp(c, d.finish('setup', 'setup'))
    expect(groupPath(c, pocket.id)).toBe('Box 1 › Row 3 › Binder 2 › Page 1 › Pocket A')
    expect(c.groups.get(pocket.id)?.box_id).toBe(box.id)
    // cards and the sub-group share one order in the ordered binder
    const order = [
      ...[...c.stacks.values()].filter((s) => s.group_id === binder.id).map((s) => [s.card_key, s.position]),
      ['Page 1', c.groups.get(page.id)?.position],
    ].sort((x, y) => (x[1] as number) - (y[1] as number))
    expect(order.map((x) => x[0])).toEqual(['1', 'Page 1', '2'])
    d = new Draft(c, nameOf)
    expect(() => d.updateGroup(binder.id, { parent_id: pocket.id })).toThrow(/inside itself/)
    expect(() => d.deleteGroup(binder.id)).toThrow()
    // moving the top group to no box takes its sub-groups along
    d.updateGroup(binder.id, { box_id: null })
    c = applyOp(c, d.finish('move', 'move'))
    expect(c.groups.get(pocket.id)?.box_id).toBeNull()
    // moving a sub-group into an ordered group gives it a place at the end
    d = new Draft(c, nameOf)
    d.updateGroup(pocket.id, { parent_id: ordered.id })
    c = applyOp(c, d.finish('move', 'move'))
    expect(c.groups.get(pocket.id)).toMatchObject({ parent_id: ordered.id, position: 1 })
  })

  it('refuses impossible edits', () => {
    const { c, a, box } = setup()
    const d = new Draft(c, nameOf)
    const s = d.add({ card_key: '14558127', qty: 2 }, a.id)
    expect(() => d.move(s.id, 3, a.id)).toThrow()
    expect(() => d.deleteGroup(a.id)).toThrow(/Move or remove/)
    expect(() => d.deleteBox(box.id)).toThrow(/groups/)
    expect(() => d.add({ qty: 1 }, a.id)).toThrow(/Pick a card/)
  })

  it('rows created and deleted in one draft vanish; versions advance once per op', () => {
    let { c, a } = setup()
    const d = new Draft(c, nameOf)
    const temp = d.createGroup('temp')
    d.deleteGroup(temp.id)
    d.updateGroup(a.id, { name: 'A1' })
    d.updateGroup(a.id, { name: 'A2' })
    const op = d.finish('edit', 'rename')
    expect(op.expect).toEqual([{ t: 'groups', id: a.id, v: 1 }])
    c = applyOp(c, op)
    expect(c.groups.get(a.id)).toMatchObject({ name: 'A2', version: 2 })
    expect(conflictOf(c, op)).toMatch(/version 2, expected 1/)
  })
})
