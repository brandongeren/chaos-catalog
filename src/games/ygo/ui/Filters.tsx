import { ABILITIES, ARROWS, ATTRIBUTES, BAN_STATUSES, FRAMES, KINDS, SPELL_TYPES, TRAP_TYPES } from '../classify.ts'
import { emptyQuery, type Range, type YgoQuery } from '../query.ts'

type ListField = 'kinds' | 'frames' | 'abilities' | 'spellTypes' | 'trapTypes' | 'attributes' | 'races' | 'arrows' | 'ban'
type RangeField = 'level' | 'rank' | 'link' | 'scale' | 'atk' | 'def' | 'gp'

interface Props {
  query: YgoQuery
  races: string[]
  archetypes: string[]
  /** `typing` = text entry: replace the history entry instead of adding one per keystroke. */
  onChange: (next: YgoQuery, typing?: boolean) => void
}

const KIND_LABEL: Record<string, string> = { monster: 'Monster', spell: 'Spell', trap: 'Trap', skill: 'Skill', token: 'Token' }

export function Filters({ query, races, archetypes, onChange }: Props) {
  const toggle = (field: ListField, value: string) => {
    const list = query[field]
    onChange({ ...query, [field]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value] })
  }
  const chips = (field: ListField, values: readonly string[], label?: (v: string) => string) => (
    <div className="chips">
      {values.map((v) => (
        <button
          key={v}
          type="button"
          className={query[field].includes(v) ? 'chip on' : 'chip'}
          aria-pressed={query[field].includes(v)}
          onClick={() => toggle(field, v)}
        >
          {label ? label(v) : v}
        </button>
      ))}
    </div>
  )
  const range = (field: RangeField, label: string, step = 1) => {
    const r = query[field]
    const set = (side: keyof Range, raw: string) =>
      onChange({ ...query, [field]: { ...r, [side]: raw === '' ? undefined : Number(raw) } }, true)
    return (
      <label className="range">
        <span>{label}</span>
        <input type="number" inputMode="numeric" min={0} step={step} placeholder="min" value={r.min ?? ''} onChange={(e) => set('min', e.target.value)} />
        <span className="muted">–</span>
        <input type="number" inputMode="numeric" min={0} step={step} placeholder="max" value={r.max ?? ''} onChange={(e) => set('max', e.target.value)} />
      </label>
    )
  }
  const text = (field: 'text' | 'set' | 'archetype' | 'from' | 'to', props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} value={query[field]} onChange={(e) => onChange({ ...query, [field]: e.target.value }, true)} />
  )

  return (
    <div className="filters">
      <section>
        <h3>Card</h3>
        {chips('kinds', KINDS, (k) => KIND_LABEL[k])}
        <label className="field">
          <span>Card text contains</span>
          {text('text', { type: 'search', placeholder: 'e.g. negate, draw 2' })}
        </label>
        <label className="field">
          <span>Archetype</span>
          {text('archetype', { list: 'archetypes', placeholder: 'e.g. Blue-Eyes' })}
          <datalist id="archetypes">
            {archetypes.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </label>
        <label className="field">
          <span>Set (code or name)</span>
          {text('set', { type: 'search', placeholder: 'e.g. LOB or Duel Devastator' })}
        </label>
      </section>

      <section>
        <h3>Monster</h3>
        {chips('frames', FRAMES)}
        {chips('abilities', ABILITIES)}
        <h4>Attribute</h4>
        {chips('attributes', ATTRIBUTES)}
        <h4>Monster type</h4>
        {chips('races', races)}
        <div className="ranges">
          {range('level', 'Level')}
          {range('rank', 'Rank')}
          {range('link', 'Link rating')}
          {range('scale', 'Pendulum scale')}
          {range('atk', 'ATK', 100)}
          {range('def', 'DEF', 100)}
        </div>
        <h4>Link arrows (all of)</h4>
        <div className="arrows" role="group" aria-label="Link arrows">
          {[ARROWS[0], ARROWS[1], ARROWS[2], ARROWS[3], 'center', ARROWS[4], ARROWS[5], ARROWS[6], ARROWS[7]].map((a) =>
            a === 'center' ? (
              <span key={a} />
            ) : (
              <button key={a} type="button" title={a} className={query.arrows.includes(a) ? 'chip on' : 'chip'} aria-pressed={query.arrows.includes(a)} onClick={() => toggle('arrows', a)}>
                {ARROW_GLYPH[a]}
              </button>
            ),
          )}
        </div>
      </section>

      <section>
        <h3>Spell / Trap</h3>
        <h4>Spell type</h4>
        {chips('spellTypes', SPELL_TYPES)}
        <h4>Trap type</h4>
        {chips('trapTypes', TRAP_TYPES)}
      </section>

      <section>
        <h3>Format</h3>
        <h4>TCG banlist</h4>
        {chips('ban', BAN_STATUSES)}
        <div className="ranges">{range('gp', 'Genesys points')}</div>
        <div className="dates">
          <label className="field">
            <span>Released from</span>
            {text('from', { type: 'date' })}
          </label>
          <label className="field">
            <span>to</span>
            {text('to', { type: 'date' })}
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={query.ocg} onChange={(e) => onChange({ ...query, ocg: e.target.checked })} /> Include OCG-only cards
        </label>
      </section>

      <button type="button" className="link" onClick={() => onChange({ ...emptyQuery(), q: query.q, fuzzy: query.fuzzy, sort: query.sort, desc: query.desc })}>
        Clear filters
      </button>
    </div>
  )
}

const ARROW_GLYPH: Record<string, string> = {
  'Top-Left': '↖',
  Top: '↑',
  'Top-Right': '↗',
  Left: '←',
  Right: '→',
  'Bottom-Left': '↙',
  Bottom: '↓',
  'Bottom-Right': '↘',
}
