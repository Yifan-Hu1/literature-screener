import { useEffect, useState } from 'react'
import type { AppSettings, ProjectOverview } from '../../shared/types'
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

  useEffect(() => {
    api.getSettings().then(setSettings, (e) => setFatal(errorMessage(e)))
  }, [])

  const refresh = async () => setProject(await api.getOverview())

  if (fatal) return <div className="alert alert-error">{fatal}</div>
  if (!settings) return null

  if (!project) {
    return (
      <StartScreen
        settings={settings}
        onSettingsChanged={setSettings}
        onOpened={(p) => {
          setProject(p)
          setView('overview')
        }}
      />
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
              if (id === 'screening') setFocusRecordId(null)
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
        {view === 'overview' && <OverviewScreen project={project} onChanged={setProject} />}
        {view === 'search' && <SearchScreen onImported={refresh} />}
        {view === 'library' && (
          <LibraryScreen
            onOpenRecord={(id) => {
              setFocusRecordId(id)
              setView('screening')
            }}
          />
        )}
        {view === 'screening' && (
          <ScreeningScreen
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
