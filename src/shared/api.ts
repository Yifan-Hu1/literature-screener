// The contract between the UI and the main process. Every method is an IPC call.
import type {
  AppSettings,
  BrowsePage,
  Collection,
  DecisionInput,
  ExclusionReason,
  ExportFormat,
  ImportProgress,
  ImportResult,
  MeshSuggestion,
  NewProjectInput,
  ProjectOverview,
  RecordDetail,
  RecordFilter,
  RecordPage,
  RecordQuery,
  SearchFilters,
  SearchLogEntry,
  SearchPreview,
  SettingsUpdate
} from './types'

export interface InvokeApi {
  getSettings(): Promise<AppSettings>
  updateSettings(update: SettingsUpdate): Promise<AppSettings>
  chooseFolder(title: string): Promise<string | null>
  openExternal(url: string): Promise<void>

  createProject(input: NewProjectInput): Promise<ProjectOverview>
  /** Without a path, asks the user to pick a folder. Returns null if cancelled. */
  openProject(path?: string): Promise<ProjectOverview | null>
  closeProject(): Promise<void>
  getOverview(): Promise<ProjectOverview>
  revealProject(): Promise<void>
  /** Returns the backup folder path, or null if cancelled. */
  backupProject(): Promise<string | null>
  /** Saves edited criteria as a new version. */
  updateCriteria(inclusion: string, exclusion: string): Promise<ProjectOverview>

  suggestMesh(term: string): Promise<MeshSuggestion[]>
  previewSearch(filters: SearchFilters): Promise<SearchPreview>
  browseSearch(filters: SearchFilters, start: number): Promise<BrowsePage>
  saveFromBrowse(pmid: string): Promise<void>
  importSearch(filters: SearchFilters): Promise<ImportResult>
  listSearches(): Promise<SearchLogEntry[]>

  listRecords(query: RecordQuery): Promise<RecordPage>
  screeningQueue(filter: RecordFilter): Promise<number[]>
  getRecord(id: number): Promise<RecordDetail>
  decide(recordId: number, input: DecisionInput): Promise<RecordDetail>
  addNote(recordId: number, text: string): Promise<RecordDetail>
  /** true = applies, false = does not apply, null = remove the researcher's correction. */
  setManualTag(recordId: number, system: string, present: boolean | null): Promise<RecordDetail>

  listExclusionReasons(): Promise<ExclusionReason[]>
  addExclusionReason(label: string): Promise<ExclusionReason[]>
  renameExclusionReason(id: number, label: string): Promise<ExclusionReason[]>
  setExclusionReasonRetired(id: number, retired: boolean): Promise<ExclusionReason[]>

  listCollections(): Promise<Collection[]>
  createCollection(name: string): Promise<Collection[]>
  deleteCollection(id: number): Promise<Collection[]>
  setInCollection(collectionId: number, recordIds: number[], inCollection: boolean): Promise<Collection[]>

  /** Asks where to save; returns the saved file path, or null if cancelled. */
  exportRecords(filter: RecordFilter, format: ExportFormat): Promise<string | null>
  exportPrismaSummary(): Promise<string | null>
}

export type InvokeMethod = keyof InvokeApi

export const INVOKE_METHODS = [
  'getSettings',
  'updateSettings',
  'chooseFolder',
  'openExternal',
  'createProject',
  'openProject',
  'closeProject',
  'getOverview',
  'revealProject',
  'backupProject',
  'updateCriteria',
  'suggestMesh',
  'previewSearch',
  'browseSearch',
  'saveFromBrowse',
  'importSearch',
  'listSearches',
  'listRecords',
  'screeningQueue',
  'getRecord',
  'decide',
  'addNote',
  'setManualTag',
  'listExclusionReasons',
  'addExclusionReason',
  'renameExclusionReason',
  'setExclusionReasonRetired',
  'listCollections',
  'createCollection',
  'deleteCollection',
  'setInCollection',
  'exportRecords',
  'exportPrismaSummary'
] as const satisfies readonly InvokeMethod[]

// Fails to compile if a method is added to InvokeApi but not listed above.
export const ALL_METHODS_LISTED: [Exclude<InvokeMethod, (typeof INVOKE_METHODS)[number]>] extends [never]
  ? true
  : never = true

export const IMPORT_PROGRESS_CHANNEL = 'import-progress'

export interface Api extends InvokeApi {
  onImportProgress(listener: (progress: ImportProgress) => void): () => void
}
