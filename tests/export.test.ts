import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prismaSummary, recordsToCsv, recordsToRis } from '../src/main/export'
import { ProjectStore } from '../src/main/project/store'
import { parsePubMedXml } from '../src/main/sources/pubmed/parse'
import { EMPTY_FILTERS } from '../src/shared/query'
import type { RecordFilter } from '../src/shared/types'

const records = parsePubMedXml(readFileSync(join(__dirname, 'fixtures/pubmed-sample.xml'), 'utf8'))
const alice = { id: 'a', name: 'Alice' }
const ALL: RecordFilter = { decision: 'all', origin: 'all', text: '', systems: [], systemsMode: 'any', collectionId: null }

let dir: string
let store: ProjectStore
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ls-export-'))
  store = ProjectStore.create(dir, { name: 'P', researchQuestion: '', inclusionCriteria: '', exclusionCriteria: '' }, alice)
  const search = (n: number) =>
    store.insertSearch(
      { source: 'pubmed', mode: 'structured', filters: EMPTY_FILTERS, querySent: `q${n}`, queryTranslation: null, totalCount: 3, status: 'complete' },
      alice
    )
  store.addRecords(search(1), records.slice(0, 3), 'search_import')
  store.addRecords(search(2), records.slice(1), 'search_import')
  const ids = store.recordIds(ALL)
  store.decide(ids[0], { decision: 'include', comment: 'key paper, "mouse" model' }, alice)
  store.decide(ids[1], { decision: 'exclude', reasonId: store.exclusionReasons()[5].id }, alice)
})
afterEach(() => {
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('exports', () => {
  it('CSV has one row per record, with quoting for commas and quotes', () => {
    const csv = recordsToCsv(store, ALL)
    expect(csv.startsWith('﻿record_id,pmid,')).toBe(true)
    const lines = csv.trim().split('\r\n')
    expect(lines[0].split(',')).toContain('exclusion_reason')
    expect(csv).toContain('"key paper, ""mouse"" model"')
    expect(csv).toContain('Not primary research')
    expect(csv).toContain('https://pubmed.ncbi.nlm.nih.gov/33385560/')
  })

  it('CSV follows the filter', () => {
    const csv = recordsToCsv(store, { ...ALL, decision: 'include' })
    expect(csv).toContain('33385560')
    expect(csv).not.toContain('38108521')
  })

  it('RIS has one entry per record with standard tags', () => {
    const ris = recordsToRis(store, ALL)
    expect(ris.match(/^TY {2}- JOUR$/gm)).toHaveLength(4)
    expect(ris.match(/^ER {2}- $/gm)).toHaveLength(4)
    expect(ris).toContain('DO  - 10.1016/j.neuroimage.2020.117707')
    expect(ris).toContain('AN  - PMID:33385560')
    expect(ris).toMatch(/N1 {2}- Literature Screener title\/abstract decision: include by Alice/)
  })

  it('PRISMA summary counts identification, duplicates and decisions', () => {
    const text = prismaSummary(store)
    expect(text).toContain('Records identified from database searches (PubMed): 6')
    expect(text).toContain('Duplicate records removed: 2')
    expect(text).toContain('Records screened: 2')
    expect(text).toContain('Excluded: 1')
    expect(text).toContain('- Not primary research: 1')
    expect(text).toContain('query: q1')
  })
})
