import { useCallback, useEffect, useState } from 'react'
import type {
  Collection,
  Decision,
  DecisionFilter,
  ExclusionReason,
  OriginFilter,
  RecordDetail
} from '../../../shared/types'
import { api, errorMessage, formatDate } from '../api'
import { DECISION_LABEL, DecisionBadge, ErrorBox } from '../components/common'
import { RecordView } from '../components/RecordView'

interface Props {
  initialOrigin: OriginFilter
  focusRecordId: number | null
  reviewerName: string
  onDecided: () => void
}

const KEYS: Record<string, Decision> = { i: 'include', e: 'exclude', u: 'unsure' }

export function ScreeningScreen({ initialOrigin, focusRecordId, reviewerName, onDecided }: Props) {
  const [decisionFilter, setDecisionFilter] = useState<DecisionFilter>(focusRecordId ? 'all' : 'undecided')
  const [origin, setOrigin] = useState<OriginFilter>(initialOrigin)
  const [queue, setQueue] = useState<number[] | null>(null)
  const [index, setIndex] = useState(0)
  const [record, setRecord] = useState<RecordDetail | null>(null)
  const [reasons, setReasons] = useState<ExclusionReason[]>([])
  const [collections, setCollections] = useState<Collection[]>([])
  const [comment, setComment] = useState('')
  const [choosingReason, setChoosingReason] = useState(false)
  const [note, setNote] = useState('')
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [deciding, setDeciding] = useState(false)

  const activeReasons = reasons.filter((r) => !r.retired)

  useEffect(() => {
    api.listExclusionReasons().then(setReasons, (e) => setError(errorMessage(e)))
    api.listCollections().then(setCollections, (e) => setError(errorMessage(e)))
  }, [])

  // The queue is loaded once per filter change, so records stay in place after
  // a decision and you can step back to them.
  useEffect(() => {
    api
      .screeningQueue({ decision: decisionFilter, origin, text: '', systems: [], systemsMode: 'any', collectionId: null })
      .then(
        (ids) => {
          setQueue(ids)
          const focus = focusRecordId ? ids.indexOf(focusRecordId) : -1
          setIndex(focus >= 0 ? focus : 0)
        },
        (e) => setError(errorMessage(e))
      )
  }, [decisionFilter, origin, focusRecordId])

  const currentId = queue && queue.length > 0 ? queue[Math.min(index, queue.length - 1)] : null

  useEffect(() => {
    setChoosingReason(false)
    setComment('')
    setNote('')
    if (currentId == null) {
      setRecord(null)
      return
    }
    api.getRecord(currentId).then(setRecord, (e) => setError(errorMessage(e)))
  }, [currentId])

  // Only the record actually on screen can be decided; while the next one is
  // still loading (e.g. after fast key presses) decisions are ignored.
  const ready = record != null && record.id === currentId

  const go = useCallback(
    (delta: number) => {
      if (!queue) return
      setSaved(null)
      setIndex((i) => Math.max(0, Math.min(queue.length - 1, i + delta)))
    },
    [queue]
  )

  const decide = useCallback(
    async (d: Decision, reasonId: number | null = null) => {
      if (!ready || !record || !queue || deciding) return
      setDeciding(true)
      setChoosingReason(false)
      setError(null)
      try {
        await api.decide(record.id, { decision: d, reasonId, comment })
        const reason = reasonId != null ? reasons.find((r) => r.id === reasonId)?.label : null
        setSaved(`Saved “${DECISION_LABEL[d]}”${reason ? ` (${reason})` : ''} for PMID ${record.pmid}`)
        onDecided()
        const pos = queue.indexOf(record.id)
        if (pos < queue.length - 1) setIndex(pos + 1)
        else {
          setComment('')
          setRecord(await api.getRecord(record.id))
        }
      } catch (e) {
        setError(errorMessage(e))
      } finally {
        setDeciding(false)
      }
    },
    [ready, record, queue, deciding, comment, reasons, onDecided]
  )

  /** Exclusions first ask for a reason when the project has any. */
  const startDecision = useCallback(
    (d: Decision) => {
      if (d === 'exclude' && activeReasons.length > 0) setChoosingReason(true)
      else void decide(d)
    },
    [activeReasons.length, decide]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || e.metaKey || e.ctrlKey || e.altKey) return
      if (choosingReason) {
        const n = parseInt(e.key, 10)
        if (n >= 1 && n <= activeReasons.length) {
          e.preventDefault()
          void decide('exclude', activeReasons[n - 1].id)
        } else if (e.key === '0') {
          e.preventDefault()
          void decide('exclude')
        } else if (e.key === 'Escape') setChoosingReason(false)
        return
      }
      const d = KEYS[e.key.toLowerCase()]
      if (d) {
        e.preventDefault()
        startDecision(d)
      } else if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [choosingReason, activeReasons, decide, startDecision, go])

  const update = async (action: () => Promise<RecordDetail>) => {
    setError(null)
    try {
      setRecord(await action())
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <div className="page screening">
      <div className="screening-toolbar">
        <h1>Title &amp; abstract screening</h1>
        <div className="row">
          <select value={decisionFilter} onChange={(e) => setDecisionFilter(e.target.value as DecisionFilter)}>
            <option value="undecided">Not screened yet</option>
            <option value="unsure">Marked unsure</option>
            <option value="include">Included</option>
            <option value="exclude">Excluded</option>
            <option value="all">All records</option>
          </select>
          <select value={origin} onChange={(e) => setOrigin(e.target.value as OriginFilter)}>
            <option value="all">All sources</option>
            <option value="structured">From imported searches</option>
            <option value="hand_picked">Hand-picked</option>
            <option value="update">New from automatic updates</option>
          </select>
        </div>
      </div>
      <ErrorBox message={error} />

      {queue && queue.length === 0 && (
        <div className="card">
          <p>No records in this list.</p>
          <p className="muted">
            {decisionFilter === 'undecided'
              ? 'Everything here has been screened, or nothing has been imported yet. Use “Search PubMed” to add records.'
              : 'Try another filter.'}
          </p>
        </div>
      )}

      {queue && queue.length > 0 && record && (
        <div className="screening-layout">
          <div className={`card ${ready ? '' : 'loading'}`}>
            <RecordView
              record={record}
              onSetTag={(system, present) => update(() => api.setManualTag(record.id, system, present))}
            />
          </div>

          <aside className="decision-panel card">
            <div className="small muted">
              Record {index + 1} of {queue.length} in this list
            </div>
            <div className="nav-buttons">
              <button onClick={() => go(-1)} disabled={index === 0}>
                ← Previous
              </button>
              <button onClick={() => go(1)} disabled={index >= queue.length - 1}>
                Next →
              </button>
            </div>

            <div className="current-decision">
              Current decision: <DecisionBadge decision={record.current} />
            </div>

            {choosingReason ? (
              <div className="reason-picker">
                <div className="reason-title">Why exclude?</div>
                {activeReasons.map((r, i) => (
                  <button key={r.id} className="reason" disabled={!ready || deciding} onClick={() => decide('exclude', r.id)}>
                    <kbd>{i + 1}</kbd> {r.label}
                  </button>
                ))}
                <button className="reason" disabled={!ready || deciding} onClick={() => decide('exclude')}>
                  <kbd>0</kbd> Exclude without a reason
                </button>
                <button className="small" onClick={() => setChoosingReason(false)}>
                  Cancel (Esc)
                </button>
              </div>
            ) : (
              <div className="decision-buttons">
                {(['include', 'unsure', 'exclude'] as Decision[]).map((d) => (
                  <button
                    key={d}
                    className={`decision decision-${d} ${record.current === d ? 'selected' : ''}`}
                    disabled={!ready || deciding}
                    onClick={() => startDecision(d)}
                  >
                    {DECISION_LABEL[d]} <kbd>{d[0].toUpperCase()}</kbd>
                  </button>
                ))}
              </div>
            )}
            <textarea
              className="comment"
              rows={2}
              placeholder="Comment on this decision (optional)"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            <p className="hint">
              Keys: I / U / E to decide (after E, a number picks the reason), ← → to move. If in doubt, choose Unsure;
              nothing is excluded unless you decide so.
            </p>
            {saved && <div className="alert alert-ok small">{saved}</div>}
            <p className="small muted">Deciding as {reviewerName}.</p>

            <h4>Decision history</h4>
            {record.history.length === 0 ? (
              <p className="small muted">No decisions yet.</p>
            ) : (
              <ul className="history">
                {record.history.map((h) => (
                  <li key={h.id}>
                    <DecisionBadge decision={h.decision} />
                    <span className="small">
                      {formatDate(h.decidedAt)} · {h.reviewerName}
                      {h.criteriaVersion != null && ` · criteria v${h.criteriaVersion}`}
                    </span>
                    {h.reasonText && <span className="small history-detail">Reason: {h.reasonText}</span>}
                    {h.comment && <span className="small history-detail">“{h.comment}”</span>}
                  </li>
                ))}
              </ul>
            )}

            <h4>Notes</h4>
            {record.notes.map((n) => (
              <div key={n.id} className="note">
                <div className="small">{n.text}</div>
                <div className="small muted">
                  {n.reviewerName} · {formatDate(n.createdAt)}
                </div>
              </div>
            ))}
            <textarea rows={2} placeholder="Add a note about this paper…" value={note} onChange={(e) => setNote(e.target.value)} />
            <button
              className="small"
              disabled={!note.trim()}
              onClick={() =>
                update(async () => {
                  const r = await api.addNote(record.id, note)
                  setNote('')
                  return r
                })
              }
            >
              Save note
            </button>

            <h4>Collections</h4>
            {collections.length === 0 ? (
              <p className="small muted">Create collections in the Library to group papers.</p>
            ) : (
              <div className="collection-checks">
                {collections.map((c) => (
                  <label key={c.id} className="inline small">
                    <input
                      type="checkbox"
                      checked={record.collectionIds.includes(c.id)}
                      onChange={(e) =>
                        update(async () => {
                          setCollections(await api.setInCollection(c.id, [record.id], e.target.checked))
                          return api.getRecord(record.id)
                        })
                      }
                    />
                    {c.name}
                  </label>
                ))}
              </div>
            )}

            <h4>Found by</h4>
            <ul className="history">
              {record.origins.map((o) => (
                <li key={o.searchId} className="small">
                  Search #{o.searchId} ({o.how === 'hand_picked' ? 'hand-picked' : 'imported'}) · {formatDate(o.addedAt)}
                </li>
              ))}
            </ul>
          </aside>
        </div>
      )}
    </div>
  )
}
