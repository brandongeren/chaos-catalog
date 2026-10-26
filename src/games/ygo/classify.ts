// Facts derived from a catalog card: what kind of card it is, Level vs Rank, display strings.

import type { YgoCard } from './types.ts'

export type Kind = 'monster' | 'spell' | 'trap' | 'skill' | 'token'

export const KINDS: Kind[] = ['monster', 'spell', 'trap', 'skill', 'token']
/** Monster card classes, as YGOPRODeck's typeline names them. */
export const FRAMES = ['Normal', 'Effect', 'Ritual', 'Fusion', 'Synchro', 'Xyz', 'Pendulum', 'Link'] as const
export const ABILITIES = ['Tuner', 'Flip', 'Gemini', 'Union', 'Spirit', 'Toon'] as const
export const SPELL_TYPES = ['Normal', 'Quick-Play', 'Continuous', 'Equip', 'Field', 'Ritual'] as const
export const TRAP_TYPES = ['Normal', 'Continuous', 'Counter'] as const
export const ATTRIBUTES = ['DARK', 'LIGHT', 'EARTH', 'WATER', 'FIRE', 'WIND', 'DIVINE'] as const
export const ARROWS = ['Top-Left', 'Top', 'Top-Right', 'Left', 'Right', 'Bottom-Left', 'Bottom', 'Bottom-Right'] as const
export const BAN_STATUSES = ['Banned', 'Limited', 'Semi-Limited', 'Unlimited'] as const

export function kindOf(c: YgoCard): Kind {
  if (c.f === 'spell') return 'spell'
  if (c.f === 'trap') return 'trap'
  if (c.f === 'skill') return 'skill'
  if (c.f === 'token') return 'token'
  return 'monster'
}

export const isXyz = (c: YgoCard) => c.f.startsWith('xyz')
export const isLink = (c: YgoCard) => c.f === 'link'

/** Level for most monsters; undefined for Xyz (Rank) and Link monsters. */
export const levelOf = (c: YgoCard) => (kindOf(c) === 'monster' && !isXyz(c) && !isLink(c) ? c.lv : undefined)
export const rankOf = (c: YgoCard) => (isXyz(c) ? c.lv : undefined)

/** Release date used for sorting and the date filter: TCG first; OCG-only cards fall back to their OCG date. */
export const releaseDate = (c: YgoCard) => c.tcg ?? c.ocg

export const statText = (v: number | undefined) => (v === undefined ? '' : v < 0 ? '?' : String(v))

/** One-line summary, e.g. "DARK Spellcaster / Effect · Level 7 · 2500 / 2000". */
export function summary(c: YgoCard): string {
  const k = kindOf(c)
  if (k === 'spell' || k === 'trap') return `${c.r} ${k === 'spell' ? 'Spell' : 'Trap'}`.trim()
  if (k === 'skill') return `Skill (${c.r})`
  const parts = [`${c.a ? c.a + ' ' : ''}${c.r}${c.tl?.length ? ' / ' + c.tl.join(' / ') : ''}`]
  if (isLink(c)) parts.push(`Link-${c.lk}`)
  else if (isXyz(c)) parts.push(`Rank ${c.lv}`)
  else if (c.lv !== undefined) parts.push(`Level ${c.lv}`)
  if (c.sc !== undefined) parts.push(`Scale ${c.sc}`)
  if (c.atk !== undefined) parts.push(isLink(c) ? `ATK ${statText(c.atk)}` : `${statText(c.atk)} / ${statText(c.def)}`)
  return parts.join(' · ')
}
