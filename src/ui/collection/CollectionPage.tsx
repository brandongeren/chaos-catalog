import { useMemo, useState } from 'react'
import { availabilityTag, childGroups, descendantsOf, groupPath, rowName, uuid, type Availability, type Box, type Collection, type Group, type Section, type Stack } from '../../core/collection/model.ts'
import { photoUrl } from '../../core/supabase.ts'
import { useUrlParams } from '../../lib/useUrlParams.ts'
import { summary } from '../../games/ygo/classify.ts'
import { Modal } from '../Modal.tsx'
import { PlaceholderRepair } from './PlaceholderRepair.tsx'
import { usePrices } from '../pricesContext.ts'
import { stackPrice } from '../../games/ygo/prices.ts'
import { money } from '../../games/ygo/ui/format.ts'
import type { YgoPriceDay } from '../../games/ygo/types.ts'
import { toYdk, toYdke, type RawDeck } from '../../games/ygo/decks.ts'
import { download } from '../../lib/download.ts'
import { cardOf, change, nameOfStack, useCollection, useCollectionContext } from './context.ts'
import {
  BoxDialog,
  CustomCardDialog,
  EditStackDialog,
  AvailabilityAllDialog,
  GiveBackDialog,
  LendDialog,
  GroupDialog,
  GroupSelect,
  MoveDialog,
  RemoveDialog,
  SplitDialog,
} from './dialogs.tsx'
import { languageName } from './labels.ts'

type Dialog =
  | { kind: 'box'; box?: Box }
  | { kind: 'group'; group?: Group; groupKind?: Group['kind']; boxId?: string | null; parentId?: string }
  | { kind: 'move' | 'edit' | 'remove' | 'split' | 'lend' | 'giveback'; stack: Stack }
  | { kind: 'custom' }
  | { kind: 'bulk-move'; stacks: Stack[] }
  | { kind: 'move-groups'; groups: Group[] }
  | { kind: 'availability'; title: string; groupIds: string[] }

const count = (c: Collection, groupId: string) => {
  let n = 0
  for (const s of c.stacks.values()) if (s.group_id === groupId) n += s.qty
  return n
}

/** Cards in a group and all its sub-groups. */
const countAll = (c: Collection, groupId: string) => [groupId, ...descendantsOf(c, groupId).map((g) => g.id)].reduce((n, id) => n + count(c, id), 0)

/** Market value of the cards in these groups (undefined when no prices are loaded). */
const valueOf = (c: Collection, prices: YgoPriceDay | undefined, groupIds: string[]) => {
  if (!prices) return undefined
  const ids = new Set(groupIds)
  let v = 0
  for (const s of c.stacks.values()) if (ids.has(s.group_id)) v += (stackPrice(prices, s) ?? 0) * s.qty
  return v
}
const withSubs = (c: Collection, groupId: string) => [groupId, ...descendantsOf(c, groupId).map((g) => g.id)]

/** Prices are shown unless you're viewing someone who hides them. */
function useVisiblePrices() {
  const ctx = useCollectionContext()
  const prices = usePrices()
  return ctx.readOnly && !ctx.owner.show_prices ? undefined : prices
}

/** Children in display order: by position in ordered groups, else by name. */
const sortedChildren = (c: Collection, parent: Group) =>
  childGroups(c, parent.id).sort((a, b) => (parent.ordered ? (a.position ?? 0) - (b.position ?? 0) : a.name.localeCompare(b.name)))

export function CollectionPage() {
  const ctx = useCollectionContext()
  const c = useCollection(ctx.store)
  const [params, setParams] = useUrlParams()
  const [dialog, setDialog] = useState<Dialog>()
  const selectedGroup = params.get('g') ?? undefined
  const selectedBox = params.get('b') ?? undefined
  const select = (key: 'g' | 'b', id: string) => {
    const p = new URLSearchParams(params)
    p.delete('g')
    p.delete('b')
    p.set(key, id)
    setParams(p)
    // On phones the list sits above the cards: jump down to what was picked.
    if (window.matchMedia('(max-width: 48rem)').matches)
      requestAnimationFrame(() => document.querySelector('.pane')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  const tree = useMemo(() => {
    const groups = [...c.groups.values()].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    const boxes = [...c.boxes.values()].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    return {
      boxes: boxes.map((b) => ({ box: b, groups: groups.filter((g) => g.box_id === b.id && !g.parent_id) })),
      loose: groups.filter((g) => !g.box_id && !g.parent_id && g.kind === 'storage'),
      decks: groups.filter((g) => !g.box_id && !g.parent_id && g.kind === 'deck'),
      holding: groups.filter((g) => !g.box_id && !g.parent_id && (g.kind === 'holding' || g.kind === 'lent')),
    }
  }, [c])
  const total = useMemo(() => [...c.stacks.values()].reduce((n, s) => n + s.qty, 0), [c])
  const prices = useVisiblePrices()
  const collectionValue = useMemo(() => valueOf(c, prices, [...c.groups.keys()]), [c, prices])

  const groupLink = (g: Group): React.ReactNode => {
    const kids = sortedChildren(c, g)
    return (
      <li key={g.id}>
        <button type="button" className={selectedGroup === g.id ? 'tree-item on' : 'tree-item'} onClick={() => select('g', g.id)}>
          <span className="tree-item-name">{g.name}</span>
          <span className="count">{countAll(c, g.id)}</span>
        </button>
        {kids.length > 0 && <ul className="tree-list tree-sub">{kids.map(groupLink)}</ul>}
      </li>
    )
  }
  const rowsOf = (groups: Group[]) => {
    const byRow = new Map<string, Group[]>()
    for (const g of groups) byRow.set(g.row_label ?? '', [...(byRow.get(g.row_label ?? '') ?? []), g])
    return [...byRow.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
  }

  if (!ctx.store.loaded) return <p className="muted">{ctx.store.error ?? 'Loading collection…'}</p>

  return (
    <div className="collection">
      <aside className="tree">
        <p className="muted small">
          {ctx.readOnly ? `${ctx.owner.display_name || ctx.owner.username}'s collection` : 'Your collection'} · {total.toLocaleString()} cards
          {collectionValue !== undefined && ` · ≈ ${money(collectionValue)}`}
          {ctx.owner.city && ` · ${ctx.owner.city}`}
        </p>
        {!ctx.readOnly && (
          <div className="chips">
            <button type="button" className="chip" onClick={() => setDialog({ kind: 'box' })}>
              + Box
            </button>
            <button type="button" className="chip" onClick={() => setDialog({ kind: 'group', groupKind: 'storage' })}>
              + Group
            </button>
            <button type="button" className="chip" onClick={() => setDialog({ kind: 'group', groupKind: 'deck' })}>
              + Deck
            </button>
            <button type="button" className="chip" onClick={() => setDialog({ kind: 'custom' })}>
              + Custom card
            </button>
            <button type="button" className="chip" onClick={() => setParams(new URLSearchParams({ view: 'scan' }))}>
              Scan cards
            </button>
            <button type="button" className="chip" onClick={() => setParams(new URLSearchParams({ view: 'data' }))}>
              Import / export
            </button>
          </div>
        )}
        {tree.boxes.map(({ box, groups }) => (
          <section key={box.id} className={selectedBox === box.id ? 'tree-card on' : 'tree-card'}>
            <button type="button" className="tree-card-head" onClick={() => select('b', box.id)}>
              {box.photo_path && <img src={photoUrl(box.photo_path)} alt="" className="tree-thumb" />}
              <span className="tree-card-title">{box.name}</span>
              <span className="count">{groups.reduce((n, g) => n + countAll(c, g.id), 0)}</span>
            </button>
            {rowsOf(groups).map(([row, gs]) => (
              <div key={row} className={row ? 'tree-rowbox' : undefined}>
                {row && <div className="tree-row">{rowName(row)}</div>}
                <ul className="tree-list">{gs.map(groupLink)}</ul>
              </div>
            ))}
            {!groups.length && <p className="muted small tree-empty">No groups yet</p>}
          </section>
        ))}
        {tree.loose.length > 0 && (
          <section className="tree-card">
            <div className="tree-card-head static">
              <span className="tree-card-title">On their own</span>
            </div>
            <ul className="tree-list">{tree.loose.map(groupLink)}</ul>
          </section>
        )}
        {tree.decks.length > 0 && (
          <section className="tree-card">
            <div className="tree-card-head static">
              <span className="tree-card-title">Decks</span>
            </div>
            <ul className="tree-list">{tree.decks.map(groupLink)}</ul>
          </section>
        )}
        <section className="tree-card">
          <div className="tree-card-head static">
            <span className="tree-card-title">In-between</span>
          </div>
          <ul className="tree-list">{tree.holding.map(groupLink)}</ul>
          {!ctx.readOnly && (
            <button type="button" className="link small tree-add" onClick={() => setDialog({ kind: 'group', groupKind: 'holding' })}>
              + in-between area
            </button>
          )}
        </section>
      </aside>

      <section className="pane">
        <PlaceholderRepair />
        {selectedGroup && c.groups.get(selectedGroup) ? (
          <GroupView group={c.groups.get(selectedGroup)!} onDialog={setDialog} />
        ) : selectedBox && c.boxes.get(selectedBox) ? (
          <BoxView box={c.boxes.get(selectedBox)!} onDialog={setDialog} onOpenGroup={(id) => select('g', id)} />
        ) : (
          <p className="muted">
            {c.groups.size ? 'Pick a box or group.' : ctx.readOnly ? 'Nothing here yet.' : 'Start by creating a box or a group.'}
          </p>
        )}
      </section>

      {dialog?.kind === 'box' && <BoxDialog box={dialog.box} onClose={() => setDialog(undefined)} />}
      {dialog?.kind === 'group' && (
        <GroupDialog group={dialog.group} kind={dialog.groupKind} boxId={dialog.boxId} parentId={dialog.parentId} onClose={() => setDialog(undefined)} />
      )}
      {dialog?.kind === 'custom' && <CustomCardDialog onClose={() => setDialog(undefined)} />}
      {dialog?.kind === 'move' && <MoveDialog stack={dialog.stack} onClose={() => setDialog(undefined)} />}
      {dialog?.kind === 'edit' && <EditStackDialog stack={dialog.stack} onClose={() => setDialog(undefined)} />}
      {dialog?.kind === 'remove' && <RemoveDialog stack={dialog.stack} onClose={() => setDialog(undefined)} />}
      {dialog?.kind === 'split' && <SplitDialog stack={dialog.stack} onClose={() => setDialog(undefined)} />}
      {dialog?.kind === 'lend' && <LendDialog stack={dialog.stack} onClose={() => setDialog(undefined)} />}
      {dialog?.kind === 'giveback' && <GiveBackDialog stack={dialog.stack} onClose={() => setDialog(undefined)} />}
      {dialog?.kind === 'bulk-move' && <BulkMoveDialog stacks={dialog.stacks} onClose={() => setDialog(undefined)} />}
      {dialog?.kind === 'move-groups' && <MoveGroupsDialog groups={dialog.groups} onClose={() => setDialog(undefined)} />}
      {dialog?.kind === 'availability' && <AvailabilityAllDialog title={dialog.title} groupIds={dialog.groupIds} onClose={() => setDialog(undefined)} />}
    </div>
  )
}

function Photo({ path }: { path: string | null }) {
  const url = photoUrl(path)
  return url ? <img className="thumb" src={url} alt="" /> : null
}

function BoxView({ box, onDialog, onOpenGroup }: { box: Box; onDialog: (d: Dialog) => void; onOpenGroup: (id: string) => void }) {
  const ctx = useCollectionContext()
  const c = useCollection(ctx.store)
  const groups = [...c.groups.values()].filter((g) => g.box_id === box.id && !g.parent_id).sort((a, b) => (a.row_label ?? '').localeCompare(b.row_label ?? '', undefined, { numeric: true }) || a.name.localeCompare(b.name))
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const toggle = (id: string) => setPicked((p) => (p.has(id) ? new Set([...p].filter((x) => x !== id)) : new Set([...p, id])))
  const prices = useVisiblePrices()
  const boxValue = valueOf(c, prices, groups.flatMap((g) => withSubs(c, g.id)))
  return (
    <div>
      <header className="pane-head">
        <Photo path={box.photo_path} />
        <div>
          <h2>{box.name}</h2>
          {boxValue !== undefined && <p className="muted small">≈ {money(boxValue)}</p>}
          {box.notes && <p className="muted">{box.notes}</p>}
        </div>
        {!ctx.readOnly && (
          <div className="chips">
            <button type="button" className="chip" onClick={() => onDialog({ kind: 'group', groupKind: 'storage', boxId: box.id })}>
              + Group in this box
            </button>
            <button type="button" className="chip" onClick={() => onDialog({ kind: 'box', box })}>
              Edit box
            </button>
            <button
              type="button"
              className="chip"
              onClick={() => onDialog({ kind: 'availability', title: `Borrow / trade for everything in ${box.name}`, groupIds: groups.flatMap((g) => withSubs(c, g.id)) })}
            >
              Borrow / trade…
            </button>
          </div>
        )}
      </header>
      {picked.size > 0 && !ctx.readOnly && (
        <div className="bulkbar">
          {picked.size} selected
          <button type="button" className="chip" onClick={() => onDialog({ kind: 'move-groups', groups: groups.filter((g) => picked.has(g.id)) })}>
            Move to another box…
          </button>
        </div>
      )}
      <ul className="results">
        {groups.map((g) => (
          <li key={g.id} className="row-with-check">
            {!ctx.readOnly && <input type="checkbox" aria-label={`Select ${g.name}`} checked={picked.has(g.id)} onChange={() => toggle(g.id)} />}
            <button type="button" className="result" onClick={() => onOpenGroup(g.id)}>
              <span className="name">{g.name}</span>
              <span className="meta">
                {[rowName(g.row_label), g.kind === 'deck' ? 'Deck' : null, g.ordered ? 'ordered' : null].filter(Boolean).join(' · ')}
              </span>
              <span className="side">
                <span>{countAll(c, g.id)} cards</span>
                {prices && <span className="muted">≈ {money(valueOf(c, prices, withSubs(c, g.id))!)}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {!groups.length && <p className="muted">No groups in this box yet.</p>}
    </div>
  )
}

/** A deck group as a decklist (custom cards can't be exported). */
function rawDeckOf(stacks: Stack[]): RawDeck {
  const deck: RawDeck = { main: [], extra: [], side: [] }
  for (const s of stacks) if (s.card_key) for (let i = 0; i < s.qty; i++) deck[s.section ?? 'main'].push(Number(s.card_key))
  return deck
}

function detailText(s: Stack) {
  return [s.set_code, s.rarity, s.edition, s.condition, s.language !== 'en' ? languageName(s.language) : null, s.note ? `“${s.note}”` : null].filter(Boolean).join(' · ')
}

function GroupView({ group, onDialog }: { group: Group; onDialog: (d: Dialog) => void }) {
  const ctx = useCollectionContext()
  const c = useCollection(ctx.store)
  const [, setParams] = useUrlParams()
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string>()
  const stacks = useMemo(() => {
    const list = [...c.stacks.values()].filter((s) => s.group_id === group.id)
    return group.ordered
      ? list.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      : list.sort((a, b) => nameOfStack(ctx.searcher, c, a).localeCompare(nameOfStack(ctx.searcher, c, b)))
  }, [c, group, ctx.searcher])
  const subs = useMemo(() => sortedChildren(c, group), [c, group])
  const prices = useVisiblePrices()
  const groupValue = valueOf(c, prices, withSubs(c, group.id))
  // One list of cards and sub-groups. Ordered groups interleave them by position; otherwise sub-groups come first.
  type Item = { kind: 'stack'; s: Stack; position: number } | { kind: 'group'; g: Group; position: number }
  const items: Item[] = useMemo(() => {
    const list: Item[] = [
      ...subs.map((g) => ({ kind: 'group' as const, g, position: g.position ?? 0 })),
      ...stacks.map((s) => ({ kind: 'stack' as const, s, position: s.position ?? 0 })),
    ]
    return group.ordered ? list.sort((a, b) => a.position - b.position) : list
  }, [subs, stacks, group.ordered])
  const visiblePicked = stacks.filter((s) => picked.has(s.id))
  const toggle = (id: string) => setPicked((p) => (p.has(id) ? new Set([...p].filter((x) => x !== id)) : new Set([...p, id])))
  const openCard = (s: Stack) => s.card_key && setParams(new URLSearchParams({ view: 'search', card: s.card_key }))

  const sections: (Section | null)[] = group.kind === 'deck' ? ['main', 'extra', 'side'] : [null]
  const run = async (type: string, text: string, fn: Parameters<typeof change>[3]) => {
    setError(await change(ctx, type, text, fn, { batch_id: uuid() }))
    setPicked(new Set())
  }
  const swap = (i: number, j: number) => {
    const a = items[i]
    const b = items[j]
    if (!a || !b) return
    const place = (d: Parameters<Parameters<typeof change>[3]>[0], x: Item, pos: number) =>
      x.kind === 'stack' ? d.reposition(x.s.id, pos) : d.repositionGroup(x.g.id, pos)
    void run('reorder', `Reordered ${group.name}`, (d) => {
      // equal positions (e.g. never set) would swap to the same place, so fall back to list indexes
      const [pa, pb] = a.position === b.position ? [i + 1, j + 1] : [a.position, b.position]
      place(d, a, pb)
      place(d, b, pa)
    })
  }
  const arrows = (i: number) =>
    group.ordered && (
      <>
        <button type="button" className="link" aria-label="Move up" disabled={i === 0} onClick={() => swap(i, i - 1)}>
          ↑
        </button>
        <button type="button" className="link" aria-label="Move down" disabled={i === items.length - 1} onClick={() => swap(i, i + 1)}>
          ↓
        </button>
      </>
    )
  const subRow = (g: Group) => {
    const i = items.findIndex((x) => x.kind === 'group' && x.g.id === g.id)
    return (
      <li key={g.id} className="row-with-check">
        {!ctx.readOnly && <span className="check-spacer" />}
        <div className="stack-row">
          <span className="qty sub-icon" aria-hidden>
            ▸
          </span>
          <span className="stack-main">
            <button type="button" className="link name" onClick={() => setParams(new URLSearchParams({ view: 'collection', g: g.id }))}>
              {g.name}
            </button>
            <span className="meta">
              Sub-group · {countAll(c, g.id)} cards{g.kind === 'deck' ? ' · deck' : ''}
            </span>
          </span>
          {!ctx.readOnly && (
            <span className="row-actions">
              {arrows(i)}
              <button type="button" className="link" onClick={() => onDialog({ kind: 'group', group: g })}>
                Edit
              </button>
            </span>
          )}
        </div>
      </li>
    )
  }

  return (
    <div>
      <header className="pane-head">
        <Photo path={group.photo_path} />
        <div>
          <h2>{group.name}</h2>
          <p className="muted small">
            {groupPath(c, group.id)} · {group.kind === 'deck' ? 'Deck' : group.kind === 'holding' ? 'In-between area' : group.kind === 'lent' ? 'Lent out' : 'Group'}
            {group.ordered ? ' · kept in order' : ''} · {count(c, group.id)}{group.capacity ? ` of ${group.capacity}` : ''} cards
            {subs.length > 0 && ` (+${countAll(c, group.id) - count(c, group.id)} in ${subs.length} sub-group${subs.length > 1 ? 's' : ''})`}
            {groupValue !== undefined && ` · ≈ ${money(groupValue)}`}
          </p>
          {group.notes && <p className="muted">{group.notes}</p>}
        </div>
        {!ctx.readOnly && (
          <div className="chips">
            <button type="button" className="chip" onClick={() => setParams(new URLSearchParams({ view: 'search', add: group.id }))}>
              + Add cards
            </button>
            {group.kind !== 'lent' && (
              <button type="button" className="chip" onClick={() => onDialog({ kind: 'group', groupKind: 'storage', parentId: group.id })}>
                + Sub-group
              </button>
            )}
            <button type="button" className="chip" onClick={() => onDialog({ kind: 'group', group })}>
              Edit
            </button>
            {group.kind !== 'lent' && (
              <button
                type="button"
                className="chip"
                onClick={() => onDialog({ kind: 'availability', title: `Borrow / trade for everything in ${group.name}`, groupIds: withSubs(c, group.id) })}
              >
                Borrow / trade…
              </button>
            )}
            {group.kind === 'deck' && stacks.length > 0 && (
              <>
                <button type="button" className="chip" onClick={() => download(`${group.name.replace(/[^\w -]+/g, '') || 'deck'}.ydk`, toYdk(rawDeckOf(stacks)))}>
                  .ydk
                </button>
                <button type="button" className="chip" onClick={() => navigator.clipboard.writeText(toYdke(rawDeckOf(stacks)))}>
                  Copy ydke://
                </button>
              </>
            )}
          </div>
        )}
      </header>
      {error && <p className="error">{error}</p>}

      {visiblePicked.length > 0 && !ctx.readOnly && (
        <div className="bulkbar">
          {visiblePicked.length} selected ({visiblePicked.reduce((n, s) => n + s.qty, 0)} cards)
          <button type="button" className="chip" onClick={() => onDialog({ kind: 'bulk-move', stacks: visiblePicked })}>
            Move…
          </button>
          {(['trade', 'borrow', 'both', 'none'] as Availability[]).map((a) => (
            <button
              key={a}
              type="button"
              className="chip"
              onClick={() =>
                run('bulk_edit', `Marked ${visiblePicked.length} stacks in ${group.name} as ${a === 'none' ? 'not available' : availabilityTag(a)}`, (d) => {
                  for (const s of visiblePicked) d.edit(s.id, s.qty, { availability: a })
                })
              }
            >
              {a === 'none' ? 'Not available' : a === 'both' ? 'For both' : `For ${a}`}
            </button>
          ))}
          <button
            type="button"
            className="chip danger"
            onClick={() => {
              if (confirm(`Remove ${visiblePicked.reduce((n, s) => n + s.qty, 0)} cards from your collection? History keeps a record.`))
                void run('bulk_remove', `Removed ${visiblePicked.length} stacks from ${group.name}`, (d) => {
                  for (const s of visiblePicked) d.remove(s.id, s.qty)
                })
            }}
          >
            Remove
          </button>
          <button type="button" className="link" onClick={() => setPicked(new Set())}>
            Clear
          </button>
        </div>
      )}

      {group.kind === 'deck' && subs.length > 0 && <ul className="results">{subs.map(subRow)}</ul>}
      {sections.map((section) => {
        const list = stacks.filter((s) => (section ? (s.section ?? 'main') === section : true))
        if (section && !list.length) return null
        // In ordinary groups, cards and sub-groups share one list (and one order).
        const rows: Item[] = section ? list.map((s) => ({ kind: 'stack', s, position: s.position ?? 0 })) : items
        return (
          <section key={section ?? 'all'}>
            {section && (
              <h3>
                {section === 'main' ? 'Main deck' : section === 'extra' ? 'Extra deck' : 'Side deck'} ({list.reduce((n, s) => n + s.qty, 0)})
              </h3>
            )}
            <ul className="results">
              {rows.map((item) => {
                if (item.kind === 'group') return subRow(item.g)
                const s = item.s
                const i = items.findIndex((x) => x.kind === 'stack' && x.s.id === s.id)
                const card = cardOf(ctx.searcher, s)
                const twin = group.ordered ? stacks.find((o) => o.id !== s.id && o.card_key === s.card_key && o.custom_card_id === s.custom_card_id && detailText(o) === detailText(s) && o.availability === s.availability) : undefined
                return (
                  <li key={s.id} className="row-with-check">
                    {!ctx.readOnly && <input type="checkbox" aria-label="Select" checked={picked.has(s.id)} onChange={() => toggle(s.id)} />}
                    <div className="stack-row">
                      <span className="qty">{s.qty}×</span>
                      <span className="stack-main">
                        <button type="button" className="link name" onClick={() => openCard(s)} disabled={!card}>
                          {nameOfStack(ctx.searcher, c, s)}
                        </button>
                        {s.availability !== 'none' && <span className="badge gp">{availabilityTag(s.availability)}</span>}
                        {s.lent_to_name && <span className="badge">lent to {s.lent_to_name}{s.lent_due ? `, due ${s.lent_due}` : ''}</span>}
                        <span className="meta">{detailText(s) || (card ? summary(card) : 'custom card')}</span>
                      </span>
                      {prices && <StackPrice each={stackPrice(prices, s)} qty={s.qty} />}
                      {!ctx.readOnly && (
                        <span className="row-actions">
                          {arrows(i)}
                          {group.kind === 'lent' ? (
                            <button type="button" className="link" onClick={() => onDialog({ kind: 'giveback', stack: s })}>
                              Given back
                            </button>
                          ) : (
                            <button type="button" className="link" onClick={() => onDialog({ kind: 'lend', stack: s })}>
                              Lend
                            </button>
                          )}
                          <button type="button" className="link" onClick={() => onDialog({ kind: 'move', stack: s })}>
                            Move
                          </button>
                          <button type="button" className="link" onClick={() => onDialog({ kind: 'edit', stack: s })}>
                            Edit
                          </button>
                          {group.ordered && s.qty > 1 && (
                            <button type="button" className="link" onClick={() => onDialog({ kind: 'split', stack: s })}>
                              Split
                            </button>
                          )}
                          {twin && (
                            <button type="button" className="link" onClick={() => run('merge', `Merged ${nameOfStack(ctx.searcher, c, s)}`, (d) => d.merge(s.id, twin.id))}>
                              Merge
                            </button>
                          )}
                          <button type="button" className="link" onClick={() => onDialog({ kind: 'remove', stack: s })}>
                            Remove
                          </button>
                        </span>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
      {!stacks.length && !subs.length && <p className="muted">No cards here yet.</p>}
    </div>
  )
}

function BulkMoveDialog({ stacks, onClose }: { stacks: Stack[]; onClose: () => void }) {
  const ctx = useCollectionContext()
  const c = useCollection(ctx.store)
  const [to, setTo] = useState('')
  const [error, setError] = useState<string>()
  const cards = stacks.reduce((n, s) => n + s.qty, 0)
  return (
    <Modal title={`Move ${cards} cards`} onClose={onClose}>
      <form
        className="stack-form"
        onSubmit={async (e) => {
          e.preventDefault()
          const deck = c.groups.get(to)?.kind === 'deck'
          const err = await change(ctx, 'bulk_move', `Moved ${cards} cards to ${groupPath(c, to)}`, (d) => {
            for (const s of stacks) {
              const card = cardOf(ctx.searcher, s)
              const section: Section = s.section ?? (deck && card && ['fusion', 'synchro', 'xyz', 'link'].some((f) => card.f.startsWith(f)) ? 'extra' : 'main')
              d.move(s.id, s.qty, to, section)
            }
          }, { batch_id: uuid() })
          if (err) setError(err)
          else onClose()
        }}
      >
        <label className="field">
          <span>To</span>
          <GroupSelect value={to} onChange={setTo} />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button className="primary">Move</button>
        </div>
      </form>
    </Modal>
  )
}

function MoveGroupsDialog({ groups, onClose }: { groups: Group[]; onClose: () => void }) {
  const ctx = useCollectionContext()
  const c = useCollection(ctx.store)
  const [box, setBox] = useState('')
  const [error, setError] = useState<string>()
  return (
    <Modal title={`Move ${groups.length} group${groups.length > 1 ? 's' : ''}`} onClose={onClose}>
      <form
        className="stack-form"
        onSubmit={async (e) => {
          e.preventDefault()
          const target = box ? c.boxes.get(box)?.name : 'on their own'
          const err = await change(ctx, 'move_groups', `Moved ${groups.map((g) => g.name).join(', ')} to ${target}`, (d) => {
            for (const g of groups) d.updateGroup(g.id, { box_id: box || null, row_label: box ? g.row_label : null })
          }, { batch_id: uuid() })
          if (err) setError(err)
          else onClose()
        }}
      >
        <label className="field">
          <span>To box</span>
          <select value={box} onChange={(e) => setBox(e.target.value)}>
            <option value="">No box (stand on their own)</option>
            {[...c.boxes.values()]
              .filter((b) => b.id !== groups[0]?.box_id)
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
          </select>
        </label>
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button className="primary">Move</button>
        </div>
      </form>
    </Modal>
  )
}

function StackPrice({ each, qty }: { each: number | undefined; qty: number }) {
  if (each === undefined) return <span className="stack-price muted small">no price</span>
  return (
    <span className="stack-price" title="TCGplayer market price">
      {money(each)}
      {qty > 1 && <span className="muted small"> · {money(each * qty)}</span>}
    </span>
  )
}
