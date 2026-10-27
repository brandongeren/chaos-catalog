// Runs the real migrations in PGlite (Postgres compiled to WebAssembly) with stand-ins for Supabase's auth schema
// and roles, then checks sign-up rules, permissions, and that apply_ops() gives the same rows as the app's applyOp().

import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { applyOp, Draft, emptyCollection, type Collection, type Op } from '../src/core/collection/model.ts'

const dir = path.join(import.meta.dirname, 'migrations')
// Storage (photos) needs Supabase's storage schema; it's tested by hand in the dashboard.
const migrations = readdirSync(dir).filter((f) => f.endsWith('.sql') && !f.includes('photos')).sort()

const SUPABASE_STANDINS = `
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key, raw_user_meta_data jsonb not null default '{}');
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
grant usage on schema public, auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
`

let db: PGlite

async function as<T>(uid: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${uid ? 'authenticated' : 'anon'}; select set_config('test.uid', '${uid ?? ''}', false);`)
  try {
    return await fn()
  } finally {
    await db.exec(`reset role; select set_config('test.uid', '', false);`)
  }
}

const signUp = (id: string, meta: Record<string, string>) =>
  db.query('insert into auth.users (id, raw_user_meta_data) values ($1, $2)', [id, JSON.stringify(meta)])

const applyOps = (uid: string, ops: Op[]) =>
  as(uid, async () => (await db.query<{ r: unknown }>('select public.apply_ops($1::jsonb) as r', [JSON.stringify(ops)])).rows[0].r as { status: string; reason?: string }[])

async function loadCollection(uid: string): Promise<Collection> {
  const c = emptyCollection()
  for (const t of ['boxes', 'groups', 'custom_cards', 'stacks'] as const) {
    const { rows } = await db.query<Record<string, unknown>>(`select * from public.${t} where owner_id = $1`, [uid])
    for (const r of rows) {
      const { owner_id: _o, created_at: _c, updated_at: _u, ...row } = r
      if (t === 'stacks' && row.lent_due instanceof Date) row.lent_due = row.lent_due.toISOString().slice(0, 10)
      ;(c[t] as Map<string, unknown>).set(row.id as string, row)
    }
  }
  return c
}

const ALICE = '00000000-0000-0000-0000-00000000000a'
const BOB = '00000000-0000-0000-0000-00000000000b'

beforeAll(async () => {
  db = new PGlite()
  await db.exec(SUPABASE_STANDINS)
  for (const f of migrations) await db.exec(readFileSync(path.join(dir, f), 'utf-8'))
  await db.exec(`insert into public.invites (code) values ('alice-code'), ('bob-code');`)
  await signUp(ALICE, { invite_code: 'alice-code', username: 'alice' })
  await signUp(BOB, { invite_code: 'bob-code', username: 'bob' })
}, 60_000)

describe('sign-up', () => {
  it('requires an unused invite', async () => {
    await expect(signUp('00000000-0000-0000-0000-00000000000c', { invite_code: 'nope', username: 'carol' })).rejects.toThrow(/invite/)
    await expect(signUp('00000000-0000-0000-0000-00000000000c', { invite_code: 'alice-code', username: 'carol' })).rejects.toThrow(/invite/)
  })
  it('creates a profile and an Unsorted area', async () => {
    const { rows } = await db.query<{ username: string; name: string; kind: string }>(
      'select p.username, g.name, g.kind from public.profiles p join public.groups g on g.owner_id = p.id where p.id = $1',
      [ALICE],
    )
    expect(rows).toEqual([{ username: 'alice', name: 'Unsorted', kind: 'holding' }])
  })
  it('check_signup explains problems before submitting', async () => {
    await db.exec(`insert into public.invites (code) values ('fresh')`)
    const check = async (code: string, user: string) =>
      as(null, async () => (await db.query<{ r: string }>('select public.check_signup($1, $2) as r', [code, user])).rows[0].r)
    expect(await check('nope', 'carol')).toBe('invalid_invite')
    expect(await check('fresh', 'Carol!')).toBe('invalid_username')
    expect(await check('fresh', 'alice')).toBe('username_taken')
    expect(await check('fresh', 'carol')).toBe('ok')
  })
  it('only admins create invites', async () => {
    await expect(as(ALICE, () => db.query('select public.create_invite()'))).rejects.toThrow(/admins/)
    await db.query('update public.profiles set is_admin = true where id = $1', [ALICE])
    const code = await as(ALICE, async () => (await db.query<{ c: string }>('select public.create_invite($1) as c', ['for dawson'])).rows[0].c)
    expect(code).toMatch(/^[0-9a-f]{32}$/)
  })
})

describe('apply_ops', () => {
  it('matches the app: add, move, edit, remove, then rejects a stale op', async () => {
    const nameOf = () => 'Ash Blossom'
    let local = await loadCollection(ALICE)
    const unsorted = [...local.groups.values()][0]
    const ops: Op[] = []
    const step = (fn: (d: Draft) => void) => {
      const d = new Draft(local, nameOf)
      fn(d)
      const op = d.finish('test', 'test')
      ops.push(op)
      local = applyOp(local, op)
      return op
    }
    let groupA = ''
    let stackId = ''
    step((d) => {
      const box = d.createBox('Box 1')
      groupA = d.createGroup('A', { box_id: box.id, row_label: 'Row 1' }).id
      stackId = d.add({ card_key: '14558127', qty: 3, details: { set_code: 'DUDE-EN003', condition: 'NM' } }, groupA).id
    })
    step((d) => d.move(stackId, 1, unsorted.id))
    step((d) => d.edit(stackId, 1, { condition: 'LP', availability: 'trade' }))
    step((d) => {
      const lp = [...d.collection.stacks.values()].find((s) => s.condition === 'LP')!
      d.remove(lp.id, 1)
    })

    expect((await applyOps(ALICE, ops)).map((r) => r.status)).toEqual(['applied', 'applied', 'applied', 'applied'])
    expect(await loadCollection(ALICE)).toEqual(local)
    // Retrying the same ops (a flaky connection) changes nothing.
    expect((await applyOps(ALICE, ops)).map((r) => r.status)).toEqual(['duplicate', 'duplicate', 'duplicate', 'duplicate'])
    // An op built from an old copy is rejected instead of overwriting.
    const stale = ops[1]
    const replay = { ...stale, client_op_id: crypto.randomUUID() }
    const [r] = await applyOps(ALICE, [replay])
    expect(r.status).toBe('rejected')
    expect(r.reason).toMatch(/expected/)
    const history = await as(ALICE, async () => (await db.query('select type from public.operations')).rows)
    expect(history).toHaveLength(4)
  })

  it('sub-groups round-trip and loops are refused even if the app is bypassed', async () => {
    let local = await loadCollection(ALICE)
    const d = new Draft(local, () => 'x')
    const top = d.createGroup('Binder', { ordered: true })
    const sub = d.createGroup('Page 1', { parent_id: top.id })
    const op = d.finish('create', 'create')
    expect((await applyOps(ALICE, [op]))[0].status).toBe('applied')
    local = applyOp(local, op)
    expect((await loadCollection(ALICE)).groups.get(sub.id)).toEqual(local.groups.get(sub.id))
    const loop: Op = {
      client_op_id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      type: 'edit',
      summary: { text: 'loop' },
      expect: [{ t: 'groups', id: top.id, v: 1 }],
      put: [{ t: 'groups', row: { ...local.groups.get(top.id)!, parent_id: sub.id } }],
      del: [],
    }
    await expect(applyOps(ALICE, [loop])).rejects.toThrow(/inside itself/)
  })

  it('cannot touch another user\'s rows or skip expect', async () => {
    const aliceGroups = await loadCollection(ALICE)
    const g = [...aliceGroups.groups.values()][0]
    const hijack: Op = {
      client_op_id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      type: 'edit',
      summary: { text: 'x' },
      expect: [{ t: 'groups', id: g.id, v: 0 }],
      put: [{ t: 'groups', row: { ...g, name: 'pwned' } }],
      del: [],
    }
    // Bob's view of Alice's group is "doesn't exist" (version 0): the insert conflicts on id and does nothing.
    expect((await applyOps(BOB, [hijack]))[0].status).toBe('applied')
    expect((await loadCollection(ALICE)).groups.get(g.id)?.name).toBe('Unsorted')
    const sneaky = { ...hijack, client_op_id: crypto.randomUUID(), expect: [] }
    expect((await applyOps(BOB, [sneaky]))[0]).toMatchObject({ status: 'rejected', reason: /listed in expect/ })
    await expect(as(null, () => db.query(`select public.apply_ops('[]'::jsonb)`))).rejects.toThrow()
  })

  it('direct writes are blocked; reads follow privacy settings', async () => {
    await expect(as(ALICE, () => db.query(`update public.groups set name = 'x' where owner_id = '${ALICE}'`))).resolves.toMatchObject({ affectedRows: 0 })
    await expect(as(ALICE, () => db.query(`update public.profiles set is_admin = true where id = '${ALICE}'`))).rejects.toThrow(/permission/)
    const anonSees = async () =>
      as(null, async () => ({
        stacks: (await db.query(`select id from public.stacks where owner_id = '${ALICE}'`)).rows.length,
        groups: (await db.query(`select id from public.groups where owner_id = '${ALICE}'`)).rows.length,
      }))
    expect(await anonSees()).toMatchObject({ stacks: 2 })
    await as(ALICE, () => db.query('update public.profiles set show_locations = false where id = $1', [ALICE]))
    expect(await anonSees()).toEqual({ stacks: 2, groups: 0 })
    await as(ALICE, () => db.query('update public.profiles set profile_public = false where id = $1', [ALICE]))
    expect(await anonSees()).toEqual({ stacks: 0, groups: 0 })
    const own = await as(ALICE, async () => (await db.query(`select id from public.groups where owner_id = '${ALICE}'`)).rows.length)
    expect(own).toBe(4) // Unsorted, A, and the sub-group test's Binder + Page 1
    const ops = await as(BOB, async () => (await db.query(`select id from public.operations where owner_id = '${ALICE}'`)).rows.length)
    expect(ops).toBe(0)
  })
})

describe('social', () => {
  const CAROL = '00000000-0000-0000-0000-00000000000c' // same city as Bob, not a friend
  const DAVE = '00000000-0000-0000-0000-00000000000d' // stranger elsewhere
  const addCards = async (uid: string, cards: { key: string; qty: number; availability: 'none' | 'borrow' | 'trade' }[]) => {
    const c = await loadCollection(uid)
    const d = new Draft(c, () => 'card')
    const g = d.createGroup('Binder')
    for (const x of cards) d.add({ card_key: x.key, qty: x.qty, availability: x.availability }, g.id)
    expect((await applyOps(uid, [d.finish('add', 'add')]))[0].status).toBe('applied')
  }
  const rpc = <T,>(uid: string, sql: string, args: unknown[] = []) => as(uid, async () => (await db.query<T>(sql, args)).rows)

  beforeAll(async () => {
    await db.exec(`insert into public.invites (code) values ('carol-code'), ('dave-code');`)
    await signUp(CAROL, { invite_code: 'carol-code', username: 'carol' })
    await signUp(DAVE, { invite_code: 'dave-code', username: 'dave' })
    await db.exec(`update public.profiles set city = 'Seattle, WA' where username in ('bob', 'carol');
                   update public.profiles set city = 'Boise' where username = 'dave';`)
    await addCards(ALICE, [{ key: '999', qty: 1, availability: 'none' }])
    await addCards(CAROL, [{ key: '777', qty: 2, availability: 'trade' }, { key: '888', qty: 1, availability: 'none' }])
    await addCards(DAVE, [{ key: '777', qty: 3, availability: 'trade' }])
  })

  it('friend requests: ask, accept, list', async () => {
    expect((await rpc<{ r: string }>(BOB, `select public.request_friend('alice') as r`))[0].r).toBe('requested')
    expect(await rpc(ALICE, 'select username, status, incoming from public.my_friends()')).toEqual([{ username: 'bob', status: 'pending', incoming: true }])
    expect((await rpc<{ r: string }>(ALICE, `select public.request_friend('bob') as r`))[0].r).toBe('accepted')
    await expect(rpc(BOB, `select public.request_friend('nobody')`)).rejects.toThrow(/No user/)
  })

  it('who has it: friends (all copies, even private) and same-city public profiles (available copies only)', async () => {
    // Alice is private now (earlier test) but Bob is her friend; Dave is in another city.
    const rows = await rpc<{ username: string; card_key: string; qty: number; availability: string; is_friend: boolean }>(
      BOB,
      `select username, card_key, qty::int as qty, availability, is_friend from public.who_has(array['999', '777', '888'])`,
    )
    expect(rows).toEqual([
      { username: 'alice', card_key: '999', qty: 1, availability: 'none', is_friend: true },
      { username: 'carol', card_key: '777', qty: 2, availability: 'trade', is_friend: false },
    ])
    // Bob can read his friend Alice's private collection directly too; Dave can't.
    expect((await rpc(BOB, `select id from public.stacks where owner_id = '${ALICE}'`)).length).toBeGreaterThan(0)
    expect((await rpc(DAVE, `select id from public.stacks where owner_id = '${ALICE}'`)).length).toBe(0)
  })

  it('wants and trade matches', async () => {
    await rpc(BOB, `insert into public.wants (card_key, qty) values ('777', 2)`)
    await expect(rpc(BOB, `insert into public.wants (owner_id, card_key) values ('${CAROL}', '1')`)).rejects.toThrow()
    expect(await rpc(BOB, `select direction, username, card_key, qty::int as qty from public.trade_matches()`)).toEqual([
      { direction: 'they_have', username: 'carol', card_key: '777', qty: 2 },
    ])
    expect(await rpc(CAROL, `select direction, username, card_key from public.trade_matches()`)).toEqual([
      { direction: 'they_want', username: 'bob', card_key: '777' },
    ])
  })

  it('requests: only to friends or locals; only the right side can answer', async () => {
    await rpc(BOB, `insert into public.requests (to_user, kind, card_key) values ('${CAROL}', 'trade', '777')`)
    await expect(rpc(BOB, `insert into public.requests (to_user, kind, card_key) values ('${DAVE}', 'trade', '777')`)).rejects.toThrow()
    const [{ id }] = await rpc<{ id: string }>(CAROL, `select id from public.requests`)
    await expect(rpc(BOB, `select public.answer_request('${id}', 'accepted')`)).rejects.toThrow(/owner/)
    await rpc(CAROL, `select public.answer_request('${id}', 'accepted', 'sure, Saturday?')`)
    expect(await rpc(BOB, `select status, reply from public.requests`)).toEqual([{ status: 'accepted', reply: 'sure, Saturday?' }])
    expect(await rpc(DAVE, `select id from public.requests`)).toEqual([])
  })
})
