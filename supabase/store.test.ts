// The app's CollectionStore against the real SQL (PGlite) through a tiny fake Supabase client that can go "offline".
// Covers: queued changes while offline, sending them when back, retries not applying twice, and a change made on
// another device turning a queued change into a conflict instead of overwriting.

import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

const memory = new Map<string, unknown>()
vi.mock('idb-keyval', () => ({
  get: async (k: string) => structuredClone(memory.get(k)),
  set: async (k: string, v: unknown) => void memory.set(k, structuredClone(v)),
  del: async (k: string) => void memory.delete(k),
  keys: async () => [...memory.keys()],
}))

let db: PGlite
let online = true
let currentUser = ''
const offlineError = () => new TypeError('Failed to fetch')

async function asUser<T>(fn: () => Promise<T>) {
  await db.exec(`set role authenticated; select set_config('test.uid', '${currentUser}', false);`)
  try {
    return await fn()
  } finally {
    await db.exec(`reset role;`)
  }
}

const fake = {
  rpc: async (name: string, args: { ops: unknown }) => {
    if (!online) throw offlineError()
    if (name !== 'apply_ops') throw new Error(name)
    const rows = await asUser(() => db.query<{ r: unknown }>('select public.apply_ops($1::jsonb) as r', [JSON.stringify(args.ops)]))
    return { data: rows.rows[0].r, error: null }
  },
  from: (table: string) => {
    const q = { owner: '', from: 0, to: 0 }
    const chain = {
      select: () => chain,
      eq: (_c: string, v: string) => ((q.owner = v), chain),
      order: () => chain,
      range: async (a: number, b: number) => {
        if (!online) throw offlineError()
        q.from = a
        q.to = b
        const { rows } = await asUser(() =>
          db.query(`select * from public.${table} where owner_id = $1 order by id offset $2 limit $3`, [q.owner, a, b - a + 1]),
        )
        for (const r of rows as Record<string, unknown>[]) if (r.lent_due instanceof Date) r.lent_due = r.lent_due.toISOString().slice(0, 10)
        return { data: rows, error: null }
      },
    }
    return chain
  },
}
vi.mock('../src/core/supabase.ts', () => ({ requireSupabase: () => fake, supabase: fake }))

const { CollectionStore } = await import('../src/core/collection/store.ts')
const { Draft } = await import('../src/core/collection/model.ts')

const USER = '00000000-0000-0000-0000-0000000000e1'
const nameOf = () => 'Ash Blossom'

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create schema auth;
    create table auth.users (id uuid primary key, raw_user_meta_data jsonb not null default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;`)
  const dir = path.join(import.meta.dirname, 'migrations')
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql') && !x.includes('photos')).sort())
    await db.exec(readFileSync(path.join(dir, f), 'utf-8'))
  await db.exec(`insert into public.invites (code) values ('e');`)
  await db.query(`insert into auth.users (id, raw_user_meta_data) values ($1, '{"invite_code":"e","username":"erin"}')`, [USER])
  currentUser = USER
}, 60_000)

describe('CollectionStore', () => {
  it('works offline, syncs when back, and turns a clash with another device into a conflict', async () => {
    const phone = new CollectionStore(USER, false)
    await phone.load()
    const unsorted = [...phone.collection.groups.values()][0]

    // online change
    let d = new Draft(phone.collection, nameOf)
    const s = d.add({ card_key: '14558127', qty: 3 }, unsorted.id)
    await phone.apply(d.finish('add', 'add'))
    expect(phone.pending).toBe(0)

    // offline: two changes wait in the queue, and survive a "restart"
    online = false
    d = new Draft(phone.collection, nameOf)
    const box = d.createBox('Box 1')
    const g = d.createGroup('A', { box_id: box.id })
    await phone.apply(d.finish('create', 'create'))
    d = new Draft(phone.collection, nameOf)
    d.move(s.id, 2, g.id)
    await phone.apply(d.finish('move', 'move'))
    expect(phone.pending).toBe(2)
    expect(phone.offline).toBe(true)
    const restarted = new CollectionStore(USER, false)
    await restarted.load()
    expect(restarted.pending).toBe(2)
    expect([...restarted.collection.stacks.values()].map((x) => x.qty).sort()).toEqual([1, 2])

    // another device (online) changes the same stack meanwhile
    online = true
    const laptop = new CollectionStore(USER, false)
    memory.clear() // the laptop has its own storage
    await laptop.load()
    d = new Draft(laptop.collection, nameOf)
    d.edit(s.id, 3, { condition: 'NM' })
    await laptop.apply(d.finish('edit', 'edit'))

    // phone comes back: the box/group change applies, the stale move becomes a conflict, nothing is overwritten
    await restarted.flush()
    expect(restarted.pending).toBe(0)
    expect(restarted.conflicts.map((c) => c.op.type)).toEqual(['move'])
    await restarted.refresh()
    const final = [...restarted.collection.stacks.values()]
    expect(final.map((x) => [x.qty, x.condition])).toEqual([[3, 'NM']])
    expect([...restarted.collection.boxes.values()].map((b) => b.name)).toEqual(['Box 1'])

    // and a retried op is never applied twice
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from public.operations where owner_id = $1`, [USER])
    expect(rows[0].n).toBe(3)
    phone.dispose()
    restarted.dispose()
    laptop.dispose()
  })
})
