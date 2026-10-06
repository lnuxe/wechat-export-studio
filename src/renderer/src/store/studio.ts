import { create } from 'zustand'
import type {
  AppInfo,
  ConversationLocation,
  ConversationStats,
  ConversationSummary,
  DecryptProgress,
  DecryptReport,
  ExportPlan,
  ExportRecord,
  ExportRequest,
  KeyVerification,
  LogEntry,
  MessageQuery,
  WorkspaceConfig
} from '@shared/types'
import { appApi, decryptApi, exportApi, keyApi, logApi, wechatApi, workspaceApi } from '../api/studio'
import { conversationApi } from '../api/conversations'
import { describeError, StudioError } from '../api/client'

export type PageKey = 'setup' | 'chats' | 'exports'

export interface Toast {
  id: number
  tone: 'info' | 'success' | 'warn' | 'error'
  title: string
  detail?: string
}

interface StudioState {
  /* 全局 */
  ready: boolean
  appInfo: AppInfo | null
  workspace: WorkspaceConfig | null
  page: PageKey
  logs: LogEntry[]
  toasts: Toast[]
  busy: string | null
  lastError: { message: string; hint?: string } | null

  /* 微信与密钥 */
  wechat: Awaited<ReturnType<typeof wechatApi.detect>> | null
  accounts: Awaited<ReturnType<typeof wechatApi.accounts>>
  selectedAccount: string | null
  keyDraft: string
  keyVerification: KeyVerification | null
  decryptPlan: Awaited<ReturnType<typeof decryptApi.plan>>
  decryptProgress: DecryptProgress | null
  decryptReport: DecryptReport | null
  /** 磁盘上现存解密产物的状态：重启后据此判「已就绪」 */
  decryptStatus: Awaited<ReturnType<typeof decryptApi.status>> | null

  /* 会话 */
  conversations: ConversationSummary[]
  /** 未过滤的会话总数（侧栏展示用，不随搜索变化） */
  conversationTotal: number
  conversationQuery: string
  selected: ConversationSummary | null
  location: ConversationLocation | null
  messages: Awaited<ReturnType<typeof conversationApi.messages>>['messages']
  messageTotal: number
  messageQuery: Omit<MessageQuery, 'username'>
  stats: ConversationStats | null
  /** 实时同步开关（对已解密库做短轮询） */
  liveMode: boolean
  /** 正在抓新消息 */
  syncing: boolean
  /** 正在往上翻旧消息 */
  loadingOlder: boolean
  /** 本轮同步带回了多少条新消息 */
  freshCount: number
  /** 底层库最后被改写的时间 */
  dbModified: string | null

  /* 导出 */
  exportPlan: ExportPlan | null
  exportRequest: Omit<ExportRequest, 'username' | 'displayName'>
  history: ExportRecord[]

  /* actions */
  bootstrap: () => Promise<void>
  setPage: (page: PageKey) => void
  toast: (toast: Omit<Toast, 'id'>) => void
  dismissToast: (id: number) => void
  clearError: () => void

  patchWorkspace: (patch: Parameters<typeof workspaceApi.patch>[0]) => Promise<void>
  refreshWechat: (path?: string) => Promise<void>
  chooseDataDir: () => Promise<void>
  selectAccount: (path: string) => Promise<void>

  setKeyDraft: (key: string) => void
  loadKeyFromFile: () => Promise<void>
  verifyKey: () => Promise<void>

  loadDecryptStatus: () => Promise<void>

  planDecrypt: () => Promise<void>
  runDecrypt: () => Promise<void>
  cancelDecrypt: () => Promise<void>

  loadConversations: (query?: string) => Promise<void>
  openConversation: (conversation: ConversationSummary) => Promise<void>
  loadMessages: (options?: { reset?: boolean }) => Promise<void>
  loadOlder: () => Promise<void>
  syncNow: (options?: { silent?: boolean }) => Promise<void>
  setLiveMode: (on: boolean) => void
  setMessageQuery: (patch: Partial<Omit<MessageQuery, 'username'>>) => Promise<void>

  planExport: (patch?: Partial<Omit<ExportRequest, 'username' | 'displayName'>>) => Promise<void>
  runExport: () => Promise<void>
  loadHistory: () => Promise<void>
  deleteHistory: (id: string) => Promise<void>
}

const initialMessageQuery: Omit<MessageQuery, 'username'> = {
  offset: 0,
  limit: 80,
  order: 'desc'
}

const initialExportRequest: Omit<ExportRequest, 'username' | 'displayName'> = {
  formats: ['txt', 'html'],
  withSeconds: true,
  includeStats: true,
  includeSystem: true,
  includeAnalysisPrompt: false
}

let toastSeq = 0

/**
 * 自检轨迹：只有 window.__studioTrace 存在时才记录（`--wes-ui-flow` 会注入）。
 * 生产运行下是个空操作，用来在自检里断言「某个动作真的把数据取回来了」。
 */
function trace(event: string, detail?: unknown): void {
  const target = (globalThis as unknown as { __studioTrace?: string[] }).__studioTrace
  if (Array.isArray(target)) target.push(`${event}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`)
}

export const useStudio = create<StudioState>((set, get) => ({
  ready: false,
  appInfo: null,
  workspace: null,
  page: 'setup',
  logs: [],
  toasts: [],
  busy: null,
  lastError: null,

  wechat: null,
  accounts: [],
  selectedAccount: null,
  keyDraft: '',
  keyVerification: null,
  decryptPlan: [],
  decryptProgress: null,
  decryptReport: null,
  decryptStatus: null,

  conversations: [],
  conversationTotal: 0,
  conversationQuery: '',
  selected: null,
  location: null,
  messages: [],
  messageTotal: 0,
  messageQuery: { ...initialMessageQuery },
  stats: null,
  liveMode: true,
  syncing: false,
  loadingOlder: false,
  freshCount: 0,
  dbModified: null,

  exportPlan: null,
  exportRequest: { ...initialExportRequest },
  history: [],

  /* ------------------------------------------------------------- 引导 */

  bootstrap: async () => {
    try {
      const [info, workspace, logs] = await Promise.all([appApi.info(), workspaceApi.get(), logApi.tail(200)])
      set({ appInfo: info, workspace, logs, keyDraft: workspace.savedKey ?? '' })

      // 先挂事件，再置 ready：否则「环境探测」期间产生的日志会丢
      window.studio.on('event:log', (entry) => {
        set((state) => ({ logs: [...state.logs.slice(-400), entry] }))
      })
      window.studio.on('event:progress', (progress) => set({ decryptProgress: progress }))
      window.studio.on('event:workspace-changed', (next) => set({ workspace: next }))
      window.studio.on('event:history-changed', (records) => set({ history: records }))

      // 首屏立刻可用；环境探测（可能要跑有界深度搜索）放到后台，避免白屏等待
      set({ ready: true })
      void get().loadHistory()
      void get().loadDecryptStatus()
      void get().refreshWechat()
    } catch (error) {
      const described = describeError(error)
      set({ ready: true, lastError: described })
      get().toast({ tone: 'error', title: '初始化失败', detail: described.message })
    }
  },

  setPage: (page) => set({ page }),

  toast: (toast) => {
    const id = ++toastSeq
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }))
    setTimeout(() => get().dismissToast(id), toast.tone === 'error' ? 8000 : 4200)
  },

  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  clearError: () => set({ lastError: null }),

  /* ----------------------------------------------------------- 工作区 */

  patchWorkspace: async (patch) => {
    const workspace = await workspaceApi.patch(patch)
    set({ workspace })
  },

  refreshWechat: async (path) => {
    trace('refreshWechat:start', path ?? null)
    try {
      const [wechat, accounts] = await Promise.all([wechatApi.detect(), wechatApi.accounts(path)])
      set({ wechat, accounts })
      trace('refreshWechat:accounts', accounts.length)
      const current = get().workspace?.wechatDataDir ?? null
      const stillValid = Boolean(current) && accounts.some((account) => account.dbStoragePath === current)
      if (stillValid && current) {
        set({ selectedAccount: current })
        trace('refreshWechat:keep-current', current)
        await get().loadConversations()
        // 重启后补齐解密计划与产物状态，否则管线页会是「还没有解密计划」
        void get().planDecrypt()
        void get().loadDecryptStatus()
      } else if (accounts[0]) {
        await get().selectAccount(accounts[0].dbStoragePath)
      }
    } catch (error) {
      const described = describeError(error)
      trace('refreshWechat:error', described.message)
      get().toast({ tone: 'warn', title: '微信环境探测失败', detail: described.message })
    }
  },

  chooseDataDir: async () => {
    const picked = await appApi.pickDirectory({ title: '选择微信数据目录（含 db_storage 的账号目录）' })
    if (!picked) return
    await get().refreshWechat(picked)
  },

  selectAccount: async (path) => {
    trace('selectAccount', path)
    set({ selectedAccount: path, keyVerification: null, decryptReport: null, decryptPlan: [] })
    await get().patchWorkspace({ wechatDataDir: path })
    await get().loadConversations()
    void get().planDecrypt()
  },

  /* --------------------------------------------------------------- 密钥 */

  setKeyDraft: (key) => set({ keyDraft: key.trim(), keyVerification: null }),

  loadKeyFromFile: async () => {
    try {
      const inspection = await keyApi.fromFile()
      if (!inspection.normalized) {
        get().toast({ tone: 'warn', title: '没找到密钥文件', detail: inspection.message })
        return
      }
      set({ keyDraft: inspection.normalized })
      get().toast({ tone: 'success', title: '已读取密钥', detail: inspection.message })
      await get().verifyKey()
    } catch (error) {
      const described = describeError(error)
      get().toast({ tone: 'error', title: '读取密钥失败', detail: described.message })
    }
  },

  verifyKey: async () => {
    const key = get().keyDraft.trim()
    const dbStoragePath = get().selectedAccount ?? get().workspace?.wechatDataDir ?? undefined
    if (!key) {
      get().toast({ tone: 'warn', title: '先填入密钥' })
      return
    }
    set({ busy: 'verify-key' })
    try {
      const verification = await keyApi.verify(key, dbStoragePath)
      set({ keyVerification: verification })
      if (verification.ok) {
        await get().patchWorkspace({ savedKey: key })
        get().toast({ tone: 'success', title: '密钥验证通过', detail: verification.message })
      } else {
        get().toast({ tone: 'error', title: '密钥无法解密', detail: verification.message })
      }
    } catch (error) {
      const described = describeError(error)
      set({ keyVerification: null })
      get().toast({ tone: 'error', title: '密钥校验失败', detail: described.hint ?? described.message })
    } finally {
      set({ busy: null })
    }
  },

  /* --------------------------------------------------------------- 解密 */

  planDecrypt: async () => {
    const dbStoragePath = get().selectedAccount ?? get().workspace?.wechatDataDir
    if (!dbStoragePath) return
    try {
      const plan = await decryptApi.plan(dbStoragePath)
      set({ decryptPlan: plan })
    } catch (error) {
      const described = describeError(error)
      get().toast({ tone: 'warn', title: '生成解密计划失败', detail: described.message })
    }
  },

  /**
   * 读磁盘上现有的解密产物。
   * 应用重启后内存里没有 report，但产物可能还在——不能因此显示「尚未解密」。
   */
  loadDecryptStatus: async () => {
    try {
      const decryptStatus = await decryptApi.status()
      set({ decryptStatus })
    } catch {
      set({ decryptStatus: null })
    }
  },

  runDecrypt: async () => {
    const dbStoragePath = get().selectedAccount ?? get().workspace?.wechatDataDir
    const key = get().keyDraft.trim()
    if (!dbStoragePath) {
      get().toast({ tone: 'warn', title: '先选择微信账号目录' })
      return
    }
    if (!key) {
      get().toast({ tone: 'warn', title: '先填入或读取密钥' })
      return
    }
    set({ busy: 'decrypt', decryptProgress: null, decryptReport: null })
    try {
      const report = await decryptApi.run({ dbStoragePath, key })
      set({ decryptReport: report, decryptProgress: null })
      const succeeded = report.files.filter((file) => file.strategy !== 'skipped').length
      get().toast({
        tone: succeeded > 0 ? 'success' : 'error',
        title: succeeded > 0 ? `解密完成：${succeeded} 个库` : '解密没有产出',
        detail: report.walGuardTriggered
          ? '检测到过期 WAL 并已拒绝合并（防护生效）'
          : `耗时 ${(report.elapsedMs / 1000).toFixed(1)}s`
      })
      await Promise.all([get().loadConversations(), get().loadDecryptStatus()])
      set({ page: 'chats' })
    } catch (error) {
      const described = describeError(error)
      get().toast({ tone: 'error', title: '解密失败', detail: described.hint ?? described.message })
    } finally {
      set({ busy: null })
    }
  },

  cancelDecrypt: async () => {
    const cancelled = await decryptApi.cancel()
    if (cancelled) get().toast({ tone: 'info', title: '已请求取消，正在收尾' })
  },

  /* --------------------------------------------------------------- 会话 */

  loadConversations: async (query) => {
    const text = query ?? get().conversationQuery
    set({ conversationQuery: text })
    trace('loadConversations:start', text)
    try {
      const conversations = await conversationApi.list({ query: text, limit: 600 })
      trace('loadConversations:ok', conversations.length)
      set((state) => ({
        conversations,
        conversationTotal: text.trim() ? state.conversationTotal : conversations.length
      }))
    } catch (error) {
      const described = describeError(error)
      trace('loadConversations:error', `${described.code ?? ''} ${described.message}`)
      if (error instanceof StudioError && error.code === 'E_NOT_FOUND') {
        set({ conversations: [] })
        return
      }
      get().toast({ tone: 'warn', title: '读取会话列表失败', detail: described.message })
    }
  },

  openConversation: async (conversation) => {
    trace('openConversation:start', conversation.username)
    set({
      selected: conversation,
      messages: [],
      messageTotal: 0,
      stats: null,
      freshCount: 0,
      dbModified: null,
      location: conversation.located ?? null,
      messageQuery: { ...initialMessageQuery }
    })
    try {
      const location = await conversationApi.locate(conversation.username)
      trace('openConversation:locate', location ? location.table : null)
      set({ location })
      if (!location) {
        get().toast({
          tone: 'warn',
          title: '没找到这个消息表',
          detail: '可能在未解密的 message 库里，试试重新解密'
        })
        return
      }
      await get().loadMessages({ reset: true })
      trace('openConversation:messages', get().messages.length)
      void conversationApi
        .stats(conversation.username)
        .then((stats) => {
          trace('openConversation:stats', { mine: stats.mine, theirs: stats.theirs, count: stats.messageCount })
          set({ stats })
        })
        .catch((error: unknown) => {
          trace('openConversation:statsError', describeError(error).message)
          set({ stats: null })
        })
    } catch (error) {
      const described = describeError(error)
      trace('openConversation:error', described.message)
      get().toast({ tone: 'error', title: '定位会话失败', detail: described.message })
    }
  },

  loadMessages: async (options) => {
    const conversation = get().selected
    if (!conversation) return
    const reset = Boolean(options?.reset)
    const query = reset ? { ...get().messageQuery, offset: 0 } : get().messageQuery
    if (reset) set({ messageQuery: query, freshCount: 0 })
    set({ busy: reset ? 'messages' : null })
    try {
      const page = await conversationApi.messages({ ...query, username: conversation.username })
      set((state) => {
        if (reset) {
          return { messages: page.messages, messageTotal: page.total, location: page.location ?? state.location }
        }
        // 往上翻旧消息：新拿到的更旧，要放到数组前面
        const known = new Set(state.messages.map((message) => message.localId))
        const older = page.messages.filter((message) => !known.has(message.localId))
        return {
          messages: [...older, ...state.messages],
          messageTotal: page.total,
          location: page.location ?? state.location
        }
      })
    } catch (error) {
      const described = describeError(error)
      get().toast({ tone: 'error', title: '加载消息失败', detail: described.message })
    } finally {
      set({ busy: null })
    }
  },

  /** 往上翻一页（滚动到顶部时触发） */
  loadOlder: async () => {
    const state = get()
    const conversation = state.selected
    if (!conversation || state.loadingOlder) return
    if (state.messages.length >= state.messageTotal) return
    set({ loadingOlder: true })
    try {
      set({ messageQuery: { ...state.messageQuery, offset: state.messages.length } })
      await get().loadMessages()
    } finally {
      set({ loadingOlder: false })
    }
  },

  /**
   * 增量同步：只问「比已知最新时间更新的消息」。
   *
   * 水位线的取法是这里最容易出错的地方：
   *  - 已经有消息 → 取已加载消息的最大时间戳（用 max 而不是「最后一条」，
   *    因为翻页会把更旧的消息插到数组前面）；
   *  - 还没有消息（刚打开会话、首屏还在加载）→ 取「会话最后时间」与「当前时间」的较大者。
   *    只写 `Date.now()` 是不够的：微信库里的时间可能领先于本机时钟，
   *    那样第一轮就会把整段历史当成新消息拉回来（实测出现「2000 条新消息」的假提示）。
   */
  syncNow: async (options) => {
    const state = get()
    const conversation = state.selected
    if (!conversation || state.syncing) return

    const loadedMax = state.messages.reduce((max, message) => Math.max(max, message.timestamp), 0)
    const watermark = loadedMax > 0
      ? loadedMax
      : Math.max(conversation.lastTimestamp ?? 0, Math.floor(Date.now() / 1000))
    set({ syncing: true })
    try {
      const result = await conversationApi.sync(conversation.username, watermark)
      const known = new Set(state.messages.map((message) => message.localId))
      const fresh = result.messages.filter((message) => !known.has(message.localId))
      set((current) => ({
        dbModified: result.dbModified,
        messageTotal: result.total || current.messageTotal,
        freshCount: fresh.length > 0 ? current.freshCount + fresh.length : current.freshCount,
        messages: fresh.length > 0 ? [...current.messages, ...fresh] : current.messages
      }))
      if (fresh.length > 0 && !options?.silent) {
        get().toast({ tone: 'info', title: `收到 ${fresh.length} 条新消息` })
      }
    } catch {
      /* 同步失败不打扰用户，下一轮会重试 */
    } finally {
      set({ syncing: false })
    }
  },

  setLiveMode: (on) => {
    set({ liveMode: on, freshCount: on ? get().freshCount : 0 })
    if (on) void get().syncNow({ silent: true })
  },

  setMessageQuery: async (patch) => {
    set((state) => ({ messageQuery: { ...state.messageQuery, ...patch } }))
    await get().loadMessages({ reset: true })
  },

  /* --------------------------------------------------------------- 导出 */

  planExport: async (patch) => {
    const conversation = get().selected
    if (!conversation) return
    const exportRequest = { ...get().exportRequest, ...patch }
    set({ exportRequest, busy: 'export-plan' })
    try {
      const plan = await exportApi.plan({
        ...exportRequest,
        username: conversation.username,
        displayName: conversation.displayName,
        ...(get().location ? { location: get().location } : {})
      })
      set({ exportPlan: plan })
    } catch (error) {
      const described = describeError(error)
      get().toast({ tone: 'error', title: '导出预检失败', detail: described.hint ?? described.message })
    } finally {
      set({ busy: null })
    }
  },

  runExport: async () => {
    const conversation = get().selected
    if (!conversation) {
      get().toast({ tone: 'warn', title: '先选一个会话' })
      return
    }
    const request = {
      ...get().exportRequest,
      username: conversation.username,
      displayName: conversation.displayName,
      ...(get().location ? { location: get().location } : {})
    }
    set({ busy: 'export' })
    try {
      const record = await exportApi.run(request)
      set({ page: 'exports' })
      get().toast({
        tone: 'success',
        title: `已导出 ${record.artifacts.length} 个文件`,
        detail: `${record.messageCount} 条消息 · 耗时 ${(record.elapsedMs / 1000).toFixed(1)}s`
      })
      await get().loadHistory()
    } catch (error) {
      const described = describeError(error)
      get().toast({ tone: 'error', title: '导出失败', detail: described.hint ?? described.message })
    } finally {
      set({ busy: null })
    }
  },

  loadHistory: async () => {
    try {
      const history = await exportApi.history()
      set({ history })
    } catch {
      set({ history: [] })
    }
  },

  deleteHistory: async (id) => {
    await exportApi.remove(id)
    await get().loadHistory()
  }
}))
