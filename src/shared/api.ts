// The contract between the UI and the main process. Every method is an IPC call.
import type {
  AppSettings,
  BrowsePage,
  Decision,
  DecisionFilter,
  ImportProgress,
  ImportResult,
  NewProjectInput,
  OriginFilter,
  ProjectOverview,
  RecordDetail,
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

  previewSearch(filters: SearchFilters): Promise<SearchPreview>
  browseSearch(filters: SearchFilters, start: number): Promise<BrowsePage>
  saveFromBrowse(pmid: string): Promise<void>
  importSearch(filters: SearchFilters): Promise<ImportResult>
  listSearches(): Promise<SearchLogEntry[]>

  listRecords(query: RecordQuery): Promise<RecordPage>
  screeningQueue(decision: DecisionFilter, origin: OriginFilter): Promise<number[]>
  getRecord(id: number): Promise<RecordDetail>
  decide(recordId: number, decision: Decision): Promise<RecordDetail>
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
  'previewSearch',
  'browseSearch',
  'saveFromBrowse',
  'importSearch',
  'listSearches',
  'listRecords',
  'screeningQueue',
  'getRecord',
  'decide'
] as const satisfies readonly InvokeMethod[]

// Fails to compile if a method is added to InvokeApi but not listed above.
export const ALL_METHODS_LISTED: [Exclude<InvokeMethod, (typeof INVOKE_METHODS)[number]>] extends [never]
  ? true
  : never = true

export const IMPORT_PROGRESS_CHANNEL = 'import-progress'

export interface Api extends InvokeApi {
  onImportProgress(listener: (progress: ImportProgress) => void): () => void
}
