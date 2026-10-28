import { useEffect, useState } from 'react'
import type { ProjectOverview, SearchLogEntry } from '../../../shared/types'
import { api, errorMessage, formatDate } from '../api'
import { ErrorBox } from '../components/common'

const STATUS_LABEL: Record<SearchLogEntry['status'], string> = {
  in_progress: 'In progress',
  complete: 'Complete',
  incomplete: 'Incomplete',
  failed: 'Failed'
}

export function OverviewScreen({ project }: { project: ProjectOverview }) {
  const [searches, setSearches] = useState<SearchLogEntry[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.listSearches().then(setSearches, (e) => setError(errorMessage(e)))
  }, [project])

  const { include, exclude, unsure } = project.counts
  const undecided = project.recordCount - include - exclude - unsure

  return (
    <div className="page">
      <h1>{project.name}</h1>
      {project.cloudWarning && <div className="alert alert-warn">{project.cloudWarning}</div>}
      {project.researchQuestion && <p className="lead">{project.researchQuestion}</p>}

      <div className="stats">
        <Stat label="Records" value={project.recordCount} />
        <Stat label="Not screened" value={undecided} />
        <Stat label="Include" value={include} kind="include" />
        <Stat label="Unsure" value={unsure} kind="unsure" />
        <Stat label="Exclude" value={exclude} kind="exclude" />
      </div>

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
      <p className="hint">Criteria version {project.criteriaVersion}. Each screening decision records the version in force.</p>

      <section className="card">
        <h3>Search history</h3>
        {searches.length === 0 ? (
          <p className="muted">No searches yet. Go to “Search PubMed” to find publications.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Date</th>
                <th>Type</th>
                <th>Query sent to PubMed</th>
                <th className="num">Results</th>
                <th className="num">Saved</th>
                <th className="num">New</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {searches.map((s) => (
                <tr key={s.id}>
                  <td>{s.id}</td>
                  <td className="nowrap">{formatDate(s.runAt)}</td>
                  <td>{s.mode === 'structured' ? 'Import all' : 'Hand-picked'}</td>
                  <td>
                    <code className="query">{s.querySent}</code>
                    {s.message && <div className="small muted">{s.message}</div>}
                  </td>
                  <td className="num">{s.totalCount?.toLocaleString() ?? '—'}</td>
                  <td className="num">{s.retrievedCount.toLocaleString()}</td>
                  <td className="num">{s.newCount.toLocaleString()}</td>
                  <td>
                    <span className={`status status-${s.status}`}>{STATUS_LABEL[s.status]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h3>Project folder</h3>
        <p className="small">
          <code>{project.path}</code>
        </p>
        <div className="row">
          <button onClick={() => api.revealProject()}>Show in folder</button>
          <button
            onClick={async () => {
              setError(null)
              setMessage(null)
              try {
                const dest = await api.backupProject()
                if (dest) setMessage(`Backup saved to ${dest}`)
              } catch (e) {
                setError(errorMessage(e))
              }
            }}
          >
            Back up project…
          </button>
        </div>
        {message && <div className="alert alert-ok">{message}</div>}
        <ErrorBox message={error} />
      </section>
    </div>
  )
}

function Stat({ label, value, kind }: { label: string; value: number; kind?: string }) {
  return (
    <div className={`stat ${kind ? `stat-${kind}` : ''}`}>
      <div className="stat-value">{value.toLocaleString()}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}
