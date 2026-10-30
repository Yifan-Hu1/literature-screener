// A small local error log, so testers can include recent errors in bug reports.
// It stays on this computer; nothing is sent anywhere automatically.
import { app } from 'electron'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

const MAX_BYTES = 1024 * 1024

function logFile(): string {
  return join(app.getPath('userData'), 'logs', 'errors.log')
}

export function logError(context: string, e: unknown) {
  try {
    const file = logFile()
    mkdirSync(join(file, '..'), { recursive: true })
    if (existsSync(file) && statSync(file).size > MAX_BYTES) renameSync(file, `${file}.old`)
    const err = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e)
    appendFileSync(file, `${new Date().toISOString()} [${context}] ${err}\n\n`)
  } catch {
    // Logging must never break the app.
  }
}

export function recentErrors(maxEntries = 15): string {
  try {
    const file = logFile()
    if (!existsSync(file)) return '(none)'
    const entries = readFileSync(file, 'utf8').trim().split(/\n\n+/)
    return entries.slice(-maxEntries).join('\n\n') || '(none)'
  } catch {
    return '(could not read the error log)'
  }
}

export function diagnostics(): string {
  const os = process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : process.platform
  return [
    `Literature Screener ${app.getVersion()}`,
    `${os} ${process.getSystemVersion()} (${process.arch})`,
    `Electron ${process.versions.electron}, Chromium ${process.versions.chrome}`,
    '',
    'Recent errors:',
    recentErrors()
  ].join('\n')
}
