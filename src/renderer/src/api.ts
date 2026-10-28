import type { Api } from '../../shared/api'

declare global {
  interface Window {
    api: Api
  }
}

export const api: Api = window.api

/** Turns an IPC error into the plain message thrown in the main process. */
export function errorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
