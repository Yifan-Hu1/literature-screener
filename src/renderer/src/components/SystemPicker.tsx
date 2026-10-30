// Organism / experimental-system / study-approach chips with an any/all switch.
import type { MatchMode } from '../../../shared/types'
import { SYSTEM_PRESETS } from '../../../shared/systems'

interface Props {
  selected: string[]
  mode: MatchMode
  onChange: (selected: string[], mode: MatchMode) => void
}

const GROUPS = [
  { id: 'organism', label: 'Organisms & experimental systems' },
  { id: 'approach', label: 'Study approach' }
] as const

export function SystemPicker({ selected, mode, onChange }: Props) {
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id], mode)

  return (
    <div className="system-picker">
      {GROUPS.map((g) => (
        <div key={g.id} className="system-group">
          <span className="system-group-label small muted">{g.label}</span>
          <div className="chips">
            {SYSTEM_PRESETS.filter((p) => p.group === g.id).map((p) => (
              <button
                type="button"
                key={p.id}
                className={`chip ${selected.includes(p.id) ? 'on' : ''}`}
                onClick={() => toggle(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      {selected.length > 1 && (
        <div className="segmented" role="radiogroup" aria-label="How to combine the selected systems">
          <button type="button" className={mode === 'any' ? 'on' : ''} onClick={() => onChange(selected, 'any')}>
            Any of these
          </button>
          <button type="button" className={mode === 'all' ? 'on' : ''} onClick={() => onChange(selected, 'all')}>
            All of these in the same paper
          </button>
        </div>
      )}
    </div>
  )
}
