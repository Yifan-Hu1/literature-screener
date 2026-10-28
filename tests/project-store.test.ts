import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectStore, isProjectFolder } from '../src/main/project/store'
import { parsePubMedXml } from '../src/main/sources/pubmed/parse'
import { EMPTY_FILTERS } from '../src/shared/query'
import type { SearchMode } from '../src/shared/types'

const records = parsePubMedXml(readFileSync(join(__dirname, 'fixtures/pubmed-sample.xml'), 'utf8'))
const alice = { id: 'reviewer-alice', name: 'Alice' }
const info = { name: 'Test: Project?', researchQuestion: 'Q', inclusionCriteria: 'mice', exclusionCriteria: 'reviews' }

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ls-test-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function newSearch(store: ProjectStore, mode: SearchMode = 'structured') {
  return store.insertSearch(
    { source: 'pubmed', mode, filters: EMPTY_FILTERS, querySent: 'q', queryTranslation: null, totalCount: 4, status: 'in_progress' },
    alice
  )
}

describe('ProjectStore', () => {
  it('creates a portable project folder with a safe name', () => {
    const store = ProjectStore.create(dir, info, alice)
    expect(store.path).toBe(join(dir, 'Test- Project-'))
    expect(isProjectFolder(store.path)).toBe(true)
    const o = store.overview()
    expect(o.name).toBe('Test: Project?')
    expect(o.inclusionCriteria).toBe('mice')
    expect(o.criteriaVersion).toBe(1)
    store.close()
  })

  it('refuses to create a project over a non-empty folder', () => {
    ProjectStore.create(dir, info, alice).close()
    expect(() => ProjectStore.create(dir, info, alice)).toThrow(/already exists/)
  })

  it('refuses to open a folder that is not a project', () => {
    expect(() => ProjectStore.open(dir)).toThrow(/not a Literature Screener project/)
  })

  it('deduplicates records across searches by PMID and keeps the link to each search', () => {
    const store = ProjectStore.create(dir, info, alice)
    const s1 = newSearch(store)
    expect(store.addRecords(s1, records.slice(0, 3), 'search_import')).toEqual({ newCount: 3, duplicateCount: 0 })

    const s2 = newSearch(store)
    expect(store.addRecords(s2, records.slice(1), 'search_import')).toEqual({ newCount: 1, duplicateCount: 2 })
    // The same record saved twice from one search is not counted twice.
    expect(store.addRecords(s2, records.slice(1, 2), 'search_import')).toEqual({ newCount: 0, duplicateCount: 0 })

    expect(store.overview().recordCount).toBe(4)
    const log = store.listSearches().find((s) => s.id === s2)!
    expect([log.retrievedCount, log.newCount, log.duplicateCount]).toEqual([3, 1, 2])

    const shared = store.listRecords({ decision: 'all', origin: 'all', text: records[1].pmid, offset: 0, limit: 10 }).items[0]
    expect(store.getRecord(shared.id).origins.map((o) => o.searchId)).toEqual([s1, s2])
    store.close()
  })

  it('distinguishes imported from hand-picked records', () => {
    const store = ProjectStore.create(dir, info, alice)
    store.addRecords(newSearch(store), records.slice(0, 2), 'search_import')
    store.addRecords(newSearch(store, 'exploratory'), records.slice(1, 3), 'hand_picked')
    const q = { decision: 'all' as const, text: '', offset: 0, limit: 10 }
    expect(store.listRecords({ ...q, origin: 'structured' }).total).toBe(2)
    expect(store.listRecords({ ...q, origin: 'hand_picked' }).total).toBe(2)
    expect(store.listRecords({ ...q, origin: 'all' }).total).toBe(3)
    store.close()
  })

  it('keeps the full decision history and uses the latest decision', () => {
    const store = ProjectStore.create(dir, info, alice)
    store.addRecords(newSearch(store), records, 'search_import')
    const [first] = store.screeningQueue('undecided', 'all')

    store.decide(first, 'exclude', alice)
    const after = store.decide(first, 'include', { ...alice, name: 'Alice B.' })
    expect(after.current).toBe('include')
    expect(after.history.map((h) => h.decision)).toEqual(['include', 'exclude'])
    expect(after.history[0].criteriaVersion).toBe(1)

    expect(store.screeningQueue('undecided', 'all')).not.toContain(first)
    expect(store.screeningQueue('include', 'all')).toEqual([first])
    expect(store.overview().counts).toEqual({ include: 1, exclude: 0, unsure: 0 })
    store.close()
  })

  it('makes decisions append-only at the database level', () => {
    const store = ProjectStore.create(dir, info, alice)
    store.addRecords(newSearch(store), records.slice(0, 1), 'search_import')
    store.decide(store.screeningQueue('all', 'all')[0], 'unsure', alice)
    store.close()

    const db = new DatabaseSync(join(dir, 'Test- Project-', 'project.db'))
    expect(() => db.exec("UPDATE decisions SET decision = 'include'")).toThrow(/append-only/)
    expect(() => db.exec('DELETE FROM decisions')).toThrow(/append-only/)
    db.close()
  })

  it('restores records and decisions after closing and reopening', () => {
    const created = ProjectStore.create(dir, info, alice)
    const path = created.path
    created.addRecords(newSearch(created), records, 'search_import')
    const ids = created.screeningQueue('all', 'all')
    created.decide(ids[0], 'include', alice)
    created.decide(ids[1], 'exclude', alice)
    created.close()

    const reopened = ProjectStore.open(path)
    expect(reopened.overview().counts).toEqual({ include: 1, exclude: 1, unsure: 0 })
    expect(reopened.screeningQueue('undecided', 'all')).toEqual(ids.slice(2))
    const r = reopened.getRecord(ids[0])
    expect(r.title).toBe(records[0].title)
    expect(r.abstract).toBe(records[0].abstract)
    reopened.close()
  })

  it('makes a backup that opens as a complete project', () => {
    const store = ProjectStore.create(dir, info, alice)
    store.addRecords(newSearch(store), records, 'search_import')
    store.decide(store.screeningQueue('all', 'all')[0], 'include', alice)
    const backup = store.backupTo(dir)
    store.close()

    const copy = ProjectStore.open(backup)
    expect(copy.overview().recordCount).toBe(4)
    expect(copy.overview().counts.include).toBe(1)
    copy.close()
  })

  it('filters by text and decision together', () => {
    const store = ProjectStore.create(dir, info, alice)
    store.addRecords(newSearch(store), records, 'search_import')
    const zebra = store.listRecords({ decision: 'all', origin: 'all', text: 'Zebrafish', offset: 0, limit: 10 })
    expect(zebra.items.map((r) => r.pmid)).toEqual(['38108521'])
    store.decide(zebra.items[0].id, 'unsure', alice)
    expect(store.listRecords({ decision: 'unsure', origin: 'all', text: 'Zebrafish', offset: 0, limit: 10 }).total).toBe(1)
    expect(store.listRecords({ decision: 'undecided', origin: 'all', text: 'Zebrafish', offset: 0, limit: 10 }).total).toBe(0)
    store.close()
  })
})
