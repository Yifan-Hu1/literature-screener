import { useState } from 'react'
import type { AppSettings } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { ErrorBox } from '../components/common'
import { DOWNLOAD_PAGE_URL, FEEDBACK_URL } from '../../../shared/links'

export function SettingsScreen({ settings, onSaved }: { settings: AppSettings; onSaved: (s: AppSettings) => void }) {
  const [name, setName] = useState(settings.reviewerName)
  const [email, setEmail] = useState(settings.ncbiEmail)
  const [apiKey, setApiKey] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const save = async (update: Parameters<typeof api.updateSettings>[0], done: string) => {
    setError(null)
    setMessage(null)
    try {
      onSaved(await api.updateSettings(update))
      setMessage(done)
      setApiKey('')
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <div className="page">
      <h1>Settings</h1>
      <p className="muted">These settings belong to this computer and are never stored in project folders.</p>

      <section className="card narrow">
        <h3>Reviewer</h3>
        <label>
          Your name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <p className="hint">Recorded with each screening decision and search.</p>
        <button className="primary" disabled={!name.trim()} onClick={() => save({ reviewerName: name }, 'Reviewer name saved.')}>
          Save name
        </button>
      </section>

      <section className="card narrow">
        <h3>PubMed (NCBI) access</h3>
        <label>
          Email address <span className="muted">(optional)</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <p className="hint">NCBI asks tools to send a contact email so they can reach you if there is a problem.</p>
        <button onClick={() => save({ ncbiEmail: email }, 'Email saved.')}>Save email</button>

        <label>
          NCBI API key <span className="muted">(optional)</span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={settings.hasNcbiApiKey ? 'A key is saved. Enter a new one to replace it.' : 'Paste key here'}
          />
        </label>
        <p className="hint">
          A free key from your NCBI account makes large imports about three times faster. It is encrypted with your
          system&apos;s secure storage.
        </p>
        <div className="row">
          <button disabled={!apiKey.trim()} onClick={() => save({ ncbiApiKey: apiKey }, 'API key saved securely.')}>
            Save key
          </button>
          {settings.hasNcbiApiKey && <button onClick={() => save({ ncbiApiKey: null }, 'API key removed.')}>Remove key</button>}
        </div>
      </section>

      <section className="card narrow">
        <h3>About</h3>
        <p>
          Literature Screener <strong>{settings.appVersion}</strong>
        </p>
        <p className="hint">
          New versions are on the{' '}
          <a
            href={DOWNLOAD_PAGE_URL}
            onClick={(e) => {
              e.preventDefault()
              void api.openExternal(DOWNLOAD_PAGE_URL)
            }}
          >
            download page
          </a>
          .
        </p>
        <p className="hint">
          Found a problem or have an idea? Click “Copy details for a bug report”, then “Send feedback” and paste the
          details into the form. The details include the app version, your operating system and recent error messages;
          nothing is sent automatically.
        </p>
        <div className="row">
          <button
            onClick={async () => {
              await api.copyDiagnostics()
              setError(null)
              setMessage('Details copied. Now click “Send feedback” and paste them into the form.')
            }}
          >
            Copy details for a bug report
          </button>
          <button className="primary" onClick={() => api.openExternal(FEEDBACK_URL)}>
            Send feedback
          </button>
        </div>
      </section>

      {message && <div className="alert alert-ok narrow">{message}</div>}
      <ErrorBox message={error} />
    </div>
  )
}
