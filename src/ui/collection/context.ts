import { createContext, useContext, useSyncExternalStore } from 'react'
import { Draft, type Collection, type Stack } from '../../core/collection/model.ts'
import type { CollectionStore } from '../../core/collection/store.ts'
import type { Profile } from '../../core/supabase.ts'
import type { Searcher } from '../../games/ygo/search.ts'
import type { YgoCard } from '../../games/ygo/types.ts'

export interface CollectionContextValue {
  store: CollectionStore
  owner: Profile
  readOnly: boolean
  searcher: Searcher
}

export const CollectionContext = createContext<CollectionContextValue | null>(null)

export function useCollectionContext(): CollectionContextValue {
  const v = useContext(CollectionContext)
  if (!v) throw new Error('No collection loaded')
  return v
}

export function useCollection(store: CollectionStore): Collection {
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}

export const cardOf = (searcher: Searcher, s: Pick<Stack, 'card_key'>): YgoCard | undefined =>
  s.card_key ? searcher.byId.get(Number(s.card_key)) : undefined

export function nameOfStack(searcher: Searcher, c: Collection, s: Pick<Stack, 'card_key' | 'custom_card_id'>): string {
  if (s.custom_card_id) return c.custom_cards.get(s.custom_card_id)?.name ?? 'Custom card'
  return cardOf(searcher, s)?.n ?? `Unknown card ${s.card_key}`
}

/** Runs `edit` in a fresh draft and applies the result; returns an error message, if any. */
export async function change(
  ctx: CollectionContextValue,
  type: string,
  text: string,
  edit: (d: Draft) => void,
  opts: { batch_id?: string } = {},
): Promise<string | undefined> {
  const c = ctx.store.collection
  const d = new Draft(c, (s) => nameOfStack(ctx.searcher, c, s))
  try {
    edit(d)
  } catch (err) {
    return (err as Error).message
  }
  await ctx.store.apply(d.finish(type, text, opts))
  return undefined
}

/** Stacks per passcode, for "you have N" and the locations list. */
export function ownedIndex(c: Collection): Map<number, Stack[]> {
  const m = new Map<number, Stack[]>()
  for (const s of c.stacks.values()) {
    if (!s.card_key) continue
    const k = Number(s.card_key)
    const list = m.get(k)
    if (list) list.push(s)
    else m.set(k, [s])
  }
  return m
}
