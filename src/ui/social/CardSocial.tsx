import { useEffect, useState } from 'react'
import { removeWant, setWant, wantsOf } from '../../core/social.ts'
import type { YgoCard } from '../../games/ygo/types.ts'
import { useCollectionContext } from '../collection/context.ts'
import { WhoHasIt } from './WhoHasIt.tsx'

/** On a card's page, for signed-in users: wants list toggle and which friends/locals have it. */
export function CardSocial({ card }: { card: YgoCard }) {
  const { owner } = useCollectionContext()
  const [wanted, setWanted] = useState<number>()
  const [showHolders, setShowHolders] = useState(false)
  const key = String(card.id)
  useEffect(() => {
    wantsOf(owner.id).then((w) => setWanted(w.find((x) => x.card_key === key)?.qty ?? 0), () => {})
  }, [owner.id, key])
  return (
    <section className="owned-box">
      <h3>
        {wanted ? `On your wants list (${wanted})` : 'Want it?'}{' '}
        <button
          type="button"
          className="chip"
          onClick={async () => {
            if (wanted) await removeWant(key)
            else await setWant(key, 1)
            setWanted(wanted ? 0 : 1)
          }}
        >
          {wanted ? 'Remove from wants' : '+ Want'}
        </button>{' '}
        <button type="button" className="chip" onClick={() => setShowHolders(true)}>
          Who has it?
        </button>
      </h3>
      {showHolders && <WhoHasIt cards={[{ card_key: key, name: card.n, qty: Math.max(1, wanted ?? 1) }]} />}
    </section>
  )
}
