import { useCallback, useEffect, useState } from 'react'
import type { Collection, DecisionFilter, ExportFormat, OriginFilter, RecordFilter, RecordPage } from '../../../shared/types'
import { systemLabel } from '../../../shared/systems'
import { api, errorMessage } from '../api'
import { DecisionBadge, ErrorBox } from '../components/common'
import { SystemPicker } from '../components/SystemPicker'

const PAGE_SIZE = 100

const EMPTY_FILTER: RecordFilter = {
  decision: 'all',
  origin: 'all',
  text: '',
  systems: [],
  systemsMode: 'any',
  collectionId: null
}

// Remembered while the project is open, so returning from screening keeps the view.
let lastFilter: RecordFilter = EMPTY_FILTER
export function resetLibraryScreen() {
  lastFilter = EMPTY_FILTER
}

export function LibraryScreen({ onOpenRecord }: { onOpenRecord: (id: number) => void }) {
  const [filter, setFilterState] = useState<RecordFilter>(lastFilter)
  const [offset, setOffset] = useState(0)
  const [page, setPage] = useState<RecordPage | null>(null)
  const [collections, setCollections] = useState<Collection[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [targetCollection, setTargetCollection] = useState<number | ''>('')
  const [newCollection, setNewCollection] = useState('')
  const [showSystems, setShowSystems] = useState(filter.systems.length > 0)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const setFilter = (f: Partial<RecordFilter>) => {
    const next = { ...filter, ...f }
    lastFilter = next
    setFilterState(next)
    setOffset(0)
    setSelected(new Set())
  }

  const load = useCallback(() => {
    api.listRecords({ ...filter, offset, limit: PAGE_SIZE }).then(setPage, (e) => setError(errorMessage(e)))
  }, [filter, offset])

  useEffect(() => {
    const t = setTimeout(load, 150)
    return () => clearTimeout(t)
  }, [load])

  useEffect(() => {
    api.listCollections().then(setCollections, (e) => setError(errorMessage(e)))
  }, [])

  const run = async (action: () => Promise<void>) => {
    setError(null)
    setMessage(null)
    try {
      await action()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  const exportAs = (format: ExportFormat) =>
    run(async () => {
      const path = await api.exportRecords(filter, format)
      if (path) setMessage(`Exported ${page?.total ?? ''} records to ${path}`)
    })

  const moveSelected = (inCollection: boolean) =>
    run(async () => {
      if (targetCollection === '') return
      setCollections(await api.setInCollection(targetCollection, [...selected], inCollection))
      const name = collections.find((c) => c.id === targetCollection)?.name
      setMessage(`${inCollection ? 'Added' : 'Removed'} ${selected.size} records ${inCollection ? 'to' : 'from'} “${name}”.`)
      setSelected(new Set())
      load()
    })

  const pageIds = page?.items.map((r) => r.id) ?? []
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id))
  const activeCollection = collections.find((c) => c.id === filter.collectionId)

  return (
    <div className="page library">
      <h1>Library</h1>
      <div className="library-layout">
        <aside className="card collections-panel">
          <h3>Collections</h3>
          <ul className="collection-list">
            <li>
              <button className={`collection-item ${filter.collectionId == null ? 'active' : ''}`} onClick={() => setFilter({ collectionId: null })}>
                <span>All records</span>
              </button>
            </li>
            {collections.map((c) => (
              <li key={c.id}>
                <button className={`collection-item ${filter.collectionId === c.id ? 'active' : ''}`} onClick={() => setFilter({ collectionId: c.id })}>
                  <span>{c.name}</span>
                  <span className="muted small">{c.count}</span>
                </button>
              </li>
            ))}
          </ul>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault()
              void run(async () => {
                setCollections(await api.createCollection(newCollection))
                setNewCollection('')
              })
            }}
          >
            <input className="grow" placeholder="New collection…" value={newCollection} onChange={(e) => setNewCollection(e.target.value)} />
            <button type="submit" className="small" disabled={!newCollection.trim()}>
              Add
            </button>
          </form>
          {activeCollection && (
            <button
              className="small danger-link"
              onClick={() =>
                run(async () => {
                  if (!window.confirm(`Delete the collection “${activeCollection.name}”? The records stay in the project.`)) return
                  setCollections(await api.deleteCollection(activeCollection.id))
                  setFilter({ collectionId: null })
                })
              }
            >
              Delete this collection
            </button>
          )}
          <p className="hint">Collections group papers, e.g. by theme. A paper can be in several collections.</p>
        </aside>

        <div className="library-main">
          <div className="card">
            <div className="row filters">
              <input
                className="grow"
                placeholder="Search title, abstract, PMID or DOI…"
                value={filter.text}
                onChange={(e) => setFilter({ text: e.target.value })}
              />
              <select value={filter.decision} onChange={(e) => setFilter({ decision: e.target.value as DecisionFilter })}>
                <option value="all">All decisions</option>
                <option value="undecided">Not screened</option>
                <option value="include">Include</option>
                <option value="unsure">Unsure</option>
                <option value="exclude">Exclude</option>
              </select>
              <select value={filter.origin} onChange={(e) => setFilter({ origin: e.target.value as OriginFilter })}>
                <option value="all">All sources</option>
                <option value="structured">From imported searches</option>
                <option value="hand_picked">Hand-picked</option>
                <option value="update">New from automatic updates</option>
              </select>
              <button type="button" onClick={() => setShowSystems(!showSystems)}>
                {showSystems ? 'Hide' : 'Filter by'} organism / system{filter.systems.length ? ` (${filter.systems.length})` : ''}
              </button>
            </div>
            {showSystems && (
              <div className="library-systems">
                <SystemPicker
                  selected={filter.systems}
                  mode={filter.systemsMode}
                  onChange={(systems, systemsMode) => setFilter({ systems, systemsMode })}
                />
                <p className="hint">
                  Uses the systems shown on each paper, including your own corrections made while screening.
                </p>
              </div>
            )}
          </div>

          <ErrorBox message={error} />
          {message && <div className="alert alert-ok">{message}</div>}

          {page && (
            <section className="card">
              <div className="row library-actions">
                <span className="small muted grow">
                  {page.total === 0
                    ? 'No records match.'
                    : `${page.total.toLocaleString()} records${activeCollection ? ` in “${activeCollection.name}”` : ''}. Click a title to screen it.`}
                </span>
                <span className="small muted">Export these:</span>
                <button className="small" disabled={page.total === 0} onClick={() => exportAs('csv')}>
                  CSV (Excel)
                </button>
                <button className="small" disabled={page.total === 0} onClick={() => exportAs('ris')}>
                  RIS (Zotero, EndNote)
                </button>
              </div>

              {selected.size > 0 && (
                <div className="row selection-bar">
                  <strong>{selected.size} selected</strong>
                  <select value={targetCollection} onChange={(e) => setTargetCollection(e.target.value ? Number(e.target.value) : '')}>
                    <option value="">Choose a collection…</option>
                    {collections.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <button className="small" disabled={targetCollection === ''} onClick={() => moveSelected(true)}>
                    Add to collection
                  </button>
                  <button className="small" disabled={targetCollection === ''} onClick={() => moveSelected(false)}>
                    Remove from collection
                  </button>
                  <button className="small" onClick={() => setSelected(new Set())}>
                    Clear selection
                  </button>
                  {collections.length === 0 && <span className="small muted">Create a collection on the left first.</span>}
                </div>
              )}

              {page.items.length > 0 && (
                <table className="table">
                  <thead>
                    <tr>
                      <th className="check">
                        <input
                          type="checkbox"
                          aria-label="Select all on this page"
                          checked={allOnPageSelected}
                          onChange={() => {
                            const next = new Set(selected)
                            pageIds.forEach((id) => (allOnPageSelected ? next.delete(id) : next.add(id)))
                            setSelected(next)
                          }}
                        />
                      </th>
                      <th>Title</th>
                      <th>Year</th>
                      <th>Systems</th>
                      <th>Source</th>
                      <th>Decision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {page.items.map((r) => (
                      <tr key={r.id} className={selected.has(r.id) ? 'selected' : ''}>
                        <td className="check">
                          <input
                            type="checkbox"
                            aria-label={`Select ${r.title}`}
                            checked={selected.has(r.id)}
                            onChange={() => {
                              const next = new Set(selected)
                              if (next.has(r.id)) next.delete(r.id)
                              else next.add(r.id)
                              setSelected(next)
                            }}
                          />
                        </td>
                        <td>
                          <button className="title-link" onClick={() => onOpenRecord(r.id)}>
                            {r.title}
                          </button>
                          <div className="small muted">{[r.journal, r.pmid && `PMID ${r.pmid}`].filter(Boolean).join(' · ')}</div>
                        </td>
                        <td>{r.pubYear ?? '—'}</td>
                        <td className="small">{r.systems.map(systemLabel).join(', ') || '—'}</td>
                        <td className="small">{[r.structured && 'Imported', r.handPicked && 'Hand-picked'].filter(Boolean).join(', ')}</td>
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
                  <span className="small">
                    {offset + 1}–{Math.min(offset + PAGE_SIZE, page.total)} of {page.total.toLocaleString()}
                  </span>
                  <button disabled={offset + PAGE_SIZE >= page.total} onClick={() => setOffset(offset + PAGE_SIZE)}>
                    Next →
                  </button>
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
