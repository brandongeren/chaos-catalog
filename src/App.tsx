import { useEffect, useMemo, useState } from 'react'
import { loadCatalog, loadMeta, loadPrices } from './games/ygo/data.ts'
import { createSearcher } from './games/ygo/search.ts'
import type { YgoCatalog, YgoMeta, YgoPriceDay } from './games/ygo/types.ts'
import { SearchPage } from './games/ygo/ui/SearchPage.tsx'

type State =
  | { status: 'loading' }
  | { status: 'ok'; meta: YgoMeta; catalog: YgoCatalog }
  | { status: 'error'; message: string }

export default function App() {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [prices, setPrices] = useState<YgoPriceDay>()

  useEffect(() => {
    loadMeta()
      .then(async (meta) => {
        setState({ status: 'ok', meta, catalog: await loadCatalog(meta) })
        // Prices are optional extras: load after the catalog so search is usable sooner.
        loadPrices(meta).then(setPrices, () => {})
      })
      .catch((err: Error) => setState({ status: 'error', message: err.message }))
  }, [])

  const searcher = useMemo(() => (state.status === 'ok' ? createSearcher(state.catalog.cards) : undefined), [state])

  return (
    <div className="page">
      <header className="top">
        <a className="brand" href={import.meta.env.BASE_URL}>
          <img src={`${import.meta.env.BASE_URL}icons/icon-32.png`} alt="" width={28} height={28} />
          Chaos Catalog
        </a>
      </header>
      <main>
        {state.status === 'loading' && <p className="muted">Loading cards…</p>}
        {state.status === 'error' && (
          <p className="error">
            {state.message}. {import.meta.env.DEV && 'Run npm run build:data first.'}
          </p>
        )}
        {searcher && <SearchPage searcher={searcher} prices={prices} />}
      </main>
      {state.status === 'ok' && (
        <footer className="muted small">
          {state.meta.cardCount.toLocaleString()} cards · card data from YGOPRODeck (version {state.meta.dbVersion}) · prices
          from TCGplayer via TCGCSV{prices ? ` (${prices.date})` : ''}. Yu-Gi-Oh! is a trademark of Konami; this site isn't
          affiliated with Konami.
        </footer>
      )}
    </div>
  )
}
