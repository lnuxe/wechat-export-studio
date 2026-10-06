/**
 * IPC 契约表：函数名 → [入参, 返回]。
 * preload 的 `invoke` 与主进程的 `handle` 都以它为类型约束，
 * 任何一侧改签名都会在编译期暴露，而不是运行时才炸。
 */
import { IPC } from './ipc'
import type {
  AppInfo,
  ConversationLocation,
  ConversationStats,
  ConversationSummary,
  ConversationSync,
  DbTarget,
  DecryptProgress,
  DecryptReport,
  DecryptStatus,
  ExportPlan,
  ExportRecord,
  ExportRequest,
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
} from './types'

export interface IpcContract {
  [IPC.appInfo]: { args: []; result: AppInfo }
  [IPC.appRevealPath]: { args: [string]; result: null }
  [IPC.appOpenPath]: { args: [string]; result: null }
  [IPC.appPickDirectory]: { args: [{ title?: string; defaultPath?: string }?]; result: string | null }
  [IPC.appPickFile]: {
    args: [{ title?: string; filters?: { name: string; extensions: string[] }[] }?]
    result: string | null
  }

  [IPC.workspaceGet]: { args: []; result: WorkspaceConfig }
  [IPC.workspacePatch]: { args: [WorkspacePatch]; result: WorkspaceConfig }
  [IPC.workspaceReset]: { args: []; result: WorkspaceConfig }

  [IPC.wechatDetect]: { args: []; result: WeChatInstallation }
  [IPC.wechatAccounts]: { args: [string?]; result: WeChatAccount[] }

  [IPC.keyInspect]: { args: [string]; result: KeyInspection }
  [IPC.keyFromFile]: { args: [string?]; result: KeyInspection }
  [IPC.keyVerify]: { args: [string, string?]; result: KeyVerification }
  [IPC.keyCandidates]: { args: []; result: KeyCandidate[] }

  [IPC.decryptPlan]: { args: [{ dbStoragePath: string }]; result: DbTarget[] }
  [IPC.decryptStatus]: { args: []; result: DecryptStatus }
  [IPC.decryptRun]: { args: [{ dbStoragePath: string; key: string; targets?: string[] }]; result: DecryptReport }
  [IPC.decryptCancel]: { args: []; result: boolean }

  [IPC.conversationList]: {
    args: [{ accountId?: string; query?: string; limit?: number }?]
    result: ConversationSummary[]
  }
  [IPC.conversationLocate]: {
    args: [{ username: string }]
    result: ConversationLocation | null
  }
  [IPC.conversationMessages]: { args: [MessageQuery]; result: MessagePage }
  [IPC.conversationSync]: {
    args: [{ username: string; after?: number }]
    result: ConversationSync
  }
  [IPC.conversationStats]: { args: [{ username: string }]; result: ConversationStats }
  [IPC.conversationSearch]: {
    args: [{ keyword: string; limit?: number }]
    result: { username: string; displayName: string; hits: number; preview: string }[]
  }

  [IPC.exportPlan]: { args: [ExportRequest]; result: ExportPlan }
  [IPC.exportRun]: { args: [ExportRequest]; result: ExportRecord }
  [IPC.exportHistory]: { args: []; result: ExportRecord[] }
  [IPC.exportDeleteHistory]: { args: [string]; result: null }
  [IPC.exportReveal]: { args: [string]; result: null }

  [IPC.logTail]: { args: [{ limit?: number }?]; result: LogEntry[] }
}

export type IpcChannelKey = keyof IpcContract
export type IpcArgs<K extends IpcChannelKey> = IpcContract[K]['args']
export type IpcData<K extends IpcChannelKey> = IpcContract[K]['result']

/** 主进程 → 渲染层事件负载 */
export interface IpcEventMap {
  'event:log': LogEntry
  'event:progress': DecryptProgress
  'event:workspace-changed': WorkspaceConfig
  'event:history-changed': ExportRecord[]
}
