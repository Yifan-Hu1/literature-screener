// Types shared by the main process (Node) and the renderer (UI).

export type Decision = 'include' | 'exclude' | 'unsure'
export type DecisionFilter = Decision | 'undecided' | 'all'
export type OriginFilter = 'all' | 'structured' | 'hand_picked'
export type MatchMode = 'any' | 'all'
export type ExportFormat = 'csv' | 'ris'
export type ScreeningStage = 'title_abstract' | 'full_text'
export type SearchMode = 'structured' | 'exploratory'
export type SearchStatus = 'in_progress' | 'complete' | 'incomplete' | 'failed'
/** Where an organism / experimental-system classification came from. */
export type TagSource = 'pubmed_mesh' | 'keyword_match' | 'ai' | 'manual'

export interface Author {
  lastName?: string
  foreName?: string
  initials?: string
  collectiveName?: string
}

export interface MeshHeading {
  descriptor: string
  ui?: string
  majorTopic: boolean
  qualifiers: string[]
}

/** A publication exactly as parsed from the PubMed record (no interpretation). */
export interface PubMedRecord {
  pmid: string
  doi: string | null
  pmcid: string | null
  title: string
  abstract: string | null
  authors: Author[]
  journal: string | null
  journalAbbrev: string | null
  pubYear: number | null
  pubDate: string | null
  publicationTypes: string[]
  mesh: MeshHeading[]
  keywords: string[]
  languages: string[]
  rawXml: string
}

export type ConceptField = 'tiab' | 'ti' | 'all'

/** One idea in the search: its synonyms are combined with OR. */
export interface SearchConcept {
  terms: string[]
  /** MeSH descriptor names. */
  mesh: string[]
  field: ConceptField
}

export interface MeshSuggestion {
  ui: string
  name: string
  scopeNote: string | null
  entryTerms: string[]
}

export interface SearchFilters {
  /** Concepts are combined with AND. Optional so older search logs still read. */
  concepts?: SearchConcept[]
  /** Free text; PubMed syntax (AND/OR/NOT, [Mesh], [tiab], ...) is allowed. */
  query: string
  yearFrom: number | null
  yearTo: number | null
  articleTypes: string[]
  /** Ids from SYSTEM_PRESETS. */
  systems: string[]
  /** Whether papers need any or all of the selected systems. Defaults to 'any'. */
  systemsMode?: MatchMode
  /** Leave out reviews, editorials, notices and other non-primary publication types. */
  primaryResearchOnly?: boolean
}

export interface SearchPreview {
  querySent: string
  queryTranslation: string | null
  count: number
  warnings: string[]
  exceedsLimit: boolean
  limit: number
}

export interface BrowseItem {
  pmid: string
  title: string
  authorsShort: string
  journal: string | null
  pubYear: number | null
  abstract: string | null
  publicationTypes: string[]
  inProject: boolean
}

export interface BrowsePage {
  preview: SearchPreview
  start: number
  pageSize: number
  items: BrowseItem[]
}

export interface ImportProgress {
  done: number
  total: number
}

export interface ImportResult {
  searchId: number
  status: SearchStatus
  total: number
  retrieved: number
  newRecords: number
  alreadyInProject: number
  missingPmids: string[]
  message: string
}

export interface SearchLogEntry {
  id: number
  source: string
  mode: SearchMode
  filters: SearchFilters
  querySent: string
  queryTranslation: string | null
  totalCount: number | null
  retrievedCount: number
  newCount: number
  duplicateCount: number
  missingPmids: string[]
  status: SearchStatus
  message: string | null
  runAt: string
  completedAt: string | null
  reviewerName: string | null
}

export interface ProjectOverview {
  path: string
  name: string
  researchQuestion: string
  inclusionCriteria: string
  exclusionCriteria: string
  criteriaVersion: number
  createdAt: string
  recordCount: number
  counts: Record<Decision, number>
  searchCount: number
  cloudWarning: string | null
}

export interface RecordSummary {
  id: number
  pmid: string | null
  title: string
  journal: string | null
  pubYear: number | null
  decision: Decision | null
  structured: boolean
  handPicked: boolean
  systems: string[]
}

export interface RecordFilter {
  decision: DecisionFilter
  origin: OriginFilter
  text: string
  systems: string[]
  systemsMode: MatchMode
  collectionId: number | null
}

export interface RecordQuery extends RecordFilter {
  offset: number
  limit: number
}

export interface RecordPage {
  total: number
  offset: number
  items: RecordSummary[]
}

export interface SystemTag {
  system: string
  source: TagSource
  evidence: string | null
  /** False only for a researcher's "does not apply" correction. */
  present: boolean
}

export interface ExclusionReason {
  id: number
  label: string
  retired: boolean
}

export interface RecordNote {
  id: number
  text: string
  reviewerName: string
  createdAt: string
}

export interface Collection {
  id: number
  name: string
  count: number
}

export interface DecisionInput {
  decision: Decision
  /** Only for exclusions. */
  reasonId?: number | null
  comment?: string
}

export interface DecisionEntry {
  id: number
  decision: Decision
  stage: ScreeningStage
  reviewerName: string
  decidedAt: string
  criteriaVersion: number | null
  reasonText: string | null
  comment: string | null
}

export interface RecordOrigin {
  searchId: number
  mode: SearchMode
  how: 'search_import' | 'hand_picked'
  addedAt: string
}

export interface RecordDetail {
  id: number
  source: string
  pmid: string | null
  doi: string | null
  pmcid: string | null
  title: string
  abstract: string | null
  authors: Author[]
  journal: string | null
  pubYear: number | null
  pubDate: string | null
  publicationTypes: string[]
  mesh: MeshHeading[]
  keywords: string[]
  languages: string[]
  retrievedAt: string
  tags: SystemTag[]
  /** Systems that currently apply, after researcher corrections. */
  systems: string[]
  notes: RecordNote[]
  collectionIds: number[]
  origins: RecordOrigin[]
  history: DecisionEntry[]
  current: Decision | null
}

export interface AppSettings {
  reviewerName: string
  ncbiEmail: string
  hasNcbiApiKey: boolean
  recentProjects: string[]
}

export interface SettingsUpdate {
  reviewerName?: string
  ncbiEmail?: string
  /** A string sets the key, null removes it, undefined leaves it unchanged. */
  ncbiApiKey?: string | null
}

export interface NewProjectInput {
  parentDir: string
  name: string
  researchQuestion: string
  inclusionCriteria: string
  exclusionCriteria: string
}
