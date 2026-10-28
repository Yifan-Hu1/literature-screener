// Detects project folders that are probably inside a cloud-sync service.
// Sync tools can copy project.db mid-write and corrupt or fork it.

const CLOUD_PATTERNS: [RegExp, string][] = [
  [/[\\/]Dropbox([\\/]|$)/i, 'Dropbox'],
  [/[\\/]OneDrive([ -][^\\/]*)?([\\/]|$)/i, 'OneDrive'],
  [/[\\/]Google ?Drive([\\/]|$)/i, 'Google Drive'],
  [/[\\/]Library[\\/]CloudStorage[\\/]/i, 'a cloud storage provider'],
  [/[\\/]Library[\\/]Mobile Documents[\\/]/i, 'iCloud Drive'],
  [/[\\/]iCloud ?Drive([\\/]|$)/i, 'iCloud Drive'],
  [/[\\/]Box( Sync)?([\\/]|$)/i, 'Box']
]

export function cloudSyncWarning(path: string): string | null {
  const hit = CLOUD_PATTERNS.find(([re]) => re.test(path))
  if (!hit) return null
  return (
    `This project seems to be inside a folder synced by ${hit[1]}. ` +
    'Syncing while the app is open can damage the project database. ' +
    'We recommend keeping projects in an ordinary local folder and using "Back up project" to make copies.'
  )
}
