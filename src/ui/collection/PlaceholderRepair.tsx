import { useState } from 'react'
import { groupPath, uuid, type Stack } from '../../core/collection/model.ts'
import { isPlaceholderRarity } from '../../games/ygo/keys.ts'
import type { YgoCard } from '../../games/ygo/types.ts'
import { cardOf, change, nameOfStack, useCollection, useCollectionContext } from './context.ts'

/**
 * Cards saved with a placeholder rarity ("New") from before the catalog knew the real one. When that set code now has
 * exactly one printing that YGOPRODeck didn't list (the one "New" stood in for, e.g. MAMO-EN017 → Ultra Rare
 * (Overframe)), offer to fix them in one go; otherwise point at Edit.
 */
export function PlaceholderRepair() {
  const ctx = useCollectionContext()
  const c = useCollection(ctx.store)
  const [error, setError] = useState<string>()
  const fixes: { stack: Stack; card: YgoCard; rarity: string }[] = []
  const unsure: { stack: Stack; card: YgoCard }[] = []
  for (const s of c.stacks.values()) {
    if (!s.rarity || !s.set_code || !isPlaceholderRarity(s.rarity)) continue
    const card = cardOf(ctx.searcher, s)
    if (!card) continue
    const real = (card.p ?? []).filter((p) => p.c === s.set_code && !isPlaceholderRarity(p.r))
    if (real.some((p) => p.r === s.rarity)) continue
    const added = real.filter((p) => p.tcg)
    if (added.length === 1) fixes.push({ stack: s, card, rarity: added[0].r })
    else unsure.push({ stack: s, card })
  }
  if (ctx.readOnly || (!fixes.length && !unsure.length)) return null

  return (
    <div className="owned-box repair">
      <p>
        <strong>
          {fixes.length + unsure.length} card{fixes.length + unsure.length === 1 ? ' was' : 's were'} saved with a placeholder rarity
        </strong>{' '}
        ("New") that the card list has since replaced with the real one.
      </p>
      {fixes.length > 0 && (
        <>
          <ul className="locations small">
            {fixes.map(({ stack, rarity }) => (
              <li key={stack.id}>
                {stack.qty}× {nameOfStack(ctx.searcher, c, stack)} {stack.set_code}: {stack.rarity} → <strong>{rarity}</strong>{' '}
                <span className="muted">({groupPath(c, stack.group_id)})</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="primary"
            onClick={async () =>
              setError(
                await change(ctx, 'repair_rarity', `Replaced placeholder rarity "New" on ${fixes.length} stack(s)`, (d) => {
                  for (const f of fixes) if (d.collection.stacks.has(f.stack.id)) d.edit(f.stack.id, f.stack.qty, { rarity: f.rarity })
                }, { batch_id: uuid() }),
              )
            }
          >
            Fix {fixes.length === 1 ? 'it' : `these ${fixes.length}`}
          </button>
        </>
      )}
      {unsure.length > 0 && (
        <p className="small">
          Pick the rarity by hand (Edit) for:{' '}
          {unsure.map(({ stack }) => `${nameOfStack(ctx.searcher, c, stack)} ${stack.set_code} (${groupPath(c, stack.group_id)})`).join('; ')}
        </p>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  )
}
