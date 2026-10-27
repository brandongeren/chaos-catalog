// Collection files: JSON (complete backup, restorable) and CSV (one row per stack, for spreadsheets and other apps).
// Imports never reuse ids from the file (they could belong to someone else): everything gets new ids, and large
// imports are split into several ops so each request stays small.

import { applyOp, Draft, groupPath, uuid, type Box, type Collection, type CustomCard, type Group, type Op, type Stack } from './model.ts'

export const JSON_FORMAT = 'chaos-catalog-collection'
const CHUNK = 400

export interface CollectionFile {
  format: typeof JSON_FORMAT
  version: 1
  exported_at: string
  boxes: Box[]
  groups: Group[]
  custom_cards: CustomCard[]
  stacks: Stack[]
  wants?: { card_key: string; qty: number; note: string }[]
}

export function toJsonFile(c: Collection, wants?: CollectionFile['wants']): string {
  const file: CollectionFile = {
    format: JSON_FORMAT,
    version: 1,
    exported_at: new Date().toISOString(),
    boxes: [...c.boxes.values()],
    groups: [...c.groups.values()],
    custom_cards: [...c.custom_cards.values()],
    stacks: [...c.stacks.values()],
    ...(wants ? { wants } : {}),
  }
  return JSON.stringify(file, null, 1)
}

export function parseJsonFile(text: string): CollectionFile {
  let data: CollectionFile
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error("That file isn't valid JSON")
  }
  if (data?.format !== JSON_FORMAT || !Array.isArray(data.stacks)) throw new Error("That isn't a Chaos Catalog collection file")
  return data
}

type NameOf = (s: Pick<Stack, 'game' | 'card_key' | 'custom_card_id'>) => string

/** Ops that add everything in the file to `c` (as new boxes/groups; "Unsorted"-style areas merge by name). */
export function importJsonOps(c: Collection, file: CollectionFile, nameOf: NameOf): Op[] {
  const ops: Op[] = []
  const batch_id = uuid()
  let state = c
  const ids = new Map<string, string>()
  const d = new Draft(state, nameOf)
  for (const b of file.boxes) ids.set(b.id, d.createBox(b.name, { notes: b.notes ?? '', sort_order: b.sort_order ?? Date.now() }).id)
  for (const g of file.groups) {
    // An existing in-between or lent-out area with the same name absorbs the file's one.
    const same = [...state.groups.values()].find((x) => (x.kind === 'holding' || x.kind === 'lent') && x.kind === g.kind && x.name === g.name)
    ids.set(
      g.id,
      same?.id ??
        d.createGroup(g.name, {
          box_id: g.box_id ? (ids.get(g.box_id) ?? null) : null,
          row_label: g.row_label,
          kind: g.kind,
          ordered: g.ordered,
          notes: g.notes ?? '',
          sort_order: g.sort_order ?? Date.now(),
        }).id,
    )
  }
  for (const cc of file.custom_cards) ids.set(cc.id, d.createCustomCard(cc.name, cc.fields ?? {}, cc.notes ?? '').id)
  let op = d.finish('import', `Imported ${file.boxes.length} boxes and ${file.groups.length} groups`, { batch_id })
  ops.push(op)
  state = applyOp(state, op)

  const stacks = [...file.stacks].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  for (let i = 0; i < stacks.length; i += CHUNK) {
    const part = stacks.slice(i, i + CHUNK)
    const dd = new Draft(state, nameOf)
    for (const s of part) {
      const groupId = ids.get(s.group_id)
      if (!groupId) continue
      dd.add(
        {
          game: s.game,
          card_key: s.card_key,
          custom_card_id: s.custom_card_id ? (ids.get(s.custom_card_id) ?? null) : null,
          qty: s.qty,
          details: { set_code: s.set_code, rarity: s.rarity, edition: s.edition, language: s.language ?? 'en', condition: s.condition, note: s.note ?? '' },
          section: s.section,
          availability: s.availability,
          // loans stay loans (the borrower's account link isn't carried over)
          loan: s.lent_to_name
            ? { lent_to_name: s.lent_to_name, lent_due: s.lent_due, lent_from_group: s.lent_from_group ? (ids.get(s.lent_from_group) ?? null) : null }
            : undefined,
        },
        groupId,
      )
    }
    op = dd.finish('import', `Imported cards ${i + 1}–${i + part.length} of ${stacks.length}`, { batch_id })
    ops.push(op)
    state = applyOp(state, op)
  }
  return ops
}

// ------------------------------------------------------------------ CSV

export const CSV_COLUMNS = [
  'name',
  'passcode',
  'qty',
  'set_code',
  'rarity',
  'edition',
  'language',
  'condition',
  'box',
  'row',
  'group',
  'group_type',
  'deck_section',
  'availability',
  'note',
] as const

type CsvRow = Partial<Record<(typeof CSV_COLUMNS)[number], string>>

const quote = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(c: Collection, nameOf: NameOf): string {
  const lines = [CSV_COLUMNS.join(',')]
  const stacks = [...c.stacks.values()].sort((a, b) => groupPath(c, a.group_id).localeCompare(groupPath(c, b.group_id)) || nameOf(a).localeCompare(nameOf(b)))
  for (const s of stacks) {
    const g = c.groups.get(s.group_id)
    const box = g?.box_id ? c.boxes.get(g.box_id) : undefined
    const row: Record<string, unknown> = {
      name: nameOf(s),
      passcode: s.card_key ?? '',
      qty: s.qty,
      set_code: s.set_code,
      rarity: s.rarity,
      edition: s.edition,
      language: s.language,
      condition: s.condition,
      box: box?.name,
      row: g?.row_label,
      group: g?.name,
      group_type: g?.kind,
      deck_section: s.section,
      availability: s.availability === 'none' ? '' : s.availability,
      note: s.note,
    }
    lines.push(CSV_COLUMNS.map((k) => quote(row[k])).join(','))
  }
  return lines.join('\r\n') + '\r\n'
}

/** RFC 4180 CSV: quoted fields, doubled quotes, CRLF or LF. Header names are matched case-insensitively. */
export function parseCsv(text: string): CsvRow[] {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  const [header, ...body] = rows.filter((r) => r.some((x) => x.trim()))
  if (!header) return []
  const keys = header.map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'))
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])) as CsvRow)
}

export interface CsvPlan {
  ops: Op[]
  cards: number
  /** Rows that didn't match a card (by passcode or exact name). */
  unmatched: { line: number; name: string }[]
}

/**
 * Ops that add CSV rows: boxes/groups are found by name (box + row + group) or created. `resolve` turns a row's
 * passcode or name into a card key.
 */
export function importCsvOps(c: Collection, rows: CsvRow[], resolve: (passcode: string, name: string) => string | undefined, nameOf: NameOf): CsvPlan {
  const batch_id = uuid()
  const ops: Op[] = []
  const unmatched: CsvPlan['unmatched'] = []
  let state = c
  let cards = 0

  const valid = rows
    .map((r, i) => ({ r, line: i + 2, key: resolve(r.passcode ?? '', r.name ?? '') }))
    .filter((x) => {
      if (!x.key) unmatched.push({ line: x.line, name: x.r.name || x.r.passcode || '(blank)' })
      return !!x.key
    })

  // Locations first, in one op.
  const d = new Draft(state, nameOf)
  const boxByName = new Map([...state.boxes.values()].map((b) => [b.name.toLowerCase(), b.id]))
  const groupKey = (box: string | undefined, row: string | undefined, group: string) => `${(box ?? '').toLowerCase()}|${(row ?? '').toLowerCase()}|${group.toLowerCase()}`
  const groupByKey = new Map(
    [...state.groups.values()].map((g) => [groupKey(g.box_id ? state.boxes.get(g.box_id)?.name : '', g.row_label ?? '', g.name), g.id]),
  )
  const fallback = [...state.groups.values()].find((g) => g.kind === 'holding')?.id
  const groupFor = new Map<number, string>()
  for (const { r, line } of valid) {
    const groupName = r.group?.trim()
    if (!groupName) {
      const id = fallback ?? d.createGroup('Unsorted', { kind: 'holding' }).id
      groupFor.set(line, id)
      continue
    }
    const k = groupKey(r.box, r.row, groupName)
    let id = groupByKey.get(k)
    if (!id) {
      let boxId: string | null = null
      if (r.box?.trim()) {
        boxId = boxByName.get(r.box.trim().toLowerCase()) ?? d.createBox(r.box.trim()).id
        boxByName.set(r.box.trim().toLowerCase(), boxId)
      }
      const kind = (['storage', 'deck', 'holding'] as const).find((x) => x === r.group_type) ?? 'storage'
      id = d.createGroup(groupName, { box_id: boxId, row_label: r.row?.trim() || null, kind }).id
      groupByKey.set(k, id)
    }
    groupFor.set(line, id)
  }
  let op = d.finish('import', 'Imported a CSV file: boxes and groups', { batch_id })
  if (op.put.length) {
    ops.push(op)
    state = applyOp(state, op)
  }

  for (let i = 0; i < valid.length; i += CHUNK) {
    const part = valid.slice(i, i + CHUNK)
    const dd = new Draft(state, nameOf)
    for (const { r, line, key } of part) {
      const qty = Math.max(1, Math.floor(Number(r.qty) || 1))
      const condition = (['NM', 'LP', 'MP', 'HP', 'Damaged'] as const).find((x) => x.toLowerCase() === (r.condition ?? '').toLowerCase()) ?? null
      const section = (['main', 'extra', 'side'] as const).find((x) => x === (r.deck_section ?? '').toLowerCase()) ?? null
      const availability = (['borrow', 'trade'] as const).find((x) => x === (r.availability ?? '').toLowerCase()) ?? 'none'
      dd.add(
        {
          card_key: key,
          qty,
          details: {
            set_code: r.set_code?.toUpperCase() || null,
            rarity: r.rarity || null,
            edition: r.edition || null,
            language: r.language?.toLowerCase() || 'en',
            condition,
            note: r.note ?? '',
          },
          section,
          availability,
        },
        groupFor.get(line)!,
      )
      cards += qty
    }
    op = dd.finish('import', `Imported CSV rows ${i + 1}–${i + part.length} of ${valid.length}`, { batch_id })
    ops.push(op)
    state = applyOp(state, op)
  }
  return { ops, cards, unmatched }
}
