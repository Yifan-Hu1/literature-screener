// Minimal client for NCBI E-utilities (esearch + efetch) for PubMed.
// https://www.ncbi.nlm.nih.gov/books/NBK25499/
import type { MeshSuggestion, PubMedRecord } from '../../../shared/types'
import { parsePubMedXml } from './parse'

const BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/'

/** PubMed's esearch can only return the first 10,000 ids of any search. */
export const PUBMED_RETRIEVAL_LIMIT = 10000

const FETCH_BATCH = 200

export interface PubMedClientOptions {
  apiKey?: string
  email?: string
  fetchImpl?: typeof fetch
  /** Minimum gap between requests; NCBI allows 3/s without a key, 10/s with one. */
  minIntervalMs?: number
}

export interface SearchResult {
  count: number
  ids: string[]
  queryTranslation: string | null
  warnings: string[]
}

export class PubMedError extends Error {}

export class PubMedClient {
  private readonly fetchImpl: typeof fetch
  private readonly minIntervalMs: number
  private queue: Promise<unknown> = Promise.resolve()
  private lastRequestAt = 0

  constructor(private readonly opts: PubMedClientOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch
    this.minIntervalMs = opts.minIntervalMs ?? (opts.apiKey ? 110 : 350)
  }

  /** Requests are queued so we never exceed NCBI's rate limit. */
  private request(endpoint: string, params: Record<string, string>): Promise<string> {
    const run = async () => {
      const wait = this.lastRequestAt + this.minIntervalMs - Date.now()
      if (wait > 0) await sleep(wait)
      this.lastRequestAt = Date.now()
      return this.send(endpoint, params)
    }
    const result = this.queue.then(run, run)
    this.queue = result.catch(() => undefined)
    return result
  }

  private async send(endpoint: string, params: Record<string, string>): Promise<string> {
    const body = new URLSearchParams({ db: 'pubmed', tool: 'LiteratureScreener', ...params })
    if (this.opts.email) body.set('email', this.opts.email)
    if (this.opts.apiKey) body.set('api_key', this.opts.apiKey)

    let lastError: unknown
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1))
      try {
        const res = await this.fetchImpl(BASE + endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString()
        })
        if (res.ok) return await res.text()
        lastError = new PubMedError(`PubMed returned HTTP ${res.status}`)
        // Retry only on rate limiting and server errors.
        if (res.status !== 429 && res.status < 500) break
      } catch (e) {
        lastError = new PubMedError(`Could not reach PubMed: ${(e as Error).message}`)
      }
    }
    throw lastError
  }

  async search(
    term: string,
    opts: { retstart?: number; retmax?: number; sort?: 'relevance' } = {}
  ): Promise<SearchResult> {
    const params: Record<string, string> = {
      term,
      retmode: 'json',
      retstart: String(opts.retstart ?? 0),
      retmax: String(opts.retmax ?? 0)
    }
    if (opts.sort) params.sort = opts.sort
    const text = await this.request('esearch.fcgi', params)

    let json: Record<string, any>
    try {
      json = JSON.parse(text)
    } catch {
      throw new PubMedError('PubMed returned an unreadable search response.')
    }
    const r = json.esearchresult
    if (!r || json.error || r.ERROR) {
      throw new PubMedError(`PubMed rejected the search: ${json.error ?? r?.ERROR ?? 'unknown error'}`)
    }

    const warnings: string[] = []
    const wl = r.warninglist ?? {}
    const el = r.errorlist ?? {}
    for (const p of el.phrasesnotfound ?? []) warnings.push(`Term not found in PubMed: ${p}`)
    for (const f of el.fieldsnotfound ?? []) warnings.push(`Unknown search field: ${f}`)
    for (const p of wl.phrasesignored ?? []) warnings.push(`Ignored by PubMed: ${p}`)
    for (const p of wl.quotedphrasesnotfound ?? []) warnings.push(`Quoted phrase not found: ${p}`)
    for (const m of wl.outputmessages ?? []) warnings.push(m)

    return {
      count: parseInt(r.count, 10) || 0,
      ids: (r.idlist ?? []).map(String),
      queryTranslation: r.querytranslation ?? null,
      warnings
    }
  }

  /** Looks up MeSH descriptors (subject headings) matching a term, best match first. */
  async suggestMesh(term: string, max = 5): Promise<MeshSuggestion[]> {
    const search = JSON.parse(
      await this.request('esearch.fcgi', { db: 'mesh', term, retmode: 'json', retmax: String(max) })
    )
    const ids: string[] = search.esearchresult?.idlist ?? []
    if (ids.length === 0) return []
    const summary = JSON.parse(await this.request('esummary.fcgi', { db: 'mesh', id: ids.join(','), retmode: 'json' }))
    return ids
      .map((id) => summary.result?.[id])
      // Only descriptors ("D..."); supplementary chemical concepts cannot be searched with [Mesh].
      .filter((d) => d && String(d.ds_meshui).startsWith('D') && d.ds_meshterms?.length)
      .map((d) => ({
        ui: String(d.ds_meshui),
        name: String(d.ds_meshterms[0]),
        scopeNote: d.ds_scopenote ? String(d.ds_scopenote).trim() : null,
        entryTerms: d.ds_meshterms.slice(1, 6).map(String)
      }))
  }

  /** Fetches full records in batches. Order follows the PubMed response. */
  async fetchRecords(
    ids: string[],
    onBatch?: (records: PubMedRecord[], requested: string[]) => void
  ): Promise<PubMedRecord[]> {
    const all: PubMedRecord[] = []
    for (let i = 0; i < ids.length; i += FETCH_BATCH) {
      const batch = ids.slice(i, i + FETCH_BATCH)
      const xml = await this.request('efetch.fcgi', { id: batch.join(','), retmode: 'xml' })
      const records = parsePubMedXml(xml)
      all.push(...records)
      onBatch?.(records, batch)
    }
    return all
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
