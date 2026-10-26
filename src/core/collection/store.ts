// A user's collection in memory: loaded from Supabase (cached in IndexedDB for fast starts), changed with ops.
// Every change shows on screen at once (applyOp) and is sent to apply_ops() right away; if the server rejects it
// (the collection changed on another device), the store reloads and reports the conflict.

import { get, set } from 'idb-keyval'
import { requireSupabase } from '../supabase.ts'
import { applyOp, emptyCollection, type Collection, type Op, type Row, type Table } from './model.ts'

const TABLES: Table[] = ['boxes', 'groups', 'custom_cards', 'stacks']
const PAGE = 1000 // Supabase's default maximum rows per request

export interface OpRecord {
  id: number
  client_op_id: string
  batch_id: string | null
  type: string
  summary: Op['summary']
  created_at: string
}

type Listener = () => void

export class CollectionStore {
  readonly ownerId: string
  readonly readOnly: boolean
  private state: Collection = emptyCollection()
  private listeners = new Set<Listener>()
  private sending = Promise.resolve()
  loaded = false
  error: string | undefined
  pending = 0

  constructor(ownerId: string, readOnly: boolean) {
    this.ownerId = ownerId
    this.readOnly = readOnly
  }

  get collection() {
    return this.state
  }

  subscribe = (fn: Listener) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getSnapshot = () => this.state

  private emit() {
    for (const fn of this.listeners) fn()
  }

  private cacheKey() {
    return `collection:${this.ownerId}`
  }

  /** Shows the cached copy (if any) immediately, then refreshes from the server. */
  async load() {
    if (!this.readOnly) {
      const cached = await get<Collection>(this.cacheKey()).catch(() => undefined)
      if (cached && !this.loaded) {
        this.state = cached
        this.loaded = true
        this.emit()
      }
    }
    await this.refresh()
  }

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
      this.state = next
      this.loaded = true
      this.error = undefined
      if (!this.readOnly) await set(this.cacheKey(), next).catch(() => {})
    } catch (err) {
      this.error = (err as Error).message
    }
    this.emit()
  }

  /** Applies an op locally and sends it. Resolves once the server has accepted (or rejected) it. */
  apply(op: Op): Promise<void> {
    if (this.readOnly) return Promise.reject(new Error('This collection is read-only'))
    this.state = applyOp(this.state, op)
    this.pending++
    this.emit()
    const send = async () => {
      try {
        const { data, error } = await requireSupabase().rpc('apply_ops', { ops: [op] })
        if (error) throw new Error(error.message)
        const [result] = data as { status: string; reason?: string }[]
        if (result.status === 'rejected') {
          this.error = `That change conflicted with a newer one (${result.reason}). Your collection was reloaded; please redo it.`
          await this.refresh()
        } else {
          await set(this.cacheKey(), this.state).catch(() => {})
        }
      } catch (err) {
        this.error = `Couldn't save a change: ${(err as Error).message}. Reloading your collection.`
        await this.refresh()
      } finally {
        this.pending--
        this.emit()
      }
    }
    // One at a time, in order: later ops are built on top of earlier ones.
    this.sending = this.sending.then(send)
    return this.sending
  }

  dismissError() {
    this.error = undefined
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
