import { useState } from 'react'
import { importCsvOps, importJsonOps, parseCsv, parseJsonFile, toCsv, toJsonFile, type CsvPlan } from '../../core/collection/files.ts'
import type { Op } from '../../core/collection/model.ts'
import { wantsOf } from '../../core/social.ts'
import { download } from '../../lib/download.ts'
import { normalize } from '../../games/ygo/search.ts'
import { nameOfStack, useCollection, useCollectionContext } from './context.ts'

/** Export and import the whole collection (JSON backup, or CSV for spreadsheets). */
export function DataPage() {
  const ctx = useCollectionContext()
  const c = useCollection(ctx.store)
  const [plan, setPlan] = useState<{ ops: Op[]; text: string; unmatched?: CsvPlan['unmatched'] }>()
  const [progress, setProgress] = useState<string>()
  const [error, setError] = useState<string>()
  const nameOf = (s: Parameters<typeof nameOfStack>[2]) => nameOfStack(ctx.searcher, c, s)
  const stamp = () => new Date().toISOString().slice(0, 10)

  const byName = () => {
    const m = new Map<string, string>()
    for (const card of ctx.searcher.cards) m.set(normalize(card.n), String(card.id))
    return m
  }

  const readFile = async (file: File) => {
    setError(undefined)
    setPlan(undefined)
    setProgress(undefined)
    try {
      const text = await file.text()
      if (/\.json$/i.test(file.name) || text.trimStart().startsWith('{')) {
        const data = parseJsonFile(text)
        const cards = data.stacks.reduce((n, s) => n + s.qty, 0)
        setPlan({ ops: importJsonOps(c, data, nameOf), text: `${cards.toLocaleString()} cards in ${data.groups.length} groups and ${data.boxes.length} boxes` })
      } else {
        const names = byName()
        const resolve = (passcode: string, name: string) => {
          const card = passcode ? ctx.searcher.byId.get(Number(passcode)) : undefined
          return card ? String(card.id) : names.get(normalize(name))
        }
        const p = importCsvOps(c, parseCsv(text), resolve, nameOf)
        setPlan({ ops: p.ops, text: `${p.cards.toLocaleString()} cards`, unmatched: p.unmatched })
      }
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const run = async () => {
    if (!plan) return
    for (let i = 0; i < plan.ops.length; i++) {
      setProgress(`Saving part ${i + 1} of ${plan.ops.length}…`)
      await ctx.store.apply(plan.ops[i])
      if (ctx.store.error) {
        setError(`Stopped: ${ctx.store.error}`)
        return
      }
    }
    setProgress(`Imported ${plan.text}. You'll find them in History as one batch.`)
    setPlan(undefined)
  }

  return (
    <div className="narrow">
      <h2>Import and export</h2>
      <section>
        <h3>Export</h3>
        <div className="chips">
          <button
            type="button"
            className="chip"
            onClick={async () => download(`chaos-catalog-${stamp()}.json`, toJsonFile(c, await wantsOf(ctx.owner.id).catch(() => undefined)), 'application/json')}
          >
            Backup (JSON)
          </button>
          <button type="button" className="chip" onClick={() => download(`chaos-catalog-${stamp()}.csv`, toCsv(c, nameOf), 'text/csv')}>
            Spreadsheet (CSV)
          </button>
        </div>
        <p className="muted small">JSON keeps everything (boxes, rows, groups, order, custom cards, loans, wants). CSV has one row per stack.</p>
      </section>
      {!ctx.readOnly && (
        <section>
          <h3>Import</h3>
          <p className="muted small">
            Adds to your collection; nothing is deleted. CSV columns (any order, only a name or passcode is required):{' '}
            <code>name, passcode, qty, set_code, rarity, edition, language, condition, box, row, group, group_type, deck_section, availability</code>.
            Boxes and groups are matched by name or created.
          </p>
          <input type="file" accept=".json,.csv,application/json,text/csv" onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} />
          {plan && (
            <div className="owned-box">
              <p>
                Ready to import <strong>{plan.text}</strong> in {plan.ops.length} part{plan.ops.length > 1 ? 's' : ''}.
              </p>
              {plan.unmatched && plan.unmatched.length > 0 && (
                <details>
                  <summary className="error">{plan.unmatched.length} rows didn't match a card and will be skipped</summary>
                  <ul className="small">
                    {plan.unmatched.slice(0, 200).map((u) => (
                      <li key={u.line}>
                        line {u.line}: {u.name}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <button type="button" className="primary" onClick={run}>
                Import
              </button>
            </div>
          )}
        </section>
      )}
      {progress && <p className="ok">{progress}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  )
}
