// Exposes a narrow, typed `window.api` to the UI. The UI has no direct Node access.
import { contextBridge, ipcRenderer } from 'electron'
import { IMPORT_PROGRESS_CHANNEL, INVOKE_METHODS, type Api } from '../shared/api'
import type { ImportProgress } from '../shared/types'

const api: Record<string, unknown> = {}
for (const method of INVOKE_METHODS) {
  api[method] = (...args: unknown[]) => ipcRenderer.invoke(method, ...args)
}
api.onImportProgress = (listener: (p: ImportProgress) => void) => {
  const handler = (_e: unknown, p: ImportProgress) => listener(p)
  ipcRenderer.on(IMPORT_PROGRESS_CHANNEL, handler)
  return () => ipcRenderer.removeListener(IMPORT_PROGRESS_CHANNEL, handler)
}

contextBridge.exposeInMainWorld('api', api as unknown as Api)
