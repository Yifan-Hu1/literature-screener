// Search workflows:
//  - exploratory: browse pages of results and hand-pick records to save
//  - structured: import every result of a logged search, with completeness checks
import type {
  BrowsePage,
  ImportProgress,
  ImportResult,
  PubMedRecord,
  SearchFilters,
  SearchPreview
} from '../shared/types'
import { buildPubMedQuery } from '../shared/query'
import { PUBMED_RETRIEVAL_LIMIT, PubMedClient } from './sources/pubmed/client'
import { shortAuthors } from './sources/pubmed/parse'
import type { ProjectStore, Reviewer } from './project/store'

export const BROWSE_PAGE_SIZE = 20

interface BrowseSession {
  preview: SearchPreview
  filters: SearchFilters
  /** Created when the first record is saved from this search. */
  searchId: number | null
  records: Map<string, PubMedRecord>
  positions: Map<string, number>
}

export class SearchService {
  private session: BrowseSession | null = null

  constructor(
    private readonly client: () => PubMedClient,
    private readonly project: () => ProjectStore,
    private readonly reviewer: () => Reviewer
  ) {}

  /** Call when the open project changes, so saves never go to the wrong project. */
  reset() {
    this.session = null
  }

  private query(filters: SearchFilters): string {
    const q = buildPubMedQuery(filters)
    if (!q) throw new Error('Enter search terms or choose at least one filter.')
    return q
  }

  async preview(filters: SearchFilters): Promise<SearchPreview> {
    const querySent = this.query(filters)
    const r = await this.client().search(querySent)
    return {
      querySent,
      queryTranslation: r.queryTranslation,
      count: r.count,
      warnings: r.warnings,
      exceedsLimit: r.count > PUBMED_RETRIEVAL_LIMIT,
      limit: PUBMED_RETRIEVAL_LIMIT
    }
  }

  async browse(filters: SearchFilters, start: number): Promise<BrowsePage> {
    const querySent = this.query(filters)
    const client = this.client()
    const r = await client.search(querySent, { retstart: start, retmax: BROWSE_PAGE_SIZE, sort: 'relevance' })
    const records = await client.fetchRecords(r.ids)
    const byPmid = new Map(records.map((rec) => [rec.pmid, rec]))

    const preview: SearchPreview = {
      querySent,
      queryTranslation: r.queryTranslation,
      count: r.count,
      warnings: r.warnings,
      exceedsLimit: r.count > PUBMED_RETRIEVAL_LIMIT,
      limit: PUBMED_RETRIEVAL_LIMIT
    }
    if (!this.session || this.session.preview.querySent !== querySent) {
      this.session = { preview, filters, searchId: null, records: new Map(), positions: new Map() }
    }
    r.ids.forEach((id, i) => this.session!.positions.set(id, start + i))
    for (const rec of records) this.session.records.set(rec.pmid, rec)

    const inProject = this.project().existingPmids(r.ids)
    return {
      preview,
      start,
      pageSize: BROWSE_PAGE_SIZE,
      items: r.ids
        .map((id) => byPmid.get(id))
        .filter((rec): rec is PubMedRecord => !!rec)
        .map((rec) => ({
          pmid: rec.pmid,
          title: rec.title,
          authorsShort: shortAuthors(rec.authors),
          journal: rec.journal,
          pubYear: rec.pubYear,
          abstract: rec.abstract,
          publicationTypes: rec.publicationTypes,
          inProject: inProject.has(rec.pmid)
        }))
    }
  }

  /** Saves one hand-picked record; the search it came from is logged as exploratory. */
  saveFromBrowse(pmid: string) {
    const s = this.session
    const record = s?.records.get(pmid)
    if (!s || !record) throw new Error('This result is no longer available. Please run the search again.')
    const project = this.project()
    if (s.searchId == null) {
      s.searchId = project.insertSearch(
        {
          source: 'pubmed',
          mode: 'exploratory',
          filters: s.filters,
          querySent: s.preview.querySent,
          queryTranslation: s.preview.queryTranslation,
          totalCount: s.preview.count,
          status: 'complete'
        },
        this.reviewer()
      )
      project.finishSearch(s.searchId, 'complete', [], 'Exploratory search: only hand-picked records were saved.')
    }
    project.addRecords(s.searchId, [record], 'hand_picked', s.positions)
  }

  /**
   * Imports every record of a search. Refuses searches above PubMed's retrieval
   * limit, and reports any record that was requested but not retrieved.
   */
  async importAll(filters: SearchFilters, onProgress: (p: ImportProgress) => void): Promise<ImportResult> {
    return importQuery(this.client(), this.project(), this.reviewer(), { querySent: this.query(filters), filters }, onProgress)
  }
}

/**
 * Imports every result of an exact query string. Used for new searches and for
 * automatic updates, which re-run the original query text unchanged.
 */
export async function importQuery(
  client: PubMedClient,
  project: ProjectStore,
  reviewer: Reviewer,
  q: { querySent: string; filters: SearchFilters; parentSearchId?: number },
  onProgress: (p: ImportProgress) => void
): Promise<ImportResult> {
  const { querySent, filters } = q
  const first = await client.search(querySent)
  if (first.count === 0) throw new Error('This search returned no results, so there is nothing to import.')
  if (first.count > PUBMED_RETRIEVAL_LIMIT) {
    throw new Error(
      `This search has ${first.count.toLocaleString()} results, but PubMed only allows retrieving the first ` +
        `${PUBMED_RETRIEVAL_LIMIT.toLocaleString()}. Nothing was imported. Please narrow the search ` +
        '(for example by date range or filters) and try again.'
    )
  }

  const idSearch = await client.search(querySent, { retmax: PUBMED_RETRIEVAL_LIMIT })
  const total = idSearch.count
  const ids = [...new Set(idSearch.ids)]
  const positions = new Map(ids.map((id, i) => [id, i]))

  const searchId = project.insertSearch(
    {
      source: 'pubmed',
      mode: 'structured',
      filters,
      querySent,
      queryTranslation: idSearch.queryTranslation,
      totalCount: total,
      status: 'in_progress',
      parentSearchId: q.parentSearchId ?? null
    },
    reviewer
  )

  const retrieved = new Set<string>()
  let newRecords = 0
  let alreadyInProject = 0
  onProgress({ done: 0, total })

  try {
    await client.fetchRecords(ids, (records) => {
      const wanted = records.filter((r) => positions.has(r.pmid) && !retrieved.has(r.pmid))
      wanted.forEach((r) => retrieved.add(r.pmid))
      const res = project.addRecords(searchId, wanted, 'search_import', positions)
      newRecords += res.newCount
      alreadyInProject += res.duplicateCount
      onProgress({ done: retrieved.size, total })
    })
  } catch (e) {
    const message =
      `Import stopped after ${retrieved.size} of ${total} records: ${(e as Error).message} ` +
      'Records retrieved so far are kept and marked as coming from this incomplete search.'
    const missing = ids.filter((id) => !retrieved.has(id))
    project.finishSearch(searchId, 'failed', missing, message)
    return { searchId, status: 'failed', total, retrieved: retrieved.size, newRecords, alreadyInProject, missingPmids: missing, message }
  }

  const missing = ids.filter((id) => !retrieved.has(id))
  const shortfall = total - ids.length
  let status: ImportResult['status'] = 'complete'
  let message = `Imported all ${total} records: ${newRecords} new, ${alreadyInProject} already in the project.`
  if (missing.length || shortfall > 0) {
    status = 'incomplete'
    message =
      `PubMed reported ${total} results, but only ${retrieved.size} could be retrieved. ` +
      (missing.length ? `${missing.length} PMIDs were listed but their records were not returned (listed below). ` : '') +
      (shortfall > 0 ? `${shortfall} results were not listed by PubMed at all. ` : '') +
      'Consider re-running the search later.'
  }
  project.finishSearch(searchId, status, missing, message)
  return { searchId, status, total, retrieved: retrieved.size, newRecords, alreadyInProject, missingPmids: missing, message }
}
