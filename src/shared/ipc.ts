/**
 * 主进程 ↔ 预加载 ↔ 渲染层之间唯一的通信契约。
 *
 * 约定：
 *  - 通道名一律 `<domain>:<verb>`，只增不改（改名等于破坏性变更）。
 *  - 每个通道的入参/出参类型由 `IpcContract` 收口，`invoke()` 的类型安全来自这里。
 *  - 渲染层永远拿不到绝对路径以外的任何系统能力：文件系统/子进程/网络都在主进程。
 */

export const IPC = {
  /** 应用与环境 */
  appInfo: 'app:info',
  appRevealPath: 'app:reveal-path',
  appOpenPath: 'app:open-path',
  appPickDirectory: 'app:pick-directory',
  appPickFile: 'app:pick-file',

  /** 工作区（toolbox 工作目录 / 微信数据目录 / 解密产物目录） */
  workspaceGet: 'workspace:get',
  workspacePatch: 'workspace:patch',
  workspaceReset: 'workspace:reset',

  /** 微信环境探测 */
  wechatDetect: 'wechat:detect',
  wechatAccounts: 'wechat:accounts',

  /** 密钥 */
  keyInspect: 'key:inspect',
  keyFromFile: 'key:from-file',
  keyVerify: 'key:verify',
  keyCandidates: 'key:candidates',

  /** 解密 */
  decryptPlan: 'decrypt:plan',
  decryptStatus: 'decrypt:status',
  decryptRun: 'decrypt:run',
  decryptCancel: 'decrypt:cancel',

  /** 会话与消息 */
  conversationList: 'conversation:list',
  conversationLocate: 'conversation:locate',
  conversationMessages: 'conversation:messages',
  conversationSync: 'conversation:sync',
  conversationStats: 'conversation:stats',
  conversationSearch: 'conversation:search',

  /** 导出 */
  exportPlan: 'export:plan',
  exportRun: 'export:run',
  exportHistory: 'export:history',
  exportDeleteHistory: 'export:delete-history',
  exportReveal: 'export:reveal',

  /** 日志流 */
  logTail: 'log:tail'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

/** 主进程 → 渲染层的单向推送事件 */
export const IPC_EVENTS = {
  log: 'event:log',
  progress: 'event:progress',
  workspaceChanged: 'event:workspace-changed',
  historyChanged: 'event:history-changed'
} as const

export type IpcEventName = (typeof IPC_EVENTS)[keyof typeof IPC_EVENTS]

/** 统一返回信封：渲染层不需要 try/catch，按 ok 分支处理即可 */
export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: IpcErrorPayload }

export interface IpcErrorPayload {
  /** 机器可读的错误码，UI 用它决定展示形态 */
  code: ErrorCode
  message: string
  /** 给用户看的可执行建议（例如“先关闭微信再取密钥”） */
  hint?: string
  detail?: string
}

export type ErrorCode =
  | 'E_UNKNOWN'
  | 'E_NOT_FOUND'
  | 'E_PERMISSION'
  | 'E_VALIDATION'
  | 'E_WECHAT_RUNNING'
  | 'E_NO_KEY'
  | 'E_BAD_KEY'
  | 'E_DECRYPT'
  | 'E_SQLITE'
  | 'E_CANCELLED'
  | 'E_UNSUPPORTED'
