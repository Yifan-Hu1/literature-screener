// Shows each organism/system label with where it came from, and lets the
// researcher confirm it, mark it as not applying, or add a missing one.
// Corrections are stored separately; automatic labels are never overwritten.
import { useState } from 'react'
import type { SystemTag, TagSource } from '../../../shared/types'
import { SYSTEM_PRESETS, systemLabel } from '../../../shared/systems'

const SOURCE_LABEL: Record<TagSource, string> = {
  pubmed_mesh: 'PubMed MeSH',
  keyword_match: 'word match',
  ai: 'AI',
  manual: 'you'
}

interface Props {
  tags: SystemTag[]
  onSetTag?: (system: string, present: boolean | null) => void
}

export function SystemEditor({ tags, onSetTag }: Props) {
  const [adding, setAdding] = useState('')
  const systems = [...new Set(tags.map((t) => t.system))]
  const missing = SYSTEM_PRESETS.filter((p) => !systems.includes(p.id))

  return (
    <div className="system-editor">
      {systems.length === 0 && <p className="muted small">No organism or system detected.</p>}
      {systems.map((system) => {
        const auto = tags.filter((t) => t.system === system && t.source !== 'manual')
        const manual = tags.find((t) => t.system === system && t.source === 'manual')
        const applies = manual ? manual.present : true
        return (
          <div key={system} className={`system-row ${applies ? '' : 'rejected'}`}>
            <span className="system-name">{systemLabel(system)}</span>
            <span className="small muted system-sources">
              {auto.map((t) => (
                <span key={t.source} title={t.evidence ?? ''} className="source">
                  {SOURCE_LABEL[t.source]}
                  {t.evidence ? `: ${t.evidence}` : ''}
                </span>
              ))}
              {manual && (
                <span className={`source source-manual ${manual.present ? 'ok' : 'no'}`}>
                  {manual.present ? (auto.length ? '✓ confirmed by you' : '✓ added by you') : '✗ you marked: does not apply'}
                </span>
              )}
            </span>
            {onSetTag && (
              <span className="system-actions">
                {manual ? (
                  <button className="small" onClick={() => onSetTag(system, null)}>
                    Undo
                  </button>
                ) : (
                  <>
                    <button className="small" title="This paper really uses this system" onClick={() => onSetTag(system, true)}>
                      ✓ Confirm
                    </button>
                    <button className="small" title="The paper only mentions it" onClick={() => onSetTag(system, false)}>
                      ✗ Doesn&apos;t apply
                    </button>
                  </>
                )}
              </span>
            )}
          </div>
        )
      })}
      {onSetTag && missing.length > 0 && (
        <div className="row system-add">
          <select value={adding} onChange={(e) => setAdding(e.target.value)}>
            <option value="">Add a missing system…</option>
            {missing.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <button
            className="small"
            disabled={!adding}
            onClick={() => {
              onSetTag(adding, true)
              setAdding('')
            }}
          >
            Add
          </button>
        </div>
      )}
      <p className="hint">
        Automatic labels come from PubMed&apos;s MeSH indexing and from words in the title/abstract; a word match may
        only mean the system is mentioned. Your corrections are saved separately and used for filtering.
      </p>
    </div>
  )
}
