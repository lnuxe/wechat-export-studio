import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { IPC, IPC_EVENTS, type IpcChannel, type IpcResult } from '@shared/ipc'
import type { IpcChannelKey } from '@shared/contracts'
import type {
  AppInfo,
  ConversationSync,
  DecryptReport,
  DecryptStatus,
  ExportPlan,
  ExportRecord,
  KeyCandidate,
  KeyInspection,
  KeyVerification,
  LogEntry,
  MessagePage,
  MessageQuery,
  WeChatAccount,
  WeChatInstallation,
  WorkspaceConfig,
  WorkspacePatch
} from '@shared/types'
import { AppError, toAppError } from '../core/errors'
import { log, logBus } from '../core/logger'
import { workspace } from '../core/workspace'
import { capabilities } from '../core/env'
import { detectInstallation, listAccounts } from '../services/wechat-environment'
import { KeyService } from '../services/key-service'
import { DecryptRunner } from '../services/decrypt-runner'
import { ChatStore } from '../services/chat-store'
import { ExportRunner } from '../services/export-runner'

/**
 * IPC 边界层：唯一一处把「领域服务」暴露给渲染层的地方。
 *
 * 三条铁律：
 *  1. 渲染层只能通过这些具名通道拿数据，不能碰文件系统/子进程；
 *  2. 任何抛出都收敛成 `IpcResult`（ok / error），不让异常穿过上下文边界；
 *  3. 服务实例跟着工作区配置版本重建（换工作目录/数据目录后必须重新构造）。
 */

interface Services {
  keys: KeyService
  decrypt: DecryptRunner
  store: ChatStore
  exports: ExportRunner
  /** 造出这组服务时的配置版本号 */
  revision: number
}

let mainWindow: BrowserWindow | null = null
let services: Services | null = null

function emit<T>(channel: string, payload: T): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

/**
 * 按配置版本懒重建服务。
 *
 * 这里必须懒加载 + 版本比对，不能「模块加载时建一次就完事」：
 * 早期版本在 import 阶段就构造了服务，之后 workspace.patch 设上 wechatDataDir 并不会重建，
 * 结果 ChatStore 里的数据目录永远是 null →「谁是我」推不出来 →
 * 所有消息都被判成对方发的（实测统计显示 我 0 / 对方 4720）。
 */
function currentServices(): Services {
  const revision = workspace.version
  if (!services || services.revision !== revision) {
    const config = workspace.get()
    const store = new ChatStore(config)
    const decrypt = new DecryptRunner(config)
    decrypt.on('progress', (progress) => emit(IPC_EVENTS.progress, progress))
    services = {
      keys: new KeyService(config),
      decrypt,
      store,
      exports: new ExportRunner(config, store, join(config.workDir, 'exports', 'history.json')),
      revision
    }
    log.debug('app', `服务已按配置 v${revision} 重建（workDir=${config.workDir}）`)
  }
  return services
}

export function setMainWindow(window: BrowserWindow): void {
  mainWindow = window
}

/** 统一的 handler 注册：把 (args) => Promise<T> 包成带信封的 IPC */
function handle<K extends IpcChannelKey>(
  channel: K,
  handler: (...args: unknown[]) => Promise<IpcResult<unknown>> | IpcResult<unknown>
): void {
  ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
    try {
      return await handler(...args)
    } catch (error) {
      const appError = toAppError(error)
      log.error('app', `${channel} 失败：${appError.message}`, appError.detail)
      return { ok: false as const, error: appError.toPayload() }
    }
  })
}

const ok = <T>(data: T): IpcResult<T> => ({ ok: true, data })

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AppError('E_VALIDATION', `缺少参数 ${name}`)
  }
  return value
}

export function registerIpc(): void {
  /* ------------------------------------------------------------ 应用信息 */

  handle(IPC.appInfo, async (): Promise<IpcResult<AppInfo>> => {
    const caps = await capabilities()
    return ok({
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      nodeVersion: process.versions.node,
      platform: process.platform,
      sqliteDriver: caps.sqlite ? 'node:sqlite' : 'python-fallback',
      pythonAvailable: caps.python,
      pythonVersion: caps.pythonVersion,
      paths: {
        userData: app.getPath('userData'),
        logs: join(workspace.get().workDir, 'logs'),
        config: join(app.getPath('userData'), 'config.json')
      }
    })
  })

  handle(IPC.appRevealPath, async (target): Promise<IpcResult<null>> => {
    const path = requireString(target, 'path')
    if (!existsSync(path)) throw new AppError('E_NOT_FOUND', `路径不存在：${path}`)
    shell.showItemInFolder(path)
    return ok(null)
  })

  handle(IPC.appOpenPath, async (target): Promise<IpcResult<null>> => {
    const path = requireString(target, 'path')
    if (!existsSync(path)) throw new AppError('E_NOT_FOUND', `路径不存在：${path}`)
    const error = await shell.openPath(path)
    if (error) throw new AppError('E_UNKNOWN', `打开失败：${error}`)
    return ok(null)
  })

  handle(IPC.appPickDirectory, async (options): Promise<IpcResult<string | null>> => {
    const opts = (options ?? {}) as { title?: string; defaultPath?: string }
    const result = await dialog.showOpenDialog({
      title: opts.title ?? '选择目录',
      defaultPath: opts.defaultPath,
      properties: ['openDirectory', 'createDirectory']
    })
    return ok(result.canceled || result.filePaths.length === 0 ? null : (result.filePaths[0] as string))
  })

  handle(IPC.appPickFile, async (options): Promise<IpcResult<string | null>> => {
    const opts = (options ?? {}) as { title?: string; filters?: { name: string; extensions: string[] }[] }
    const result = await dialog.showOpenDialog({
      title: opts.title ?? '选择文件',
      properties: ['openFile'],
      ...(opts.filters ? { filters: opts.filters } : {})
    })
    return ok(result.canceled || result.filePaths.length === 0 ? null : (result.filePaths[0] as string))
  })

  /* -------------------------------------------------------------- 工作区 */

  handle(IPC.workspaceGet, async (): Promise<IpcResult<WorkspaceConfig>> => ok(workspace.get()))

  handle(IPC.workspacePatch, async (patch): Promise<IpcResult<WorkspaceConfig>> => {
    const next = workspace.patch((patch ?? {}) as WorkspacePatch)
    currentServices().store.invalidate()
    emit(IPC_EVENTS.workspaceChanged, next)
    return ok(next)
  })

  handle(IPC.workspaceReset, async (): Promise<IpcResult<WorkspaceConfig>> => {
    const next = workspace.reset()
    emit(IPC_EVENTS.workspaceChanged, next)
    return ok(next)
  })

  /* ---------------------------------------------------------------- 微信 */

  handle(IPC.wechatDetect, async (): Promise<IpcResult<WeChatInstallation>> => ok(await detectInstallation()))

  handle(IPC.wechatAccounts, async (extra): Promise<IpcResult<WeChatAccount[]>> => {
    const explicit = typeof extra === 'string' && extra.trim() ? extra.trim() : null
    return ok(await listAccounts(explicit ?? workspace.get().wechatDataDir))
  })

  /* ---------------------------------------------------------------- 密钥 */

  handle(IPC.keyInspect, async (raw): Promise<IpcResult<KeyInspection>> =>
    ok(currentServices().keys.inspect(requireString(raw, 'key'), 'manual'))
  )
  handle(IPC.keyFromFile, async (path): Promise<IpcResult<KeyInspection>> =>
    ok(currentServices().keys.inspectFromFile(typeof path === 'string' ? path : undefined))
  )
  handle(IPC.keyVerify, async (key, dbStoragePath): Promise<IpcResult<KeyVerification>> =>
    ok(
      currentServices().keys.verify(
        requireString(key, 'key'),
        typeof dbStoragePath === 'string' ? dbStoragePath : undefined
      )
    )
  )
  handle(IPC.keyCandidates, async (): Promise<IpcResult<KeyCandidate[]>> => ok(currentServices().keys.candidates()))

  /* ---------------------------------------------------------------- 解密 */

  handle(IPC.decryptPlan, async (options): Promise<IpcResult<ReturnType<DecryptRunner['plan']>>> => {
    const opts = (options ?? {}) as { dbStoragePath?: string }
    return ok(currentServices().decrypt.plan(requireString(opts.dbStoragePath, 'dbStoragePath')))
  })

  handle(IPC.decryptStatus, async (): Promise<IpcResult<DecryptStatus>> => ok(currentServices().decrypt.summary()))

  handle(IPC.decryptRun, async (options): Promise<IpcResult<DecryptReport>> => {
    const opts = (options ?? {}) as { dbStoragePath?: string; key?: string; targets?: string[] }
    const dbStoragePath = requireString(opts.dbStoragePath, 'dbStoragePath')
    const key = requireString(opts.key, 'key')
    const report = await currentServices().decrypt.run({
      dbStoragePath,
      key,
      ...(opts.targets ? { targets: opts.targets } : {})
    })
    // 解密产物变了，缓存必须失效；顺手记住密钥与数据目录，下次开箱即用
    workspace.patch({ savedKey: report.key, wechatDataDir: dbStoragePath })
    currentServices().store.invalidate()
    return ok(report)
  })

  handle(IPC.decryptCancel, async (): Promise<IpcResult<boolean>> => ok(currentServices().decrypt.cancel()))

  /* ------------------------------------------------------------ 会话消息 */

  handle(
    IPC.conversationList,
    async (options): Promise<IpcResult<Awaited<ReturnType<ChatStore['listConversations']>>>> => {
      const opts = (options ?? {}) as { query?: string; limit?: number }
      return ok(await currentServices().store.listConversations(opts.query, opts.limit ?? 500))
    }
  )

  handle(
    IPC.conversationLocate,
    async (options): Promise<IpcResult<Awaited<ReturnType<ChatStore['locateConversation']>>>> => {
      const opts = (options ?? {}) as { username?: string }
      return ok(await currentServices().store.locateConversation(requireString(opts.username, 'username')))
    }
  )

  handle(IPC.conversationMessages, async (query): Promise<IpcResult<MessagePage>> => {
    const q = (query ?? {}) as MessageQuery
    requireString(q.username, 'username')
    return ok(
      await currentServices().store.queryMessages({
        ...q,
        offset: Number.isFinite(q.offset) ? q.offset : 0,
        limit: Number.isFinite(q.limit) ? q.limit : 60,
        order: q.order === 'asc' ? 'asc' : 'desc'
      })
    )
  })

  handle(IPC.conversationSync, async (options): Promise<IpcResult<ConversationSync>> => {
    const opts = (options ?? {}) as { username?: string; after?: number }
    return ok(
      await currentServices().store.syncConversation(
        requireString(opts.username, 'username'),
        typeof opts.after === 'number' && opts.after > 0 ? opts.after : undefined
      )
    )
  })

  handle(IPC.conversationStats, async (options): Promise<IpcResult<Awaited<ReturnType<ChatStore['stats']>>>> => {
    const opts = (options ?? {}) as { username?: string }
    return ok(await currentServices().store.stats(requireString(opts.username, 'username')))
  })

  handle(
    IPC.conversationSearch,
    async (options): Promise<IpcResult<Awaited<ReturnType<ChatStore['searchMessages']>>>> => {
      const opts = (options ?? {}) as { keyword?: string; limit?: number }
      return ok(
        await currentServices().store.searchMessages(requireString(opts.keyword, 'keyword'), opts.limit ?? 40)
      )
    }
  )

  /* ---------------------------------------------------------------- 导出 */

  handle(IPC.exportPlan, async (request): Promise<IpcResult<ExportPlan>> => {
    const req = (request ?? {}) as Parameters<ExportRunner['plan']>[0]
    requireString(req.username, 'username')
    if (!Array.isArray(req.formats) || req.formats.length === 0) {
      throw new AppError('E_VALIDATION', '至少选择一种导出格式')
    }
    return ok(await currentServices().exports.plan(req))
  })

  handle(IPC.exportRun, async (request): Promise<IpcResult<ExportRecord>> => {
    const req = (request ?? {}) as Parameters<ExportRunner['run']>[0]
    requireString(req.username, 'username')
    const record = await currentServices().exports.run(req)
    emit(IPC_EVENTS.historyChanged, currentServices().exports.list())
    return ok(record)
  })

  handle(IPC.exportHistory, async (): Promise<IpcResult<ExportRecord[]>> => ok(currentServices().exports.list()))

  handle(IPC.exportDeleteHistory, async (id): Promise<IpcResult<null>> => {
    currentServices().exports.deleteHistory(requireString(id, 'id'))
    emit(IPC_EVENTS.historyChanged, currentServices().exports.list())
    return ok(null)
  })

  handle(IPC.exportReveal, async (path): Promise<IpcResult<null>> => {
    const target = requireString(path, 'path')
    if (!existsSync(target)) throw new AppError('E_NOT_FOUND', `文件不存在：${target}`)
    shell.showItemInFolder(target)
    return ok(null)
  })

  /* ------------------------------------------------------------------ 日志 */

  handle(IPC.logTail, async (options): Promise<IpcResult<LogEntry[]>> => {
    const opts = (options ?? {}) as { limit?: number }
    return ok(logBus.tail(opts.limit ?? 300))
  })

  // 日志总线 → 渲染层（全局只挂一次）
  logBus.on('entry', (entry) => emit(IPC_EVENTS.log, entry))
}

/** 供自检模块复用同一套服务实例 */
export function currentServicesRef(): Services {
  return currentServices()
}

export { IPC, IPC_EVENTS }
export type { IpcChannel }
