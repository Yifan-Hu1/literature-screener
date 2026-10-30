// Database schema for a project's project.db.
// Each entry in MIGRATIONS upgrades the schema by one version; never edit an
// entry that has been released, add a new one instead.

export const APP_ID = 'literature-screener'

export const MIGRATIONS: string[] = [
  /* v1 */ `
  CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE project (
    id                INTEGER PRIMARY KEY CHECK (id = 1),
    name              TEXT NOT NULL,
    research_question TEXT NOT NULL DEFAULT '',
    created_at        TEXT NOT NULL
  );

  CREATE TABLE reviewers (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    first_seen_at TEXT NOT NULL
  );

  -- Editing the criteria adds a new version; decisions point at the version in force.
  CREATE TABLE criteria_versions (
    id          INTEGER PRIMARY KEY,
    version     INTEGER NOT NULL UNIQUE,
    inclusion   TEXT NOT NULL DEFAULT '',
    exclusion   TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL,
    reviewer_id TEXT REFERENCES reviewers(id)
  );

  -- Every search that put records into the project, exactly as run.
  CREATE TABLE searches (
    id                INTEGER PRIMARY KEY,
    source            TEXT NOT NULL,
    mode              TEXT NOT NULL CHECK (mode IN ('structured', 'exploratory')),
    filters_json      TEXT NOT NULL,
    query_sent        TEXT NOT NULL,
    query_translation TEXT,
    total_count       INTEGER,
    retrieved_count   INTEGER NOT NULL DEFAULT 0,
    new_count         INTEGER NOT NULL DEFAULT 0,
    duplicate_count   INTEGER NOT NULL DEFAULT 0,
    missing_json      TEXT NOT NULL DEFAULT '[]',
    status            TEXT NOT NULL CHECK (status IN ('in_progress', 'complete', 'incomplete', 'failed')),
    message           TEXT,
    run_at            TEXT NOT NULL,
    completed_at      TEXT,
    reviewer_id       TEXT REFERENCES reviewers(id)
  );

  -- Bibliographic metadata as retrieved. raw_xml keeps the untouched source record.
  CREATE TABLE records (
    id                     INTEGER PRIMARY KEY,
    source                 TEXT NOT NULL,
    pmid                   TEXT UNIQUE,
    doi                    TEXT,
    pmcid                  TEXT,
    title                  TEXT NOT NULL,
    abstract               TEXT,
    authors_json           TEXT NOT NULL DEFAULT '[]',
    journal                TEXT,
    journal_abbrev         TEXT,
    pub_year               INTEGER,
    pub_date               TEXT,
    publication_types_json TEXT NOT NULL DEFAULT '[]',
    mesh_json              TEXT NOT NULL DEFAULT '[]',
    keywords_json          TEXT NOT NULL DEFAULT '[]',
    languages_json         TEXT NOT NULL DEFAULT '[]',
    raw_xml                TEXT NOT NULL,
    retrieved_at           TEXT NOT NULL
  );
  CREATE INDEX records_doi ON records(doi);

  -- Which searches returned which records (a record can come from several).
  CREATE TABLE search_records (
    search_id INTEGER NOT NULL REFERENCES searches(id),
    record_id INTEGER NOT NULL REFERENCES records(id),
    position  INTEGER,
    how       TEXT NOT NULL CHECK (how IN ('search_import', 'hand_picked')),
    was_new   INTEGER NOT NULL,
    added_at  TEXT NOT NULL,
    PRIMARY KEY (search_id, record_id)
  );
  CREATE INDEX search_records_record ON search_records(record_id);

  CREATE TABLE system_tags (
    id          INTEGER PRIMARY KEY,
    record_id   INTEGER NOT NULL REFERENCES records(id),
    system      TEXT NOT NULL,
    source      TEXT NOT NULL CHECK (source IN ('pubmed_mesh', 'keyword_match', 'ai', 'manual')),
    evidence    TEXT,
    created_at  TEXT NOT NULL,
    reviewer_id TEXT REFERENCES reviewers(id),
    UNIQUE (record_id, system, source)
  );

  CREATE TABLE exclusion_reasons (
    id         INTEGER PRIMARY KEY,
    label      TEXT NOT NULL,
    created_at TEXT NOT NULL,
    retired_at TEXT
  );

  -- Human screening decisions. Append-only: a changed mind is a new row.
  CREATE TABLE decisions (
    id                  INTEGER PRIMARY KEY,
    record_id           INTEGER NOT NULL REFERENCES records(id),
    stage               TEXT NOT NULL CHECK (stage IN ('title_abstract', 'full_text')),
    decision            TEXT NOT NULL CHECK (decision IN ('include', 'exclude', 'unsure')),
    reviewer_id         TEXT NOT NULL REFERENCES reviewers(id),
    criteria_version_id INTEGER REFERENCES criteria_versions(id),
    reason_id           INTEGER REFERENCES exclusion_reasons(id),
    reason_text         TEXT, -- the reason's wording at decision time
    note                TEXT,
    decided_at          TEXT NOT NULL
  );
  CREATE INDEX decisions_record ON decisions(record_id, stage, id);

  CREATE TRIGGER decisions_no_update BEFORE UPDATE ON decisions
  BEGIN SELECT RAISE(ABORT, 'Screening decisions are append-only'); END;
  CREATE TRIGGER decisions_no_delete BEFORE DELETE ON decisions
  BEGIN SELECT RAISE(ABORT, 'Screening decisions are append-only'); END;
  `,

  /* v2: notes, exclusion-reason ordering, collections, researcher tag corrections */ `
  ALTER TABLE exclusion_reasons ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

  -- Free-text notes about a record. Kept as a list; notes are never edited in place.
  CREATE TABLE record_notes (
    id          INTEGER PRIMARY KEY,
    record_id   INTEGER NOT NULL REFERENCES records(id),
    reviewer_id TEXT NOT NULL REFERENCES reviewers(id),
    text        TEXT NOT NULL,
    created_at  TEXT NOT NULL
  );
  CREATE INDEX record_notes_record ON record_notes(record_id);

  CREATE TABLE collections (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );
  CREATE TABLE collection_records (
    collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    record_id     INTEGER NOT NULL REFERENCES records(id),
    added_at      TEXT NOT NULL,
    PRIMARY KEY (collection_id, record_id)
  );

  -- For source 'manual': present = 1 means the researcher confirmed/added the system,
  -- present = 0 means the researcher says it does not apply. Automatic tags are kept.
  ALTER TABLE system_tags ADD COLUMN present INTEGER NOT NULL DEFAULT 1;

  -- The systems that currently apply to each record: a researcher's correction
  -- overrides the automatic tags for that system.
  CREATE VIEW record_systems AS
    SELECT record_id, system FROM system_tags WHERE source = 'manual' AND present = 1
    UNION
    SELECT t.record_id, t.system FROM system_tags t
    WHERE t.source <> 'manual' AND NOT EXISTS (
      SELECT 1 FROM system_tags m WHERE m.record_id = t.record_id AND m.system = t.system AND m.source = 'manual');
  `,

  /* v3: automatic search updates and retraction / expression-of-concern alerts */ `
  ALTER TABLE searches ADD COLUMN parent_search_id INTEGER REFERENCES searches(id);

  CREATE TABLE search_schedules (
    search_id     INTEGER PRIMARY KEY REFERENCES searches(id),
    interval_days INTEGER NOT NULL CHECK (interval_days >= 1),
    created_at    TEXT NOT NULL,
    last_run_at   TEXT,
    last_success_at TEXT,
    last_message  TEXT
  );

  CREATE TABLE record_alerts (
    id          INTEGER PRIMARY KEY,
    record_id   INTEGER NOT NULL REFERENCES records(id),
    kind        TEXT NOT NULL CHECK (kind IN ('retraction', 'expression_of_concern')),
    notice_pmid TEXT NOT NULL DEFAULT '',
    found_by    TEXT NOT NULL CHECK (found_by IN ('import', 'recheck')),
    detected_at TEXT NOT NULL,
    UNIQUE (record_id, kind, notice_pmid)
  );
  `
]

/** Suggested title/abstract exclusion reasons for new projects; editable per project. */
export const DEFAULT_EXCLUSION_REASONS = [
  'Not relevant to the research question',
  'Wrong population, organism or experimental system',
  'Wrong intervention or exposure',
  'Wrong outcome',
  'Wrong study design',
  'Not primary research',
  'Duplicate publication'
]

export const SCHEMA_VERSION = MIGRATIONS.length
