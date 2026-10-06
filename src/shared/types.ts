/**
 * 全域领域模型（shared）：主进程与渲染层共用同一份类型。
 * 这里是“单一事实来源”，任何一侧新增字段都要先改这里。
 */

/* ------------------------------------------------------------------ 工作区 */

export interface WorkspaceConfig {
  /** 工具工作目录：解密产物、导出文件、日志都落在这里 */
  workDir: string
  /** 微信数据目录（含 db_storage 的那一层，或 db_storage 本身） */
  wechatDataDir: string | null
  /** 解密产物目录（默认 <workDir>/decrypted） */
  decryptDir: string
  /** 导出产物目录（默认 <workDir>/exports） */
  exportDir: string
  /** 最近一次成功使用的密钥缓存在 <workDir>/key.txt */
  keyFilePath: string
  /** 记住的密钥（仅本机、仅内存/本地文件，不上传） */
  savedKey: string | null
  /** 界面偏好 */
  ui: UiPreferences
}

export interface UiPreferences {
  /** 主题：跟随系统 / 暖色纸感 / 冷色夜间 */
  theme: 'system' | 'paper' | 'midnight'
  /** 消息密度 */
  density: 'compact' | 'cozy'
  /** 是否默认隐藏系统消息 */
  hideSystemMessages: boolean
}

export interface WorkspacePatch {
  workDir?: string
  wechatDataDir?: string | null
  savedKey?: string | null
  ui?: Partial<UiPreferences>
}

/* ------------------------------------------------------------------ 环境 */

export type WeChatVariant = 'wechat-4x' | 'wechat-3x' | 'unknown'

export interface WeChatInstallation {
  /** 微信进程是否在运行（4.x 进程名为 Weixin.exe） */
  running: boolean
  processName: string | null
  variant: WeChatVariant
  version: string | null
  /** 安装目录 */
  installPath: string | null
  /** 找到的 db_storage 目录候选 */
  storageCandidates: string[]
}

export interface WeChatAccount {
  /** 账号目录名（wxid / 手机号 / 自定义串） */
  id: string
  /** 账号目录绝对路径 */
  root: string
  dbStoragePath: string
  /** db_storage 下的子库目录 */
  stores: { name: string; path: string; files: number; bytes: number }[]
  totalBytes: number
  lastModified: string | null
}

export interface AppInfo {
  appVersion: string
  electronVersion: string
  chromeVersion: string
  nodeVersion: string
  platform: NodeJS.Platform
  /** node:sqlite 是否可用（决定了能否在进程内直读解密库） */
  sqliteDriver: 'node:sqlite' | 'python-fallback'
  pythonAvailable: boolean
  pythonVersion: string | null
  paths: {
    userData: string
    logs: string
    config: string
  }
}

/* ------------------------------------------------------------------ 密钥 */

export type KeyStatus = 'empty' | 'malformed' | 'plausible' | 'verified' | 'rejected'

export interface KeyInspection {
  raw: string
  /** 规范化后的 64 位小写 hex，非法时为 null */
  normalized: string | null
  status: KeyStatus
  /** 字节长度，正常应为 32 */
  bytes: number
  /** 来源：手动粘贴 / key.txt / 环境变量 */
  source: 'manual' | 'file' | 'env' | 'unknown'
  message: string
}

export interface KeyVerification {
  ok: boolean
  /** 用该密钥成功解出的库数量 */
  verifiedCount: number
  tried: number
  /** 首个 16 字节 HMAC 校验通过的库 */
  sampleDb: string | null
  /** 解出的 salt 前缀，便于人工比对 */
  salt: string | null
  message: string
}

export interface KeyCandidate {
  key: string
  source: string
  path: string | null
  /** 该 key.txt 的修改时间 */
  modifiedAt: string | null
  verified: boolean
}

/* ------------------------------------------------------------------ 解密 */

export interface DbTarget {
  /** 相对 db_storage 的路径，例如 message/message_0.db */
  relPath: string
  absPath: string
  bytes: number
  /** 是否 worth decrypting（小文件/非 sqlite 会被跳过） */
  decryptable: boolean
  reason?: string
}

export interface DecryptStrategyReport {
  /** 只用主库 */
  mainOnly: DbProbeResult | null
  /** 主库 + 全部 WAL 帧 */
  walMerged: DbProbeResult | null
  /** 实际采用者 */
  chosen: 'main-only' | 'wal-merged' | 'none'
  /** 决策理由（人类可读，直接进 UI 日志） */
  reason: string
}

export interface DbProbeResult {
  strategy: 'main-only' | 'wal-merged'
  /** 解出的最新消息时间（ISO 或原始字符串） */
  newest: string | null
  /** 消息总行数 */
  rows: number
  /** 参与合并的 WAL 帧数 */
  frames: number
  /** 文件大小 % 4096 是否为 0 */
  pageAligned: boolean
  /** page 1 头部自检结果 */
  headerOk: boolean
  /** sqlite 能否读出 schema */
  schemaReadable: boolean
  /** 页 1 自检明细 */
  header: SqliteHeaderInspection | null
}

export interface SqliteHeaderInspection {
  magic: string
  pageSize: number
  reservedSpace: number
  dbSizePages: number
  actualPages: number
  textEncoding: number
}

export interface DecryptProgress {
  stage: 'scan' | 'decrypt' | 'probe' | 'choose' | 'verify' | 'done'
  file: string | null
  index: number
  total: number
  /** 0–100 */
  percent: number
  message: string
}

export interface DecryptReport {
  /** 解密产物目录 */
  outDir: string
  key: string
  files: DecryptedFile[]
  totalBytes: number
  elapsedMs: number
  /** 是否出现了被拒绝的 WAL 合并（坑 3 防护命中） */
  walGuardTriggered: boolean
}

/**
 * 已解密产物的当前状态。
 * 用于应用重启后的判态：产物还在磁盘上，但内存里没有 report，
 * 不能因此显示「尚未解密」——那是误导。
 */
export interface DecryptStatus {
  ready: boolean
  stores: { name: string; bytes: number; modified: string | null }[]
  totalBytes: number
  /** 最近一次修改时间（ISO），用于提示数据新鲜度 */
  modified: string | null
}

export interface DecryptedFile {
  relPath: string
  outPath: string
  bytes: number
  /** main-only 还是 wal-merged */
  strategy: 'main-only' | 'wal-merged' | 'skipped'
  probe: DbProbeResult | null
  skippedReason?: string
}

/* ------------------------------------------------------------------ 会话 */

export interface ConversationSummary {
  /** 会话唯一键：username（群聊为 xxx@chatroom） */
  id: string
  username: string
  displayName: string
  remark: string | null
  nickName: string | null
  alias: string | null
  kind: 'private' | 'group' | 'official' | 'system' | 'service' | 'unknown'
  avatarUrl: string | null
  lastTimestamp: number | null
  lastTimeText: string | null
  summary: string | null
  unreadCount: number
  isMine?: boolean
  messageCount?: number
  /** 定位到的消息库与表 */
  located?: ConversationLocation | null
}

export interface ConversationLocation {
  dbRelPath: string
  table: string
  rows: number
  oldest: string | null
  newest: string | null
  senderIds: Record<string, string>
  /** 判定依据：Name2Id 命中 + 发送者数量阈值 */
  reason: string
  /** 0–1，越低越不可信 */
  confidence: number
}

export interface MessageSender {
  id: number
  username: string
  displayName: string
  isMe: boolean
}

export type MessageKind =
  | 'text'
  | 'image'
  | 'voice'
  | 'video'
  | 'sticker'
  | 'file'
  | 'link'
  | 'card'
  | 'location'
  | 'transfer'
  | 'redpacket'
  | 'call'
  | 'quote'
  | 'system'
  | 'recall'
  | 'unknown'

export interface ChatMessage {
  localId: number
  serverId: string | null
  /** unix 秒 */
  timestamp: number
  timeText: string
  kind: MessageKind
  /** 原始 local_type（保留，便于排查） */
  rawType: number
  sender: MessageSender
  direction: 'in' | 'out' | 'system'
  /** 文本正文（已去掉 wxid 前缀、已解压） */
  text: string
  /** 引用/链接/文件等的附加字段 */
  extra?: MessageExtra
  /** zstd 压缩列 */
  compressed: boolean
  /** 原始字节长度，用于诊断 */
  rawBytes: number
}

export interface MessageExtra {
  title?: string
  url?: string
  fileName?: string
  fileSize?: number
  quotedText?: string
  quotedSender?: string
  appType?: number
  xml?: string
}

export interface ConversationStats {
  username: string
  displayName: string
  messageCount: number
  mine: number
  theirs: number
  system: number
  firstTime: string | null
  lastTime: string | null
  spanDays: number
  /** 每天消息量，用于迷你柱状图 */
  perDay: { date: string; count: number; mine: number; theirs: number }[]
  /** 每小时分布（0–23） */
  perHour: number[]
  topKinds: { kind: MessageKind; count: number }[]
  avgChars: number
  longestText: number
  /** 我的平均回复间隔（秒），拿不到则为 null */
  medianReplySeconds: number | null
}

export interface MessageQuery {
  username: string
  dbRelPath?: string
  table?: string
  /** 关键字（服务端过滤，命中 text） */
  keyword?: string
  kinds?: MessageKind[]
  from?: number
  to?: number
  /** 0-based */
  offset: number
  limit: number
  order: 'asc' | 'desc'
}

export interface MessagePage {
  messages: ChatMessage[]
  total: number
  hasMore: boolean
  location: ConversationLocation | null
  senders: MessageSender[]
}

/**
 * 会话增量同步结果（对话窗「实时」刷新用）。
 *
 * 说明：这不是微信推送，而是对已解密库的短轮询。微信仍在写入时，
 * 能读到多久以前的取决于最后一次解密；导出前建议先重新解密一次。
 */
export interface ConversationSync {
  /** 比 after 更新的消息，按时间升序 */
  messages: ChatMessage[]
  /** 会话表内总行数（用于判断是否真的有新增） */
  total: number
  /** 当前表内最新一条的时间戳，供下次轮询使用 */
  latestTimestamp: number | null
  /** 库的 mtime（ISO），变了说明底层数据被改写 */
  dbModified: string | null
  location: ConversationLocation | null
}

/* ------------------------------------------------------------------ 导出 */

export type ExportFormat = 'txt' | 'json' | 'csv' | 'md' | 'html'

export interface ExportRequest {
  username: string
  displayName: string
  /** 会话定位结果（没有则先自动定位） */
  location?: ConversationLocation | null
  formats: ExportFormat[]
  /** 文件名前缀，默认 displayName */
  fileName?: string
  from?: number
  to?: number
  kinds?: MessageKind[]
  /** txt 的“我”标签 */
  meLabel?: string
  /** 每条消息时间是否带秒 */
  withSeconds?: boolean
  includeSystem?: boolean
  includeStats?: boolean
  /** 附加：把泡菜鱼分析提示词一起导出 */
  includeAnalysisPrompt?: boolean
}

export interface ExportPlan {
  request: ExportRequest
  /** 预计读取的消息条数 */
  estimatedMessages: number
  /** 预计产物文件 */
  outputs: { format: ExportFormat; path: string; bytes: number | null; exists: boolean }[]
  location: ConversationLocation | null
  warnings: string[]
}

export interface ExportArtifact {
  format: ExportFormat
  path: string
  bytes: number
  lines?: number
}

export interface ExportRecord {
  id: string
  createdAt: string
  username: string
  displayName: string
  kind: ConversationSummary['kind']
  formats: ExportFormat[]
  artifacts: ExportArtifact[]
  messageCount: number
  firstTime: string | null
  lastTime: string | null
  elapsedMs: number
  location: ConversationLocation | null
  stats: ConversationStats | null
}

/* ------------------------------------------------------------------ 日志 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'success'

export interface LogEntry {
  id: number
  time: string
  level: LogLevel
  /** 归属阶段，UI 按阶段分组着色 */
  scope: 'app' | 'workspace' | 'wechat' | 'key' | 'decrypt' | 'store' | 'conversation' | 'export'
  message: string
  detail?: string
}
