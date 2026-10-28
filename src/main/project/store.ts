// A project is a folder:  <name>/project.db  +  files/  +  exports/
// ProjectStore owns the database connection and all reads/writes.
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type {
  Decision,
  DecisionEntry,
  DecisionFilter,
  OriginFilter,
  ProjectOverview,
  PubMedRecord,
  RecordDetail,
  RecordOrigin,
  RecordPage,
  RecordQuery,
  RecordSummary,
  SearchFilters,
  SearchLogEntry,
  SearchMode,
  SearchStatus,
  SystemTag
} from '../../shared/types'
import { APP_ID, MIGRATIONS, SCHEMA_VERSION } from './schema'
import { deriveSystemTags } from '../tagging'

export const DB_FILE = 'project.db'
const STAGE = 'title_abstract'

type Row = Record<string, any>

export interface Reviewer {
  id: string
  name: string
}

export interface NewSearch {
  source: string
  mode: SearchMode
  filters: SearchFilters
  querySent: string
  queryTranslation: string | null
  totalCount: number | null
  status: SearchStatus
}

const README = `This folder is a Literature Screener project.

project.db  - all records, searches and screening decisions (SQLite database)
files/      - full texts and supplementary files
exports/    - exported results

To move or back up the project, close it in Literature Screener first, then copy
the whole folder. Avoid keeping it in a folder that Dropbox, OneDrive, iCloud or
Google Drive is actively syncing while the app is open.
`

const now = () => new Date().toISOString()

function safeFolderName(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim()
}

export function isProjectFolder(dir: string): boolean {
  return existsSync(join(dir, DB_FILE))
}

export class ProjectStore {
  private constructor(
    readonly path: string,
    private readonly db: DatabaseSync
  ) {}

  static create(
    parentDir: string,
    info: { name: string; researchQuestion: string; inclusionCriteria: string; exclusionCriteria: string },
    reviewer: Reviewer
  ): ProjectStore {
    const name = info.name.trim()
    if (!name) throw new Error('Please give the project a name.')
    const dir = join(parentDir, safeFolderName(name))
    if (existsSync(dir) && readdirSync(dir).length > 0) {
      throw new Error(`A folder named "${basename(dir)}" already exists there and is not empty.`)
    }
    mkdirSync(join(dir, 'files'), { recursive: true })
    mkdirSync(join(dir, 'exports'), { recursive: true })
    writeFileSync(join(dir, 'README.txt'), README)

    const store = new ProjectStore(dir, openDb(join(dir, DB_FILE)))
    store.migrate()
    store.tx(() => {
      const t = now()
      store.setMeta('app', APP_ID)
      store.setMeta('project_id', randomUUID())
      store.db.prepare('INSERT INTO project (id, name, research_question, created_at) VALUES (1, ?, ?, ?)')
        .run(name, info.researchQuestion.trim(), t)
      store.ensureReviewer(reviewer)
      store.db.prepare(
        'INSERT INTO criteria_versions (version, inclusion, exclusion, created_at, reviewer_id) VALUES (1, ?, ?, ?, ?)'
      ).run(info.inclusionCriteria.trim(), info.exclusionCriteria.trim(), t, reviewer.id)
    })
    return store
  }

  static open(dir: string): ProjectStore {
    if (!isProjectFolder(dir)) {
      throw new Error('This folder is not a Literature Screener project (no project.db found).')
    }
    const store = new ProjectStore(dir, openDb(join(dir, DB_FILE)))
    try {
      store.migrate()
      if (store.getMeta('app') !== APP_ID) throw new Error('This project.db was not created by Literature Screener.')
    } catch (e) {
      store.close()
      throw e
    }
    return store
  }

  close() {
    if (this.db.isOpen) this.db.close()
  }

  // ---------- internals ----------

  private migrate() {
    const current = Number((this.db.prepare('PRAGMA user_version').get() as Row).user_version)
    if (current > SCHEMA_VERSION) {
      throw new Error('This project was created by a newer version of Literature Screener. Please update the app.')
    }
    for (let v = current; v < SCHEMA_VERSION; v++) {
      this.tx(() => {
        this.db.exec(MIGRATIONS[v])
        this.db.exec(`PRAGMA user_version = ${v + 1}`)
      })
    }
  }

  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN')
    try {
      const result = fn()
      this.db.exec('COMMIT')
      return result
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }

  private setMeta(key: string, value: string) {
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value)
  }

  private getMeta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as Row | undefined
    return row ? String(row.value) : null
  }

  private currentCriteria(): Row {
    return this.db.prepare('SELECT * FROM criteria_versions ORDER BY version DESC LIMIT 1').get() as Row
  }

  // ---------- reviewers ----------

  ensureReviewer(r: Reviewer) {
    this.db.prepare(
      'INSERT INTO reviewers (id, name, first_seen_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name'
    ).run(r.id, r.name, now())
  }

  // ---------- overview ----------

  overview(): Omit<ProjectOverview, 'cloudWarning'> {
    const p = this.db.prepare('SELECT * FROM project WHERE id = 1').get() as Row
    const c = this.currentCriteria()
    const recordCount = Number((this.db.prepare('SELECT COUNT(*) AS n FROM records').get() as Row).n)
    const searchCount = Number((this.db.prepare('SELECT COUNT(*) AS n FROM searches').get() as Row).n)
    const counts: Record<Decision, number> = { include: 0, exclude: 0, unsure: 0 }
    const rows = this.db.prepare(
      `SELECT decision, COUNT(*) AS n FROM (${LATEST_DECISION_SQL}) GROUP BY decision`
    ).all() as Row[]
    for (const r of rows) counts[r.decision as Decision] = Number(r.n)
    return {
      path: this.path,
      name: p.name,
      researchQuestion: p.research_question,
      inclusionCriteria: c.inclusion,
      exclusionCriteria: c.exclusion,
      criteriaVersion: Number(c.version),
      createdAt: p.created_at,
      recordCount,
      counts,
      searchCount
    }
  }

  // ---------- searches & records ----------

  insertSearch(s: NewSearch, reviewer: Reviewer): number {
    this.ensureReviewer(reviewer)
    const res = this.db.prepare(
      `INSERT INTO searches (source, mode, filters_json, query_sent, query_translation, total_count, status, run_at, reviewer_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(s.source, s.mode, JSON.stringify(s.filters), s.querySent, s.queryTranslation, s.totalCount, s.status, now(), reviewer.id)
    return Number(res.lastInsertRowid)
  }

  finishSearch(id: number, status: SearchStatus, missingPmids: string[], message: string) {
    this.db.prepare('UPDATE searches SET status = ?, missing_json = ?, message = ?, completed_at = ? WHERE id = ?')
      .run(status, JSON.stringify(missingPmids), message, now(), id)
  }

  /**
   * Adds records to the project, linked to the search that found them.
   * Records already in the project (same PMID) are not duplicated or overwritten;
   * the link to this search is still recorded.
   */
  addRecords(
    searchId: number,
    records: PubMedRecord[],
    how: 'search_import' | 'hand_picked',
    positions?: Map<string, number>
  ): { newCount: number; duplicateCount: number } {
    const findByPmid = this.db.prepare('SELECT id FROM records WHERE pmid = ?')
    const insertRecord = this.db.prepare(
      `INSERT INTO records (source, pmid, doi, pmcid, title, abstract, authors_json, journal, journal_abbrev,
         pub_year, pub_date, publication_types_json, mesh_json, keywords_json, languages_json, raw_xml, retrieved_at)
       VALUES ('pubmed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const insertTag = this.db.prepare(
      'INSERT OR IGNORE INTO system_tags (record_id, system, source, evidence, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    const linkExists = this.db.prepare('SELECT 1 FROM search_records WHERE search_id = ? AND record_id = ?')
    const link = this.db.prepare(
      'INSERT INTO search_records (search_id, record_id, position, how, was_new, added_at) VALUES (?, ?, ?, ?, ?, ?)'
    )

    return this.tx(() => {
      let newCount = 0
      let duplicateCount = 0
      for (const r of records) {
        const t = now()
        const existing = findByPmid.get(r.pmid) as Row | undefined
        let recordId: number
        if (existing) {
          recordId = Number(existing.id)
          if (linkExists.get(searchId, recordId)) continue
          duplicateCount++
        } else {
          recordId = Number(
            insertRecord.run(
              r.pmid, r.doi, r.pmcid, r.title, r.abstract, JSON.stringify(r.authors), r.journal, r.journalAbbrev,
              r.pubYear, r.pubDate, JSON.stringify(r.publicationTypes), JSON.stringify(r.mesh),
              JSON.stringify(r.keywords), JSON.stringify(r.languages), r.rawXml, t
            ).lastInsertRowid
          )
          for (const tag of deriveSystemTags(r)) insertTag.run(recordId, tag.system, tag.source, tag.evidence, t)
          newCount++
        }
        link.run(searchId, recordId, positions?.get(r.pmid) ?? null, how, existing ? 0 : 1, t)
      }
      this.db.prepare(
        `UPDATE searches SET retrieved_count = retrieved_count + ?, new_count = new_count + ?,
           duplicate_count = duplicate_count + ? WHERE id = ?`
      ).run(newCount + duplicateCount, newCount, duplicateCount, searchId)
      return { newCount, duplicateCount }
    })
  }

  existingPmids(pmids: string[]): Set<string> {
    const stmt = this.db.prepare('SELECT 1 FROM records WHERE pmid = ?')
    return new Set(pmids.filter((p) => stmt.get(p)))
  }

  listSearches(): SearchLogEntry[] {
    const rows = this.db.prepare(
      `SELECT s.*, rv.name AS reviewer_name FROM searches s
       LEFT JOIN reviewers rv ON rv.id = s.reviewer_id ORDER BY s.id DESC`
    ).all() as Row[]
    return rows.map((s) => ({
      id: Number(s.id),
      source: s.source,
      mode: s.mode,
      filters: JSON.parse(s.filters_json),
      querySent: s.query_sent,
      queryTranslation: s.query_translation,
      totalCount: s.total_count == null ? null : Number(s.total_count),
      retrievedCount: Number(s.retrieved_count),
      newCount: Number(s.new_count),
      duplicateCount: Number(s.duplicate_count),
      missingPmids: JSON.parse(s.missing_json),
      status: s.status,
      message: s.message,
      runAt: s.run_at,
      completedAt: s.completed_at,
      reviewerName: s.reviewer_name
    }))
  }

  // ---------- listing & screening ----------

  private filteredRecordsSql(decision: DecisionFilter, origin: OriginFilter, text: string) {
    const where: string[] = []
    const params: (string | number)[] = []
    if (decision === 'undecided') where.push('decision IS NULL')
    else if (decision !== 'all') {
      where.push('decision = ?')
      params.push(decision)
    }
    if (origin === 'structured') where.push('structured = 1')
    if (origin === 'hand_picked') where.push('hand_picked = 1')
    const inner: string[] = []
    if (text.trim()) {
      inner.push('(r.title LIKE ? OR r.abstract LIKE ? OR r.pmid = ?)')
      const like = `%${text.trim()}%`
      params.unshift(like, like, text.trim())
    }
    const sql = `SELECT * FROM (
        SELECT r.id, r.pmid, r.title, r.journal, r.pub_year,
          (SELECT d.decision FROM decisions d WHERE d.record_id = r.id AND d.stage = '${STAGE}'
             ORDER BY d.id DESC LIMIT 1) AS decision,
          EXISTS (SELECT 1 FROM search_records sr WHERE sr.record_id = r.id AND sr.how = 'search_import') AS structured,
          EXISTS (SELECT 1 FROM search_records sr WHERE sr.record_id = r.id AND sr.how = 'hand_picked') AS hand_picked,
          (SELECT group_concat(DISTINCT t.system) FROM system_tags t WHERE t.record_id = r.id) AS systems
        FROM records r ${inner.length ? `WHERE ${inner.join(' AND ')}` : ''}
      ) ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`
    return { sql, params }
  }

  listRecords(q: RecordQuery): RecordPage {
    const { sql, params } = this.filteredRecordsSql(q.decision, q.origin, q.text)
    const total = Number((this.db.prepare(`SELECT COUNT(*) AS n FROM (${sql})`).get(...params) as Row).n)
    const rows = this.db.prepare(`${sql} ORDER BY id LIMIT ? OFFSET ?`).all(...params, q.limit, q.offset) as Row[]
    const items: RecordSummary[] = rows.map((r) => ({
      id: Number(r.id),
      pmid: r.pmid,
      title: r.title,
      journal: r.journal,
      pubYear: r.pub_year == null ? null : Number(r.pub_year),
      decision: r.decision ?? null,
      structured: Number(r.structured) === 1,
      handPicked: Number(r.hand_picked) === 1,
      systems: r.systems ? String(r.systems).split(',') : []
    }))
    return { total, offset: q.offset, items }
  }

  screeningQueue(decision: DecisionFilter, origin: OriginFilter): number[] {
    const { sql, params } = this.filteredRecordsSql(decision, origin, '')
    return (this.db.prepare(`SELECT id FROM (${sql}) ORDER BY id`).all(...params) as Row[]).map((r) => Number(r.id))
  }

  getRecord(id: number): RecordDetail {
    const r = this.db.prepare('SELECT * FROM records WHERE id = ?').get(id) as Row | undefined
    if (!r) throw new Error(`Record ${id} not found in this project.`)

    const tags: SystemTag[] = (
      this.db.prepare('SELECT system, source, evidence FROM system_tags WHERE record_id = ? ORDER BY system, source').all(id) as Row[]
    ).map((t) => ({ system: t.system, source: t.source, evidence: t.evidence }))

    const origins: RecordOrigin[] = (
      this.db.prepare(
        `SELECT sr.search_id, s.mode, sr.how, sr.added_at FROM search_records sr
         JOIN searches s ON s.id = sr.search_id WHERE sr.record_id = ? ORDER BY sr.added_at`
      ).all(id) as Row[]
    ).map((o) => ({ searchId: Number(o.search_id), mode: o.mode, how: o.how, addedAt: o.added_at }))

    const history: DecisionEntry[] = (
      this.db.prepare(
        `SELECT d.id, d.decision, d.stage, d.decided_at, rv.name AS reviewer_name, cv.version AS criteria_version
         FROM decisions d JOIN reviewers rv ON rv.id = d.reviewer_id
         LEFT JOIN criteria_versions cv ON cv.id = d.criteria_version_id
         WHERE d.record_id = ? ORDER BY d.id DESC`
      ).all(id) as Row[]
    ).map((d) => ({
      id: Number(d.id),
      decision: d.decision,
      stage: d.stage,
      reviewerName: d.reviewer_name,
      decidedAt: d.decided_at,
      criteriaVersion: d.criteria_version == null ? null : Number(d.criteria_version)
    }))

    return {
      id: Number(r.id),
      source: r.source,
      pmid: r.pmid,
      doi: r.doi,
      pmcid: r.pmcid,
      title: r.title,
      abstract: r.abstract,
      authors: JSON.parse(r.authors_json),
      journal: r.journal,
      pubYear: r.pub_year == null ? null : Number(r.pub_year),
      pubDate: r.pub_date,
      publicationTypes: JSON.parse(r.publication_types_json),
      mesh: JSON.parse(r.mesh_json),
      keywords: JSON.parse(r.keywords_json),
      languages: JSON.parse(r.languages_json),
      retrievedAt: r.retrieved_at,
      tags,
      origins,
      history,
      current: history.find((h) => h.stage === STAGE)?.decision ?? null
    }
  }

  /** Records a human decision. Earlier decisions are kept as history. */
  decide(recordId: number, decision: Decision, reviewer: Reviewer): RecordDetail {
    this.tx(() => {
      this.ensureReviewer(reviewer)
      this.db.prepare(
        `INSERT INTO decisions (record_id, stage, decision, reviewer_id, criteria_version_id, decided_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(recordId, STAGE, decision, reviewer.id, Number(this.currentCriteria().id), now())
    })
    return this.getRecord(recordId)
  }

  // ---------- backup ----------

  /** Writes a consistent copy of the project into a new folder inside destParent. */
  backupTo(destParent: string): string {
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '')
    const dest = join(destParent, `${basename(this.path)} backup ${stamp}`)
    if (existsSync(dest)) throw new Error(`A backup folder named "${basename(dest)}" already exists.`)
    mkdirSync(dest, { recursive: true })
    this.db.prepare('VACUUM INTO ?').run(join(dest, DB_FILE))
    for (const sub of ['files', 'exports']) {
      const src = join(this.path, sub)
      if (existsSync(src)) cpSync(src, join(dest, sub), { recursive: true })
      else mkdirSync(join(dest, sub))
    }
    writeFileSync(join(dest, 'README.txt'), README)
    return dest
  }
}

/** The latest title/abstract decision for each record. */
const LATEST_DECISION_SQL = `
  SELECT d.record_id, d.decision FROM decisions d
  WHERE d.stage = '${STAGE}'
    AND d.id = (SELECT MAX(d2.id) FROM decisions d2 WHERE d2.record_id = d.record_id AND d2.stage = d.stage)`

function openDb(file: string): DatabaseSync {
  const db = new DatabaseSync(file)
  // Rollback journal (not WAL) keeps the project a single file between writes,
  // which is safer when people copy project folders around.
  db.exec('PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;')
  return db
}
