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
  `
]

export const SCHEMA_VERSION = MIGRATIONS.length
