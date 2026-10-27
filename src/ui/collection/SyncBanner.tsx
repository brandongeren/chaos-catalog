import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { CollectionStore } from '../../core/collection/store.ts'

const SAVED_SHOWN_MS = 2500 // how long "Saved" stays before fading
const FADE_MS = 600

/** Unsaved changes, offline state and conflicts for your own collection. */
export function SyncBanner({ store }: { store: CollectionStore }) {
  // Re-render on every store event: confirming a queued change doesn't change the collection itself.
  useSyncExternalStore(store.subscribe, store.getVersion)
  const { pending, offline, conflicts, error } = store

  // After saving finishes, say so for a moment and then fade out, instead of vanishing at once.
  const [saved, setSaved] = useState<'shown' | 'fading' | undefined>()
  const wasPending = useRef(false)
  useEffect(() => {
    if (pending > 0) {
      // "Saving…" shows instead while anything is pending
      wasPending.current = true
      return
    }
    if (!wasPending.current || offline || error) return
    wasPending.current = false
    setSaved('shown')
    const fade = setTimeout(() => setSaved('fading'), SAVED_SHOWN_MS)
    const gone = setTimeout(() => setSaved(undefined), SAVED_SHOWN_MS + FADE_MS)
    return () => {
      clearTimeout(fade)
      clearTimeout(gone)
    }
  }, [pending, offline, error])

  if (!pending && !offline && !conflicts.length && !error && !saved) return null
  return (
    <div className="sync">
      {offline && (
        <p>
          <strong>Offline.</strong> {pending ? `${pending} change${pending > 1 ? 's' : ''} saved on this device, ` : 'Changes are saved on this device and '}
          sent when you're back online. Sync before editing your collection on another device.
        </p>
      )}
      {!offline && pending > 0 && <p className="muted small">Saving {pending} change{pending > 1 ? 's' : ''}…</p>}
      {!offline && !pending && saved && <p className={saved === 'fading' ? 'muted small saved fading' : 'muted small saved'}>✓ Saved</p>}
      {error && (
        <p className="error">
          {error}{' '}
          <button type="button" className="link" onClick={() => store.dismissError()}>
            Dismiss
          </button>{' '}
          <button type="button" className="link" onClick={() => store.refresh().then(() => store.flush())}>
            Retry
          </button>
        </p>
      )}
      {conflicts.map((c, i) => (
        <p key={c.op.client_op_id} className="error">
          Not saved: <strong>{c.op.summary.text}</strong>. The same cards were changed on another device first, so this change was
          skipped and your collection shows the latest version. Redo it if you still want it.{' '}
          <button type="button" className="link" onClick={() => store.dismissConflict(i)}>
            OK
          </button>
        </p>
      ))}
    </div>
  )
}
