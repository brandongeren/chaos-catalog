// Loads the static card data published with the site, keeping a copy in IndexedDB so repeat visits (and flaky
// connections) don't re-download the ~2 MB catalog. meta.json decides whether the cached copy is current.

import { del, get, keys, set } from 'idb-keyval'
import type { YgoCatalog, YgoMeta, YgoPriceDay } from './types.ts'

const base = `${import.meta.env.BASE_URL}data/ygo/`

async function fetchJson<T>(file: string, init?: RequestInit): Promise<T> {
  const res = await fetch(base + file, init)
  if (!res.ok) throw new Error(`Couldn't load ${file} (HTTP ${res.status})`)
  return (await res.json()) as T
}

/** Cached under `ygo:<kind>:<version>`; older versions of the same kind are deleted. */
async function cached<T>(kind: string, version: string, load: () => Promise<T>): Promise<T> {
  const key = `ygo:${kind}:${version}`
  try {
    const hit = await get<T>(key)
    if (hit) return hit
  } catch {
    // IndexedDB unavailable (private browsing on some browsers): just download
  }
  const value = await load()
  try {
    await set(key, value)
    for (const k of await keys())
      if (typeof k === 'string' && k.startsWith(`ygo:${kind}:`) && k !== key) await del(k)
  } catch {
    // storage full or unavailable: the app still works, it just downloads again next time
  }
  return value
}

export interface YgoData {
  meta: YgoMeta
  catalog: YgoCatalog
  /** Newest price day, if any is published. */
  prices?: YgoPriceDay
}

export async function loadMeta(): Promise<YgoMeta> {
  try {
    const meta = await fetchJson<YgoMeta>('meta.json', { cache: 'no-cache' })
    await set('ygo:meta', meta).catch(() => {})
    return meta
  } catch (err) {
    // Offline: fall back to the last meta we saw, so the cached catalog still opens.
    const last = await get<YgoMeta>('ygo:meta').catch(() => undefined)
    if (last) return last
    throw err
  }
}

export const loadCatalog = (meta: YgoMeta) =>
  cached('catalog', meta.builtAt, () => fetchJson<YgoCatalog>('catalog.json'))

export const loadPrices = (meta: YgoMeta) => {
  const day = meta.priceDays[0]
  return day ? cached('prices', day, () => fetchJson<YgoPriceDay>(`prices/${day}.json`)) : Promise.resolve(undefined)
}
