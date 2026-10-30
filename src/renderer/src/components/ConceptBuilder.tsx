// Guided query building: each concept is a group of synonyms (combined with OR),
// and concepts are combined with AND.
import { Fragment, useState } from 'react'
import type { ConceptField, MeshSuggestion, SearchConcept } from '../../../shared/types'
import { CONCEPT_FIELDS, emptyConcept } from '../../../shared/query'
import { api, errorMessage } from '../api'

interface Props {
  concepts: SearchConcept[]
  onChange: (concepts: SearchConcept[]) => void
}

export function ConceptBuilder({ concepts, onChange }: Props) {
  const update = (i: number, c: SearchConcept) => onChange(concepts.map((x, j) => (j === i ? c : x)))
  return (
    <div className="concepts">
      {concepts.map((c, i) => (
        <Fragment key={i}>
          {i > 0 && <div className="concept-and">AND</div>}
          <ConceptRow
            index={i}
            concept={c}
            onChange={(next) => update(i, next)}
            onRemove={concepts.length > 1 ? () => onChange(concepts.filter((_, j) => j !== i)) : undefined}
          />
        </Fragment>
      ))}
      <button type="button" onClick={() => onChange([...concepts, emptyConcept()])}>
        + Add another concept (AND)
      </button>
    </div>
  )
}

interface RowProps {
  index: number
  concept: SearchConcept
  onChange: (c: SearchConcept) => void
  onRemove?: () => void
}

function ConceptRow({ index, concept, onChange, onRemove }: RowProps) {
  const [draft, setDraft] = useState('')
  const [suggestions, setSuggestions] = useState<MeshSuggestion[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** Adds typed text as terms; commas or semicolons separate several synonyms. */
  const commit = (text: string): SearchConcept => {
    const added = text
      .split(/[,;\n]/)
      .map((t) => t.trim())
      .filter((t) => t && !concept.terms.includes(t))
    setDraft('')
    if (added.length === 0) return concept
    const next = { ...concept, terms: [...concept.terms, ...added] }
    onChange(next)
    return next
  }

  const suggest = async () => {
    const c = commit(draft)
    setLoading(true)
    setError(null)
    try {
      const seen = new Set<string>()
      const all: MeshSuggestion[] = []
      for (const term of c.terms.slice(0, 4)) {
        for (const s of await api.suggestMesh(term)) {
          if (!seen.has(s.ui)) {
            seen.add(s.ui)
            all.push(s)
          }
        }
      }
      setSuggestions(all)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="concept">
      <div className="concept-head">
        <strong>Concept {index + 1}</strong>
        <div className="row">
          <label className="inline small">
            Search in
            <select
              value={concept.field}
              onChange={(e) => onChange({ ...concept, field: e.target.value as ConceptField })}
            >
              {CONCEPT_FIELDS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          {onRemove && (
            <button type="button" className="small" onClick={onRemove}>
              Remove
            </button>
          )}
        </div>
      </div>

      <div className="term-box">
        {concept.terms.map((t) => (
          <span key={`t-${t}`} className="term">
            {t}
            <button type="button" aria-label={`Remove ${t}`} onClick={() => onChange({ ...concept, terms: concept.terms.filter((x) => x !== t) })}>
              ×
            </button>
          </span>
        ))}
        {concept.mesh.map((m) => (
          <span key={`m-${m}`} className="term term-mesh" title="MeSH subject heading (includes narrower headings)">
            {m} <span className="term-kind">MeSH</span>
            <button type="button" aria-label={`Remove ${m}`} onClick={() => onChange({ ...concept, mesh: concept.mesh.filter((x) => x !== m) })}>
              ×
            </button>
          </span>
        ))}
        <input
          className="term-input"
          value={draft}
          placeholder={concept.terms.length || concept.mesh.length ? 'Add a synonym…' : 'Type a term and press Enter, e.g. alcohol use disorder'}
          onChange={(e) => (/[,;]/.test(e.target.value) ? commit(e.target.value) : setDraft(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit(draft)
            } else if (e.key === 'Backspace' && !draft && concept.terms.length) {
              onChange({ ...concept, terms: concept.terms.slice(0, -1) })
            }
          }}
          onBlur={() => commit(draft)}
        />
      </div>

      <div className="row concept-actions">
        <button type="button" className="small" disabled={loading || (!concept.terms.length && !draft.trim())} onClick={suggest}>
          {loading ? 'Looking up…' : 'Suggest MeSH terms'}
        </button>
        <span className="hint">Synonyms in one concept are combined with OR.</span>
      </div>
      {error && <div className="alert alert-error small">{error}</div>}

      {suggestions && (
        <div className="mesh-suggestions">
          {suggestions.length === 0 ? (
            <p className="small muted">No matching MeSH heading found. Text terms will still be searched.</p>
          ) : (
            suggestions.map((s) => {
              const added = concept.mesh.includes(s.name)
              return (
                <div key={s.ui} className="mesh-suggestion">
                  <div>
                    <strong>{s.name}</strong> <span className="small muted">MeSH {s.ui}</span>
                    {s.scopeNote && <div className="small muted">{s.scopeNote}</div>}
                    {s.entryTerms.length > 0 && (
                      <div className="small muted">Also covers: {s.entryTerms.join('; ')}</div>
                    )}
                  </div>
                  <button type="button" className="small" disabled={added} onClick={() => onChange({ ...concept, mesh: [...concept.mesh, s.name] })}>
                    {added ? 'Added' : 'Add'}
                  </button>
                </div>
              )
            })
          )}
          <p className="hint">Suggestions come from NLM&apos;s MeSH database. Check that the definition matches what you mean.</p>
        </div>
      )}
    </div>
  )
}
