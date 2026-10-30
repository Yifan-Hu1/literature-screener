// Screening criteria (versioned) and the project's exclusion reasons.
import { useEffect, useState } from 'react'
import type { ExclusionReason, ProjectOverview } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { ErrorBox } from './common'

export function CriteriaCard({ project, onSaved }: { project: ProjectOverview; onSaved: (p: ProjectOverview) => void }) {
  const [editing, setEditing] = useState(false)
  const [inclusion, setInclusion] = useState(project.inclusionCriteria)
  const [exclusion, setExclusion] = useState(project.exclusionCriteria)
  const [error, setError] = useState<string | null>(null)

  if (!editing) {
    return (
      <>
        <div className="two-col">
          <section className="card">
            <h3>Inclusion criteria</h3>
            <pre className="criteria">{project.inclusionCriteria || '—'}</pre>
          </section>
          <section className="card">
            <h3>Exclusion criteria</h3>
            <pre className="criteria">{project.exclusionCriteria || '—'}</pre>
          </section>
        </div>
        <div className="row criteria-footer">
          <span className="hint">Criteria version {project.criteriaVersion}. Each screening decision records the version in force.</span>
          <button
            className="small"
            onClick={() => {
              setInclusion(project.inclusionCriteria)
              setExclusion(project.exclusionCriteria)
              setEditing(true)
            }}
          >
            Edit criteria
          </button>
        </div>
      </>
    )
  }

  return (
    <section className="card">
      <h3>Edit criteria</h3>
      <div className="two-col">
        <label>
          Inclusion criteria
          <textarea rows={6} value={inclusion} onChange={(e) => setInclusion(e.target.value)} />
        </label>
        <label>
          Exclusion criteria
          <textarea rows={6} value={exclusion} onChange={(e) => setExclusion(e.target.value)} />
        </label>
      </div>
      <p className="hint">
        Saving creates criteria version {project.criteriaVersion + 1}. Decisions already made keep pointing at the version
        they were made under, so you can see which ones may need another look.
      </p>
      <ErrorBox message={error} />
      <div className="row">
        <button
          className="primary"
          onClick={async () => {
            try {
              onSaved(await api.updateCriteria(inclusion, exclusion))
              setEditing(false)
            } catch (e) {
              setError(errorMessage(e))
            }
          }}
        >
          Save as new version
        </button>
        <button onClick={() => setEditing(false)}>Cancel</button>
      </div>
    </section>
  )
}

export function ExclusionReasonsCard() {
  const [reasons, setReasons] = useState<ExclusionReason[]>([])
  const [newLabel, setNewLabel] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.listExclusionReasons().then(setReasons, (e) => setError(errorMessage(e)))
  }, [])

  const run = async (action: () => Promise<ExclusionReason[]>) => {
    setError(null)
    try {
      setReasons(await action())
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  const active = reasons.filter((r) => !r.retired)
  const retired = reasons.filter((r) => r.retired)

  return (
    <section className="card">
      <h3>Exclusion reasons</h3>
      <p className="hint">
        Offered when you exclude a paper (press E, then the number). Renaming or retiring a reason does not change
        decisions already made: each decision keeps the wording it was made with.
      </p>
      <ol className="reason-list">
        {active.map((r) => (
          <li key={r.id}>
            {editingId === r.id ? (
              <form
                className="row"
                onSubmit={(e) => {
                  e.preventDefault()
                  void run(() => api.renameExclusionReason(r.id, editLabel)).then(() => setEditingId(null))
                }}
              >
                <input className="grow" value={editLabel} onChange={(e) => setEditLabel(e.target.value)} autoFocus />
                <button type="submit" className="small" disabled={!editLabel.trim()}>
                  Save
                </button>
                <button type="button" className="small" onClick={() => setEditingId(null)}>
                  Cancel
                </button>
              </form>
            ) : (
              <div className="row">
                <span className="grow">{r.label}</span>
                <button
                  className="small"
                  onClick={() => {
                    setEditingId(r.id)
                    setEditLabel(r.label)
                  }}
                >
                  Rename
                </button>
                <button className="small" onClick={() => run(() => api.setExclusionReasonRetired(r.id, true))}>
                  Retire
                </button>
              </div>
            )}
          </li>
        ))}
      </ol>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault()
          void run(() => api.addExclusionReason(newLabel)).then(() => setNewLabel(''))
        }}
      >
        <input className="grow" placeholder="Add a reason…" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
        <button type="submit" className="small" disabled={!newLabel.trim()}>
          Add
        </button>
      </form>
      {retired.length > 0 && (
        <details className="retired">
          <summary className="small">Retired reasons ({retired.length})</summary>
          {retired.map((r) => (
            <div key={r.id} className="row small">
              <span className="grow muted">{r.label}</span>
              <button className="small" onClick={() => run(() => api.setExclusionReasonRetired(r.id, false))}>
                Restore
              </button>
            </div>
          ))}
        </details>
      )}
      <ErrorBox message={error} />
    </section>
  )
}
