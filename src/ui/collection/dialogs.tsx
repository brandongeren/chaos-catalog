import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { myFriends } from '../../core/social.ts'
import {
  CONDITIONS,
  EDITIONS,
  groupPath,
  type Availability,
  type Box,
  type Collection,
  type Condition,
  type Details,
  type Group,
  type GroupKind,
  type Section,
  type Stack,
} from '../../core/collection/model.ts'
import { deletePhoto, uploadPhoto } from '../../core/photos.ts'
import { photoUrl } from '../../core/supabase.ts'
import type { YgoCard } from '../../games/ygo/types.ts'
import { Modal } from '../Modal.tsx'
import { LANGUAGES } from './labels.ts'
import { change, nameOfStack, useCollection, useCollectionContext } from './context.ts'


const AVAILABILITY: [Availability, string][] = [
  ['none', 'Not available'],
  ['borrow', 'Available to borrow'],
  ['trade', 'Available to trade'],
]

const KIND_LABEL: Record<GroupKind, string> = { storage: 'Storage group', deck: 'Deck', holding: 'In-between area', lent: 'Lent out' }

function sortedGroups(c: Collection) {
  return [...c.groups.values()].sort((a, b) => groupPath(c, a.id).localeCompare(groupPath(c, b.id)))
}

export function GroupSelect({ value, onChange, exclude }: { value: string; onChange: (id: string) => void; exclude?: string }) {
  const { store } = useCollectionContext()
  const c = useCollection(store)
  const groups = sortedGroups(c).filter((g) => g.id !== exclude && g.kind !== 'lent')
  const kinds: GroupKind[] = ['storage', 'deck', 'holding']
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} required>
      <option value="" disabled>
        Choose a group…
      </option>
      {kinds.map((k) => (
        <optgroup key={k} label={k === 'storage' ? 'Storage' : k === 'deck' ? 'Decks' : 'In-between'}>
          {groups
            .filter((g) => g.kind === k)
            .map((g) => (
              <option key={g.id} value={g.id}>
                {groupPath(c, g.id)}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  )
}

function Qty({ max, value, onChange }: { max: number; value: number; onChange: (n: number) => void }) {
  return (
    <label className="field">
      <span>How many{max > 1 ? ` (of ${max})` : ''}</span>
      <input type="number" min={1} max={max} required value={value} onChange={(e) => onChange(Math.max(1, Math.min(max, Number(e.target.value) || 1)))} />
    </label>
  )
}

function Actions({ busy, label, error, children }: { busy: boolean; label: string; error?: string; children?: ReactNode }) {
  return (
    <>
      {error && <p className="error">{error}</p>}
      <div className="modal-actions">
        {children}
        <button className="primary" disabled={busy}>
          {label}
        </button>
      </div>
    </>
  )
}

function useSubmit(onDone: () => void) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const submit = (fn: () => Promise<string | undefined | void>) => async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      const err = await fn()
      if (err) setError(err)
      else onDone()
    } catch (x) {
      setError((x as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, submit }
}

/** Optional details. Printing choices come from the card's known printings; "other" allows any set code. */
export function DetailsFields({ card, value, onChange }: { card?: YgoCard; value: Details; onChange: (d: Details) => void }) {
  const printings = card?.p ?? []
  const key = value.set_code ? `${value.set_code}|${value.rarity ?? ''}` : ''
  const known = printings.some((p) => `${p.c}|${p.r}` === key)
  const [other, setOther] = useState(!!value.set_code && !known)
  return (
    <fieldset className="details">
      <legend>Details (all optional)</legend>
      {printings.length > 0 && !other ? (
        <label className="field">
          <span>Printing (set code and rarity)</span>
          <select
            value={known ? key : ''}
            onChange={(e) => {
              if (e.target.value === '__other') return setOther(true)
              const [c, r] = e.target.value.split('|')
              onChange({ ...value, set_code: c || null, rarity: r || null })
            }}
          >
            <option value="">Not recorded</option>
            {[...printings]
              .sort((a, b) => a.c.localeCompare(b.c))
              .map((p) => (
                <option key={`${p.c}|${p.r}`} value={`${p.c}|${p.r}`}>
                  {p.c} · {p.r} · {p.s}
                </option>
              ))}
            <option value="__other">Other…</option>
          </select>
        </label>
      ) : (
        <div className="row2">
          <label className="field">
            <span>Set code</span>
            <input value={value.set_code ?? ''} placeholder="e.g. LOB-EN001" onChange={(e) => onChange({ ...value, set_code: e.target.value.toUpperCase() || null })} />
          </label>
          <label className="field">
            <span>Rarity</span>
            <input value={value.rarity ?? ''} placeholder="e.g. Ultra Rare" onChange={(e) => onChange({ ...value, rarity: e.target.value || null })} />
          </label>
        </div>
      )}
      <div className="row3">
        <label className="field">
          <span>Edition</span>
          <select value={value.edition ?? ''} onChange={(e) => onChange({ ...value, edition: e.target.value || null })}>
            <option value="">Not recorded</option>
            {EDITIONS.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Condition</span>
          <select value={value.condition ?? ''} onChange={(e) => onChange({ ...value, condition: (e.target.value || null) as Condition | null })}>
            <option value="">Not recorded</option>
            {CONDITIONS.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Language</span>
          <select value={value.language} onChange={(e) => onChange({ ...value, language: e.target.value })}>
            {LANGUAGES.map(([c, n]) => (
              <option key={c} value={c}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
    </fieldset>
  )
}

function SectionSelect({ value, onChange }: { value: Section; onChange: (s: Section) => void }) {
  return (
    <label className="field">
      <span>Deck section</span>
      <select value={value} onChange={(e) => onChange(e.target.value as Section)}>
        <option value="main">Main deck</option>
        <option value="extra">Extra deck</option>
        <option value="side">Side deck</option>
      </select>
    </label>
  )
}

const defaultSection = (card?: YgoCard): Section =>
  card && ['fusion', 'synchro', 'xyz', 'link'].some((f) => card.f.startsWith(f)) ? 'extra' : 'main'

// ------------------------------------------------------------------ cards

export function AddCardDialog({ card, onClose, initialGroup }: { card: YgoCard; onClose: () => void; initialGroup?: string }) {
  const ctx = useCollectionContext()
  const c = useCollection(ctx.store)
  const fallback = [...c.groups.values()].find((g) => g.kind === 'holding')?.id ?? ''
  const [groupId, setGroupId] = useState(initialGroup ?? localStorage.getItem('lastGroup') ?? fallback)
  const [qty, setQty] = useState(1)
  const [details, setDetails] = useState<Details>({ set_code: null, rarity: null, edition: null, language: 'en', condition: null })
  const [availability, setAvailability] = useState<Availability>('none')
  const [section, setSection] = useState<Section>(defaultSection(card))
  const { busy, error, submit } = useSubmit(onClose)
  const target = c.groups.get(groupId)
  return (
    <Modal title={`Add ${card.n}`} onClose={onClose}>
      <form
        className="stack-form"
        onSubmit={submit(async () => {
          if (!c.groups.has(groupId)) return 'Choose a group'
          localStorage.setItem('lastGroup', groupId)
          return change(ctx, 'add', `Added ${qty}× ${card.n} to ${groupPath(c, groupId)}`, (d) =>
            d.add({ card_key: String(card.id), qty, details, availability, section }, groupId),
          )
        })}
      >
        <label className="field">
          <span>Where</span>
          <GroupSelect value={c.groups.has(groupId) ? groupId : ''} onChange={setGroupId} />
        </label>
        <label className="field">
          <span>How many</span>
          <input type="number" min={1} max={999} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} />
        </label>
        {target?.kind === 'deck' && <SectionSelect value={section} onChange={setSection} />}
        <DetailsFields card={card} value={details} onChange={setDetails} />
        <label className="field">
          <span>Borrow / trade</span>
          <select value={availability} onChange={(e) => setAvailability(e.target.value as Availability)}>
            {AVAILABILITY.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <Actions busy={busy} label="Add" error={error} />
      </form>
    </Modal>
  )
}

export function MoveDialog({ stack, onClose }: { stack: Stack; onClose: () => void }) {
  const ctx = useCollectionContext()
  const c = useCollection(ctx.store)
  const [qty, setQty] = useState(stack.qty)
  const [to, setTo] = useState('')
  const card = stack.card_key ? ctx.searcher.byId.get(Number(stack.card_key)) : undefined
  const [section, setSection] = useState<Section>(stack.section ?? defaultSection(card))
  const { busy, error, submit } = useSubmit(onClose)
  const name = nameOfStack(ctx.searcher, c, stack)
  return (
    <Modal title={`Move ${name}`} onClose={onClose}>
      <form
        className="stack-form"
        onSubmit={submit(() =>
          change(ctx, 'move', `Moved ${qty}× ${name} from ${groupPath(c, stack.group_id)} to ${groupPath(c, to)}`, (d) =>
            d.move(stack.id, qty, to, section),
          ),
        )}
      >
        <p className="muted small">From {groupPath(c, stack.group_id)}</p>
        <Qty max={stack.qty} value={qty} onChange={setQty} />
        <label className="field">
          <span>To</span>
          <GroupSelect value={to} onChange={setTo} exclude={stack.group_id} />
        </label>
        {c.groups.get(to)?.kind === 'deck' && <SectionSelect value={section} onChange={setSection} />}
        <Actions busy={busy} label="Move" error={error} />
      </form>
    </Modal>
  )
}

export function EditStackDialog({ stack, onClose }: { stack: Stack; onClose: () => void }) {
  const ctx = useCollectionContext()
  const c = useCollection(ctx.store)
  const card = stack.card_key ? ctx.searcher.byId.get(Number(stack.card_key)) : undefined
  const [qty, setQty] = useState(stack.qty)
  const [details, setDetails] = useState<Details>({
    set_code: stack.set_code,
    rarity: stack.rarity,
    edition: stack.edition,
    language: stack.language,
    condition: stack.condition,
  })
  const [availability, setAvailability] = useState(stack.availability)
  const [section, setSection] = useState<Section>(stack.section ?? 'main')
  const isDeck = c.groups.get(stack.group_id)?.kind === 'deck'
  const { busy, error, submit } = useSubmit(onClose)
  const name = nameOfStack(ctx.searcher, c, stack)
  return (
    <Modal title={`Edit ${name}`} onClose={onClose}>
      <form
        className="stack-form"
        onSubmit={submit(() =>
          change(ctx, 'edit', `Edited ${qty}× ${name} in ${groupPath(c, stack.group_id)}`, (d) =>
            d.edit(stack.id, qty, { ...details, availability, ...(isDeck ? { section } : {}) }),
          ),
        )}
      >
        <Qty max={stack.qty} value={qty} onChange={setQty} />
        {stack.qty > 1 && <p className="muted small">Editing fewer than all {stack.qty} splits them into their own stack.</p>}
        {isDeck && <SectionSelect value={section} onChange={setSection} />}
        <DetailsFields card={card} value={details} onChange={setDetails} />
        <label className="field">
          <span>Borrow / trade</span>
          <select value={availability} onChange={(e) => setAvailability(e.target.value as Availability)}>
            {AVAILABILITY.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <Actions busy={busy} label="Save" error={error} />
      </form>
    </Modal>
  )
}

export function RemoveDialog({ stack, onClose }: { stack: Stack; onClose: () => void }) {
  const ctx = useCollectionContext()
  const c = useCollection(ctx.store)
  const [qty, setQty] = useState(stack.qty)
  const { busy, error, submit } = useSubmit(onClose)
  const name = nameOfStack(ctx.searcher, c, stack)
  return (
    <Modal title={`Remove ${name}`} onClose={onClose}>
      <form
        className="stack-form"
        onSubmit={submit(() =>
          change(ctx, 'remove', `Removed ${qty}× ${name} from ${groupPath(c, stack.group_id)}`, (d) => d.remove(stack.id, qty)),
        )}
      >
        <p className="small">
          Takes the cards out of your collection. History keeps a record, so you can put them back into any group later.
          To keep them tracked while you play, move them to a deck or an in-between area instead.
        </p>
        <Qty max={stack.qty} value={qty} onChange={setQty} />
        <Actions busy={busy} label="Remove" error={error} />
      </form>
    </Modal>
  )
}

export function SplitDialog({ stack, onClose }: { stack: Stack; onClose: () => void }) {
  const ctx = useCollectionContext()
  const c = useCollection(ctx.store)
  const [qty, setQty] = useState(1)
  const { busy, error, submit } = useSubmit(onClose)
  const name = nameOfStack(ctx.searcher, c, stack)
  return (
    <Modal title={`Split ${name}`} onClose={onClose}>
      <form className="stack-form" onSubmit={submit(() => change(ctx, 'split', `Split ${qty}× ${name} into their own stack`, (d) => d.split(stack.id, qty)))}>
        <Qty max={stack.qty - 1} value={qty} onChange={setQty} />
        <Actions busy={busy} label="Split" error={error} />
      </form>
    </Modal>
  )
}

// ------------------------------------------------------------------ boxes and groups

function PhotoField({ path, onChange }: { path: string | null; onChange: (file: File | null | undefined) => void }) {
  const [preview, setPreview] = useState<string | undefined>(photoUrl(path))
  return (
    <label className="field">
      <span>Photo (optional; stored as a small thumbnail)</span>
      {preview && <img className="thumb" src={preview} alt="" />}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => {
          const f = e.target.files?.[0]
          onChange(f)
          if (f) setPreview(URL.createObjectURL(f))
        }}
      />
      {preview && (
        <button
          type="button"
          className="link small"
          onClick={() => {
            onChange(null)
            setPreview(undefined)
          }}
        >
          Remove photo
        </button>
      )}
    </label>
  )
}

/** undefined = unchanged, null = removed, File = new photo. */
async function resolvePhoto(ownerId: string, old: string | null, file: File | null | undefined) {
  if (file === undefined) return old
  if (old) await deletePhoto(old).catch(() => {})
  return file ? uploadPhoto(ownerId, file) : null
}

export function BoxDialog({ box, onClose }: { box?: Box; onClose: () => void }) {
  const ctx = useCollectionContext()
  const [name, setName] = useState(box?.name ?? '')
  const [notes, setNotes] = useState(box?.notes ?? '')
  const [file, setFile] = useState<File | null>()
  const { busy, error, submit } = useSubmit(onClose)
  return (
    <Modal title={box ? `Edit ${box.name}` : 'New box'} onClose={onClose}>
      <form
        className="stack-form"
        onSubmit={submit(async () => {
          const photo_path = await resolvePhoto(ctx.owner.id, box?.photo_path ?? null, file)
          return box
            ? change(ctx, 'edit_box', `Edited box ${name}`, (d) => d.updateBox(box.id, { name, notes, photo_path }))
            : change(ctx, 'create_box', `Created box ${name}`, (d) => void d.createBox(name, { notes, photo_path }))
        })}
      >
        <label className="field">
          <span>Name</span>
          <input required value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label className="field">
          <span>Notes</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <PhotoField path={box?.photo_path ?? null} onChange={setFile} />
        <Actions busy={busy} label={box ? 'Save' : 'Create'} error={error}>
          {box && (
            <button
              type="button"
              className="danger"
              onClick={submit(async () => {
                const err = await change(ctx, 'delete_box', `Deleted box ${box.name}`, (d) => d.deleteBox(box.id))
                if (!err) await deletePhoto(box.photo_path).catch(() => {})
                return err
              })}
            >
              Delete box
            </button>
          )}
        </Actions>
      </form>
    </Modal>
  )
}

export function GroupDialog({ group, kind, boxId, onClose }: { group?: Group; kind?: GroupKind; boxId?: string | null; onClose: () => void }) {
  const ctx = useCollectionContext()
  const c = useCollection(ctx.store)
  const [name, setName] = useState(group?.name ?? '')
  const [box, setBox] = useState<string>(group?.box_id ?? boxId ?? '')
  const [row, setRow] = useState(group?.row_label ?? '')
  const [groupKind, setKind] = useState<GroupKind>(group?.kind ?? kind ?? 'storage')
  const [ordered, setOrdered] = useState(group?.ordered ?? ctx.owner.group_ordered_default)
  const [notes, setNotes] = useState(group?.notes ?? '')
  const [file, setFile] = useState<File | null>()
  const { busy, error, submit } = useSubmit(onClose)
  const rows = [...new Set([...c.groups.values()].filter((g) => g.box_id === box && g.row_label).map((g) => g.row_label!))]
  const boxes = [...c.boxes.values()].sort((a, b) => a.name.localeCompare(b.name))
  return (
    <Modal title={group ? `Edit ${group.name}` : `New ${KIND_LABEL[groupKind].toLowerCase()}`} onClose={onClose}>
      <form
        className="stack-form"
        onSubmit={submit(async () => {
          const photo_path = await resolvePhoto(ctx.owner.id, group?.photo_path ?? null, file)
          const fields = { name, box_id: box || null, row_label: row.trim() || null, kind: groupKind, ordered, notes, photo_path }
          return group
            ? change(ctx, 'edit_group', `Edited ${name}`, (d) => d.updateGroup(group.id, fields))
            : change(ctx, 'create_group', `Created ${KIND_LABEL[groupKind].toLowerCase()} ${name}`, (d) => void d.createGroup(name, fields))
        })}
      >
        <label className="field">
          <span>Name</span>
          <input required value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        {group?.kind !== 'lent' && (
          <label className="field">
            <span>Type</span>
            <select value={groupKind} onChange={(e) => setKind(e.target.value as GroupKind)}>
              <option value="storage">Storage group</option>
              <option value="deck">Deck (Main / Extra / Side)</option>
              <option value="holding">In-between area</option>
            </select>
          </label>
        )}
        <label className="field">
          <span>Inside a box?</span>
          <select value={box} onChange={(e) => setBox(e.target.value)}>
            <option value="">No: it stands on its own (binder, deck box, …)</option>
            {boxes.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        {box && (
          <label className="field">
            <span>Row (optional label inside the box)</span>
            <input value={row} list="row-labels" placeholder="e.g. Row 2" onChange={(e) => setRow(e.target.value)} />
            <datalist id="row-labels">
              {rows.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </label>
        )}
        <label className="check">
          <input type="checkbox" checked={ordered} onChange={(e) => setOrdered(e.target.checked)} /> Cards are kept in a set order
        </label>
        <label className="field">
          <span>Notes</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <PhotoField path={group?.photo_path ?? null} onChange={setFile} />
        <Actions busy={busy} label={group ? 'Save' : 'Create'} error={error}>
          {group && (
            <button
              type="button"
              className="danger"
              onClick={submit(async () => {
                const err = await change(ctx, 'delete_group', `Deleted ${group.name}`, (d) => d.deleteGroup(group.id))
                if (!err) await deletePhoto(group.photo_path).catch(() => {})
                return err
              })}
            >
              Delete
            </button>
          )}
        </Actions>
      </form>
    </Modal>
  )
}

export function CustomCardDialog({ onClose }: { onClose: () => void }) {
  const ctx = useCollectionContext()
  const c = useCollection(ctx.store)
  const [name, setName] = useState('')
  const [kind, setKindText] = useState('')
  const [notes, setNotes] = useState('')
  const [qty, setQty] = useState(1)
  const [groupId, setGroupId] = useState(localStorage.getItem('lastGroup') ?? '')
  const { busy, error, submit } = useSubmit(onClose)
  return (
    <Modal title="Add a custom card" onClose={onClose}>
      <form
        className="stack-form"
        onSubmit={submit(() =>
          change(ctx, 'add', `Added ${qty}× ${name} (custom) to ${groupPath(c, groupId)}`, (d) => {
            const custom = d.createCustomCard(name, kind ? { kind } : {}, notes)
            d.add({ custom_card_id: custom.id, qty }, groupId)
          }),
        )}
      >
        <p className="muted small">For anything not in the card database: proxies, tokens, cards from other games, …</p>
        <label className="field">
          <span>Name</span>
          <input required value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label className="field">
          <span>What is it? (optional)</span>
          <input value={kind} placeholder="e.g. Proxy, Token, Pokémon card" onChange={(e) => setKindText(e.target.value)} />
        </label>
        <label className="field">
          <span>Notes</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <label className="field">
          <span>Where</span>
          <GroupSelect value={c.groups.has(groupId) ? groupId : ''} onChange={setGroupId} />
        </label>
        <label className="field">
          <span>How many</span>
          <input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} />
        </label>
        <Actions busy={busy} label="Add" error={error} />
      </form>
    </Modal>
  )
}

export function LendDialog({ stack, onClose }: { stack: Stack; onClose: () => void }) {
  const ctx = useCollectionContext()
  const c = useCollection(ctx.store)
  const [qty, setQty] = useState(stack.qty)
  const [friends, setFriends] = useState<{ id: string; username: string }[]>([])
  const [who, setWho] = useState('')
  const [due, setDue] = useState('')
  const { busy, error, submit } = useSubmit(onClose)
  const name = nameOfStack(ctx.searcher, c, stack)
  useEffect(() => {
    myFriends().then((f) => setFriends(f.filter((x) => x.status === 'accepted')), () => {})
  }, [])
  const friend = friends.find((f) => f.username === who.trim().toLowerCase())
  return (
    <Modal title={`Lend ${name}`} onClose={onClose}>
      <form
        className="stack-form"
        onSubmit={submit(() =>
          change(ctx, 'lend', `Lent ${qty}× ${name} to ${who.trim()}`, (d) => d.lend(stack.id, qty, { user: friend?.id ?? null, name: who, due: due || null })),
        )}
      >
        <p className="muted small">The cards move to "Lent out" and remember where they came from, so giving them back is one click.</p>
        <Qty max={stack.qty} value={qty} onChange={setQty} />
        <label className="field">
          <span>Lent to (a friend's username, or any name)</span>
          <input required value={who} list="friend-names" onChange={(e) => setWho(e.target.value)} />
          <datalist id="friend-names">
            {friends.map((f) => (
              <option key={f.id} value={f.username} />
            ))}
          </datalist>
        </label>
        <label className="field">
          <span>Due back (optional)</span>
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        <Actions busy={busy} label="Lend" error={error} />
      </form>
    </Modal>
  )
}

export function GiveBackDialog({ stack, onClose }: { stack: Stack; onClose: () => void }) {
  const ctx = useCollectionContext()
  const c = useCollection(ctx.store)
  const [qty, setQty] = useState(stack.qty)
  const home = stack.lent_from_group && c.groups.has(stack.lent_from_group) ? stack.lent_from_group : ''
  const [to, setTo] = useState(home)
  const { busy, error, submit } = useSubmit(onClose)
  const name = nameOfStack(ctx.searcher, c, stack)
  return (
    <Modal title={`${stack.lent_to_name} gave back ${name}`} onClose={onClose}>
      <form
        className="stack-form"
        onSubmit={submit(() => change(ctx, 'return', `${stack.lent_to_name} gave back ${qty}× ${name}`, (d) => d.giveBack(stack.id, qty, to || undefined)))}
      >
        <Qty max={stack.qty} value={qty} onChange={setQty} />
        <label className="field">
          <span>Put them {home ? 'back' : ''} into</span>
          <GroupSelect value={to} onChange={setTo} />
        </label>
        <Actions busy={busy} label="Done" error={error} />
      </form>
    </Modal>
  )
}
