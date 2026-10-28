import { useEffect, useState } from 'react'
import type { DecisionFilter, OriginFilter, RecordPage } from '../../../shared/types'
import { systemLabel } from '../../../shared/systems'
import { api, errorMessage } from '../api'
import { DecisionBadge, ErrorBox } from '../components/common'

const PAGE_SIZE = 100

export function LibraryScreen({ onOpenRecord }: { onOpenRecord: (id: number) => void }) {
  const [text, setText] = useState('')
  const [decision, setDecision] = useState<DecisionFilter>('all')
  const [origin, setOrigin] = useState<OriginFilter>('all')
  const [offset, setOffset] = useState(0)
  const [page, setPage] = useState<RecordPage | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => {
      api.listRecords({ decision, origin, text, offset, limit: PAGE_SIZE }).then(setPage, (e) => setError(errorMessage(e)))
    }, 150)
    return () => clearTimeout(t)
  }, [text, decision, origin, offset])

  return (
    <div className="page">
      <h1>Library</h1>
      <div className="card row filters">
        <input
          className="grow"
          placeholder="Search title, abstract or PMID…"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setOffset(0)
          }}
        />
        <select
          value={decision}
          onChange={(e) => {
            setDecision(e.target.value as DecisionFilter)
            setOffset(0)
          }}
        >
          <option value="all">All decisions</option>
          <option value="undecided">Not screened</option>
          <option value="include">Include</option>
          <option value="unsure">Unsure</option>
          <option value="exclude">Exclude</option>
        </select>
        <select
          value={origin}
          onChange={(e) => {
            setOrigin(e.target.value as OriginFilter)
            setOffset(0)
          }}
        >
          <option value="all">All sources</option>
          <option value="structured">From imported searches</option>
          <option value="hand_picked">Hand-picked</option>
        </select>
      </div>
      <ErrorBox message={error} />

      {page && (
        <section className="card">
          <p className="small muted">
            {page.total === 0
              ? 'No records match.'
              : `Showing ${page.offset + 1}–${page.offset + page.items.length} of ${page.total.toLocaleString()} records. Click a record to screen it.`}
          </p>
          {page.items.length > 0 && (
            <table className="table clickable">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Year</th>
                  <th>Systems</th>
                  <th>Source</th>
                  <th>Decision</th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((r) => (
                  <tr key={r.id} onClick={() => onOpenRecord(r.id)}>
                    <td>
                      <div>{r.title}</div>
                      <div className="small muted">
                        {[r.journal, r.pmid && `PMID ${r.pmid}`].filter(Boolean).join(' · ')}
                      </div>
                    </td>
                    <td>{r.pubYear ?? '—'}</td>
                    <td className="small">{r.systems.map(systemLabel).join(', ') || '—'}</td>
                    <td className="small">
                      {[r.structured && 'Imported', r.handPicked && 'Hand-picked'].filter(Boolean).join(', ')}
                    </td>
                    <td>
                      <DecisionBadge decision={r.decision} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {page.total > PAGE_SIZE && (
            <div className="pager">
              <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                ← Previous
              </button>
              <button disabled={offset + PAGE_SIZE >= page.total} onClick={() => setOffset(offset + PAGE_SIZE)}>
                Next →
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
