// Automatic updates against a fake PubMed whose results change over time.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectStore } from '../src/main/project/store'
import { importQuery } from '../src/main/search'
import { PubMedClient } from '../src/main/sources/pubmed/client'
import { updateProject, updateProjects } from '../src/main/updates'
import { EMPTY_FILTERS } from '../src/shared/query'
import type { RecordFilter } from '../src/shared/types'

const fixture = readFileSync(join(__dirname, 'fixtures/pubmed-sample.xml'), 'utf8')
const articles = new Map(
  fixture.match(/<PubmedArticle>[\s\S]*?<\/PubmedArticle>/g)!.map((a) => [a.match(/<PMID[^>]*>(\d+)/)![1], a])
)
const reviewer = { id: 'r1', name: 'Tester' }
const DAY = 24 * 60 * 60 * 1000
const ALL: RecordFilter = { decision: 'all', origin: 'all', text: '', systems: [], systemsMode: 'any', collectionId: null }

/** A PubMed whose result list and records can be changed between calls. */
function fakePubMed() {
  const state = { ids: ['33385560', '32329463'], fail: false, queries: [] as string[], xml: new Map(articles) }
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const params = new URLSearchParams(String(init.body))
    if (state.fail) return new Response('down', { status: 400 })
    if (url.endsWith('esearch.fcgi')) {
      state.queries.push(params.get('term')!)
      const max = Number(params.get('retmax'))
      return new Response(JSON.stringify({ esearchresult: { count: String(state.ids.length), idlist: state.ids.slice(0, max) } }))
    }
    const wanted = params.get('id')!.split(',')
    return new Response(`<PubmedArticleSet>${wanted.map((id) => state.xml.get(id) ?? '').join('')}</PubmedArticleSet>`)
  }) as typeof fetch
  return { state, client: new PubMedClient({ fetchImpl, minIntervalMs: 0 }) }
}

let dir: string
let path: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ls-updates-'))
  const store = ProjectStore.create(dir, { name: 'P', researchQuestion: '', inclusionCriteria: '', exclusionCriteria: '' }, reviewer)
  path = store.path
  store.close()
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

async function importOriginal(client: PubMedClient, query = 'original query text') {
  const store = ProjectStore.open(path)
  const r = await importQuery(client, store, reviewer, { querySent: query, filters: { ...EMPTY_FILTERS, query: 'x' } }, () => {})
  return { store, searchId: r.searchId }
}

describe('automatic search updates', () => {
  it('re-runs the exact original query when due and adds only new papers', async () => {
    const { state, client } = fakePubMed()
    const { store, searchId } = await importOriginal(client)
    store.setSchedule(searchId, 14)
    store.close()

    // Not due yet: nothing happens.
    const early = await updateProject(path, { client, reviewer, now: Date.now() + 13 * DAY })
    expect(early.runs).toEqual([])

    state.ids = ['38108521', '33385560', '32329463']
    state.queries = []
    const due = await updateProject(path, { client, reviewer, now: Date.now() + 15 * DAY })
    expect(due.runs).toMatchObject([{ searchId, status: 'complete', newRecords: 1 }])
    expect(state.queries.every((q) => q === 'original query text')).toBe(true)

    const reopened = ProjectStore.open(path)
    const log = reopened.listSearches()
    expect(log[0]).toMatchObject({ parentSearchId: searchId, newCount: 1, duplicateCount: 2, querySent: 'original query text' })
    expect(log.find((s) => s.id === searchId)!.schedule).toMatchObject({ intervalDays: 14 })
    expect(reopened.listRecords({ ...ALL, origin: 'update', offset: 0, limit: 10 }).items.map((r) => r.pmid)).toEqual(['38108521'])
    reopened.close()

    // Just ran successfully, so the next run is two weeks later.
    const again = await updateProject(path, { client, reviewer })
    expect(again.runs).toEqual([])
  })

  it('records failures and waits before retrying', async () => {
    const { state, client } = fakePubMed()
    const { store, searchId } = await importOriginal(client)
    store.setSchedule(searchId, 7)
    store.close()
    // Make the schedule 8 days old, so it is due now.
    const db = new DatabaseSync(join(path, 'project.db'))
    db.prepare('UPDATE search_schedules SET created_at = ?').run(new Date(Date.now() - 8 * DAY).toISOString())
    db.close()

    state.fail = true
    const failed = await updateProject(path, { client, reviewer })
    expect(failed.runs[0].status).toBe('failed')
    const blocked = await updateProject(path, { client, reviewer, now: Date.now() + 60 * 60 * 1000 })
    expect(blocked.runs).toEqual([])

    state.fail = false
    const retried = await updateProject(path, { client, reviewer, now: Date.now() + 7 * 60 * 60 * 1000 })
    expect(retried.runs[0].status).toBe('complete')
  })

  it('"check now" runs a search regardless of its schedule', async () => {
    const { client } = fakePubMed()
    const { store, searchId } = await importOriginal(client)
    store.setSchedule(searchId, 30)
    store.close()
    const r = await updateProject(path, { client, reviewer }, searchId)
    expect(r.runs).toHaveLength(1)
  })

  it('only original import-all searches can be scheduled, with a sensible interval', async () => {
    const { client } = fakePubMed()
    const { store, searchId } = await importOriginal(client)
    expect(() => store.setSchedule(searchId, 0)).toThrow(/between 1 and 365/)
    const exploratory = store.insertSearch(
      { source: 'pubmed', mode: 'exploratory', filters: EMPTY_FILTERS, querySent: 'q', queryTranslation: null, totalCount: 1, status: 'complete' },
      reviewer
    )
    expect(() => store.setSchedule(exploratory, 7)).toThrow(/Only original/)
    store.setSchedule(searchId, 7)
    store.setSchedule(searchId, null)
    expect(store.scheduledSearches()).toEqual([])
    store.close()
  })

  it('a project can keep several searches up to date independently', async () => {
    const { client } = fakePubMed()
    const first = await importOriginal(client, 'query one')
    first.store.setSchedule(first.searchId, 7)
    first.store.close()
    const second = await importOriginal(client, 'query two')
    second.store.setSchedule(second.searchId, 30)
    second.store.close()

    const r = await updateProject(path, { client, reviewer, now: Date.now() + 8 * DAY })
    expect(r.runs.map((x) => x.searchId)).toEqual([first.searchId])
  })

  it('flags new retractions and expressions of concern on included or unsure papers, once', async () => {
    const { state, client } = fakePubMed()
    const { store, searchId } = await importOriginal(client)
    const id = store.listRecords({ ...ALL, text: '33385560', offset: 0, limit: 1 }).items[0].id
    store.decide(id, { decision: 'include' }, reviewer)
    store.setSchedule(searchId, 7)
    expect(store.getRecord(id).alerts).toEqual([])
    store.close()

    // PubMed later links an expression of concern to the included paper.
    state.xml.set(
      '33385560',
      articles.get('33385560')!.replace(
        '</MedlineCitation>',
        '<CommentsCorrectionsList><CommentsCorrections RefType="ExpressionOfConcernIn"><RefSource>x</RefSource><PMID Version="1">99999999</PMID></CommentsCorrections></CommentsCorrectionsList></MedlineCitation>'
      )
    )
    const r = await updateProject(path, { client, reviewer, now: Date.now() + 8 * DAY })
    expect(r.newAlerts).toBe(1)
    const again = await updateProject(path, { client, reviewer }, searchId)
    expect(again.newAlerts).toBe(0)

    const reopened = ProjectStore.open(path)
    expect(reopened.getRecord(id).alerts).toMatchObject([{ kind: 'expression_of_concern', noticePmid: '99999999', foundBy: 'recheck' }])
    reopened.close()
  })

  it('skips project folders that no longer exist', async () => {
    const { client } = fakePubMed()
    expect(await updateProjects([join(dir, 'gone'), path], { client, reviewer })).toHaveLength(1)
  })
})
