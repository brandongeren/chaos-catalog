import { useSyncExternalStore } from 'react'
import type { CollectionStore } from '../../core/collection/store.ts'

/** Unsaved changes, offline state and conflicts for your own collection. */
export function SyncBanner({ store }: { store: CollectionStore }) {
  // re-render on every store change
  useSyncExternalStore(store.subscribe, store.getSnapshot)
  const { pending, offline, conflicts, error } = store
  if (!pending && !offline && !conflicts.length && !error) return null
  return (
    <div className="sync">
      {offline && (
        <p>
          <strong>Offline.</strong> {pending ? `${pending} change${pending > 1 ? 's' : ''} saved on this device, ` : 'Changes are saved on this device and '}
          sent when you're back online. Sync before editing your collection on another device.
        </p>
      )}
      {!offline && pending > 0 && <p className="muted small">Saving {pending} change{pending > 1 ? 's' : ''}…</p>}
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
