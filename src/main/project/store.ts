// A project is a folder:  <name>/project.db  +  files/  +  exports/
// ProjectStore owns the database connection and all reads/writes.
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type {
  Collection,
  Decision,
  DecisionEntry,
  DecisionInput,
  ExclusionReason,
  ProjectOverview,
  PublicationNotice,
  PubMedRecord,
  RecordAlert,
  RecordDetail,
  RecordFilter,
  RecordNote,
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
import { APP_ID, DEFAULT_EXCLUSION_REASONS, MIGRATIONS, SCHEMA_VERSION } from './schema'
import { TAGGING_VERSION, deriveSystemTags } from '../tagging'
import { parseNotices } from '../sources/pubmed/parse'

export const DB_FILE = 'project.db'
const STAGE = 'title_abstract'

type Row = Record<string, any>

export interface Reviewer {
  id: string
  name: string
}

export interface NewSearch {
  /** Set for automatic update runs of an earlier search. */
  parentSearchId?: number | null
  source: string
  mode: SearchMode
  filters: SearchFilters
  querySent: string
  queryTranslation: string | null
  totalCount: number | null
  status: SearchStatus
}

export interface ScheduledSearch {
  searchId: number
  intervalDays: number
  dueAt: string
  lastRunAt: string | null
  querySent: string
  filters: SearchFilters
}

const DAY_MS = 24 * 60 * 60 * 1000

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
      store.seedExclusionReasons()
      store.setMeta('tagging_version', String(TAGGING_VERSION))
      store.setMeta('notices_backfilled', '1')
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
      store.seedExclusionReasons()
      store.refreshAutomaticTags()
      store.backfillImportAlerts()
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

  /**
   * Automatic tags are derived from the stored record, so they can be recomputed
   * when the presets improve. Researcher corrections and AI tags are untouched.
   */
  private refreshAutomaticTags() {
    if (Number(this.getMeta('tagging_version') ?? 1) >= TAGGING_VERSION) return
    const rows = this.db.prepare('SELECT id, title, abstract, mesh_json FROM records').all() as Row[]
    const insert = this.db.prepare(
      'INSERT INTO system_tags (record_id, system, source, evidence, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    this.tx(() => {
      this.db.exec("DELETE FROM system_tags WHERE source IN ('pubmed_mesh', 'keyword_match')")
      const t = now()
      for (const r of rows) {
        const tags = deriveSystemTags({ title: r.title, abstract: r.abstract, mesh: JSON.parse(r.mesh_json) })
        for (const tag of tags) insert.run(r.id, tag.system, tag.source, tag.evidence, t)
      }
      this.setMeta('tagging_version', String(TAGGING_VERSION))
    })
  }

  /** Projects created before alerts existed: read notices from the stored original XML once. */
  private backfillImportAlerts() {
    if (this.getMeta('notices_backfilled') === '1') return
    const rows = this.db.prepare('SELECT id, raw_xml, retrieved_at FROM records').all() as Row[]
    this.tx(() => {
      for (const r of rows) this.addAlerts(Number(r.id), parseNotices(r.raw_xml), 'import', r.retrieved_at)
      this.setMeta('notices_backfilled', '1')
    })
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
      `INSERT INTO searches (source, mode, filters_json, query_sent, query_translation, total_count, status, run_at, reviewer_id, parent_search_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(s.source, s.mode, JSON.stringify(s.filters), s.querySent, s.queryTranslation, s.totalCount, s.status, now(), reviewer.id, s.parentSearchId ?? null)
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
          this.addAlerts(recordId, r.notices, 'import', t)
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
      `SELECT s.*, rv.name AS reviewer_name, sc.interval_days, sc.created_at AS schedule_created_at,
         sc.last_run_at, sc.last_success_at, sc.last_message
       FROM searches s
       LEFT JOIN reviewers rv ON rv.id = s.reviewer_id
       LEFT JOIN search_schedules sc ON sc.search_id = s.id
       ORDER BY s.id DESC`
    ).all() as Row[]
    return rows.map((s) => ({
      id: Number(s.id),
      parentSearchId: s.parent_search_id == null ? null : Number(s.parent_search_id),
      schedule:
        s.interval_days == null
          ? null
          : {
              intervalDays: Number(s.interval_days),
              nextDueAt: dueAt(s.last_success_at ?? s.schedule_created_at, Number(s.interval_days)),
              lastRunAt: s.last_run_at,
              lastMessage: s.last_message
            },
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

  private filteredRecordsSql(f: RecordFilter) {
    const inner: string[] = []
    const innerParams: (string | number)[] = []
    if (f.text.trim()) {
      inner.push('(r.title LIKE ? OR r.abstract LIKE ? OR r.pmid = ? OR r.doi = ?)')
      const like = `%${f.text.trim()}%`
      innerParams.push(like, like, f.text.trim(), f.text.trim())
    }
    if (f.systems.length) {
      const one = 'EXISTS (SELECT 1 FROM record_systems rs WHERE rs.record_id = r.id AND rs.system = ?)'
      inner.push(`(${f.systems.map(() => one).join(f.systemsMode === 'all' ? ' AND ' : ' OR ')})`)
      innerParams.push(...f.systems)
    }
    if (f.collectionId != null) {
      inner.push('EXISTS (SELECT 1 FROM collection_records cr WHERE cr.record_id = r.id AND cr.collection_id = ?)')
      innerParams.push(f.collectionId)
    }

    const where: string[] = []
    const params: (string | number)[] = []
    if (f.decision === 'undecided') where.push('decision IS NULL')
    else if (f.decision !== 'all') {
      where.push('decision = ?')
      params.push(f.decision)
    }
    if (f.origin === 'structured') where.push('structured = 1')
    if (f.origin === 'hand_picked') where.push('hand_picked = 1')
    if (f.origin === 'update') where.push('from_update = 1')

    const sql = `SELECT * FROM (
        SELECT r.id, r.pmid, r.title, r.journal, r.pub_year,
          (SELECT d.decision FROM decisions d WHERE d.record_id = r.id AND d.stage = '${STAGE}'
             ORDER BY d.id DESC LIMIT 1) AS decision,
          EXISTS (SELECT 1 FROM search_records sr WHERE sr.record_id = r.id AND sr.how = 'search_import') AS structured,
          EXISTS (SELECT 1 FROM search_records sr WHERE sr.record_id = r.id AND sr.how = 'hand_picked') AS hand_picked,
          EXISTS (SELECT 1 FROM search_records sr JOIN searches s ON s.id = sr.search_id
                  WHERE sr.record_id = r.id AND sr.was_new = 1 AND s.parent_search_id IS NOT NULL) AS from_update,
          (SELECT group_concat(rs.system) FROM record_systems rs WHERE rs.record_id = r.id) AS systems
        FROM records r ${inner.length ? `WHERE ${inner.join(' AND ')}` : ''}
      ) ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`
    return { sql, params: [...innerParams, ...params] }
  }

  listRecords(q: RecordQuery): RecordPage {
    const { sql, params } = this.filteredRecordsSql(q)
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

  /** Ids of all records matching a filter, in import order. */
  recordIds(f: RecordFilter): number[] {
    const { sql, params } = this.filteredRecordsSql(f)
    return (this.db.prepare(`SELECT id FROM (${sql}) ORDER BY id`).all(...params) as Row[]).map((r) => Number(r.id))
  }

  getRecord(id: number): RecordDetail {
    const r = this.db.prepare('SELECT * FROM records WHERE id = ?').get(id) as Row | undefined
    if (!r) throw new Error(`Record ${id} not found in this project.`)

    const tags: SystemTag[] = (
      this.db.prepare(
        'SELECT system, source, evidence, present FROM system_tags WHERE record_id = ? ORDER BY system, source'
      ).all(id) as Row[]
    ).map((t) => ({ system: t.system, source: t.source, evidence: t.evidence, present: Number(t.present) === 1 }))

    const systems = (
      this.db.prepare('SELECT system FROM record_systems WHERE record_id = ? ORDER BY system').all(id) as Row[]
    ).map((s) => String(s.system))

    const notes: RecordNote[] = (
      this.db.prepare(
        `SELECT n.id, n.text, n.created_at, rv.name AS reviewer_name FROM record_notes n
         JOIN reviewers rv ON rv.id = n.reviewer_id WHERE n.record_id = ? ORDER BY n.id DESC`
      ).all(id) as Row[]
    ).map((n) => ({ id: Number(n.id), text: n.text, reviewerName: n.reviewer_name, createdAt: n.created_at }))

    const alerts: RecordAlert[] = (
      this.db.prepare('SELECT kind, notice_pmid, found_by, detected_at FROM record_alerts WHERE record_id = ? ORDER BY id').all(id) as Row[]
    ).map((a) => ({ kind: a.kind, noticePmid: a.notice_pmid || null, foundBy: a.found_by, detectedAt: a.detected_at }))

    const collectionIds = (
      this.db.prepare('SELECT collection_id FROM collection_records WHERE record_id = ?').all(id) as Row[]
    ).map((c) => Number(c.collection_id))

    const origins: RecordOrigin[] = (
      this.db.prepare(
        `SELECT sr.search_id, s.mode, sr.how, sr.added_at FROM search_records sr
         JOIN searches s ON s.id = sr.search_id WHERE sr.record_id = ? ORDER BY sr.added_at`
      ).all(id) as Row[]
    ).map((o) => ({ searchId: Number(o.search_id), mode: o.mode, how: o.how, addedAt: o.added_at }))

    const history: DecisionEntry[] = (
      this.db.prepare(
        `SELECT d.id, d.decision, d.stage, d.decided_at, d.reason_text, d.note, rv.name AS reviewer_name,
           cv.version AS criteria_version
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
      criteriaVersion: d.criteria_version == null ? null : Number(d.criteria_version),
      reasonText: d.reason_text ?? null,
      comment: d.note ?? null
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
      systems,
      notes,
      alerts,
      collectionIds,
      origins,
      history,
      current: history.find((h) => h.stage === STAGE)?.decision ?? null
    }
  }

  /** Records a human decision. Earlier decisions are kept as history. */
  decide(recordId: number, input: DecisionInput, reviewer: Reviewer): RecordDetail {
    let reasonId: number | null = null
    let reasonText: string | null = null
    if (input.reasonId != null) {
      if (input.decision !== 'exclude') throw new Error('Exclusion reasons can only be given for exclusions.')
      const reason = this.db.prepare('SELECT label FROM exclusion_reasons WHERE id = ?').get(input.reasonId) as Row | undefined
      if (!reason) throw new Error('That exclusion reason no longer exists.')
      reasonId = input.reasonId
      reasonText = reason.label
    }
    const comment = input.comment?.trim() || null
    this.tx(() => {
      this.ensureReviewer(reviewer)
      this.db.prepare(
        `INSERT INTO decisions (record_id, stage, decision, reviewer_id, criteria_version_id, reason_id, reason_text, note, decided_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(recordId, STAGE, input.decision, reviewer.id, Number(this.currentCriteria().id), reasonId, reasonText, comment, now())
    })
    return this.getRecord(recordId)
  }

  // ---------- criteria & exclusion reasons ----------

  /** Saves edited criteria as a new version; earlier decisions keep pointing at their version. */
  updateCriteria(inclusion: string, exclusion: string, reviewer: Reviewer) {
    const c = this.currentCriteria()
    if (c.inclusion === inclusion.trim() && c.exclusion === exclusion.trim()) return
    this.tx(() => {
      this.ensureReviewer(reviewer)
      this.db.prepare(
        'INSERT INTO criteria_versions (version, inclusion, exclusion, created_at, reviewer_id) VALUES (?, ?, ?, ?, ?)'
      ).run(Number(c.version) + 1, inclusion.trim(), exclusion.trim(), now(), reviewer.id)
    })
  }

  private seedExclusionReasons() {
    const n = Number((this.db.prepare('SELECT COUNT(*) AS n FROM exclusion_reasons').get() as Row).n)
    if (n > 0) return
    const insert = this.db.prepare('INSERT INTO exclusion_reasons (label, created_at, sort_order) VALUES (?, ?, ?)')
    DEFAULT_EXCLUSION_REASONS.forEach((label, i) => insert.run(label, now(), i))
  }

  exclusionReasons(): ExclusionReason[] {
    return (this.db.prepare('SELECT * FROM exclusion_reasons ORDER BY sort_order, id').all() as Row[]).map((r) => ({
      id: Number(r.id),
      label: r.label,
      retired: r.retired_at != null
    }))
  }

  addExclusionReason(label: string) {
    if (!label.trim()) throw new Error('The reason cannot be empty.')
    const max = Number((this.db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM exclusion_reasons').get() as Row).m)
    this.db.prepare('INSERT INTO exclusion_reasons (label, created_at, sort_order) VALUES (?, ?, ?)').run(label.trim(), now(), max + 1)
  }

  /** Past decisions keep the wording they were made with. */
  renameExclusionReason(id: number, label: string) {
    if (!label.trim()) throw new Error('The reason cannot be empty.')
    this.db.prepare('UPDATE exclusion_reasons SET label = ? WHERE id = ?').run(label.trim(), id)
  }

  /** Retired reasons stay in past decisions but are no longer offered. */
  setExclusionReasonRetired(id: number, retired: boolean) {
    this.db.prepare('UPDATE exclusion_reasons SET retired_at = ? WHERE id = ?').run(retired ? now() : null, id)
  }

  // ---------- notes, tags, collections ----------

  addNote(recordId: number, text: string, reviewer: Reviewer) {
    if (!text.trim()) return
    this.ensureReviewer(reviewer)
    this.db.prepare('INSERT INTO record_notes (record_id, reviewer_id, text, created_at) VALUES (?, ?, ?, ?)')
      .run(recordId, reviewer.id, text.trim(), now())
  }

  /**
   * A researcher's correction of an organism/system classification:
   * true = applies, false = does not apply, null = remove the correction.
   */
  setManualTag(recordId: number, system: string, present: boolean | null, reviewer: Reviewer) {
    this.tx(() => {
      this.db.prepare("DELETE FROM system_tags WHERE record_id = ? AND system = ? AND source = 'manual'").run(recordId, system)
      if (present === null) return
      this.ensureReviewer(reviewer)
      this.db.prepare(
        "INSERT INTO system_tags (record_id, system, source, evidence, created_at, reviewer_id, present) VALUES (?, ?, 'manual', NULL, ?, ?, ?)"
      ).run(recordId, system, now(), reviewer.id, present ? 1 : 0)
    })
  }

  collections(): Collection[] {
    return (
      this.db.prepare(
        `SELECT c.id, c.name, (SELECT COUNT(*) FROM collection_records cr WHERE cr.collection_id = c.id) AS n
         FROM collections c ORDER BY c.name COLLATE NOCASE`
      ).all() as Row[]
    ).map((c) => ({ id: Number(c.id), name: c.name, count: Number(c.n) }))
  }

  createCollection(name: string): number {
    if (!name.trim()) throw new Error('Please give the collection a name.')
    if (this.db.prepare('SELECT 1 FROM collections WHERE name = ?').get(name.trim())) {
      throw new Error(`A collection named "${name.trim()}" already exists.`)
    }
    return Number(this.db.prepare('INSERT INTO collections (name, created_at) VALUES (?, ?)').run(name.trim(), now()).lastInsertRowid)
  }

  /** Deletes only the grouping; the records stay in the project. */
  deleteCollection(id: number) {
    this.db.prepare('DELETE FROM collections WHERE id = ?').run(id)
  }

  setInCollection(collectionId: number, recordIds: number[], inCollection: boolean) {
    const add = this.db.prepare('INSERT OR IGNORE INTO collection_records (collection_id, record_id, added_at) VALUES (?, ?, ?)')
    const remove = this.db.prepare('DELETE FROM collection_records WHERE collection_id = ? AND record_id = ?')
    this.tx(() => {
      for (const id of recordIds) {
        if (inCollection) add.run(collectionId, id, now())
        else remove.run(collectionId, id)
      }
    })
  }

  // ---------- automatic updates & alerts ----------

  /** Keep an import-all search up to date every `intervalDays`; null stops it. */
  setSchedule(searchId: number, intervalDays: number | null) {
    const s = this.db.prepare('SELECT mode, parent_search_id FROM searches WHERE id = ?').get(searchId) as Row | undefined
    if (!s) throw new Error(`Search #${searchId} not found.`)
    if (s.mode !== 'structured' || s.parent_search_id != null) {
      throw new Error('Only original "Import all" searches can be kept up to date.')
    }
    if (intervalDays === null) {
      this.db.prepare('DELETE FROM search_schedules WHERE search_id = ?').run(searchId)
      return
    }
    if (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 365) {
      throw new Error('Choose an interval between 1 and 365 days.')
    }
    this.db.prepare(
      `INSERT INTO search_schedules (search_id, interval_days, created_at) VALUES (?, ?, ?)
       ON CONFLICT(search_id) DO UPDATE SET interval_days = excluded.interval_days`
    ).run(searchId, intervalDays, now())
  }

  scheduledSearches(): ScheduledSearch[] {
    return (
      this.db.prepare(
        `SELECT sc.*, s.query_sent, s.filters_json FROM search_schedules sc JOIN searches s ON s.id = sc.search_id ORDER BY sc.search_id`
      ).all() as Row[]
    ).map((r) => ({
      searchId: Number(r.search_id),
      intervalDays: Number(r.interval_days),
      dueAt: dueAt(r.last_success_at ?? r.created_at, Number(r.interval_days)),
      lastRunAt: r.last_run_at,
      querySent: r.query_sent,
      filters: JSON.parse(r.filters_json)
    }))
  }

  markScheduleRun(searchId: number, success: boolean, message: string) {
    const t = now()
    this.db.prepare(
      `UPDATE search_schedules SET last_run_at = ?, last_message = ?,
         last_success_at = CASE WHEN ? THEN ? ELSE last_success_at END WHERE search_id = ?`
    ).run(t, message, success ? 1 : 0, t, searchId)
  }

  /** Records whose latest decision is include or unsure: these are re-checked for new notices. */
  recordsToRecheck(): { id: number; pmid: string }[] {
    return (
      this.db.prepare(
        `SELECT r.id, r.pmid FROM records r JOIN (${LATEST_DECISION_SQL}) d ON d.record_id = r.id
         WHERE d.decision IN ('include', 'unsure') AND r.pmid IS NOT NULL`
      ).all() as Row[]
    ).map((r) => ({ id: Number(r.id), pmid: String(r.pmid) }))
  }

  /** Stores notices not seen before; returns how many were new. */
  addAlerts(recordId: number, notices: PublicationNotice[], foundBy: 'import' | 'recheck', at = now()): number {
    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO record_alerts (record_id, kind, notice_pmid, found_by, detected_at) VALUES (?, ?, ?, ?, ?)'
    )
    const known = this.db.prepare('SELECT 1 FROM record_alerts WHERE record_id = ? AND kind = ?')
    let added = 0
    for (const n of notices) {
      // A retraction without a notice PMID duplicates one we already know about.
      if (!n.noticePmid && known.get(recordId, n.kind)) continue
      added += Number(insert.run(recordId, n.kind, n.noticePmid ?? '', foundBy, at).changes)
    }
    return added
  }

  // ---------- export ----------

  /** The latest decision row for each record (title/abstract stage), with reviewer name. */
  latestDecisions(): Map<number, Row> {
    const rows = this.db.prepare(
      `SELECT d.*, rv.name AS reviewer_name FROM decisions d JOIN reviewers rv ON rv.id = d.reviewer_id
       WHERE d.stage = '${STAGE}' AND d.id = (SELECT MAX(d2.id) FROM decisions d2 WHERE d2.record_id = d.record_id AND d2.stage = d.stage)`
    ).all() as Row[]
    return new Map(rows.map((r) => [Number(r.record_id), r]))
  }

  /** Counts for a PRISMA-style flow of the title/abstract stage. */
  prismaCounts() {
    const one = (sql: string) => Number((this.db.prepare(sql).get() as Row).n)
    return {
      identifiedFromSearches: one(
        "SELECT COUNT(*) AS n FROM search_records sr JOIN searches s ON s.id = sr.search_id WHERE s.mode = 'structured'"
      ),
      uniqueFromSearches: one("SELECT COUNT(DISTINCT record_id) AS n FROM search_records WHERE how = 'search_import'"),
      handPickedOnly: one(
        `SELECT COUNT(*) AS n FROM records r WHERE NOT EXISTS
           (SELECT 1 FROM search_records sr WHERE sr.record_id = r.id AND sr.how = 'search_import')`
      ),
      recordCount: one('SELECT COUNT(*) AS n FROM records')
    }
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

function dueAt(fromIso: string, intervalDays: number): string {
  return new Date(new Date(fromIso).getTime() + intervalDays * DAY_MS).toISOString()
}

function openDb(file: string): DatabaseSync {
  const db = new DatabaseSync(file)
  // Rollback journal (not WAL) keeps the project a single file between writes,
  // which is safer when people copy project folders around.
  db.exec('PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;')
  return db
}
