import { EventEmitter } from 'node:events'
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type {
  DbTarget,
  DecryptProgress,
  DecryptReport,
  DecryptStatus,
  DecryptedFile,
  WorkspaceConfig
} from '@shared/types'
import { AppError, toAppError } from '../core/errors'
import { ensureDir, humanBytes, mtimeIso } from '../core/fsx'
import { log } from '../core/logger'
import { capabilities } from '../core/env'
import {
  chooseFreshest,
  discoverDatabases,
  isStructurallyValid,
  keyToPassphrase,
  normalizeKey,
  probeKeyOnHeader,
  readWalFrames,
  type FreshnessReading
} from './sqlcipher'
import { as, closeAll, openReadonly, type SqlValue } from './sqlite-reader'

/** 只解密这些子库：其余（head_image / MMKV / third_app_icon…）对导出聊天没有价值 */
const VALUABLE_STORES = new Set([
  'contact',
  'message',
  'session',
  'bizchat',
  'favorite',
  'sns',
  'general',
  'emoticon'
])

/**
 * message 子库里也有不参与导出的：resource（图片/视频索引）、biz_message（公众号）、
 * media（媒体元数据）。它们体积大、与纯文本导出无关，默认跳过但保留在计划里可手动勾选。
 */
const MESSAGE_STORE_SKIP = new Set(['message_resource.db', 'biz_message_0.db', 'media_0.db', 'weclaw.db'])

/** 超过这个体积的库默认不自动解，避免一次解密吃掉几分钟 */
const DEFAULT_SIZE_LIMIT = 400 * 1024 * 1024

export interface KeyProbeOutcome {
  ok: boolean
  checked: number
  sample: string | null
  salt: string | null
}

/**
 * 解密编排器。
 *
 * 单库流程 = 两条路径都跑（只用主库 / 主库 + 全部 WAL 帧）→ 按「最新消息时间、行数」择优。
 * 这一步不是保险起见，而是必须：实测存在 4MB 的过期 WAL 副本，
 * 无条件合并会把会话倒退 6 天、少 8000+ 行，而两个文件的 mtime 完全相同。
 */
export class DecryptRunner extends EventEmitter {
  private cancelled = false
  private running = false

  constructor(private readonly workspace: WorkspaceConfig) {
    super()
  }

  get isRunning(): boolean {
    return this.running
  }

  cancel(): boolean {
    if (!this.running) return false
    this.cancelled = true
    log.warn('decrypt', '收到取消请求，将在当前库处理完后停止')
    return true
  }

  private emitProgress(progress: DecryptProgress): void {
    this.emit('progress', progress)
  }

  /** 生成解密计划：列出值得解密的库及其体积 */
  plan(dbStoragePath: string): DbTarget[] {
    if (!existsSync(dbStoragePath)) {
      throw new AppError('E_NOT_FOUND', `数据目录不存在：${dbStoragePath}`, {
        hint: '在「连接微信」里重新选择 db_storage'
      })
    }
    const discovered = discoverDatabases(dbStoragePath)
    return discovered.map((db) => {
      const store = db.relPath.split('/')[0] ?? ''
      const fileName = db.relPath.split('/').pop() ?? ''
      const chatIrrelevant = store === 'message' && MESSAGE_STORE_SKIP.has(fileName)
      const decryptable = VALUABLE_STORES.has(store) && !chatIrrelevant && db.bytes <= DEFAULT_SIZE_LIMIT
      const reason = !VALUABLE_STORES.has(store)
        ? '该子库与聊天记录无关'
        : chatIrrelevant
          ? '媒体/公众号子库，纯文本导出用不到'
          : db.bytes > DEFAULT_SIZE_LIMIT
            ? `体积超过 ${humanBytes(DEFAULT_SIZE_LIMIT)}，默认跳过`
            : undefined
      return {
        relPath: db.relPath,
        absPath: db.absPath,
        bytes: db.bytes,
        decryptable,
        ...(reason ? { reason } : {})
      }
    })
  }

  /** 用某个库快速验证密钥是否有效（只解页 1，不落盘） */
  verifyKey(key: string, dbStoragePath?: string): KeyProbeOutcome {
    const normalized = normalizeKey(key)
    if (!normalized) throw new AppError('E_BAD_KEY', '密钥必须是 64 位十六进制字符串')
    const root = dbStoragePath ?? this.workspace.wechatDataDir
    if (!root) throw new AppError('E_NOT_FOUND', '还没有选择微信数据目录')
    const targets = this.plan(root).filter((t) => t.decryptable)
    const passphrase = keyToPassphrase(normalized)
    let checked = 0
    for (const target of targets.slice(0, 6)) {
      try {
        if (statSync(target.absPath).size < 4096) continue
        const head = readFileSync(target.absPath).subarray(0, 4096)
        checked += 1
        const probe = probeKeyOnHeader(head, passphrase)
        if (probe.ok) return { ok: true, checked, sample: target.relPath, salt: probe.salt }
      } catch {
        /* 换下一个库 */
      }
    }
    return { ok: false, checked, sample: null, salt: null }
  }

  /** 跑完整解密：逐库解密 → 双策略择优 → 结构自检 → 落稳定文件名 */
  async run(options: { dbStoragePath: string; key: string; targets?: string[] }): Promise<DecryptReport> {
    if (this.running) throw new AppError('E_VALIDATION', '已有解密任务在运行')
    const normalized = normalizeKey(options.key)
    if (!normalized) throw new AppError('E_BAD_KEY', '密钥必须是 64 位十六进制字符串（32 字节）')
    const caps = await capabilities()
    if (!caps.sqlite && !caps.python) {
      throw new AppError('E_UNSUPPORTED', '缺少读取 sqlite 的运行环境', {
        hint: '安装 Node 22.5+ 或 Python 3.10+ 后重试'
      })
    }

    const plan = this.plan(options.dbStoragePath)
    const selected = options.targets?.length
      ? plan.filter((t) => options.targets?.includes(t.relPath))
      : plan.filter((t) => t.decryptable)
    if (selected.length === 0) throw new AppError('E_NOT_FOUND', '没有需要解密的库')

    this.running = true
    this.cancelled = false
    const started = Date.now()
    const outDir = this.workspace.decryptDir
    ensureDir(outDir)
    await closeAll() // 解密前释放所有句柄，避免读到半成品

    const files: DecryptedFile[] = []
    let totalBytes = 0
    let walGuardTriggered = false

    try {
      for (let index = 0; index < selected.length; index += 1) {
        if (this.cancelled) break
        const target = selected[index] as DbTarget
        this.emitProgress({
          stage: 'decrypt',
          file: target.relPath,
          index,
          total: selected.length,
          percent: Math.round((index / selected.length) * 100),
          message: `解密 ${target.relPath}（${humanBytes(target.bytes)}）`
        })
        log.info('decrypt', `开始解密 ${target.relPath}（${humanBytes(target.bytes)}）`)

        try {
          const blob = readFileSync(target.absPath)
          const frames = readWalFrames(`${target.absPath}-wal`)
          const outSubDir = join(outDir, dirname(target.relPath))
          ensureDir(outSubDir)

          const outcome = await chooseFreshest({
            sourceName: target.relPath,
            key: normalized,
            blob,
            frames,
            outDir: outSubDir,
            readFreshness: (file) => this.readFreshness(file),
            onLog: (message, level) => {
              if (level === 'warn') log.warn('decrypt', message)
              else if (level === 'success') log.success('decrypt', message)
              else log.info('decrypt', message)
            }
          })

          if (outcome.chosen === 'none' || !outcome.final) {
            files.push({
              relPath: target.relPath,
              outPath: '',
              bytes: 0,
              strategy: 'skipped',
              probe: outcome.mainOnly?.probe ?? null,
              skippedReason: outcome.reason
            })
            log.error('decrypt', `${target.relPath} 解密失败：${outcome.reason}`)
            continue
          }

          if (outcome.chosen === 'main-only' && outcome.walMerged) walGuardTriggered = true

          // 择优结果落在 <name>.<strategy>.dec，再写一份稳定名 <name> 供下游固定路径读取
          const decryptedSource = outcome.final.outPath
          const stablePath = join(outSubDir, basename(target.relPath))
          if (decryptedSource && existsSync(decryptedSource)) {
            const finalData = readFileSync(decryptedSource)
            const structural = isStructurallyValid(finalData)
            if (!structural.ok) {
              log.warn('decrypt', `${target.relPath} 结构调整告警：${structural.reasons.join('；')}`)
            }
            rmSync(stablePath, { force: true })
            writeFileSync(stablePath, finalData)
            totalBytes += finalData.length
            files.push({
              relPath: target.relPath,
              outPath: stablePath,
              bytes: finalData.length,
              strategy: outcome.chosen,
              probe: outcome.final.probe
            })
          }

          this.emitProgress({
            stage: 'choose',
            file: target.relPath,
            index,
            total: selected.length,
            percent: Math.round(((index + 0.8) / selected.length) * 100),
            message: outcome.reason
          })
        } catch (error) {
          const appError = toAppError(error)
          log.error('decrypt', `${target.relPath} 解密异常：${appError.message}`)
          files.push({
            relPath: target.relPath,
            outPath: '',
            bytes: 0,
            strategy: 'skipped',
            probe: null,
            skippedReason: appError.message
          })
        }
      }

      const succeeded = files.filter((file) => file.strategy !== 'skipped')
      this.emitProgress({
        stage: 'done',
        file: null,
        index: selected.length,
        total: selected.length,
        percent: 100,
        message: `完成：成功 ${succeeded.length} / ${selected.length}`
      })

      log.success(
        'decrypt',
        `解密完成：${succeeded.length}/${selected.length} 个库，${humanBytes(totalBytes)}，` +
          `耗时 ${Math.round((Date.now() - started) / 1000)}s`
      )
      return {
        outDir,
        key: normalized,
        files,
        totalBytes,
        elapsedMs: Date.now() - started,
        walGuardTriggered
      }
    } finally {
      this.running = false
      this.cancelled = false
    }
  }

  /** 从解密产物里读「最新消息时间 + 消息行数」——择优的唯一硬判据 */
  private async readFreshness(file: string): Promise<FreshnessReading> {
    const db = await openReadonly(file)
    const tables = db.tables.filter((table) => table.startsWith('Msg_'))
    if (tables.length === 0) {
      // 非消息库（contact/session…）：能读出 schema 就算成功
      const probe = await db.get<Record<string, SqlValue>>('select count(*) as c from sqlite_master')
      return { newest: null, rows: as.num(probe?.c ?? null), note: 'ok' }
    }
    let newest: number | null = null
    let rows = 0
    for (const table of tables) {
      try {
        const row = await db.get<Record<string, SqlValue>>(
          `select count(*) as c, max(create_time) as m from "${table}"`
        )
        rows += as.num(row?.c ?? null)
        const max = as.num(row?.m ?? null)
        if (max && (newest === null || max > newest)) newest = max
      } catch {
        /* 单表坏了不致命 */
      }
    }
    return { newest, rows, note: 'ok' }
  }

  /** 解密产物摘要（概览页与「是否已解密」判态用） */
  summary(): DecryptStatus {
    const dir = this.workspace.decryptDir
    if (!existsSync(dir)) return { ready: false, stores: [], totalBytes: 0, modified: null }
    const stores: { name: string; bytes: number; modified: string | null }[] = []
    let totalBytes = 0
    let latest: string | null = null
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const storeDir = join(dir, entry.name)
      let bytes = 0
      let modified: string | null = null
      for (const file of readdirSync(storeDir, { withFileTypes: true })) {
        if (!file.isFile()) continue
        const full = join(storeDir, file.name)
        bytes += statSync(full).size
        const stamp = mtimeIso(full)
        if (stamp && (!modified || stamp > modified)) modified = stamp
      }
      if (bytes > 0) stores.push({ name: entry.name, bytes, modified })
      totalBytes += bytes
      if (modified && (!latest || modified > latest)) latest = modified
    }
    return { ready: stores.length > 0, stores, totalBytes, modified: latest }
  }
}
