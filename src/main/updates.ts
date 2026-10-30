// Automatic updates: re-runs scheduled searches (exact original query text) and
// re-checks included / unsure papers for new retractions or expressions of concern.
// Runs only while the app is open; overdue searches run at the next start.
import { existsSync } from 'node:fs'
import type { ProjectUpdateSummary, UpdateRun } from '../shared/types'
import { ProjectStore, isProjectFolder, type Reviewer } from './project/store'
import { importQuery } from './search'
import type { PubMedClient } from './sources/pubmed/client'

/** After a failed attempt, wait this long before trying the same search again. */
const RETRY_AFTER_MS = 6 * 60 * 60 * 1000

export interface UpdateContext {
  client: PubMedClient
  reviewer: Reviewer
  now?: number
}

/**
 * Runs the due updates of one project. With `onlySearchId`, runs that search now
 * regardless of its schedule.
 */
export async function updateProject(path: string, ctx: UpdateContext, onlySearchId?: number): Promise<ProjectUpdateSummary> {
  const now = ctx.now ?? Date.now()
  const store = ProjectStore.open(path)
  try {
    const summary: ProjectUpdateSummary = { projectPath: path, projectName: store.overview().name, runs: [], newAlerts: 0 }
    const due = store.scheduledSearches().filter((s) => {
      if (onlySearchId != null) return s.searchId === onlySearchId
      const retryBlocked = s.lastRunAt != null && now - Date.parse(s.lastRunAt) < RETRY_AFTER_MS
      return Date.parse(s.dueAt) <= now && !retryBlocked
    })
    if (due.length === 0) return summary

    for (const s of due) {
      let run: UpdateRun
      try {
        const r = await importQuery(
          ctx.client,
          store,
          ctx.reviewer,
          { querySent: s.querySent, filters: s.filters, parentSearchId: s.searchId },
          () => {}
        )
        run = { searchId: s.searchId, status: r.status, newRecords: r.newRecords, message: r.message }
      } catch (e) {
        run = { searchId: s.searchId, status: 'failed', newRecords: 0, message: (e as Error).message }
      }
      // An incomplete run still counts: missing records are picked up next time.
      store.markScheduleRun(s.searchId, run.status !== 'failed', run.message)
      summary.runs.push(run)
    }

    summary.newAlerts = await recheckNotices(store, ctx.client)
    return summary
  } finally {
    store.close()
  }
}

/** Re-fetches included / unsure papers and stores any notice not seen before. */
export async function recheckNotices(store: ProjectStore, client: PubMedClient): Promise<number> {
  const targets = store.recordsToRecheck()
  if (targets.length === 0) return 0
  const idByPmid = new Map(targets.map((t) => [t.pmid, t.id]))
  let added = 0
  try {
    await client.fetchRecords([...idByPmid.keys()], (records) => {
      for (const r of records) {
        const id = idByPmid.get(r.pmid)
        if (id != null) added += store.addAlerts(id, r.notices, 'recheck')
      }
    })
  } catch {
    // Network trouble: notices are checked again at the next update.
  }
  return added
}

/** Checks every given project folder; folders that are missing or unreadable are skipped. */
export async function updateProjects(paths: string[], ctx: UpdateContext): Promise<ProjectUpdateSummary[]> {
  const results: ProjectUpdateSummary[] = []
  for (const path of paths) {
    if (!existsSync(path) || !isProjectFolder(path)) continue
    try {
      results.push(await updateProject(path, ctx))
    } catch {
      // E.g. a project made by a newer app version; it is reported when opened.
    }
  }
  return results
}
