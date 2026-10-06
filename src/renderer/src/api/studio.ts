import type { ExportRequest, WorkspacePatch } from '@shared/types'
import { api } from './client'

export const appApi = {
  info: () => api.invoke('app:info'),
  pickDirectory: (options?: { title?: string; defaultPath?: string }) =>
    api.invoke('app:pick-directory', options ?? {}),
  pickFile: (options?: { title?: string; filters?: { name: string; extensions: string[] }[] }) =>
    api.invoke('app:pick-file', options ?? {}),
  reveal: (path: string) => api.invoke('app:reveal-path', path),
  open: (path: string) => api.invoke('app:open-path', path)
}

export const workspaceApi = {
  get: () => api.invoke('workspace:get'),
  patch: (patch: WorkspacePatch) => api.invoke('workspace:patch', patch),
  reset: () => api.invoke('workspace:reset')
}

export const wechatApi = {
  detect: () => api.invoke('wechat:detect'),
  accounts: (path?: string) => api.invoke('wechat:accounts', path)
}

export const keyApi = {
  inspect: (key: string) => api.invoke('key:inspect', key),
  fromFile: (path?: string) => api.invoke('key:from-file', path),
  verify: (key: string, dbStoragePath?: string) => api.invoke('key:verify', key, dbStoragePath),
  candidates: () => api.invoke('key:candidates')
}

export const decryptApi = {
  plan: (dbStoragePath: string) => api.invoke('decrypt:plan', { dbStoragePath }),
  status: () => api.invoke('decrypt:status'),
  run: (options: { dbStoragePath: string; key: string; targets?: string[] }) =>
    api.invoke('decrypt:run', options),
  cancel: () => api.invoke('decrypt:cancel')
}

export const exportApi = {
  plan: (request: ExportRequest) => api.invoke('export:plan', request),
  run: (request: ExportRequest) => api.invoke('export:run', request),
  history: () => api.invoke('export:history'),
  remove: (id: string) => api.invoke('export:delete-history', id),
  reveal: (path: string) => api.invoke('export:reveal', path)
}

export const logApi = {
  tail: (limit?: number) => api.invoke('log:tail', { limit })
}
