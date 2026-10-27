import { useCallback, useEffect, useState } from 'react'
import { groupPath, uuid, type CardLine } from '../../core/collection/model.ts'
import type { OpRecord } from '../../core/collection/store.ts'
import { Modal } from '../Modal.tsx'
import { change, useCollection, useCollectionContext } from './context.ts'
import { GroupSelect } from './dialogs.tsx'
import { QtyInput, validQty } from '../QtyInput.tsx'
import { languageName } from './labels.ts'

const lineKey = (op: OpRecord, i: number) => `${op.id}:${i}`

/** The collection's history, newest first. Cards from any change can be ticked and put back into a group. */
export function HistoryPage() {
  const ctx = useCollectionContext()
  const c = useCollection(ctx.store)
  const [ops, setOps] = useState<OpRecord[]>([])
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string>()
  const [picked, setPicked] = useState<Map<string, CardLine>>(new Map())
  const [qty, setQty] = useState<Map<string, number | null>>(new Map())
  const [putBack, setPutBack] = useState(false)

  const more = useCallback(
    async (before?: number) => {
      try {
        const page = await ctx.store.history(100, before)
        setOps((o) => (before ? [...o, ...page] : page))
        setDone(page.length < 100)
      } catch (err) {
        setError((err as Error).message)
      }
    },
    [ctx.store],
  )
  useEffect(() => {
    void more()
  }, [more, ctx.store.pending])

  const toggle = (key: string, line: CardLine) =>
    setPicked((p) => {
      const n = new Map(p)
      if (n.has(key)) n.delete(key)
      else n.set(key, line)
      return n
    })
  const pickAll = (op: OpRecord) =>
    setPicked((p) => {
      const n = new Map(p)
      op.summary.cards?.forEach((l, i) => n.set(lineKey(op, i), l))
      return n
    })
  const qtyOf = (k: string, l: CardLine) => (qty.has(k) ? qty.get(k)! : l.qty)
  const total = [...picked.entries()].reduce((n, [k, l]) => n + (qtyOf(k, l) ?? 0), 0)
  const allValid = [...picked.entries()].every(([k, l]) => validQty(qtyOf(k, l), l.qty))

  if (ctx.readOnly) return <p className="muted">History is private.</p>

  return (
    <div>
      <h2>History</h2>
      <p className="muted small">
        Every change to your collection. Tick cards from any change (for example the cards you pulled for a deck) to put them
        back into a group, even if they were removed from the collection.
      </p>
      {picked.size > 0 && (
        <div className="bulkbar">
          {total} cards ticked
          <button type="button" className="chip" disabled={!allValid} onClick={() => setPutBack(true)}>
            Put into a group…
          </button>
          {!allValid && <span className="error small">Fill in how many for each ticked card</span>}
          <button type="button" className="link" onClick={() => setPicked(new Map())}>
            Clear
          </button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <ol className="history">
        {ops.map((op) => (
          <li key={op.id}>
            <div className="history-head">
              <span>{op.summary.text}</span>
              <span className="muted small">{new Date(op.created_at).toLocaleString()}</span>
            </div>
            {op.summary.cards && op.summary.cards.length > 0 && (
              <>
                <ul className="history-cards">
                  {op.summary.cards.map((l, i) => {
                    const key = lineKey(op, i)
                    return (
                      <li key={key}>
                        <label className="check">
                          <input type="checkbox" checked={picked.has(key)} onChange={() => toggle(key, l)} />
                          {picked.has(key) && l.qty > 1 ? (
                            <QtyInput
                              className="qty-input"
                              max={l.qty}
                              value={qty.has(key) ? qty.get(key)! : l.qty}
                              onChange={(n) => setQty(new Map(qty).set(key, n))}
                            />
                          ) : (
                            <span>{l.qty}×</span>
                          )}
                          <span>{l.name}</span>
                          <span className="muted small">
                            {[l.details.set_code, l.details.rarity, l.details.edition, l.details.condition, l.details.language !== 'en' ? languageName(l.details.language) : null, l.details.note ? `“${l.details.note}”` : null]
                              .filter(Boolean)
                              .join(' · ')}
                            {l.from !== undefined && ` · from ${l.from ? groupPath(c, l.from) : 'outside'}`}
                            {l.to !== undefined && ` → ${l.to ? groupPath(c, l.to) : 'removed'}`}
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
                {op.summary.cards.length > 1 && (
                  <button type="button" className="link small" onClick={() => pickAll(op)}>
                    Tick all {op.summary.cards.length}
                  </button>
                )}
              </>
            )}
          </li>
        ))}
      </ol>
      {!ops.length && !error && <p className="muted">No changes yet.</p>}
      {!done && ops.length > 0 && (
        <button type="button" className="more" onClick={() => more(ops.at(-1)!.id)}>
          Older changes
        </button>
      )}
      {putBack && (
        <PutBackDialog
          lines={[...picked.entries()].map(([k, l]) => ({ ...l, qty: qtyOf(k, l) ?? 0 }))}
          onClose={(ok) => {
            setPutBack(false)
            if (ok) setPicked(new Map())
          }}
        />
      )}
    </div>
  )
}

function PutBackDialog({ lines, onClose }: { lines: CardLine[]; onClose: (ok: boolean) => void }) {
  const ctx = useCollectionContext()
  const c = useCollection(ctx.store)
  const [to, setTo] = useState('')
  const [error, setError] = useState<string>()
  const cards = lines.reduce((n, l) => n + l.qty, 0)
  return (
    <Modal title={`Put ${cards} cards into a group`} onClose={() => onClose(false)}>
      <form
        className="stack-form"
        onSubmit={async (e) => {
          e.preventDefault()
          const err = await change(ctx, 'readd', `Put ${cards} cards from history into ${groupPath(c, to)}`, (d) => {
            for (const l of lines) {
              if (l.custom_card_id && !d.collection.custom_cards.has(l.custom_card_id)) {
                const custom = d.createCustomCard(l.name)
                d.add({ custom_card_id: custom.id, qty: l.qty, details: l.details }, to)
              } else d.add({ game: l.game, card_key: l.card_key, custom_card_id: l.custom_card_id, qty: l.qty, details: l.details }, to)
            }
          }, { batch_id: uuid() })
          if (err) setError(err)
          else onClose(true)
        }}
      >
        <p className="small">
          These are added as new copies with their recorded details. If some are still in the collection somewhere else, move
          those instead, or remove them where they were.
        </p>
        <label className="field">
          <span>Into</span>
          <GroupSelect value={to} onChange={setTo} />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button className="primary">Put them there</button>
        </div>
      </form>
    </Modal>
  )
}
