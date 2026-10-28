// Retrieval logic tested against a fake PubMed, so no network is needed.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectStore } from '../src/main/project/store'
import { SearchService } from '../src/main/search'
import { PUBMED_RETRIEVAL_LIMIT, PubMedClient } from '../src/main/sources/pubmed/client'
import { EMPTY_FILTERS } from '../src/shared/query'

const fixture = readFileSync(join(__dirname, 'fixtures/pubmed-sample.xml'), 'utf8')
const articles = fixture.match(/<PubmedArticle>[\s\S]*?<\/PubmedArticle>/g)!
const ALL_IDS = ['33385560', '32329463', '38108521', '36713450']
const reviewer = { id: 'r1', name: 'Tester' }

interface FakeOptions {
  count?: number
  ids?: string[]
  /** PMIDs whose records efetch "forgets" to return. */
  drop?: string[]
  failFetch?: boolean
}

function fakePubMed(opts: FakeOptions = {}) {
  const calls: { endpoint: string; params: URLSearchParams }[] = []
  const ids = opts.ids ?? ALL_IDS
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const params = new URLSearchParams(String(init.body))
    const endpoint = url.split('/').pop()!
    calls.push({ endpoint, params })
    if (endpoint === 'esearch.fcgi') {
      const start = Number(params.get('retstart'))
      const max = Number(params.get('retmax'))
      return new Response(
        JSON.stringify({
          esearchresult: {
            count: String(opts.count ?? ids.length),
            idlist: ids.slice(start, start + max),
            querytranslation: 'translated'
          }
        })
      )
    }
    if (opts.failFetch) return new Response('down', { status: 400 })
    const wanted = params.get('id')!.split(',')
    const body = articles.filter((a) => wanted.some((id) => a.includes(`>${id}</PMID>`) && !opts.drop?.includes(id)))
    return new Response(`<PubmedArticleSet>${body.join('')}</PubmedArticleSet>`)
  }) as typeof fetch
  return { client: new PubMedClient({ fetchImpl, minIntervalMs: 0 }), calls }
}

let dir: string
let store: ProjectStore
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ls-search-'))
  store = ProjectStore.create(dir, { name: 'P', researchQuestion: '', inclusionCriteria: '', exclusionCriteria: '' }, reviewer)
})
afterEach(() => {
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

const service = (client: PubMedClient) =>
  new SearchService(() => client, () => store, () => reviewer)
const filters = { ...EMPTY_FILTERS, query: 'test' }

describe('structured import', () => {
  it('imports every result and logs the search', async () => {
    const { client } = fakePubMed()
    const progress: number[] = []
    const result = await service(client).importAll(filters, (p) => progress.push(p.done))
    expect(result).toMatchObject({ status: 'complete', total: 4, retrieved: 4, newRecords: 4, alreadyInProject: 0 })
    expect(progress.at(-1)).toBe(4)
    const [log] = store.listSearches()
    expect(log).toMatchObject({ mode: 'structured', status: 'complete', querySent: '(test)', queryTranslation: 'translated' })
  })

  it('counts records already in the project instead of duplicating them', async () => {
    const { client } = fakePubMed()
    await service(client).importAll(filters, () => {})
    const second = await service(client).importAll(filters, () => {})
    expect(second).toMatchObject({ newRecords: 0, alreadyInProject: 4 })
    expect(store.overview().recordCount).toBe(4)
  })

  it('refuses searches above the PubMed limit without importing anything', async () => {
    const { client, calls } = fakePubMed({ count: PUBMED_RETRIEVAL_LIMIT + 1 })
    await expect(service(client).importAll(filters, () => {})).rejects.toThrow(/Nothing was imported/)
    expect(calls.some((c) => c.endpoint === 'efetch.fcgi')).toBe(false)
    expect(store.listSearches()).toHaveLength(0)
  })

  it('reports records that PubMed listed but did not return', async () => {
    const { client } = fakePubMed({ drop: ['38108521'] })
    const result = await service(client).importAll(filters, () => {})
    expect(result.status).toBe('incomplete')
    expect(result.missingPmids).toEqual(['38108521'])
    expect(store.listSearches()[0]).toMatchObject({ status: 'incomplete', missingPmids: ['38108521'] })
  })

  it('reports results PubMed counted but did not list', async () => {
    const { client } = fakePubMed({ count: 5 })
    const result = await service(client).importAll(filters, () => {})
    expect(result.status).toBe('incomplete')
    expect(result.message).toMatch(/1 results were not listed/)
  })

  it('marks the search as failed if retrieval breaks', async () => {
    const { client } = fakePubMed({ failFetch: true })
    const result = await service(client).importAll(filters, () => {})
    expect(result.status).toBe('failed')
    expect(store.listSearches()[0].status).toBe('failed')
  })

  it('sends the NCBI tool name and fetches in batches', async () => {
    const { client, calls } = fakePubMed()
    await service(client).importAll(filters, () => {})
    expect(calls.every((c) => c.params.get('tool') === 'LiteratureScreener')).toBe(true)
    const fetches = calls.filter((c) => c.endpoint === 'efetch.fcgi')
    expect(fetches).toHaveLength(1)
    expect(fetches[0].params.get('id')).toBe(ALL_IDS.join(','))
  })
})

describe('exploratory browsing', () => {
  it('saves only hand-picked records and logs one exploratory search', async () => {
    const { client } = fakePubMed()
    const svc = service(client)
    const page = await svc.browse(filters, 0)
    expect(page.items.map((i) => i.pmid)).toEqual(ALL_IDS)
    expect(page.items.every((i) => !i.inProject)).toBe(true)

    svc.saveFromBrowse('38108521')
    svc.saveFromBrowse('33385560')
    expect(store.overview().recordCount).toBe(2)
    const searches = store.listSearches()
    expect(searches).toHaveLength(1)
    expect(searches[0]).toMatchObject({ mode: 'exploratory', retrievedCount: 2, totalCount: 4 })

    const again = await svc.browse(filters, 0)
    expect(again.items.filter((i) => i.inProject).map((i) => i.pmid)).toEqual(['33385560', '38108521'])
  })

  it('forgets the browse session when the project changes', async () => {
    const { client } = fakePubMed()
    const svc = service(client)
    await svc.browse(filters, 0)
    svc.reset()
    expect(() => svc.saveFromBrowse('38108521')).toThrow(/run the search again/)
  })
})
