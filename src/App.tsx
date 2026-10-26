import { useEffect, useMemo, useState } from 'react'
import { AuthProvider } from './core/auth.tsx'
import { useAuth } from './core/authActions.ts'
import { CollectionStore } from './core/collection/store.ts'
import { supabase, type Profile } from './core/supabase.ts'
import { loadCatalog, loadMeta, loadPrices } from './games/ygo/data.ts'
import { createSearcher, type Searcher } from './games/ygo/search.ts'
import type { YgoCatalog, YgoMeta, YgoPriceDay } from './games/ygo/types.ts'
import { SearchPage } from './games/ygo/ui/SearchPage.tsx'
import { useUrlParams } from './lib/useUrlParams.ts'
import { AccountPage } from './ui/AccountPage.tsx'
import { CollectionPage } from './ui/collection/CollectionPage.tsx'
import { CollectionContext, type CollectionContextValue } from './ui/collection/context.ts'
import { HistoryPage } from './ui/collection/HistoryPage.tsx'
import { DataPage } from './ui/collection/DataPage.tsx'
import { DecksPage } from './games/ygo/ui/DecksPage.tsx'
import { FriendsPage } from './ui/social/FriendsPage.tsx'
import { PricesPage } from './games/ygo/ui/PricesPage.tsx'
import { SyncBanner } from './ui/collection/SyncBanner.tsx'
import { ScanPage } from './games/ygo/ui/ScanPage.tsx'
import { SyntaxGuide } from './games/ygo/ui/SyntaxGuide.tsx'

type State =
  | { status: 'loading' }
  | { status: 'ok'; meta: YgoMeta; catalog: YgoCatalog }
  | { status: 'error'; message: string }

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  )
}

/** Loads (and caches) the store for one collection: your own, or a public profile's (read-only). */
function useCollectionFor(owner: Profile | null | undefined, readOnly: boolean, searcher: Searcher | undefined) {
  const store = useMemo(() => (owner ? new CollectionStore(owner.id, readOnly) : undefined), [owner?.id, readOnly]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    void store?.load()
    return () => store?.dispose()
  }, [store])
  return useMemo<CollectionContextValue | null>(
    () => (store && owner && searcher ? { store, owner, readOnly, searcher } : null),
    [store, owner, readOnly, searcher],
  )
}

function usePublicProfile(username: string | null) {
  const [profile, setProfile] = useState<Profile | null>()
  useEffect(() => {
    if (!username || !supabase) return setProfile(undefined)
    let live = true
    supabase
      .from('profiles')
      .select('*')
      .eq('username', username.toLowerCase())
      .maybeSingle()
      .then(({ data }) => live && setProfile((data as Profile | null) ?? null))
    return () => {
      live = false
    }
  }, [username])
  return profile
}

function Shell() {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [prices, setPrices] = useState<YgoPriceDay>()
  const [params, setParams] = useUrlParams()
  const { profile, session } = useAuth()

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
  // Home is your collection when signed in; search for everyone else (a collection needs an account).
  const view = params.get('view') ?? (profile ? 'collection' : 'search')
  const username = params.get('u')
  const other = usePublicProfile(username && username !== profile?.username ? username : null)
  const viewingOther = !!username && username !== profile?.username
  const own = useCollectionFor(profile, false, searcher)
  const theirs = useCollectionFor(other, true, searcher)
  const ctx = viewingOther ? theirs : own

  const go = (v: string, extra: Record<string, string> = {}) => setParams(new URLSearchParams({ view: v, ...extra }))
  const tab = (v: string, label: string) => (
    <button type="button" className={view === v && !viewingOther ? 'tab on' : 'tab'} onClick={() => go(v)}>
      {label}
    </button>
  )

  return (
    <div className="page">
      <header className="top">
        <a className="brand" href={import.meta.env.BASE_URL}>
          <img src={`${import.meta.env.BASE_URL}icons/icon-32.png`} alt="" width={28} height={28} />
          <span className="brand-name">Chaos Catalog</span>
        </a>
        <nav className="tabs">
          {profile && tab('collection', 'Collection')}
          {tab('search', 'Search')}
          {tab('decks', 'Decks')}
          {tab('prices', 'Prices')}
          {profile && tab('friends', 'Friends')}
          {profile && tab('history', 'History')}
          {tab('account', session ? 'Account' : 'Sign in')}
        </nav>
      </header>
      {viewingOther && (
        <p className="bulkbar">
          {other === null ? (
            <>No public profile called {username}.</>
          ) : (
            <>
              Viewing <strong>{other?.display_name || username}</strong>
              {other?.city && ` (${other.city})`} · read-only
              <button type="button" className={view === 'user' ? 'chip on' : 'chip'} onClick={() => go('user', { u: username! })}>
                Collection
              </button>
              <button type="button" className={view === 'search' ? 'chip on' : 'chip'} onClick={() => go('search', { u: username!, mine: '1' })}>
                Search their cards
              </button>
            </>
          )}
          <button type="button" className="link" onClick={() => go('search')}>
            Leave
          </button>
        </p>
      )}
      {own && <SyncBanner store={own.store} />}
      <main>
        {state.status === 'loading' && <p className="muted">Loading cards…</p>}
        {state.status === 'error' && (
          <p className="error">
            {state.message}. {import.meta.env.DEV && 'Run npm run build:data first.'}
          </p>
        )}
        {searcher && (
          <CollectionContext.Provider value={ctx}>
            {view === 'search' && <SearchPage searcher={searcher} prices={prices} />}
            {(view === 'collection' || view === 'user') && (ctx ? <CollectionPage /> : <SignInHint />)}
            {view === 'history' && (ctx ? <HistoryPage /> : <SignInHint />)}
            {view === 'decks' && <DecksPage searcher={searcher} prices={prices} />}
            {view === 'prices' && state.status === 'ok' && <PricesPage searcher={searcher} meta={state.meta} today={prices} />}
            {view === 'friends' && <FriendsPage searcher={searcher} tab={params.get('tab') ?? undefined} />}
            {view === 'data' && (ctx ? <DataPage /> : <SignInHint />)}
            {view === 'syntax' && <SyntaxGuide />}
            {view === 'scan' && (own && !viewingOther ? <ScanPage searcher={searcher} /> : <SignInHint />)}
            {view === 'account' && <AccountPage inviteCode={params.get('invite') ?? undefined} />}
          </CollectionContext.Provider>
        )}
      </main>
      {state.status === 'ok' && <StaleNotice meta={state.meta} />}
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

function SignInHint() {
  const { session, profile } = useAuth()
  if (session && !profile) return <p className="muted">Loading your profile…</p>
  return <p className="muted">Sign in to keep a collection.</p>
}

/** The daily update can fail or be skipped; say so instead of quietly showing old data. */
function StaleNotice({ meta }: { meta: YgoMeta }) {
  const [now] = useState(() => Date.now())
  const days = (iso: string | undefined) => (iso ? Math.floor((now - Date.parse(iso)) / 86400000) : Infinity)
  const built = days(meta.builtAt)
  const priced = days(meta.priceDays[0])
  if (built < 3 && priced < 3) return null
  return (
    <p className="error small">
      The daily update seems to be stuck: card data was last built {built === Infinity ? 'never' : `${built} days ago`}
      {priced !== Infinity ? `, prices are from ${meta.priceDays[0]}` : ', and there are no prices yet'}. If you run this site, check
      GitHub → Actions → Build and deploy.
    </p>
  )
}
