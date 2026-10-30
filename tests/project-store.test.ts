import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectStore, isProjectFolder } from '../src/main/project/store'
import { parsePubMedXml } from '../src/main/sources/pubmed/parse'
import { EMPTY_FILTERS } from '../src/shared/query'
import type { Decision, RecordFilter, SearchMode } from '../src/shared/types'

const records = parsePubMedXml(readFileSync(join(__dirname, 'fixtures/pubmed-sample.xml'), 'utf8'))
const alice = { id: 'reviewer-alice', name: 'Alice' }
const info = { name: 'Test: Project?', researchQuestion: 'Q', inclusionCriteria: 'mice', exclusionCriteria: 'reviews' }

const F = (f: Partial<RecordFilter> = {}): RecordFilter => ({
  decision: 'all', origin: 'all', text: '', systems: [], systemsMode: 'any', collectionId: null, ...f
})
const Q = (f: Partial<RecordFilter> = {}) => ({ ...F(f), offset: 0, limit: 10 })
const d = (decision: Decision) => ({ decision })

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

    const shared = store.listRecords(Q({ decision: 'all', origin: 'all', text: records[1].pmid })).items[0]
    expect(store.getRecord(shared.id).origins.map((o) => o.searchId)).toEqual([s1, s2])
    store.close()
  })

  it('distinguishes imported from hand-picked records', () => {
    const store = ProjectStore.create(dir, info, alice)
    store.addRecords(newSearch(store), records.slice(0, 2), 'search_import')
    store.addRecords(newSearch(store, 'exploratory'), records.slice(1, 3), 'hand_picked')
    expect(store.listRecords(Q({ origin: 'structured' })).total).toBe(2)
    expect(store.listRecords(Q({ origin: 'hand_picked' })).total).toBe(2)
    expect(store.listRecords(Q()).total).toBe(3)
    store.close()
  })

  it('keeps the full decision history and uses the latest decision', () => {
    const store = ProjectStore.create(dir, info, alice)
    store.addRecords(newSearch(store), records, 'search_import')
    const [first] = store.recordIds(F({ decision: 'undecided', origin: 'all' }))

    store.decide(first, d('exclude'), alice)
    const after = store.decide(first, d('include'), { ...alice, name: 'Alice B.' })
    expect(after.current).toBe('include')
    expect(after.history.map((h) => h.decision)).toEqual(['include', 'exclude'])
    expect(after.history[0].criteriaVersion).toBe(1)

    expect(store.recordIds(F({ decision: 'undecided', origin: 'all' }))).not.toContain(first)
    expect(store.recordIds(F({ decision: 'include', origin: 'all' }))).toEqual([first])
    expect(store.overview().counts).toEqual({ include: 1, exclude: 0, unsure: 0 })
    store.close()
  })

  it('makes decisions append-only at the database level', () => {
    const store = ProjectStore.create(dir, info, alice)
    store.addRecords(newSearch(store), records.slice(0, 1), 'search_import')
    store.decide(store.recordIds(F({ decision: 'all', origin: 'all' }))[0], d('unsure'), alice)
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
    const ids = created.recordIds(F({ decision: 'all', origin: 'all' }))
    created.decide(ids[0], d('include'), alice)
    created.decide(ids[1], d('exclude'), alice)
    created.close()

    const reopened = ProjectStore.open(path)
    expect(reopened.overview().counts).toEqual({ include: 1, exclude: 1, unsure: 0 })
    expect(reopened.recordIds(F({ decision: 'undecided', origin: 'all' }))).toEqual(ids.slice(2))
    const r = reopened.getRecord(ids[0])
    expect(r.title).toBe(records[0].title)
    expect(r.abstract).toBe(records[0].abstract)
    reopened.close()
  })

  it('makes a backup that opens as a complete project', () => {
    const store = ProjectStore.create(dir, info, alice)
    store.addRecords(newSearch(store), records, 'search_import')
    store.decide(store.recordIds(F({ decision: 'all', origin: 'all' }))[0], d('include'), alice)
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
    const zebra = store.listRecords(Q({ decision: 'all', origin: 'all', text: 'Zebrafish' }))
    expect(zebra.items.map((r) => r.pmid)).toEqual(['38108521'])
    store.decide(zebra.items[0].id, d('unsure'), alice)
    expect(store.listRecords(Q({ decision: 'unsure', origin: 'all', text: 'Zebrafish' })).total).toBe(1)
    expect(store.listRecords(Q({ decision: 'undecided', origin: 'all', text: 'Zebrafish' })).total).toBe(0)
    store.close()
  })

  it('stores exclusion reasons and comments with the wording used at decision time', () => {
    const store = ProjectStore.create(dir, info, alice)
    store.addRecords(newSearch(store), records, 'search_import')
    const [id] = store.recordIds(F())
    const reason = store.exclusionReasons()[0]
    expect(reason.label).toBe('Not relevant to the research question')

    store.decide(id, { decision: 'exclude', reasonId: reason.id, comment: 'about liver only' }, alice)
    store.renameExclusionReason(reason.id, 'Off topic')
    store.setExclusionReasonRetired(reason.id, true)

    const r = store.getRecord(id)
    expect(r.history[0]).toMatchObject({ decision: 'exclude', reasonText: 'Not relevant to the research question', comment: 'about liver only' })
    expect(store.exclusionReasons().find((x) => x.id === reason.id)).toMatchObject({ label: 'Off topic', retired: true })
    expect(() => store.decide(id, { decision: 'include', reasonId: reason.id }, alice)).toThrow(/only be given for exclusions/)
    store.close()
  })

  it('versions criteria and links new decisions to the new version', () => {
    const store = ProjectStore.create(dir, info, alice)
    store.addRecords(newSearch(store), records.slice(0, 2), 'search_import')
    const [a, b] = store.recordIds(F())
    store.decide(a, d('include'), alice)
    store.updateCriteria('mice only', 'reviews', alice)
    store.updateCriteria('mice only', 'reviews', alice) // unchanged: no new version
    store.decide(b, d('include'), alice)
    expect(store.overview()).toMatchObject({ criteriaVersion: 2, inclusionCriteria: 'mice only' })
    expect(store.getRecord(a).history[0].criteriaVersion).toBe(1)
    expect(store.getRecord(b).history[0].criteriaVersion).toBe(2)
    store.close()
  })

  it('keeps notes as a list', () => {
    const store = ProjectStore.create(dir, info, alice)
    store.addRecords(newSearch(store), records.slice(0, 1), 'search_import')
    const [id] = store.recordIds(F())
    store.addNote(id, 'first', alice)
    store.addNote(id, '   ', alice)
    store.addNote(id, 'second', alice)
    expect(store.getRecord(id).notes.map((n) => n.text)).toEqual(['second', 'first'])
    store.close()
  })

  it('organises records into collections without removing them from the project', () => {
    const store = ProjectStore.create(dir, info, alice)
    store.addRecords(newSearch(store), records, 'search_import')
    const ids = store.recordIds(F())
    const c = store.createCollection('Mouse work')
    expect(() => store.createCollection('Mouse work')).toThrow(/already exists/)
    store.setInCollection(c, ids.slice(0, 2), true)
    store.setInCollection(c, ids.slice(0, 2), true)
    expect(store.collections()).toEqual([{ id: c, name: 'Mouse work', count: 2 }])
    expect(store.recordIds(F({ collectionId: c }))).toEqual(ids.slice(0, 2))
    store.setInCollection(c, [ids[0]], false)
    expect(store.getRecord(ids[1]).collectionIds).toEqual([c])
    store.deleteCollection(c)
    expect(store.collections()).toEqual([])
    expect(store.overview().recordCount).toBe(4)
    store.close()
  })

  it('filters by systems with any/all, honouring researcher corrections', () => {
    const store = ProjectStore.create(dir, info, alice)
    store.addRecords(newSearch(store), records, 'search_import')
    const idOf = (pmid: string) => store.listRecords(Q({ text: pmid })).items[0].id
    const mouseAD = idOf('33385560') // MeSH: Mice and Humans
    const zebra = idOf('38108521')

    const pmids = (f: Partial<RecordFilter>) => store.listRecords(Q(f)).items.map((r) => r.pmid)
    expect(pmids({ systems: ['mouse', 'human'], systemsMode: 'all' })).toContain('33385560')
    expect(pmids({ systems: ['mouse', 'zebrafish'], systemsMode: 'all' })).toEqual([])
    expect(pmids({ systems: ['mouse', 'zebrafish'], systemsMode: 'any' })).toEqual(expect.arrayContaining(['33385560', '38108521']))

    // The researcher says "Human" does not apply to the mouse paper, and adds "Mouse" to the zebrafish one.
    store.setManualTag(mouseAD, 'human', false, alice)
    store.setManualTag(zebra, 'mouse', true, alice)
    expect(pmids({ systems: ['mouse', 'human'], systemsMode: 'all' })).not.toContain('33385560')
    expect(pmids({ systems: ['mouse', 'zebrafish'], systemsMode: 'all' })).toEqual(['38108521'])
    const r = store.getRecord(mouseAD)
    expect(r.systems).not.toContain('human')
    expect(r.tags.filter((t) => t.system === 'human').map((t) => t.source)).toEqual(expect.arrayContaining(['pubmed_mesh', 'manual']))

    store.setManualTag(mouseAD, 'human', null, alice)
    expect(store.getRecord(mouseAD).systems).toContain('human')
    store.close()
  })

  it('upgrades a version-1 project and tags existing records with new presets', () => {
    const store = ProjectStore.create(dir, info, alice)
    store.addRecords(newSearch(store), records, 'search_import')
    const path = store.path
    store.close()

    // Turn the project back into a v1 database with v1 tagging.
    const db = new DatabaseSync(join(path, 'project.db'))
    db.exec(`DROP VIEW record_systems; DROP TABLE record_notes; DROP TABLE collection_records; DROP TABLE collections;
      DELETE FROM exclusion_reasons; ALTER TABLE exclusion_reasons DROP COLUMN sort_order;
      ALTER TABLE system_tags DROP COLUMN present; DELETE FROM system_tags WHERE system = 'epidemiology';
      DELETE FROM meta WHERE key = 'tagging_version'; PRAGMA user_version = 1;`)
    db.close()

    const reopened = ProjectStore.open(path)
    expect(reopened.exclusionReasons().length).toBeGreaterThan(0)
    expect(reopened.collections()).toEqual([])
    expect(reopened.overview().recordCount).toBe(4)
    const tagged = reopened.listRecords(Q({ systems: ['epidemiology'] })).items.map((r) => r.pmid)
    expect(tagged).toContain('32329463') // a cross-sectional study
    reopened.close()
  })
})

