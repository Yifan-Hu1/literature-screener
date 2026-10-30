// Connects the UI's api calls (see shared/api.ts) to the main-process services.
import { BrowserWindow, Notification, clipboard, dialog, ipcMain, shell } from 'electron'
import { IMPORT_PROGRESS_CHANNEL, INVOKE_METHODS, UPDATES_FINISHED_CHANNEL, type InvokeApi } from '../shared/api'
import type { ProjectOverview, ProjectUpdateSummary } from '../shared/types'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cloudSyncWarning } from './cloud'
import { diagnostics, logError } from './errorlog'
import { prismaSummary, recordsToCsv, recordsToRis } from './export'
import { ProjectStore } from './project/store'
import { SearchService } from './search'
import { Settings } from './settings'
import { PubMedClient } from './sources/pubmed/client'
import { updateProject, updateProjects } from './updates'

const UPDATE_CHECK_INTERVAL_MS = 3 * 60 * 60 * 1000

export function openExternalSafe(url: string) {
  try {
    if (new URL(url).protocol === 'https:') void shell.openExternal(url)
  } catch {
    // Not a valid URL; ignore.
  }
}

export function registerIpc(getWindow: () => BrowserWindow | null): { closeProject: () => void; startUpdateChecks: () => void } {
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
    async copyDiagnostics() {
      clipboard.writeText(diagnostics())
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
    async updateCriteria(inclusion, exclusion) {
      requireProject().updateCriteria(inclusion, exclusion, requireReviewer())
      return overview()
    },

    async suggestMesh(term) {
      return getClient().suggestMesh(term)
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
    async setSearchSchedule(searchId, intervalDays) {
      const p = requireProject()
      p.setSchedule(searchId, intervalDays)
      return p.listSearches()
    },
    async runSearchUpdateNow(searchId) {
      const summary = await updateProject(requireProject().path, { client: getClient(), reviewer: requireReviewer() }, searchId)
      announce([summary])
      return summary
    },

    async listRecords(query) {
      return requireProject().listRecords(query)
    },
    async screeningQueue(filter) {
      return requireProject().recordIds(filter)
    },
    async getRecord(id) {
      return requireProject().getRecord(id)
    },
    async decide(recordId, input) {
      return requireProject().decide(recordId, input, requireReviewer())
    },
    async addNote(recordId, text) {
      const p = requireProject()
      p.addNote(recordId, text, requireReviewer())
      return p.getRecord(recordId)
    },
    async setManualTag(recordId, system, present) {
      const p = requireProject()
      p.setManualTag(recordId, system, present, requireReviewer())
      return p.getRecord(recordId)
    },

    async listExclusionReasons() {
      return requireProject().exclusionReasons()
    },
    async addExclusionReason(label) {
      requireProject().addExclusionReason(label)
      return requireProject().exclusionReasons()
    },
    async renameExclusionReason(id, label) {
      requireProject().renameExclusionReason(id, label)
      return requireProject().exclusionReasons()
    },
    async setExclusionReasonRetired(id, retired) {
      requireProject().setExclusionReasonRetired(id, retired)
      return requireProject().exclusionReasons()
    },

    async listCollections() {
      return requireProject().collections()
    },
    async createCollection(name) {
      requireProject().createCollection(name)
      return requireProject().collections()
    },
    async deleteCollection(id) {
      requireProject().deleteCollection(id)
      return requireProject().collections()
    },
    async setInCollection(collectionId, recordIds, inCollection) {
      requireProject().setInCollection(collectionId, recordIds, inCollection)
      return requireProject().collections()
    },

    async exportRecords(filter, format) {
      const p = requireProject()
      const content = format === 'csv' ? recordsToCsv(p, filter) : recordsToRis(p, filter)
      return saveExport(p, `records.${format}`, content, format === 'csv' ? 'CSV (Excel)' : 'RIS (reference managers)', format)
    },
    async exportPrismaSummary() {
      const p = requireProject()
      return saveExport(p, 'prisma-summary.txt', prismaSummary(p), 'Text', 'txt')
    }
  }

  const saveExport = async (p: ProjectStore, suffix: string, content: string, label: string, ext: string) => {
    const name = `${p.overview().name} ${new Date().toISOString().slice(0, 10)} ${suffix}`.replace(/[/\\:*?"<>|]/g, '-')
    const opts: Electron.SaveDialogOptions = {
      title: 'Save export',
      defaultPath: join(p.path, 'exports', name),
      filters: [{ name: label, extensions: [ext] }]
    }
    const win = getWindow()
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return null
    writeFileSync(res.filePath, content)
    return res.filePath
  }

  /** Tells the user about updates that found new papers or new notices. */
  const announce = (summaries: ProjectUpdateSummary[]) => {
    const news = summaries.filter((s) => s.newAlerts > 0 || s.runs.some((r) => r.newRecords > 0))
    if (news.length === 0) return
    getWindow()?.webContents.send(UPDATES_FINISHED_CHANNEL, news)
    if (Notification.isSupported()) {
      const body = news
        .map((s) => {
          const papers = s.runs.reduce((n, r) => n + r.newRecords, 0)
          const parts = [papers && `${papers} new paper${papers === 1 ? '' : 's'}`, s.newAlerts && `${s.newAlerts} new retraction/concern notice${s.newAlerts === 1 ? '' : 's'}`]
          return `${s.projectName}: ${parts.filter(Boolean).join(', ')}`
        })
        .join('\n')
      const n = new Notification({ title: 'Literature Screener updates', body })
      n.on('click', () => getWindow()?.show())
      n.show()
    }
  }

  let updating = false
  const runScheduledUpdates = async () => {
    const reviewer = settings.reviewer()
    if (updating || !reviewer.name) return
    updating = true
    try {
      announce(await updateProjects(settings.view().recentProjects, { client: getClient(), reviewer }))
    } catch (e) {
      logError('automatic updates', e)
    } finally {
      updating = false
    }
  }
  const startUpdateChecks = () => {
    setTimeout(() => void runScheduledUpdates(), 5000)
    setInterval(() => void runScheduledUpdates(), UPDATE_CHECK_INTERVAL_MS)
  }

  for (const method of INVOKE_METHODS) {
    const fn = handlers[method] as (...args: unknown[]) => Promise<unknown>
    ipcMain.handle(method, async (_event, ...args) => {
      try {
        return await fn(...args)
      } catch (e) {
        logError(method, e)
        throw e
      }
    })
  }

  return { closeProject: () => switchProject(null), startUpdateChecks }
}
