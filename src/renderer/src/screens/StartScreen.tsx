import { useState, type FormEvent } from 'react'
import type { AppSettings, ProjectOverview } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { ErrorBox } from '../components/common'
import logo from '../../../../build/icon.svg'

interface Props {
  settings: AppSettings
  onSettingsChanged: (s: AppSettings) => void
  onOpened: (p: ProjectOverview) => void
}

export function StartScreen({ settings, onSettingsChanged, onOpened }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const open = async (path?: string) => {
    setError(null)
    try {
      const p = await api.openProject(path)
      if (p) onOpened(p)
    } catch (e) {
      setError(errorMessage(e))
      onSettingsChanged(await api.getSettings())
    }
  }

  return (
    <div className="start">
      <header className="start-header">
        <img src={logo} alt="" className="start-logo" />
        <div>
          <h1>Literature Screener</h1>
          <p className="muted">Search PubMed, collect publications and screen them in a local project.</p>
        </div>
      </header>

      {!settings.reviewerName ? (
        <ReviewerSetup onSaved={onSettingsChanged} />
      ) : creating ? (
        <NewProjectForm onCancel={() => setCreating(false)} onCreated={onOpened} />
      ) : (
        <div className="start-grid">
          <section className="card">
            <h3>Start</h3>
            <div className="button-column">
              <button className="primary" onClick={() => setCreating(true)}>
                New project…
              </button>
              <button onClick={() => open()}>Open project folder…</button>
            </div>
            <p className="hint">Screening as <strong>{settings.reviewerName}</strong>. You can change this in Settings.</p>
          </section>
          <section className="card">
            <h3>Recent projects</h3>
            {settings.recentProjects.length === 0 ? (
              <p className="muted">No recent projects yet.</p>
            ) : (
              <ul className="recent-list">
                {settings.recentProjects.map((p) => (
                  <li key={p}>
                    <button className="link-button" onClick={() => open(p)} title={p}>
                      <strong>{p.split(/[\\/]/).pop()}</strong>
                      <span className="small muted">{p}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
      <ErrorBox message={error} />
    </div>
  )
}

function ReviewerSetup({ onSaved }: { onSaved: (s: AppSettings) => void }) {
  const [name, setName] = useState('')
  return (
    <section className="card narrow">
      <h3>Welcome</h3>
      <p>
        Enter your name. It is saved with every screening decision you make, so that decisions remain
        traceable.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          if (name.trim()) onSaved(await api.updateSettings({ reviewerName: name }))
        }}
      >
        <label>
          Reviewer name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jane Smith" autoFocus />
        </label>
        <button className="primary" type="submit" disabled={!name.trim()}>
          Continue
        </button>
      </form>
    </section>
  )
}

function NewProjectForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (p: ProjectOverview) => void }) {
  const [name, setName] = useState('')
  const [question, setQuestion] = useState('')
  const [inclusion, setInclusion] = useState('')
  const [exclusion, setExclusion] = useState('')
  const [parentDir, setParentDir] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!parentDir) return
    setBusy(true)
    setError(null)
    try {
      onCreated(
        await api.createProject({
          parentDir,
          name,
          researchQuestion: question,
          inclusionCriteria: inclusion,
          exclusionCriteria: exclusion
        })
      )
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <form className="card narrow" onSubmit={submit}>
      <h3>New project</h3>
      <label>
        Project name
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Microglia in ALS models" />
      </label>
      <label>
        Research question
        <textarea rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} />
      </label>
      <label>
        Inclusion criteria <span className="muted">(one per line)</span>
        <textarea rows={4} value={inclusion} onChange={(e) => setInclusion(e.target.value)} />
      </label>
      <label>
        Exclusion criteria <span className="muted">(one per line)</span>
        <textarea rows={4} value={exclusion} onChange={(e) => setExclusion(e.target.value)} />
      </label>
      <div className="field">
        <div>Location</div>
        <div className="row">
          <button
            type="button"
            onClick={async () => setParentDir(await api.chooseFolder('Choose where to create the project folder'))}
          >
            Choose folder…
          </button>
          <span className={parentDir ? '' : 'muted'}>{parentDir ?? 'No folder chosen'}</span>
        </div>
        <p className="hint">
          A new folder named after the project is created here. Use an ordinary local folder rather than one
          synced by Dropbox, OneDrive, iCloud or Google Drive.
        </p>
      </div>
      <ErrorBox message={error} />
      <div className="row">
        <button className="primary" type="submit" disabled={!name.trim() || !parentDir || busy}>
          Create project
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
