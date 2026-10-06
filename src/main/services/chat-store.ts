import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type {
  ChatMessage,
  ConversationLocation,
  ConversationStats,
  ConversationSummary,
  ConversationSync,
  MessageKind,
  MessagePage,
  MessageQuery,
  MessageSender
} from '@shared/types'
import { AppError } from '../core/errors'
import { log } from '../core/logger'
import { formatTime, mtimeIso } from '../core/fsx'
import { as, openReadonly, type SqliteReader, type SqlValue } from './sqlite-reader'
import { decodeMessage, kindPlaceholder, sanitizeText, type RawMessageRow } from './message-codec'
import type { WorkspaceConfig } from '@shared/types'

/** 会话定位的扫描上限：极端情况下避免把 UI 卡死 */
const MAX_TABLES_PER_DB = 400
const MAX_TABLES_TOTAL = 900

/**
 * 取消息的 SELECT 片段。
 *
 * `CAST(message_content AS BLOB)` 不是可有可无的：该列的声明类型是 TEXT，
 * 但微信往里存的是 BLOB 字节（压缩体/密文）。SQLite 的类型亲和性会把它按文本处理，
 * node:sqlite 再按 UTF-8 解码 —— 非法字节被替换成 U+FFFD，原始数据在到达 JS 之前就毁了。
 * 实测正是这一步让 17% 的消息变成乱码（本来正常的三个汉字被解成一串替换符）。
 */
const MESSAGE_COLUMNS =
  'local_id, real_sender_id, local_type, create_time, CAST(message_content AS BLOB) AS message_content, WCDB_CT_message_content'

interface ContactRow {
  username: string
  localType: number
  alias: string
  remark: string
  nickName: string
  bigHeadUrl: string
  smallHeadUrl: string
}

interface SessionRow {
  username: string
  summary: string
  lastTimestamp: number
  unread: number
  isHidden: number
}

interface CacheEntry<T> {
  value: T
  at: number
}

const CACHE_TTL = 60_000

/**
 * 解密库访问层。
 *
 * 职责边界：只负责「怎么从解密后的 sqlite 里取出会话与消息」，
 * 不负责解密（sqlcipher.ts）、不负责导出（export-*.ts）、不负责 IPC。
 */
export class ChatStore {
  private contacts: CacheEntry<Map<string, ContactRow>> | null = null
  private sessions: CacheEntry<SessionRow[]> | null = null
  /** 每个 message 库的 Name2Id 映射各自缓存（rowid 语义在不同库间不通用） */
  private nameMaps = new Map<string, CacheEntry<Map<number, string>>>()
  private owner: CacheEntry<string | null> | null = null
  private locationCache = new Map<string, ConversationLocation | null>()

  constructor(private readonly workspace: WorkspaceConfig) {}

  /* ------------------------------------------------------------ 基础设施 */

  private get decryptDir(): string {
    return this.workspace.decryptDir
  }

  private contactDbPath(): string {
    return join(this.decryptDir, 'contact', 'contact.db')
  }

  private sessionDbPath(): string {
    return join(this.decryptDir, 'session', 'session.db')
  }

  messageDbPaths(): string[] {
    const dir = join(this.decryptDir, 'message')
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter((f) => /^message_\d+\.db$/.test(f))
      .sort()
      .map((f) => join(dir, f))
  }

  /** 解密产物是否就绪 */
  isReady(): boolean {
    return existsSync(this.contactDbPath()) && this.messageDbPaths().length > 0
  }

  invalidate(): void {
    this.contacts = null
    this.sessions = null
    this.nameMaps.clear()
    this.owner = null
    this.locationCache.clear()
  }

  /* -------------------------------------------------------------- 基础表 */

  async contactMap(): Promise<Map<string, ContactRow>> {
    if (this.contacts && Date.now() - this.contacts.at < CACHE_TTL) return this.contacts.value
    const map = new Map<string, ContactRow>()
    const path = this.contactDbPath()
    if (existsSync(path)) {
      try {
        const db = await openReadonly(path)
        const rows = await db.all<Record<string, SqlValue>>(
          'select username, local_type, alias, remark, nick_name, big_head_url, small_head_url from contact'
        )
        for (const row of rows) {
          const username = as.text(row.username ?? null)
          if (!username) continue
          map.set(username, {
            username,
            localType: as.num(row.local_type ?? null),
            alias: as.text(row.alias ?? null),
            remark: as.text(row.remark ?? null),
            nickName: as.text(row.nick_name ?? null),
            bigHeadUrl: as.text(row.big_head_url ?? null),
            smallHeadUrl: as.text(row.small_head_url ?? null)
          })
        }
        log.debug('store', `通讯录载入 ${map.size} 条`)
      } catch (error) {
        // 实测有个别库存在坏页，读不全也要继续——只是显示名会退化
        log.warn('store', `通讯录读取不完整：${(error as Error).message}`)
      }
    }
    this.contacts = { value: map, at: Date.now() }
    return map
  }

  async sessionList(): Promise<SessionRow[]> {
    if (this.sessions && Date.now() - this.sessions.at < CACHE_TTL) return this.sessions.value
    const path = this.sessionDbPath()
    if (!existsSync(path)) {
      this.sessions = { value: [], at: Date.now() }
      return []
    }
    const db = await openReadonly(path)
    const rows = await db.all<Record<string, SqlValue>>(
      'select username, summary, last_timestamp, unread_count, is_hidden from SessionTable'
    )
    const value: SessionRow[] = rows.map((row) => ({
      username: as.text(row.username ?? null),
      summary: as.text(row.summary ?? null),
      lastTimestamp: as.num(row.last_timestamp ?? null),
      unread: as.num(row.unread_count ?? null),
      isHidden: as.num(row.is_hidden ?? null)
    }))
    this.sessions = { value, at: Date.now() }
    return value
  }

  /** 会话列表（session.db ⨝ contact.db），按最后消息时间倒序 */
  async listConversations(query?: string, limit = 500): Promise<ConversationSummary[]> {
    const [sessions, contacts] = await Promise.all([this.sessionList(), this.contactMap()])
    const needle = query?.trim().toLowerCase()
    const result: ConversationSummary[] = []
    for (const session of sessions) {
      if (!session.username) continue
      const contact = contacts.get(session.username)
      const displayName = displayNameOf(session.username, contact)
      if (needle) {
        const haystack = `${displayName} ${session.username} ${contact?.alias ?? ''} ${session.summary}`.toLowerCase()
        if (!haystack.includes(needle)) continue
      }
      result.push({
        id: session.username,
        username: session.username,
        displayName,
        remark: contact?.remark || null,
        nickName: contact?.nickName || null,
        alias: contact?.alias || null,
        kind: classifyConversation(session.username, contact),
        avatarUrl: contact?.smallHeadUrl || contact?.bigHeadUrl || null,
        lastTimestamp: session.lastTimestamp || null,
        lastTimeText: session.lastTimestamp ? formatTime(session.lastTimestamp) : null,
        summary: session.summary ? sanitizeText(session.summary).slice(0, 120) : null,
        unreadCount: session.unread,
        located: this.locationCache.get(session.username) ?? null
      })
    }
    result.sort((a, b) => (b.lastTimestamp ?? 0) - (a.lastTimestamp ?? 0))
    return result.slice(0, limit)
  }

  /* ---------------------------------------------------------- 消息库映射 */

  /** message 库的 Name2Id：rowid → username（判断“我”与发言人归属的唯一可靠来源） */
  private async nameMapFor(dbPath: string): Promise<Map<number, string>> {
    const db = await openReadonly(dbPath)
    const rows = await db.all<Record<string, SqlValue>>('select rowid as rid, user_name from Name2Id')
    const map = new Map<number, string>()
    for (const row of rows) {
      map.set(as.num(row.rid ?? null), as.text(row.user_name ?? null))
    }
    return map
  }

  /** 谁是我：账号目录名就是自己的 wxid（形如 wxid_xxx_3cc9，后缀是账号实例号） */
  async ownerWxid(): Promise<string | null> {
    if (this.owner && Date.now() - this.owner.at < CACHE_TTL) return this.owner.value
    const dataDir = this.workspace.wechatDataDir
    let resolved = guessOwnerWxid(dataDir)
    log.debug('store', `ownerWxid 推断：dataDir=${dataDir ?? 'null'} → ${resolved ?? 'null'}`)
    // 目录名认不出来时（手机号/自定义串账号）再用 Name2Id 兜底交叉验证
    if (!resolved && this.messageDbPaths()[0]) {
      try {
        const names = new Set((await this.nameMapFor(this.messageDbPaths()[0] as string)).values())
        resolved = [...names].find((name) => /^wxid_[A-Za-z0-9]{8,}$/.test(name)) ?? null
      } catch {
        resolved = null
      }
    }
    this.owner = { value: resolved, at: Date.now() }
    if (resolved) log.info('store', `本人 wxid：${resolved}`)
    else log.warn('store', `无法从数据目录推断本人 wxid（${this.workspace.wechatDataDir ?? '未设置'}）`)
    return resolved
  }

  /** 某个 message 库的 Name2Id（按库缓存） */
  private async sendersFor(dbPath: string): Promise<Map<number, string>> {
    const cached = this.nameMaps.get(dbPath)
    if (cached && Date.now() - cached.at < CACHE_TTL) return cached.value
    const map = await this.nameMapFor(dbPath)
    this.nameMaps.set(dbPath, { value: map, at: Date.now() })
    return map
  }

  /* ------------------------------------------------------------ 会话定位 */

  /**
   * 定位某会话所在的消息库与表。
   *
   * 不做「Msg_<md5(wxid)>」这种猜测——实测哈希与 wxid 的 MD5 不吻合，猜错只会静默返回空。
   * 可靠路径：Name2Id 拿到 rowid → 在各库各表里找 real_sender_id 命中的表。
   *
   * 两轮策略（重要）：第一轮只接受「发送者 ≤ 3」的表——这是私聊/小群的签名；
   * 找不到才放宽。只跑一轮会因为先扫到某个 msg（合并消息）表而误判「未找到」，
   * 而真正的一对一会话表其实在后面还没扫到。
   */
  async locateConversation(username: string, options?: { force?: boolean }): Promise<ConversationLocation | null> {
    if (!options?.force && this.locationCache.has(username)) return this.locationCache.get(username) ?? null

    const dbs = this.messageDbPaths()
    if (dbs.length === 0) return null

    type Candidate = ConversationLocation & { senderCount: number; dbPath: string; hitRatio: number }
    let best: Candidate | null = null
    let scanned = 0

    const scan = async (maxSenders: number): Promise<Candidate | null> => {
      let localBest: Candidate | null = null
      for (const dbPath of dbs) {
        if (scanned >= MAX_TABLES_TOTAL) break
        let db: SqliteReader
        let names: Map<number, string>
        try {
          db = await openReadonly(dbPath)
          names = await this.nameMapFor(dbPath)
        } catch (error) {
          log.warn('conversation', `${dbPath} 打开失败：${(error as Error).message}`)
          continue
        }
        const targetIds: number[] = []
        for (const [id, name] of names) if (name === username) targetIds.push(id)
        if (targetIds.length === 0) continue

        const tables = db.tables.filter((table) => table.startsWith('Msg_')).slice(0, MAX_TABLES_PER_DB)
        for (const table of tables) {
          if (scanned >= MAX_TABLES_TOTAL) break
          scanned += 1
          try {
            const agg = await db.get<Record<string, SqlValue>>(
              `select count(*) as c, min(create_time) as mn, max(create_time) as mx, count(distinct real_sender_id) as n from "${table}"`
            )
            const total = as.num(agg?.c ?? null)
            if (total === 0) continue
            const senderCount = as.num(agg?.n ?? null)
            if (senderCount > maxSenders) continue

            const hitRow = await db.get<Record<string, SqlValue>>(
              `select count(*) as c from "${table}" where real_sender_id in (${targetIds.join(',')})`
            )
            const hits = as.num(hitRow?.c ?? null)
            if (hits === 0) continue

            const senderRows = await db.all<Record<string, SqlValue>>(
              `select distinct real_sender_id as sid from "${table}"`
            )
            const senderIds: Record<string, string> = {}
            for (const row of senderRows) {
              const sid = as.num(row.sid ?? null)
              senderIds[String(sid)] = names.get(sid) ?? ''
            }
            const newest = as.num(agg?.mx ?? null)
            const candidate: Candidate = {
              dbRelPath: relativeToDecrypt(this.decryptDir, dbPath),
              table,
              rows: total,
              oldest: agg?.mn ? formatTime(as.num(agg.mn), true) : null,
              newest: newest ? formatTime(newest, true) : null,
              senderIds,
              reason: `real_sender_id 命中 ${hits}/${total} 行，表内发送者 ${senderCount} 个（阈值 ≤${maxSenders}）`,
              confidence: senderCount <= 2 ? 0.98 : senderCount <= 3 ? 0.88 : 0.6,
              senderCount,
              dbPath,
              hitRatio: hits / total
            }
            // 先比发送者数（越少越像一对一会话），再比命中比例，最后比行数
            if (
              !localBest ||
              candidate.senderCount < localBest.senderCount ||
              (candidate.senderCount === localBest.senderCount && candidate.hitRatio > localBest.hitRatio + 0.05) ||
              (candidate.senderCount === localBest.senderCount &&
                Math.abs(candidate.hitRatio - localBest.hitRatio) <= 0.05 &&
                candidate.rows > localBest.rows)
            ) {
              localBest = candidate
            }
          } catch {
            /* 单表读失败（坏页/已删除）继续 */
          }
        }
      }
      return localBest
    }

    // 第一轮：只认私聊/小群签名（≤3 个发送者）
    best = await scan(3)
    // 第二轮：仍没找到才放宽（群聊发言人多、msg 合并表发送者也多）
    if (!best && scanned < MAX_TABLES_TOTAL) best = await scan(64)

    if (!best) {
      log.warn('conversation', `未找到 ${username} 的消息表（可能在未解密的其他 message 库里）`)
      this.locationCache.set(username, null)
      return null
    }
    const { senderCount, dbPath, hitRatio, ...location } = best
    void senderCount
    void dbPath
    void hitRatio
    this.locationCache.set(username, location)
    log.success(
      'conversation',
      `${username} → ${location.dbRelPath}::${location.table}（${location.rows} 条，${location.oldest} → ${location.newest}）`
    )
    return location
  }

  private resolveDbPath(relOrAbs: string): string {
    return relOrAbs.includes(':') || relOrAbs.startsWith('\\\\') ? relOrAbs : join(this.decryptDir, relOrAbs)
  }

  /* ---------------------------------------------------------------- 消息 */

  private async decodeRows(
    dbPath: string,
    table: string,
    rows: (RawMessageRow & Record<string, SqlValue>)[],
    username: string,
    contacts: Map<string, ContactRow>,
    names: Map<number, string>
  ): Promise<ChatMessage[]> {
    const owner = await this.ownerWxid()
    const peerName = displayNameOf(username, contacts.get(username))
    const displayNameById = new Map<number, string>()
    for (const [id, name] of names) {
      const contact = contacts.get(name)
      if (contact) displayNameById.set(id, displayNameOf(name, contact))
    }
    void dbPath
    void table
    return rows.map((row) =>
      decodeMessage(row, {
        nameById: names,
        meWxid: owner,
        peerName,
        peerWxid: username,
        displayNameById
      })
    )
  }

  async queryMessages(query: MessageQuery): Promise<MessagePage> {
    const location = await this.locateConversation(query.username)
    if (!location) {
      return { messages: [], total: 0, hasMore: false, location: null, senders: [] }
    }
    const dbPath = this.resolveDbPath(location.dbRelPath)
    const db = await openReadonly(dbPath)
    const names = await this.sendersFor(dbPath)
    const contacts = await this.contactMap()

    const countRow = await db.get<Record<string, SqlValue>>(
      `select count(*) as c from "${location.table}"`
    )
    const total = as.num(countRow?.c ?? null)
    const limit = Math.max(1, Math.min(query.limit, 500))
    const offset = Math.max(0, query.offset)

    // 时间窗能直接下推到 SQL；关键字/类型过滤必须在解码后做（正文带前缀且可能被压缩）
    const needsPostFilter = Boolean(query.keyword) || (query.kinds?.length ?? 0) > 0
    let rows: (RawMessageRow & Record<string, SqlValue>)[]
    if (!needsPostFilter) {
      const start = query.order === 'desc' ? offset : Math.max(0, total - offset - limit)
      rows = await db.all<RawMessageRow & Record<string, SqlValue>>(
        `select ${MESSAGE_COLUMNS}
         from "${location.table}" order by local_id asc limit ? offset ?`,
        [limit, start]
      )
      if (query.order === 'desc') rows.reverse()
    } else {
      // 有过滤条件时先全量解码再切片：会话量级通常在万条以内，代价可接受
      const all = await db.all<RawMessageRow & Record<string, SqlValue>>(
        `select ${MESSAGE_COLUMNS}
         from "${location.table}" order by local_id asc`
      )
      const decoded = await this.decodeRows(dbPath, location.table, all, query.username, contacts, names)
      const filtered = decoded.filter((m) => matchesFilter(m, query))
      const slice =
        query.order === 'desc'
          ? filtered.slice(Math.max(0, filtered.length - offset - limit), filtered.length - offset)
          : filtered.slice(offset, offset + limit)
      if (query.order === 'desc') slice.reverse()
      return {
        messages: slice,
        total: filtered.length,
        hasMore: offset + limit < filtered.length,
        location,
        senders: buildSenderList(names, contacts, decoded)
      }
    }

    const messages = await this.decodeRows(dbPath, location.table, rows, query.username, contacts, names)
    const filtered = messages.filter((m) => inWindow(m, query))
    return {
      messages: filtered,
      total,
      hasMore: offset + limit < total,
      location,
      senders: buildSenderList(names, contacts, messages)
    }
  }

  /**
   * 增量同步：只取比 `after` 更新的消息。
   *
   * 用于对话窗的「实时」刷新。实现是短轮询 + 时间戳水位，
   * 不是微信推送——所以文案上必须诚实：它反映的是**已解密库**里的最新状态。
   */
  async syncConversation(username: string, after?: number): Promise<ConversationSync> {
    const location = await this.locateConversation(username)
    if (!location) {
      return { messages: [], total: 0, latestTimestamp: null, dbModified: null, location: null }
    }
    const dbPath = this.resolveDbPath(location.dbRelPath)
    const db = await openReadonly(dbPath)
    const names = await this.sendersFor(dbPath)
    const contacts = await this.contactMap()

    const agg = await db.get<Record<string, SqlValue>>(
      `select count(*) as c, max(create_time) as mx from "${location.table}"`
    )
    const total = as.num(agg?.c ?? null)
    const latest = as.num(agg?.mx ?? null) || null
    const dbModified = mtimeIso(dbPath)

    if (!after || (latest !== null && latest <= after)) {
      return { messages: [], total, latestTimestamp: latest, dbModified, location }
    }

    const rows = await db.all<RawMessageRow & Record<string, SqlValue>>(
      `select ${MESSAGE_COLUMNS} from "${location.table}" where create_time > ? order by local_id asc limit 200`,
      [after]
    )
    const messages = await this.decodeRows(dbPath, location.table, rows, username, contacts, names)
    return { messages, total, latestTimestamp: latest, dbModified, location }
  }

  /** 全量解码（统计与导出共用），按需截断 */
  async allMessages(username: string, limit = 200_000): Promise<{ messages: ChatMessage[]; location: ConversationLocation | null }> {
    const location = await this.locateConversation(username)
    if (!location) return { messages: [], location: null }
    const dbPath = this.resolveDbPath(location.dbRelPath)
    const db = await openReadonly(dbPath)
    const names = await this.sendersFor(dbPath)
    const contacts = await this.contactMap()
    const rows = await db.all<RawMessageRow & Record<string, SqlValue>>(
      `select ${MESSAGE_COLUMNS}
       from "${location.table}" order by local_id asc limit ?`,
      [limit]
    )
    const messages = await this.decodeRows(dbPath, location.table, rows, username, contacts, names)
    return { messages, location }
  }

  async stats(username: string): Promise<ConversationStats> {
    const { messages, location } = await this.allMessages(username, 50_000)
    const contacts = await this.contactMap()
    const displayName = displayNameOf(username, contacts.get(username))
    const perDay = new Map<string, { date: string; count: number; mine: number; theirs: number }>()
    const perHour = new Array<number>(24).fill(0)
    const kinds = new Map<MessageKind, number>()
    let mine = 0
    let theirs = 0
    let system = 0
    let chars = 0
    let longest = 0
    let first: number | null = null
    let last: number | null = null
    const replyGaps: number[] = []

    for (const message of messages) {
      if (message.direction === 'out') mine += 1
      else if (message.direction === 'in') theirs += 1
      else system += 1
      const date = new Date(message.timestamp * 1000)
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      const bucket = perDay.get(key) ?? { date: key, count: 0, mine: 0, theirs: 0 }
      bucket.count += 1
      if (message.direction === 'out') bucket.mine += 1
      if (message.direction === 'in') bucket.theirs += 1
      perDay.set(key, bucket)
      perHour[date.getHours()] = (perHour[date.getHours()] ?? 0) + 1
      kinds.set(message.kind, (kinds.get(message.kind) ?? 0) + 1)
      chars += message.text.length
      longest = Math.max(longest, message.text.length)
      if (first === null) first = message.timestamp
      last = message.timestamp
    }

    // 我的回复间隔：上一条对方消息 → 我下一条消息
    let pendingInbound: number | null = null
    for (const message of messages) {
      if (message.direction === 'in') pendingInbound = message.timestamp
      else if (message.direction === 'out' && pendingInbound !== null) {
        const gap = message.timestamp - pendingInbound
        if (gap >= 0 && gap < 86_400 * 3) replyGaps.push(gap)
        pendingInbound = null
      }
    }
    replyGaps.sort((a, b) => a - b)

    return {
      username,
      displayName,
      messageCount: messages.length,
      mine,
      theirs,
      system,
      firstTime: first ? formatTime(first, true) : null,
      lastTime: last ? formatTime(last, true) : null,
      spanDays: first && last ? Math.max(1, Math.round((last - first) / 86400)) : 0,
      perDay: [...perDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
      perHour,
      topKinds: [...kinds.entries()]
        .map(([kind, count]) => ({ kind, count }))
        .sort((a, b) => b.count - a.count),
      avgChars: messages.length ? Math.round(chars / messages.length) : 0,
      longestText: longest,
      medianReplySeconds: replyGaps.length ? (replyGaps[Math.floor(replyGaps.length / 2)] ?? null) : null,
      ...(location ? {} : {})
    }
  }

  /** 全库关键字搜索：跨会话找命中，用于「我记得她说过……」场景 */
  async searchMessages(keyword: string, limit = 40): Promise<{ username: string; displayName: string; hits: number; preview: string }[]> {
    const needle = keyword.trim().toLowerCase()
    if (needle.length < 2) return []
    const sessions = await this.sessionList()
    const contacts = await this.contactMap()
    const results: { username: string; displayName: string; hits: number; preview: string; ts: number }[] = []

    for (const session of sessions) {
      const location = await this.locateConversation(session.username)
      if (!location) continue
      const dbPath = this.resolveDbPath(location.dbRelPath)
      const db = await openReadonly(dbPath)
      const names = await this.sendersFor(dbPath)
      const rows = await db.all<RawMessageRow & Record<string, SqlValue>>(
        `select ${MESSAGE_COLUMNS}
         from "${location.table}" order by local_id asc limit 20000`
      )
      const messages = await this.decodeRows(dbPath, location.table, rows, session.username, contacts, names)
      const hits = messages.filter((m) => m.text.toLowerCase().includes(needle))
      if (hits.length === 0) continue
      const lastHit = hits[hits.length - 1]
      if (!lastHit) continue
      results.push({
        username: session.username,
        displayName: displayNameOf(session.username, contacts.get(session.username)),
        hits: hits.length,
        preview: `${lastHit.timeText} ${lastHit.sender.displayName}: ${lastHit.text.slice(0, 80)}`,
        ts: lastHit.timestamp
      })
      if (results.length >= limit) break
    }
    return results.sort((a, b) => b.ts - a.ts).map(({ ts, ...rest }) => {
      void ts
      return rest
    })
  }
}

/* ------------------------------------------------------------------ 工具 */

export function displayNameOf(username: string, contact: ContactRow | undefined): string {
  if (!contact) {
    if (username.endsWith('@chatroom')) return `群聊 ${username.slice(0, 10)}`
    if (username === 'notifymessage') return '服务通知'
    if (username === 'weixin') return '微信团队'
    return username
  }
  return contact.remark || contact.nickName || contact.alias || username
}

/**
 * 从数据目录推断「我」的 wxid。
 *
 * 目录可能是 `<root>/<账号目录>`，也可能是用户直接选中的 `<账号目录>/db_storage`，
 * 所以要往上找一两层；4.x 的账号目录形如 `wxid_xxx_3cc9`（下划线后是账号实例号，不属于 wxid）。
 */
export function guessOwnerWxid(wechatDataDir: string | null | undefined): string | null {
  const parts = (wechatDataDir ?? '').split(/[\\/]/).filter(Boolean)
  const candidates = [...parts].reverse().filter((part) => part.toLowerCase() !== 'db_storage')
  for (const part of candidates.slice(0, 3)) {
    const stripped = part.replace(/_[0-9a-f]{3,}$/i, '')
    if (/^wxid_[A-Za-z0-9]{6,}$/.test(stripped)) return stripped
  }
  return null
}

function classifyConversation(username: string, contact: ContactRow | undefined): ConversationSummary['kind'] {
  if (username.endsWith('@chatroom')) return 'group'
  if (username === 'notifymessage' || username === 'weixin' || username === 'floatbottle' || username === 'medianote') return 'system'
  if (username === 'brandsessionholder' || username.startsWith('gh_')) return 'official'
  if (username.endsWith('@openim') || username.includes('@weclaw')) return 'service'
  if (contact && (contact.localType & 8) !== 0) return 'official'
  return 'private'
}

function relativeToDecrypt(decryptDir: string, file: string): string {
  return file.startsWith(decryptDir) ? file.slice(decryptDir.length + 1).replace(/\\/g, '/') : file
}

function inWindow(message: ChatMessage, query: MessageQuery): boolean {
  if (query.from && message.timestamp < query.from) return false
  if (query.to && message.timestamp > query.to) return false
  return true
}

function matchesFilter(message: ChatMessage, query: MessageQuery): boolean {
  if (!inWindow(message, query)) return false
  if (query.kinds?.length && !query.kinds.includes(message.kind)) return false
  if (query.keyword) {
    const needle = query.keyword.trim().toLowerCase()
    const haystack = `${message.text} ${message.extra?.title ?? ''} ${message.extra?.fileName ?? ''}`.toLowerCase()
    if (!haystack.includes(needle)) return false
  }
  return true
}

function buildSenderList(
  names: Map<number, string>,
  contacts: Map<string, ContactRow>,
  messages: ChatMessage[]
): MessageSender[] {
  const seen = new Map<number, MessageSender>()
  for (const message of messages) {
    if (seen.has(message.sender.id)) continue
    const username = message.sender.username
    const contact = username ? contacts.get(username) : undefined
    seen.set(message.sender.id, {
      id: message.sender.id,
      username,
      displayName: message.sender.isMe ? '我' : displayNameOf(username, contact),
      isMe: message.sender.isMe
    })
  }
  void names
  return [...seen.values()].sort((a, b) => Number(b.isMe) - Number(a.isMe))
}

export { kindPlaceholder }
export type { ContactRow, SessionRow }
export { AppError }
