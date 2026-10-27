// Development only (never in the live build): a sample collection kept in memory, so screens can be checked in a
// browser without signing in. Open http://localhost:5173/?view=demo
import { useMemo } from 'react'
import { applyOp, Draft, emptyCollection, type Collection, type Op } from '../../core/collection/model.ts'
import { CollectionStore } from '../../core/collection/store.ts'
import type { Profile } from '../../core/supabase.ts'
import type { Searcher } from '../../games/ygo/search.ts'
import { CollectionContext } from './context.ts'
import { CollectionPage } from './CollectionPage.tsx'

class MemoryStore extends CollectionStore {
  private mem: Collection
  constructor(c: Collection) {
    super('demo', false)
    this.mem = c
    this.loaded = true
  }
  override get collection() {
    return this.mem
  }
  override getSnapshot = () => this.mem
  override async load() {}
  override async refresh() {}
  override async apply(op: Op) {
    this.mem = applyOp(this.mem, op)
    ;(this as unknown as { emit: () => void }).emit()
  }
}

function sample(searcher: Searcher): Collection {
  let c = emptyCollection()
  const d = new Draft(c, () => 'card')
  const key = (name: string) => String(searcher.cards.find((x) => x.n === name)?.id ?? searcher.cards[0].id)
  d.createGroup('Unsorted', { kind: 'holding' })
  const b1 = d.createBox('Long box 1')
  const b2 = d.createBox('Deck boxes')
  const a = d.createGroup('Hand traps', { box_id: b1.id, row_label: '1', capacity: 60 })
  const s = d.createGroup('Spells A–M', { box_id: b1.id, row_label: '1' })
  d.createGroup('Extra deck staples', { box_id: b1.id, row_label: '2' })
  const binder = d.createGroup('Trade binder', { ordered: true })
  const page = d.createGroup('Page 1', { parent_id: binder.id })
  d.createGroup('Page 2', { parent_id: binder.id })
  const deck = d.createGroup('Snake-Eye', { kind: 'deck', box_id: b2.id })
  d.add({ card_key: key('Ash Blossom & Joyous Spring'), qty: 3, details: { set_code: 'DUDE-EN003', rarity: 'Ultra Rare', condition: 'NM' } }, a.id)
  d.add({ card_key: key('Called by the Grave'), qty: 2 }, s.id)
  d.add({ card_key: key('Dark Magician'), qty: 1, details: { note: 'signed' } }, page.id)
  d.add({ card_key: key('Ash Blossom & Joyous Spring'), qty: 1 }, binder.id)
  d.add({ card_key: key('Called by the Grave'), qty: 1 }, deck.id)
  d.add({ card_key: key('Cyberse Code Magician'), qty: 1, details: { set_code: 'MAMO-EN017', rarity: 'New' } }, a.id)
  c = applyOp(c, d.finish('demo', 'demo'))
  return c
}

const DEMO_OWNER: Profile = {
  id: 'demo',
  username: 'demo',
  display_name: 'Demo',
  city: 'Lincoln, NE',
  is_admin: false,
  profile_public: true,
  show_locations: true,
  show_prices: true,
  group_ordered_default: false,
  default_availability: 'none',
}

export default function DemoCollection({ searcher }: { searcher: Searcher }) {
  const store = useMemo(() => new MemoryStore(sample(searcher)), [searcher])
  return (
    <CollectionContext.Provider value={{ store, owner: DEMO_OWNER, readOnly: false, searcher }}>
      <CollectionPage />
    </CollectionContext.Provider>
  )
}
