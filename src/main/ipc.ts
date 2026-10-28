// Connects the UI's api calls (see shared/api.ts) to the main-process services.
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { IMPORT_PROGRESS_CHANNEL, INVOKE_METHODS, type InvokeApi } from '../shared/api'
import type { ProjectOverview } from '../shared/types'
import { cloudSyncWarning } from './cloud'
import { ProjectStore } from './project/store'
import { SearchService } from './search'
import { Settings } from './settings'
import { PubMedClient } from './sources/pubmed/client'

export function openExternalSafe(url: string) {
  try {
    if (new URL(url).protocol === 'https:') void shell.openExternal(url)
  } catch {
    // Not a valid URL; ignore.
  }
}

export function registerIpc(getWindow: () => BrowserWindow | null): { closeProject: () => void } {
  const settings = new Settings()
  let project: ProjectStore | null = null

  const requireProject = () => {
    if (!project) throw new Error('No project is open.')
    return project
  }
  const requireReviewer = () => {
    const r = settings.reviewer()
    if (!r.name) throw new Error('Please enter your reviewer name in Settings first.')
    return r
  }
  const overview = (): ProjectOverview => {
    const p = requireProject()
    return { ...p.overview(), cloudWarning: cloudSyncWarning(p.path) }
  }
  const switchProject = (next: ProjectStore | null) => {
    project?.close()
    project = next
    search.reset()
    if (next) settings.addRecent(next.path)
  }

  let client: PubMedClient | null = null
  let clientKey = ''
  const getClient = () => {
    const apiKey = settings.ncbiApiKey()
    const email = settings.ncbiEmail()
    const key = `${apiKey ?? ''}|${email}`
    if (!client || key !== clientKey) {
      client = new PubMedClient({ apiKey, email: email || undefined })
      clientKey = key
    }
    return client
  }

  const search = new SearchService(getClient, requireProject, requireReviewer)

  const handlers: InvokeApi = {
    async getSettings() {
      return settings.view()
    },
    async updateSettings(update) {
      const view = settings.update(update)
      if (project && update.reviewerName) project.ensureReviewer(settings.reviewer())
      return view
    },
    async chooseFolder(title) {
      const win = getWindow()
      const opts: Electron.OpenDialogOptions = { title, properties: ['openDirectory', 'createDirectory'] }
      const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
      return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
    },
    async openExternal(url) {
      openExternalSafe(url)
    },

    async createProject(input) {
      const store = ProjectStore.create(input.parentDir, input, requireReviewer())
      switchProject(store)
      return overview()
    },
    async openProject(path) {
      let dir = path
      if (!dir) {
        dir = (await handlers.chooseFolder('Open a Literature Screener project folder')) ?? undefined
        if (!dir) return null
      }
      try {
        switchProject(ProjectStore.open(dir))
      } catch (e) {
        if (path) settings.removeRecent(path)
        throw e
      }
      return overview()
    },
    async closeProject() {
      switchProject(null)
    },
    async getOverview() {
      return overview()
    },
    async revealProject() {
      shell.showItemInFolder(requireProject().path)
    },
    async backupProject() {
      const p = requireProject()
      const dest = await handlers.chooseFolder('Choose where to save the backup')
      return dest ? p.backupTo(dest) : null
    },

    async previewSearch(filters) {
      return search.preview(filters)
    },
    async browseSearch(filters, start) {
      return search.browse(filters, start)
    },
    async saveFromBrowse(pmid) {
      search.saveFromBrowse(pmid)
    },
    async importSearch(filters) {
      return search.importAll(filters, (progress) => {
        getWindow()?.webContents.send(IMPORT_PROGRESS_CHANNEL, progress)
      })
    },
    async listSearches() {
      return requireProject().listSearches()
    },

    async listRecords(query) {
      return requireProject().listRecords(query)
    },
    async screeningQueue(decision, origin) {
      return requireProject().screeningQueue(decision, origin)
    },
    async getRecord(id) {
      return requireProject().getRecord(id)
    },
    async decide(recordId, decision) {
      return requireProject().decide(recordId, decision, requireReviewer())
    }
  }

  for (const method of INVOKE_METHODS) {
    const fn = handlers[method] as (...args: unknown[]) => Promise<unknown>
    ipcMain.handle(method, (_event, ...args) => fn(...args))
  }

  return { closeProject: () => switchProject(null) }
}
