import { useMemo, useState } from 'react'
import { groupPath, uuid } from '../../../core/collection/model.ts'
import { change, useCollection, useCollectionContext } from '../../../ui/collection/context.ts'
import { GroupSelect } from '../../../ui/collection/dialogs.tsx'
import { codeIndex, findCards, ocrWords, type Detection } from '../scan.ts'
import { QtyInput, validQty } from '../../../ui/QtyInput.tsx'
import type { Searcher } from '../search.ts'

interface Row {
  id: string
  detection: Detection
  approved: boolean
  rarity: string
  qty: number | null
}

/** Photograph cards laid out flat; their set codes are read on the device and listed for you to confirm. */
export function ScanPage({ searcher }: { searcher: Searcher }) {
  const ctx = useCollectionContext()
  const c = useCollection(ctx.store)
  const index = useMemo(() => codeIndex(searcher), [searcher])
  const [rows, setRows] = useState<Row[]>([])
  const [progress, setProgress] = useState<string>()
  const [error, setError] = useState<string>()
  const [groupId, setGroupId] = useState(localStorage.getItem('lastGroup') ?? '')
  const [done, setDone] = useState<string>()
  const [preview, setPreview] = useState<string>()

  const scan = async (files: FileList) => {
    setError(undefined)
    setDone(undefined)
    const found: Row[] = []
    for (const [i, file] of [...files].entries()) {
      setPreview(URL.createObjectURL(file))
      setProgress(`Reading photo ${i + 1} of ${files.length}… (the first scan downloads the text reader, a few MB)`)
      try {
        const words = await ocrWords(file, (p) => setProgress(`Reading photo ${i + 1} of ${files.length}: ${Math.round(p * 100)}%`))
        for (const d of findCards(words, index, searcher))
          found.push({ id: uuid(), detection: d, approved: true, rarity: d.rarities[0] ?? '', qty: 1 })
      } catch (err) {
        setError(`Couldn't read photo ${i + 1}: ${(err as Error).message}`)
      }
    }
    setProgress(found.length ? undefined : 'No set codes found. Try a closer, sharper photo with the codes (under the artwork) in focus.')
    setRows((r) => [...r, ...found])
  }

  const update = (id: string, patch: Partial<Row>) => setRows((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  const approved = rows.filter((r) => r.approved)
  const manual = rows.filter((r) => !r.approved)
  const total = approved.reduce((n, r) => n + (r.qty ?? 0), 0)
  const allValid = approved.every((r) => validQty(r.qty, 99))

  const add = async () => {
    if (!c.groups.has(groupId)) return setError('Choose a group to put them in')
    localStorage.setItem('lastGroup', groupId)
    const err = await change(ctx, 'scan_add', `Added ${total} scanned cards to ${groupPath(c, groupId)}`, (d) => {
      for (const r of approved)
        d.add(
          {
            card_key: String(r.detection.card.id),
            qty: r.qty ?? 0,
            details: r.detection.kind === 'set-code' ? { set_code: r.detection.code, rarity: r.rarity || null } : {},
          },
          groupId,
        )
    }, { batch_id: uuid() })
    if (err) return setError(err)
    setDone(`Added ${total} cards to ${groupPath(c, groupId)}.`)
    setRows(manual)
  }

  if (ctx.readOnly) return null
  return (
    <div>
      <h2>Scan cards</h2>
      <p className="muted small">
        Lay cards out flat, face up, in good light, and take a photo (several cards per photo is fine). The set codes under
        the artwork are read on your device; nothing is uploaded. Untick anything that's wrong to add it by hand instead.
      </p>
      <label className="chip">
        Take or choose photos…
        <input type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => e.target.files?.length && scan(e.target.files)} />
      </label>
      {preview && <img className="scan-preview" src={preview} alt="Last photo" />}
      {progress && <p className="muted">{progress}</p>}
      {error && <p className="error">{error}</p>}
      {done && <p className="ok">{done}</p>}

      {rows.length > 0 && (
        <>
          <ul className="results">
            {rows.map((r) => (
              <li key={r.id} className="row-with-check">
                <input type="checkbox" aria-label="Approve" checked={r.approved} onChange={(e) => update(r.id, { approved: e.target.checked })} />
                <div className="stack-row">
                  <QtyInput max={99} className="qty-input" value={r.qty} onChange={(n) => update(r.id, { qty: n })} />
                  <span className="stack-main">
                    <span className="name">{r.detection.card.n}</span>
                    <span className="meta">
                      {r.detection.code}
                      {r.detection.raw !== r.detection.code && ` (read “${r.detection.raw}”)`}
                    </span>
                  </span>
                  {r.detection.rarities.length > 1 ? (
                    <select value={r.rarity} onChange={(e) => update(r.id, { rarity: e.target.value })} aria-label="Rarity">
                      {r.detection.rarities.map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="muted small">{r.rarity}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <div className="bulkbar">
            <label>
              Put {total} approved cards into: <GroupSelect value={c.groups.has(groupId) ? groupId : ''} onChange={setGroupId} />
            </label>
            <button type="button" className="primary" disabled={!approved.length || !allValid} onClick={add}>
              Add
            </button>
            <button type="button" className="link" onClick={() => setRows([])}>
              Clear list
            </button>
          </div>
          {manual.length > 0 && (
            <section>
              <h3>Add by hand ({manual.length})</h3>
              <ul className="locations">
                {manual.map((r) => (
                  <li key={r.id}>
                    read “{r.detection.raw}” ·{' '}
                    <a href={`?view=search&q=${encodeURIComponent(r.detection.card.n)}&add=${groupId}`}>search for it</a>{' '}
                    <button type="button" className="link small" onClick={() => setRows((x) => x.filter((y) => y.id !== r.id))}>
                      dismiss
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}
