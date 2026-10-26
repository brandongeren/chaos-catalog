// Pull list: for each card a decklist needs, where to take copies from. With no strategy it only lists every
// location; a strategy also picks which copies to take (and the app can move them into the deck in one batch).

import type { Collection, Condition, Section, Stack } from './model.ts'

export type PullStrategy = 'list' | 'fewest-stops' | 'cheapest' | 'worst-condition' | 'prefer-box'

export const PULL_STRATEGIES: [PullStrategy, string][] = [
  ['list', 'Just list every location'],
  ['fewest-stops', 'Fewest groups to visit'],
  ['cheapest', 'Cheapest copies first'],
  ['worst-condition', 'Most played copies first (keep the nice ones stored)'],
  ['prefer-box', 'Prefer one box'],
]

export interface Need {
  card_key: string
  name: string
  qty: number
  section: Section
}

export interface PullLine extends Need {
  /** Every stack holding this card outside the target deck and lent-out areas. */
  sources: Stack[]
  /** Chosen copies (empty for strategy "list"). */
  picks: { stack: Stack; qty: number }[]
  /** Copies already in the target deck group. */
  alreadyInDeck: number
  missing: number
}

export interface PullOptions {
  strategy: PullStrategy
  /** Deck group the cards go into; copies already there count toward the need. */
  targetGroup?: string
  preferBox?: string
  /** Price of one copy of a stack (by its printing/edition), if known. */
  priceOf?: (s: Stack) => number | undefined
}

const WORST_FIRST: (Condition | null)[] = ['Damaged', 'HP', 'MP', 'LP', null, 'NM']

export function pullList(c: Collection, needs: Need[], opts: PullOptions): PullLine[] {
  const usable = (s: Stack) => {
    const g = c.groups.get(s.group_id)
    return !!g && g.kind !== 'lent' && s.group_id !== opts.targetGroup
  }
  const byCard = new Map<string, Stack[]>()
  for (const s of c.stacks.values())
    if (s.card_key) byCard.set(s.card_key, [...(byCard.get(s.card_key) ?? []), s])

  // fewest stops: groups that can supply the most different needed cards come first
  const groupScore = new Map<string, number>()
  if (opts.strategy === 'fewest-stops')
    for (const n of needs)
      for (const g of new Set((byCard.get(n.card_key) ?? []).filter(usable).map((s) => s.group_id)))
        groupScore.set(g, (groupScore.get(g) ?? 0) + 1)

  const order = (a: Stack, b: Stack): number => {
    switch (opts.strategy) {
      case 'fewest-stops':
        return (groupScore.get(b.group_id) ?? 0) - (groupScore.get(a.group_id) ?? 0) || b.qty - a.qty
      case 'cheapest': {
        const pa = opts.priceOf?.(a) ?? Infinity
        const pb = opts.priceOf?.(b) ?? Infinity
        return pa - pb
      }
      case 'worst-condition':
        return WORST_FIRST.indexOf(a.condition) - WORST_FIRST.indexOf(b.condition)
      case 'prefer-box': {
        const inBox = (s: Stack) => (c.groups.get(s.group_id)?.box_id === opts.preferBox ? 0 : 1)
        return inBox(a) - inBox(b)
      }
      default:
        return 0
    }
  }

  // Copies picked for one line can't be picked again for another line of the same card (e.g. main + side).
  const left = new Map<string, number>()
  return needs.map((n) => {
    const all = byCard.get(n.card_key) ?? []
    const alreadyInDeck = opts.targetGroup
      ? all.filter((s) => s.group_id === opts.targetGroup && (s.section ?? 'main') === n.section).reduce((x, s) => x + s.qty, 0)
      : 0
    const sources = all.filter(usable).sort(order)
    let want = Math.max(0, n.qty - alreadyInDeck)
    const picks: PullLine['picks'] = []
    if (opts.strategy !== 'list')
      for (const s of sources) {
        if (!want) break
        const free = left.get(s.id) ?? s.qty
        const take = Math.min(free, want)
        if (take > 0) {
          picks.push({ stack: s, qty: take })
          left.set(s.id, free - take)
          want -= take
        }
      }
    const available = sources.reduce((x, s) => x + (left.get(s.id) ?? s.qty), 0) + picks.reduce((x, p) => x + p.qty, 0)
    const missing = Math.max(0, n.qty - alreadyInDeck - (opts.strategy === 'list' ? available : picks.reduce((x, p) => x + p.qty, 0)))
    return { ...n, sources, picks, alreadyInDeck, missing }
  })
}
