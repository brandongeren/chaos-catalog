import { useEffect, useState } from 'react'
import type { YgoMeta } from './games/ygo/types.ts'

// Phase 0 placeholder: proves the deploy and the daily data job work end to end. Search replaces it in phase 1.

type State = { status: 'loading' } | { status: 'ok'; meta: YgoMeta } | { status: 'error'; message: string }

export default function App() {
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/ygo/meta.json`, { cache: 'no-cache' })
      .then((res) => {
        if (!res.ok) throw new Error(`card data not found (HTTP ${res.status}); run npm run build:data`)
        return res.json() as Promise<YgoMeta>
      })
      .then((meta) => setState({ status: 'ok', meta }))
      .catch((err: Error) => setState({ status: 'error', message: err.message }))
  }, [])

  return (
    <main className="page">
      <h1>Chaos Catalog</h1>
      <p className="muted">Chaos storage for your card collection. Search is coming in phase 1.</p>
      {state.status === 'loading' && <p>Loading card data…</p>}
      {state.status === 'error' && <p className="error">{state.message}</p>}
      {state.status === 'ok' && (
        <dl className="facts">
          <dt>Cards</dt>
          <dd>{state.meta.cardCount.toLocaleString()}</dd>
          <dt>Printings</dt>
          <dd>{state.meta.printingCount.toLocaleString()}</dd>
          <dt>Card database</dt>
          <dd>
            version {state.meta.dbVersion}, updated {state.meta.dbUpdated} (UTC)
          </dd>
          <dt>Data built</dt>
          <dd>{new Date(state.meta.builtAt).toLocaleString()}</dd>
          <dt>Price days kept</dt>
          <dd>
            {state.meta.priceDays.length} of 28 (newest {state.meta.priceDays[0] ?? 'none'})
          </dd>
        </dl>
      )}
    </main>
  )
}
