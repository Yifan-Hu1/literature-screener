// Per-computer app settings, kept in the app's user-data folder (never in a project).
// Secrets are encrypted with the operating system's keychain via safeStorage.
import { app, safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppSettings, SettingsUpdate } from '../shared/types'
import type { Reviewer } from './project/store'

interface StoredSettings {
  reviewerId: string
  reviewerName: string
  ncbiEmail: string
  ncbiApiKeyEncrypted?: string
  recentProjects: string[]
}

const MAX_RECENT = 8

export class Settings {
  private data: StoredSettings
  private readonly file = join(app.getPath('userData'), 'settings.json')

  constructor() {
    const defaults: StoredSettings = { reviewerId: randomUUID(), reviewerName: '', ncbiEmail: '', recentProjects: [] }
    let loaded: Partial<StoredSettings> = {}
    if (existsSync(this.file)) {
      try {
        loaded = JSON.parse(readFileSync(this.file, 'utf8'))
      } catch {
        // A corrupt settings file should not stop the app; start from defaults.
      }
    }
    this.data = { ...defaults, ...loaded }
    this.save()
  }

  private save() {
    writeFileSync(this.file, JSON.stringify(this.data, null, 2))
  }

  view(): AppSettings {
    return {
      reviewerName: this.data.reviewerName,
      ncbiEmail: this.data.ncbiEmail,
      hasNcbiApiKey: !!this.data.ncbiApiKeyEncrypted,
      recentProjects: this.data.recentProjects
    }
  }

  update(u: SettingsUpdate): AppSettings {
    if (u.reviewerName !== undefined) this.data.reviewerName = u.reviewerName.trim()
    if (u.ncbiEmail !== undefined) this.data.ncbiEmail = u.ncbiEmail.trim()
    if (u.ncbiApiKey === null || u.ncbiApiKey?.trim() === '') {
      delete this.data.ncbiApiKeyEncrypted
    } else if (u.ncbiApiKey !== undefined) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('Secure storage is not available on this computer, so the API key cannot be saved.')
      }
      this.data.ncbiApiKeyEncrypted = safeStorage.encryptString(u.ncbiApiKey.trim()).toString('base64')
    }
    this.save()
    return this.view()
  }

  reviewer(): Reviewer {
    return { id: this.data.reviewerId, name: this.data.reviewerName }
  }

  ncbiEmail(): string {
    return this.data.ncbiEmail
  }

  ncbiApiKey(): string | undefined {
    const enc = this.data.ncbiApiKeyEncrypted
    if (!enc || !safeStorage.isEncryptionAvailable()) return undefined
    try {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'))
    } catch {
      return undefined
    }
  }

  addRecent(path: string) {
    this.data.recentProjects = [path, ...this.data.recentProjects.filter((p) => p !== path)].slice(0, MAX_RECENT)
    this.save()
  }

  removeRecent(path: string) {
    this.data.recentProjects = this.data.recentProjects.filter((p) => p !== path)
    this.save()
  }
}
