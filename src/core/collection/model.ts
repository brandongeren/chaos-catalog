// The collection model and the only way to change it: a Draft collects edits against a working copy and finishes
// as one Op (the unit the server's apply_ops() applies, logs to history, and rejects if anything changed meanwhile).
// The same Op is applied locally with applyOp(), so the screen updates before the server answers.
//
// Game-agnostic: cards are `game` + `card_key` (a Yu-Gi-Oh! passcode), or a user-made custom card.

export type Table = 'boxes' | 'groups' | 'custom_cards' | 'stacks'
export type GroupKind = 'storage' | 'deck' | 'holding' | 'lent'
export type Condition = 'NM' | 'LP' | 'MP' | 'HP' | 'Damaged'
export type Availability = 'none' | 'borrow' | 'trade'
export type Section = 'main' | 'extra' | 'side'

export const CONDITIONS: Condition[] = ['NM', 'LP', 'MP', 'HP', 'Damaged']
export const EDITIONS = ['1st Edition', 'Unlimited', 'Limited']

export interface Box {
  id: string
  name: string
  notes: string
  photo_path: string | null
  sort_order: number
  version: number
}

export interface Group {
  id: string
  box_id: string | null
  row_label: string | null
  name: string
  kind: GroupKind
  ordered: boolean
  notes: string
  photo_path: string | null
  sort_order: number
  version: number
}

export interface CustomCard {
  id: string
  name: string
  fields: Record<string, string>
  notes: string
  version: number
}

/** Details a user may record about copies. All optional except language (default "en"). */
export interface Details {
  set_code: string | null
  rarity: string | null
  edition: string | null
  language: string
  condition: Condition | null
}

export interface Stack extends Details {
  id: string
  group_id: string
  game: string
  card_key: string | null
  custom_card_id: string | null
  qty: number
  section: Section | null
  position: number | null
  availability: Availability
  lent_to_user: string | null
  lent_to_name: string | null
  lent_due: string | null
  lent_from_group: string | null
  version: number
}

export interface Collection {
  boxes: Map<string, Box>
  groups: Map<string, Group>
  custom_cards: Map<string, CustomCard>
  stacks: Map<string, Stack>
}

export type Row = Box | Group | CustomCard | Stack

/** One card line in an op's summary: what moved, so history can show it and re-add it later. */
export interface CardLine {
  game: string
  card_key: string | null
  custom_card_id: string | null
  name: string
  qty: number
  details: Details
  from?: string | null
  to?: string | null
}

export interface OpSummary {
  text: string
  cards?: CardLine[]
}

export interface Op {
  client_op_id: string
  batch_id?: string
  device?: string
  created_at: string
  type: string
  summary: OpSummary
  expect: { t: Table; id: string; v: number }[]
  put: { t: Table; row: Row }[]
  del: { t: Table; id: string }[]
}

export const emptyCollection = (): Collection => ({
  boxes: new Map(),
  groups: new Map(),
  custom_cards: new Map(),
  stacks: new Map(),
})

export const uuid = () => crypto.randomUUID()

/** Fields that make two stacks "the same copies" (mergeable). Position and qty don't count. */
const IDENTITY: (keyof Stack)[] = [
  'game',
  'card_key',
  'custom_card_id',
  'set_code',
  'rarity',
  'edition',
  'language',
  'condition',
  'section',
  'availability',
  'lent_to_user',
  'lent_to_name',
  'lent_due',
  'lent_from_group',
]

export const sameCopies = (a: Stack, b: Stack) => IDENTITY.every((k) => (a[k] ?? null) === (b[k] ?? null))

export const detailsOf = (s: Stack): Details => ({
  set_code: s.set_code,
  rarity: s.rarity,
  edition: s.edition,
  language: s.language,
  condition: s.condition,
})

export const noDetails = (): Details => ({ set_code: null, rarity: null, edition: null, language: 'en', condition: null })

export class CollectionError extends Error {}

/** Location label, e.g. "Box 3 › Row 2 › Fire" or "Deck box: Snake-Eye". */
export function groupPath(c: Collection, groupId: string | null | undefined): string {
  const g = groupId ? c.groups.get(groupId) : undefined
  if (!g) return 'removed'
  const box = g.box_id ? c.boxes.get(g.box_id) : undefined
  return [box?.name, g.row_label, g.name].filter(Boolean).join(' › ')
}

export interface AddInput {
  game?: string
  card_key?: string | null
  custom_card_id?: string | null
  qty: number
  details?: Partial<Details>
  section?: Section | null
  availability?: Availability
  /** Imported loans: who has the copies (no account link). */
  loan?: { lent_to_name: string; lent_due: string | null; lent_from_group: string | null }
}

export class Draft {
  private readonly base: Collection
  private readonly work: Collection
  private readonly touched = new Map<string, { t: Table; v: number }>()
  readonly lines: CardLine[] = []

  private readonly nameOf: (s: Pick<Stack, 'game' | 'card_key' | 'custom_card_id'>) => string

  constructor(collection: Collection, nameOf: (s: Pick<Stack, 'game' | 'card_key' | 'custom_card_id'>) => string) {
    this.nameOf = nameOf
    this.base = collection
    this.work = {
      boxes: new Map(collection.boxes),
      groups: new Map(collection.groups),
      custom_cards: new Map(collection.custom_cards),
      stacks: new Map(collection.stacks),
    }
  }

  /** The working copy, with this draft's edits so far. */
  get collection(): Collection {
    return this.work
  }

  private touch(t: Table, id: string) {
    if (!this.touched.has(id)) this.touched.set(id, { t, v: this.base[t].get(id)?.version ?? 0 })
  }

  private set<T extends Row>(t: Table, row: T) {
    this.touch(t, row.id)
    ;(this.work[t] as Map<string, Row>).set(row.id, row)
  }

  private drop(t: Table, id: string) {
    this.touch(t, id)
    this.work[t].delete(id)
  }

  private group(id: string): Group {
    const g = this.work.groups.get(id)
    if (!g) throw new CollectionError('That group no longer exists')
    return g
  }

  private stack(id: string): Stack {
    const s = this.work.stacks.get(id)
    if (!s) throw new CollectionError('Those cards are no longer there')
    return s
  }

  private line(s: Stack, qty: number, from: string | null, to: string | null) {
    this.lines.push({
      game: s.game,
      card_key: s.card_key,
      custom_card_id: s.custom_card_id,
      name: this.nameOf(s),
      qty,
      details: detailsOf(s),
      from,
      to,
    })
  }

  private nextPosition(groupId: string) {
    let max = 0
    for (const s of this.work.stacks.values()) if (s.group_id === groupId && s.position !== null) max = Math.max(max, s.position)
    return max + 1
  }

  /**
   * Puts `qty` copies (described by `proto`) into a group: merged into an identical stack in an unordered group,
   * otherwise a new stack (at the end of an ordered group). Returns the stack that holds them.
   */
  private place(proto: Omit<Stack, 'id' | 'qty' | 'version' | 'group_id' | 'position'>, qty: number, groupId: string): Stack {
    const g = this.group(groupId)
    const candidate = { ...proto, group_id: groupId } as Stack
    if (!g.ordered) {
      for (const s of this.work.stacks.values())
        if (s.group_id === groupId && sameCopies(s, candidate)) {
          const merged = { ...s, qty: s.qty + qty }
          this.set('stacks', merged)
          return merged
        }
    }
    const created: Stack = {
      ...proto,
      id: uuid(),
      group_id: groupId,
      qty,
      position: g.ordered ? this.nextPosition(groupId) : null,
      version: 1,
    }
    this.set('stacks', created)
    return created
  }

  /** Takes `qty` copies off a stack (deleting it when emptied); returns the copies' description. */
  private take(stackId: string, qty: number): Stack {
    const s = this.stack(stackId)
    if (!Number.isInteger(qty) || qty < 1 || qty > s.qty) throw new CollectionError(`Can't take ${qty} of ${s.qty}`)
    if (qty === s.qty) this.drop('stacks', s.id)
    else this.set('stacks', { ...s, qty: s.qty - qty })
    return s
  }

  // ------------------------------------------------------------ boxes and groups

  createBox(name: string, extra: Partial<Omit<Box, 'id' | 'version'>> = {}): Box {
    if (!name.trim()) throw new CollectionError('A box needs a name')
    const box: Box = { id: uuid(), name: name.trim(), notes: '', photo_path: null, sort_order: Date.now(), version: 1, ...extra }
    this.set('boxes', box)
    return box
  }

  updateBox(id: string, patch: Partial<Omit<Box, 'id' | 'version'>>) {
    const b = this.work.boxes.get(id)
    if (!b) throw new CollectionError('That box no longer exists')
    if (patch.name !== undefined && !patch.name.trim()) throw new CollectionError('A box needs a name')
    this.set('boxes', { ...b, ...patch })
  }

  deleteBox(id: string) {
    if ([...this.work.groups.values()].some((g) => g.box_id === id))
      throw new CollectionError('Move or delete the groups in this box first')
    this.drop('boxes', id)
  }

  createGroup(name: string, extra: Partial<Omit<Group, 'id' | 'version'>> = {}): Group {
    if (!name.trim()) throw new CollectionError('A group needs a name')
    const g: Group = {
      id: uuid(),
      box_id: null,
      row_label: null,
      name: name.trim(),
      kind: 'storage',
      ordered: false,
      notes: '',
      photo_path: null,
      sort_order: Date.now(),
      version: 1,
      ...extra,
    }
    this.set('groups', g)
    return g
  }

  updateGroup(id: string, patch: Partial<Omit<Group, 'id' | 'version'>>) {
    const g = this.group(id)
    if (patch.name !== undefined && !patch.name.trim()) throw new CollectionError('A group needs a name')
    const next = { ...g, ...patch }
    this.set('groups', next)
    // Switching to ordered gives existing stacks positions; switching off clears them.
    if (g.ordered !== next.ordered) {
      let pos = 1
      for (const s of [...this.work.stacks.values()].filter((x) => x.group_id === id))
        this.set('stacks', { ...s, position: next.ordered ? pos++ : null })
    }
  }

  deleteGroup(id: string) {
    if ([...this.work.stacks.values()].some((s) => s.group_id === id))
      throw new CollectionError('Move or remove the cards in this group first')
    this.drop('groups', id)
  }

  createCustomCard(name: string, fields: Record<string, string> = {}, notes = ''): CustomCard {
    if (!name.trim()) throw new CollectionError('A custom card needs a name')
    const c: CustomCard = { id: uuid(), name: name.trim(), fields, notes, version: 1 }
    this.set('custom_cards', c)
    return c
  }

  // ------------------------------------------------------------ cards

  add(input: AddInput, groupId: string): Stack {
    if (!Number.isInteger(input.qty) || input.qty < 1) throw new CollectionError('Quantity must be at least 1')
    if (!input.card_key === !input.custom_card_id) throw new CollectionError('Pick a card')
    const g = this.group(groupId)
    const proto = {
      game: input.game ?? 'ygo',
      card_key: input.card_key ?? null,
      custom_card_id: input.custom_card_id ?? null,
      ...noDetails(),
      ...input.details,
      section: g.kind === 'deck' ? (input.section ?? 'main') : null,
      availability: input.availability ?? 'none',
      lent_to_user: null,
      lent_to_name: input.loan?.lent_to_name ?? null,
      lent_due: input.loan?.lent_due ?? null,
      lent_from_group: input.loan?.lent_from_group ?? null,
    }
    const s = this.place(proto, input.qty, groupId)
    this.line(s, input.qty, null, groupId)
    return s
  }

  /** Moves `qty` copies to another group (splitting the stack when it's only some of them). */
  move(stackId: string, qty: number, toGroupId: string, section?: Section | null): Stack {
    const to = this.group(toGroupId)
    const s = this.take(stackId, qty)
    const moved = this.place(
      { ...s, section: to.kind === 'deck' ? (section ?? s.section ?? 'main') : null },
      qty,
      toGroupId,
    )
    this.line(s, qty, s.group_id, toGroupId)
    return moved
  }

  /** Takes copies out of the collection entirely (history keeps them, so they can be re-added later). */
  remove(stackId: string, qty: number) {
    const s = this.take(stackId, qty)
    this.line(s, qty, s.group_id, null)
  }

  /** Changes details or availability of `qty` copies; they merge with identical copies in the same group. */
  edit(stackId: string, qty: number, patch: Partial<Details> & { availability?: Availability; section?: Section | null }) {
    const s = this.take(stackId, qty)
    const g = this.group(s.group_id)
    const next = { ...s, ...patch, section: g.kind === 'deck' ? (patch.section ?? s.section) : null }
    if (qty === s.qty && g.ordered) {
      // keep the stack (and its place in an ordered group)
      this.set('stacks', { ...next, qty })
      return
    }
    this.place(next, qty, s.group_id)
  }

  /** Splits `qty` copies into their own stack in the same group (ordered groups: placed right after). */
  split(stackId: string, qty: number): Stack {
    const s = this.stack(stackId)
    if (qty >= s.qty) throw new CollectionError('Split off fewer copies than the stack has')
    this.take(stackId, qty)
    const after = [...this.work.stacks.values()]
      .filter((x) => x.group_id === s.group_id && x.position !== null && s.position !== null && x.position > s.position)
      .reduce((m, x) => Math.min(m, x.position!), Infinity)
    const created: Stack = {
      ...s,
      id: uuid(),
      qty,
      position: s.position === null ? null : after === Infinity ? s.position + 1 : (s.position + after) / 2,
      version: 1,
    }
    this.set('stacks', created)
    return created
  }

  /** Combines two stacks of identical copies (needed in ordered groups, where adding never merges). */
  merge(keepId: string, otherId: string) {
    const a = this.stack(keepId)
    const b = this.stack(otherId)
    if (a.id === b.id || a.group_id !== b.group_id || !sameCopies(a, b))
      throw new CollectionError('Only identical copies in the same group can be merged')
    this.set('stacks', { ...a, qty: a.qty + b.qty })
    this.drop('stacks', b.id)
  }

  /**
   * Lends `qty` copies: they move to the "Lent out" area (created if needed) with who has them and when they're due,
   * remembering where they came from.
   */
  lend(stackId: string, qty: number, to: { user?: string | null; name: string; due?: string | null }): Stack {
    if (!to.name.trim()) throw new CollectionError('Who are you lending them to?')
    const s = this.take(stackId, qty)
    const lentArea =
      [...this.work.groups.values()].find((g) => g.kind === 'lent') ?? this.createGroup('Lent out', { kind: 'lent' })
    const lent = this.place(
      {
        ...s,
        section: null,
        lent_to_user: to.user ?? null,
        lent_to_name: to.name.trim(),
        lent_due: to.due || null,
        lent_from_group: s.group_id,
      },
      qty,
      lentArea.id,
    )
    this.line(s, qty, s.group_id, lentArea.id)
    return lent
  }

  /** Brings lent copies back: to where they came from, or another group. */
  giveBack(stackId: string, qty: number, toGroupId?: string): Stack {
    const s = this.stack(stackId)
    const target = toGroupId ?? (s.lent_from_group && this.work.groups.has(s.lent_from_group) ? s.lent_from_group : undefined)
    if (!target) throw new CollectionError('Choose where to put them back')
    this.take(stackId, qty)
    const g = this.group(target)
    const back = this.place(
      { ...s, lent_to_user: null, lent_to_name: null, lent_due: null, lent_from_group: null, section: g.kind === 'deck' ? 'main' : null },
      qty,
      target,
    )
    this.line(s, qty, s.group_id, target)
    return back
  }

  /** Sets a stack's place in an ordered group. */
  reposition(stackId: string, position: number) {
    this.set('stacks', { ...this.stack(stackId), position })
  }

  /** Finishes the draft as one Op. Rows created and deleted within the draft cancel out. */
  finish(type: string, text: string, opts: { batch_id?: string; device?: string } = {}): Op {
    const op: Op = {
      client_op_id: uuid(),
      created_at: new Date().toISOString(),
      type,
      summary: { text, ...(this.lines.length ? { cards: this.lines } : {}) },
      expect: [],
      put: [],
      del: [],
      ...opts,
    }
    for (const [id, { t, v }] of this.touched) {
      const now = this.work[t].get(id)
      if (!now && v === 0) continue // created then deleted
      op.expect.push({ t, id, v })
      if (now) op.put.push({ t, row: now })
      else op.del.push({ t, id })
    }
    return op
  }
}

/** Applies an op to a collection (a copy is returned). Versions advance the way the server advances them. */
export function applyOp(c: Collection, op: Op): Collection {
  const next: Collection = {
    boxes: new Map(c.boxes),
    groups: new Map(c.groups),
    custom_cards: new Map(c.custom_cards),
    stacks: new Map(c.stacks),
  }
  const expected = new Map(op.expect.map((e) => [e.id, e.v]))
  for (const d of op.del) next[d.t].delete(d.id)
  for (const p of op.put)
    (next[p.t] as Map<string, Row>).set(p.row.id, { ...p.row, version: (expected.get(p.row.id) ?? 0) + 1 })
  return next
}

/** Whether an op still applies to `c` (the same check the server makes). */
export function conflictOf(c: Collection, op: Op): string | undefined {
  for (const e of op.expect) {
    const cur = c[e.t].get(e.id)?.version ?? 0
    if (cur !== e.v) return `${e.t} ${e.id} is at version ${cur}, expected ${e.v}`
  }
  return undefined
}
