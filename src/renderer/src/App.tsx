import { useEffect, useRef, useState } from 'react'
import type { AppSettings, OriginFilter, ProjectOverview, ProjectUpdateSummary } from '../../shared/types'
import { api, errorMessage } from './api'
import logo from '../../../build/icon.svg'
import { StartScreen } from './screens/StartScreen'
import { OverviewScreen } from './screens/OverviewScreen'
import { SearchScreen, resetSearchScreen } from './screens/SearchScreen'
import { LibraryScreen, resetLibraryScreen } from './screens/LibraryScreen'
import { ScreeningScreen } from './screens/ScreeningScreen'
import { SettingsScreen } from './screens/SettingsScreen'

type View = 'overview' | 'search' | 'library' | 'screening' | 'settings'

export function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [project, setProject] = useState<ProjectOverview | null>(null)
  const [view, setView] = useState<View>('overview')
  const [focusRecordId, setFocusRecordId] = useState<number | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [updates, setUpdates] = useState<ProjectUpdateSummary[]>([])
  const [screeningOrigin, setScreeningOrigin] = useState<OriginFilter>('all')
  const [screeningKey, setScreeningKey] = useState(0)
  const projectPath = useRef<string | null>(null)
  projectPath.current = project?.path ?? null

  useEffect(() => {
    api.getSettings().then(setSettings, (e) => setFatal(errorMessage(e)))
  }, [])

  useEffect(
    () =>
      api.onUpdatesFinished((news) => {
        setUpdates((prev) => [...news, ...prev.filter((p) => !news.some((n) => n.projectPath === p.projectPath))])
        if (news.some((n) => n.projectPath === projectPath.current)) api.getOverview().then(setProject, () => {})
      }),
    []
  )

  const refresh = async () => setProject(await api.getOverview())

  const showUpdate = async (u: ProjectUpdateSummary) => {
    setError(null)
    try {
      if (u.projectPath !== projectPath.current) {
        resetSearchScreen()
        resetLibraryScreen()
        const p = await api.openProject(u.projectPath)
        if (!p) return
        setProject(p)
      }
      setUpdates((prev) => prev.filter((p) => p.projectPath !== u.projectPath))
      setFocusRecordId(null)
      setScreeningOrigin(u.runs.some((r) => r.newRecords > 0) ? 'update' : 'all')
      setScreeningKey((k) => k + 1)
      setView('screening')
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  const banner = (
    <UpdateBanner
      updates={updates}
      onShow={showUpdate}
      onDismiss={(path) => setUpdates((prev) => prev.filter((p) => p.projectPath !== path))}
    />
  )

  if (fatal) return <div className="alert alert-error">{fatal}</div>
  if (!settings) return null

  if (!project) {
    return (
      <>
        {banner}
        <StartScreen
          settings={settings}
          onSettingsChanged={setSettings}
          onOpened={(p) => {
            setProject(p)
            setView('overview')
          }}
        />
      </>
    )
  }

  const decided = project.counts.include + project.counts.exclude + project.counts.unsure
  const nav: [View, string, string?][] = [
    ['overview', 'Overview'],
    ['search', 'Search PubMed'],
    ['library', 'Library', String(project.recordCount)],
    ['screening', 'Screening', `${decided}/${project.recordCount}`],
    ['settings', 'Settings']
  ]

  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="sidebar-brand">
          <img src={logo} alt="" />
          <span>Literature Screener</span>
        </div>
        <div className="sidebar-project" title={project.path}>
          <div className="sidebar-label">Project</div>
          <div className="sidebar-name">{project.name}</div>
        </div>
        {nav.map(([id, label, count]) => (
          <button
            key={id}
            className={`nav-item ${view === id ? 'active' : ''}`}
            onClick={() => {
              if (id === 'screening') {
                setFocusRecordId(null)
                setScreeningOrigin('all')
                setScreeningKey((k) => k + 1)
              }
              setView(id)
            }}
          >
            <span>{label}</span>
            {count && <span className="nav-count">{count}</span>}
          </button>
        ))}
        <div className="sidebar-spacer" />
        <button
          className="nav-item"
          onClick={async () => {
            await api.closeProject()
            resetSearchScreen()
            resetLibraryScreen()
            setProject(null)
            setSettings(await api.getSettings())
          }}
        >
          Close project
        </button>
      </nav>
      <main className="content">
        {banner}
        {error && <div className="alert alert-error update-banner">{error}</div>}
        {view === 'overview' && <OverviewScreen project={project} onChanged={setProject} />}
        {view === 'search' && <SearchScreen onImported={refresh} />}
        {view === 'library' && (
          <LibraryScreen
            onOpenRecord={(id) => {
              setFocusRecordId(id)
              setScreeningOrigin('all')
              setScreeningKey((k) => k + 1)
              setView('screening')
            }}
          />
        )}
        {view === 'screening' && (
          <ScreeningScreen
            key={screeningKey}
            initialOrigin={screeningOrigin}
            focusRecordId={focusRecordId}
            reviewerName={settings.reviewerName}
            onDecided={refresh}
          />
        )}
        {view === 'settings' && <SettingsScreen settings={settings} onSaved={setSettings} />}
      </main>
    </div>
  )
}

function UpdateBanner({
  updates,
  onShow,
  onDismiss
}: {
  updates: ProjectUpdateSummary[]
  onShow: (u: ProjectUpdateSummary) => void
  onDismiss: (path: string) => void
}) {
  if (updates.length === 0) return null
  return (
    <div className="update-banner">
      {updates.map((u) => {
        const papers = u.runs.reduce((n, r) => n + r.newRecords, 0)
        return (
          <div key={u.projectPath} className="alert alert-ok row">
            <span>
              <strong>{u.projectName}</strong>: automatic update found{' '}
              {[
                papers > 0 && `${papers} new paper${papers === 1 ? '' : 's'}`,
                u.newAlerts > 0 && `${u.newAlerts} new retraction or concern notice${u.newAlerts === 1 ? '' : 's'} on papers you kept`
              ]
                .filter(Boolean)
                .join(' and ')}
              .
            </span>
            <span className="row">
              <button className="small primary" onClick={() => onShow(u)}>
                {papers > 0 ? 'Screen new papers' : 'Open project'}
              </button>
              <button className="small" onClick={() => onDismiss(u.projectPath)}>
                Dismiss
              </button>
            </span>
          </div>
        )
      })}
    </div>
  )
}
