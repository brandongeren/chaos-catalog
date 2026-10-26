import { useMemo, useState } from 'react'
import { groupPath, uuid, type Availability, type Box, type Collection, type Group, type Section, type Stack } from '../../core/collection/model.ts'
import { photoUrl } from '../../core/supabase.ts'
import { useUrlParams } from '../../lib/useUrlParams.ts'
import { summary } from '../../games/ygo/classify.ts'
import { Modal } from '../Modal.tsx'
import { toYdk, toYdke, type RawDeck } from '../../games/ygo/decks.ts'
import { download } from '../../lib/download.ts'
import { cardOf, change, nameOfStack, useCollection, useCollectionContext } from './context.ts'
import {
  BoxDialog,
  CustomCardDialog,
  EditStackDialog,
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
  | { kind: 'group'; group?: Group; groupKind?: Group['kind']; boxId?: string | null }
  | { kind: 'move' | 'edit' | 'remove' | 'split' | 'lend' | 'giveback'; stack: Stack }
  | { kind: 'custom' }
  | { kind: 'bulk-move'; stacks: Stack[] }
  | { kind: 'move-groups'; groups: Group[] }

const count = (c: Collection, groupId: string) => {
  let n = 0
  for (const s of c.stacks.values()) if (s.group_id === groupId) n += s.qty
  return n
}

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
  }

  const tree = useMemo(() => {
    const groups = [...c.groups.values()].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    const boxes = [...c.boxes.values()].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    return {
      boxes: boxes.map((b) => ({ box: b, groups: groups.filter((g) => g.box_id === b.id) })),
      loose: groups.filter((g) => !g.box_id && g.kind === 'storage'),
      decks: groups.filter((g) => !g.box_id && g.kind === 'deck'),
      holding: groups.filter((g) => !g.box_id && (g.kind === 'holding' || g.kind === 'lent')),
    }
  }, [c])
  const total = useMemo(() => [...c.stacks.values()].reduce((n, s) => n + s.qty, 0), [c])

  const groupLink = (g: Group) => (
    <li key={g.id}>
      <button type="button" className={selectedGroup === g.id ? 'tree-item on' : 'tree-item'} onClick={() => select('g', g.id)}>
        <span>{g.name}</span>
        <span className="muted">{count(c, g.id)}</span>
      </button>
    </li>
  )
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
          <section key={box.id}>
            <button type="button" className={selectedBox === box.id ? 'tree-box on' : 'tree-box'} onClick={() => select('b', box.id)}>
              {box.photo_path && <img src={photoUrl(box.photo_path)} alt="" className="tree-thumb" />}
              {box.name}
            </button>
            {rowsOf(groups).map(([row, gs]) => (
              <div key={row}>
                {row && <div className="tree-row muted small">{row}</div>}
                <ul>{gs.map(groupLink)}</ul>
              </div>
            ))}
          </section>
        ))}
        {tree.loose.length > 0 && (
          <section>
            <div className="tree-heading">On their own</div>
            <ul>{tree.loose.map(groupLink)}</ul>
          </section>
        )}
        {tree.decks.length > 0 && (
          <section>
            <div className="tree-heading">Decks</div>
            <ul>{tree.decks.map(groupLink)}</ul>
          </section>
        )}
        <section>
          <div className="tree-heading">In-between</div>
          <ul>{tree.holding.map(groupLink)}</ul>
          {!ctx.readOnly && (
            <button type="button" className="link small" onClick={() => setDialog({ kind: 'group', groupKind: 'holding' })}>
              + in-between area
            </button>
          )}
        </section>
      </aside>

      <section className="pane">
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
        <GroupDialog group={dialog.group} kind={dialog.groupKind} boxId={dialog.boxId} onClose={() => setDialog(undefined)} />
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
  const groups = [...c.groups.values()].filter((g) => g.box_id === box.id).sort((a, b) => (a.row_label ?? '').localeCompare(b.row_label ?? '', undefined, { numeric: true }) || a.name.localeCompare(b.name))
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const toggle = (id: string) => setPicked((p) => (p.has(id) ? new Set([...p].filter((x) => x !== id)) : new Set([...p, id])))
  return (
    <div>
      <header className="pane-head">
        <Photo path={box.photo_path} />
        <div>
          <h2>{box.name}</h2>
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
                {[g.row_label, g.kind === 'deck' ? 'Deck' : null, g.ordered ? 'ordered' : null].filter(Boolean).join(' · ')}
              </span>
              <span className="side">{count(c, g.id)} cards</span>
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
  return [s.set_code, s.rarity, s.edition, s.condition, s.language !== 'en' ? languageName(s.language) : null].filter(Boolean).join(' · ')
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
  const visiblePicked = stacks.filter((s) => picked.has(s.id))
  const toggle = (id: string) => setPicked((p) => (p.has(id) ? new Set([...p].filter((x) => x !== id)) : new Set([...p, id])))
  const openCard = (s: Stack) => s.card_key && setParams(new URLSearchParams({ view: 'search', card: s.card_key }))

  const sections: (Section | null)[] = group.kind === 'deck' ? ['main', 'extra', 'side'] : [null]
  const run = async (type: string, text: string, fn: Parameters<typeof change>[3]) => {
    setError(await change(ctx, type, text, fn, { batch_id: uuid() }))
    setPicked(new Set())
  }
  const swap = (i: number, j: number) => {
    const a = stacks[i]
    const b = stacks[j]
    if (!a || !b) return
    void run('reorder', `Reordered ${group.name}`, (d) => {
      d.reposition(a.id, b.position ?? j)
      d.reposition(b.id, a.position ?? i)
    })
  }

  return (
    <div>
      <header className="pane-head">
        <Photo path={group.photo_path} />
        <div>
          <h2>{group.name}</h2>
          <p className="muted small">
            {groupPath(c, group.id)} · {group.kind === 'deck' ? 'Deck' : group.kind === 'holding' ? 'In-between area' : group.kind === 'lent' ? 'Lent out' : 'Group'}
            {group.ordered ? ' · kept in order' : ''} · {count(c, group.id)} cards
          </p>
          {group.notes && <p className="muted">{group.notes}</p>}
        </div>
        {!ctx.readOnly && (
          <div className="chips">
            <button type="button" className="chip" onClick={() => setParams(new URLSearchParams({ view: 'search', add: group.id }))}>
              + Add cards
            </button>
            <button type="button" className="chip" onClick={() => onDialog({ kind: 'group', group })}>
              Edit
            </button>
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
          {(['trade', 'borrow', 'none'] as Availability[]).map((a) => (
            <button
              key={a}
              type="button"
              className="chip"
              onClick={() =>
                run('bulk_edit', `Marked ${visiblePicked.length} stacks in ${group.name} as ${a === 'none' ? 'not available' : `available to ${a}`}`, (d) => {
                  for (const s of visiblePicked) d.edit(s.id, s.qty, { availability: a })
                })
              }
            >
              {a === 'none' ? 'Not available' : `For ${a}`}
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

      {sections.map((section) => {
        const list = stacks.filter((s) => (section ? (s.section ?? 'main') === section : true))
        if (section && !list.length) return null
        return (
          <section key={section ?? 'all'}>
            {section && (
              <h3>
                {section === 'main' ? 'Main deck' : section === 'extra' ? 'Extra deck' : 'Side deck'} ({list.reduce((n, s) => n + s.qty, 0)})
              </h3>
            )}
            <ul className="results">
              {list.map((s) => {
                const i = stacks.indexOf(s)
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
                        {s.availability !== 'none' && <span className="badge gp">for {s.availability}</span>}
                        {s.lent_to_name && <span className="badge">lent to {s.lent_to_name}{s.lent_due ? `, due ${s.lent_due}` : ''}</span>}
                        <span className="meta">{detailText(s) || (card ? summary(card) : 'custom card')}</span>
                      </span>
                      {!ctx.readOnly && (
                        <span className="row-actions">
                          {group.ordered && (
                            <>
                              <button type="button" className="link" aria-label="Move up" disabled={i === 0} onClick={() => swap(i, i - 1)}>
                                ↑
                              </button>
                              <button type="button" className="link" aria-label="Move down" disabled={i === stacks.length - 1} onClick={() => swap(i, i + 1)}>
                                ↓
                              </button>
                            </>
                          )}
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
      {!stacks.length && <p className="muted">No cards here yet.</p>}
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
