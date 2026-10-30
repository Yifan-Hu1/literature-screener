// "Keep up to date" controls for one import-all search.
import { useState } from 'react'
import type { SearchLogEntry } from '../../../shared/types'
import { api, errorMessage, formatDate } from '../api'

interface Props {
  search: SearchLogEntry
  onChanged: (searches: SearchLogEntry[]) => void
  onRan: () => void
}

const PRESETS = [7, 14, 30, 90]

export function ScheduleControl({ search, onChanged, onRan }: Props) {
  const schedule = search.schedule
  const [editing, setEditing] = useState(false)
  const [days, setDays] = useState(String(schedule?.intervalDays ?? 14))
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const save = async (intervalDays: number | null) => {
    setError(null)
    try {
      onChanged(await api.setSearchSchedule(search.id, intervalDays))
      setEditing(false)
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  const runNow = async () => {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const summary = await api.runSearchUpdateNow(search.id)
      const run = summary.runs[0]
      setResult(
        run
          ? `${run.newRecords} new paper${run.newRecords === 1 ? '' : 's'}.` +
              (summary.newAlerts ? ` ${summary.newAlerts} new retraction/concern notice(s) on included or unsure papers.` : '')
          : 'Nothing to run.'
      )
      onRan()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const n = parseInt(days, 10)
  const valid = Number.isInteger(n) && n >= 1 && n <= 365

  return (
    <div className="schedule">
      {editing ? (
        <div className="row">
          <span className="small">Check for new papers every</span>
          <input className="days" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
          <span className="small">days</span>
          {PRESETS.map((p) => (
            <button key={p} className="small" onClick={() => setDays(String(p))}>
              {p === 7 ? '1 week' : p === 14 ? '2 weeks' : p === 30 ? '1 month' : '3 months'}
            </button>
          ))}
          <button className="small primary" disabled={!valid} onClick={() => save(n)}>
            Save
          </button>
          <button className="small" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      ) : schedule ? (
        <div className="row">
          <span className="schedule-on small">
            ↻ Kept up to date every {schedule.intervalDays} day{schedule.intervalDays === 1 ? '' : 's'} · next check{' '}
            {Date.parse(schedule.nextDueAt) <= Date.now() ? 'when the app next checks' : `after ${formatDate(schedule.nextDueAt)}`}
          </span>
          <button className="small" disabled={busy} onClick={runNow}>
            {busy ? 'Checking PubMed…' : 'Check now'}
          </button>
          <button className="small" onClick={() => setEditing(true)}>
            Change
          </button>
          <button className="small" onClick={() => save(null)}>
            Stop
          </button>
        </div>
      ) : (
        <button className="small" onClick={() => setEditing(true)}>
          ↻ Keep up to date…
        </button>
      )}
      {schedule?.lastRunAt && !editing && (
        <div className="small muted">
          Last check {formatDate(schedule.lastRunAt)}: {schedule.lastMessage}
        </div>
      )}
      {result && <div className="small schedule-result">{result}</div>}
      {error && <div className="alert alert-error small">{error}</div>}
    </div>
  )
}
