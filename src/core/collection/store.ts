// A user's collection in memory, kept in step with Supabase.
//
// - `base` is the last copy confirmed by the server; `queue` holds changes not yet confirmed (saved in IndexedDB, so
//   they survive closing the app); what you see is base + queue.
// - Every change is queued and sent right away. Without a connection it waits and is sent when the browser comes back
//   online (and every 30 s).
// - If the server rejects a change (the same rows changed on another device), it moves to `conflicts`, the collection
//   is reloaded, and any later queued changes that no longer fit are moved to conflicts too. Nothing is overwritten.

import { get, set } from 'idb-keyval'
import { requireSupabase } from '../supabase.ts'
import { applyOp, conflictOf, emptyCollection, type Collection, type Op, type Row, type Table } from './model.ts'

const TABLES: Table[] = ['boxes', 'groups', 'custom_cards', 'stacks']
const PAGE = 1000 // Supabase's default maximum rows per request
const RETRY_MS = 30_000

export interface OpRecord {
  id: number
  client_op_id: string
  batch_id: string | null
  type: string
  summary: Op['summary']
  created_at: string
}

export interface Conflict {
  op: Op
  reason: string
}

type Listener = () => void

const isNetworkError = (err: unknown) =>
  err instanceof TypeError || /fetch|network|load failed|offline/i.test(String((err as Error)?.message ?? err))

export class CollectionStore {
  readonly ownerId: string
  readonly readOnly: boolean
  private base: Collection = emptyCollection()
  private state: Collection = emptyCollection()
  private queue: Op[] = []
  private listeners = new Set<Listener>()
  private flushing: Promise<void> | undefined
  private timer: ReturnType<typeof setInterval> | undefined
  loaded = false
  error: string | undefined
  offline = false
  conflicts: Conflict[] = []
  lastSynced: string | undefined

  constructor(ownerId: string, readOnly: boolean) {
    this.ownerId = ownerId
    this.readOnly = readOnly
  }

  get collection() {
    return this.state
  }

  /** Changes made on this device that the server hasn't confirmed yet. */
  get pending() {
    return this.queue.length
  }

  subscribe = (fn: Listener) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getSnapshot = () => this.state

  private emit() {
    for (const fn of this.listeners) fn()
  }

  private key(what: string) {
    return `${what}:${this.ownerId}`
  }

  private async persist() {
    if (this.readOnly) return
    await Promise.all([
      set(this.key('collection'), this.base),
      set(this.key('queue'), this.queue),
      set(this.key('synced'), this.lastSynced),
    ]).catch(() => {})
  }

  private rebuild() {
    let s = this.base
    for (const op of this.queue) s = applyOp(s, op)
    this.state = s
  }

  /** Shows the saved copy (and unsent changes) immediately, then syncs with the server. */
  async load() {
    if (!this.readOnly) {
      const [base, queue, synced] = await Promise.all([
        get<Collection>(this.key('collection')).catch(() => undefined),
        get<Op[]>(this.key('queue')).catch(() => undefined),
        get<string>(this.key('synced')).catch(() => undefined),
      ])
      if (base && !this.loaded) {
        this.base = base
        this.queue = queue ?? []
        this.lastSynced = synced
        this.rebuild()
        this.loaded = true
        this.emit()
      }
      if (typeof window !== 'undefined') window.addEventListener('online', this.onOnline)
      this.timer = setInterval(() => {
        if (this.queue.length) void this.flush()
      }, RETRY_MS)
    }
    await this.refresh()
    if (this.queue.length) await this.flush()
  }

  dispose() {
    if (typeof window !== 'undefined') window.removeEventListener('online', this.onOnline)
    clearInterval(this.timer)
  }

  private onOnline = () => {
    void this.refresh().then(() => this.flush())
  }

  /** Reloads from the server and re-applies unsent changes that still fit. */
  async refresh() {
    const sb = requireSupabase()
    const next = emptyCollection()
    try {
      for (const t of TABLES) {
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await sb
            .from(t)
            .select('*')
            .eq('owner_id', this.ownerId)
            .order('id')
            .range(from, from + PAGE - 1)
          if (error) throw new Error(error.message)
          for (const raw of data ?? []) {
            const { owner_id: _o, created_at: _c, updated_at: _u, ...row } = raw as Record<string, unknown>
            ;(next[t] as Map<string, Row>).set(row.id as string, row as unknown as Row)
          }
          if (!data || data.length < PAGE) break
        }
      }
      this.base = next
      this.revalidateQueue()
      this.loaded = true
      this.offline = false
      this.error = undefined
      this.lastSynced = new Date().toISOString()
      await this.persist()
    } catch (err) {
      if (isNetworkError(err)) this.offline = true
      else this.error = (err as Error).message
    }
    this.emit()
  }

  /** Drops queued changes that no longer apply on top of `base` (moving them to conflicts). */
  private revalidateQueue() {
    let s = this.base
    const keep: Op[] = []
    for (const op of this.queue) {
      const reason = conflictOf(s, op)
      if (reason) this.conflicts.push({ op, reason })
      else {
        keep.push(op)
        s = applyOp(s, op)
      }
    }
    this.queue = keep
    this.state = s
  }

  /** Applies a change on screen at once, saves it in the queue, and sends it. */
  async apply(op: Op): Promise<void> {
    if (this.readOnly) throw new Error('This collection is read-only')
    this.queue.push(op)
    this.state = applyOp(this.state, op)
    this.emit()
    await this.persist()
    await this.flush()
  }

  /** Sends queued changes in order. Safe to call any time; concurrent calls share one run. */
  flush(): Promise<void> {
    this.flushing ??= this.doFlush().finally(() => {
      this.flushing = undefined
    })
    return this.flushing
  }

  private async doFlush() {
    while (this.queue.length) {
      const batch = this.queue.slice(0, 20)
      let results: { client_op_id: string; status: string; reason?: string }[]
      try {
        const { data, error } = await requireSupabase().rpc('apply_ops', { ops: batch })
        if (error) throw Object.assign(new Error(error.message), { network: /fetch|network/i.test(error.message) })
        results = data
      } catch (err) {
        if (isNetworkError(err) || (err as { network?: boolean }).network) {
          this.offline = true
          this.emit()
          return // keep everything queued; retried when back online
        }
        this.error = `Couldn't save changes: ${(err as Error).message}`
        this.emit()
        return
      }
      this.offline = false
      let rejected = false
      for (const r of results) {
        const op = this.queue[0]
        if (!op || op.client_op_id !== r.client_op_id) break
        this.queue.shift()
        if (r.status === 'rejected') {
          this.conflicts.push({ op, reason: r.reason ?? 'changed elsewhere' })
          rejected = true
          break
        }
        this.base = applyOp(this.base, op)
      }
      this.lastSynced = new Date().toISOString()
      await this.persist()
      this.emit()
      if (rejected) {
        await this.refresh()
        if (this.error) return
      }
    }
  }

  dismissError() {
    this.error = undefined
    this.emit()
  }

  dismissConflict(i: number) {
    this.conflicts.splice(i, 1)
    this.emit()
  }

  async history(limit = 100, before?: number): Promise<OpRecord[]> {
    let q = requireSupabase()
      .from('operations')
      .select('id, client_op_id, batch_id, type, summary, created_at')
      .eq('owner_id', this.ownerId)
      .order('id', { ascending: false })
      .limit(limit)
    if (before) q = q.lt('id', before)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    return (data ?? []) as OpRecord[]
  }
}
