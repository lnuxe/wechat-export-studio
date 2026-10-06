import { createDecipheriv, pbkdf2Sync } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { closeSync, openSync, readdirSync, readSync, statSync, writeFileSync } from 'node:fs'
import type { DbProbeResult, SqliteHeaderInspection } from '@shared/types'
import { ensureDir, humanBytes } from '../core/fsx'
import { basename, dirname, join } from 'node:path'

/* ------------------------------------------------------- 微信 4.x 的加密参数 */

/**
 * 这些常量不是从文档抄来的默认值，而是实测出来的（4.1.15.13 / 4.1.16）：
 *  - reserve = 80，页内先 16 字节 IV（偏移 4016），后 64 字节 HMAC
 *  - 页 1 的密文只有 [16:4016]，明文 = "SQLite format 3\0" + 解密体，必须补齐到 4096
 *  - KDF 是 PBKDF2-HMAC-SHA512 × 256000，salt 取库文件头 16 字节
 * 改动其中任意一个都会得到「页 1 看着正常、后面全是随机字节」这种最坑的结果。
 */
export const PAGE_SIZE = 4096
export const RESERVE = 80
export const IV_OFFSET = PAGE_SIZE - RESERVE // 4016
export const CT_END = PAGE_SIZE - RESERVE // 4016
export const SALT_LEN = 16
export const KDF_ITERATIONS = 256_000
export const WAL_FRAME_SIZE = 24 + PAGE_SIZE
export const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'latin1')
const VALID_BTREE_TYPES = new Set([0x02, 0x05, 0x0a, 0x0d])
const WAL_MAGIC = new Set([0x377f0682, 0x377f0683])

/* ------------------------------------------------------------------- 密钥 */

export function normalizeKey(raw: string): string | null {
  const trimmed = raw.trim().replace(/[\s"']/g, '')
  const hex = trimmed.startsWith('0x') || trimmed.startsWith('0X') ? trimmed.slice(2) : trimmed
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return null
  return hex.toLowerCase()
}

export function keyToPassphrase(key: string): Buffer {
  const normalized = normalizeKey(key)
  if (!normalized) throw new Error('密钥必须是 64 位十六进制字符串')
  return Buffer.from(normalized, 'hex')
}

function deriveEncKey(passphrase: Buffer, salt: Buffer): Buffer {
  return pbkdf2Sync(passphrase, salt, KDF_ITERATIONS, 32, 'sha512')
}

/* --------------------------------------------------------------- 单页解密 */

/** 解一页；始终返回恰好 PAGE_SIZE 字节 */
export function decryptPage(page: Buffer, encKey: Buffer, pageNumber: number): Buffer {
  const iv = page.subarray(IV_OFFSET, IV_OFFSET + 16)
  const decipher = createDecipheriv('aes-256-cbc', encKey, iv)
  decipher.setAutoPadding(false)
  if (pageNumber === 1) {
    const body = Buffer.concat([decipher.update(page.subarray(SALT_LEN, CT_END)), decipher.final()])
    const out = Buffer.alloc(PAGE_SIZE)
    SQLITE_MAGIC.copy(out, 0)
    body.copy(out, SQLITE_MAGIC.length)
    return out
  }
  const body = Buffer.concat([decipher.update(page.subarray(0, CT_END)), decipher.final()])
  if (body.length === PAGE_SIZE) return body
  const out = Buffer.alloc(PAGE_SIZE)
  body.copy(out, 0, 0, Math.min(body.length, PAGE_SIZE))
  return out
}

/* ----------------------------------------------------------- 密钥可用性判定 */

/**
 * 判断密钥对某个库是否有效。
 *
 * 判据只用「页 1 解出来是不是 SQLite magic」——为什么不校验页尾的 64 字节标签：
 * 实测 4.1.15.13 的页尾标签与 SQLCipher 标准 HMAC（含/不含 pgno、各种拼接顺序）
 * 全部对不上，WCDB 显然改过 MAC 方案。与其把一个失效的校验当成「已验证」，
 * 不如只保留唯一可靠的判据：解密后能否读出 schema。
 */
export function probeKeyOnHeader(blob: Buffer, passphrase: Buffer): { ok: boolean; salt: string } {
  if (blob.length < PAGE_SIZE) return { ok: false, salt: blob.subarray(0, SALT_LEN).toString('hex') }
  const salt = blob.subarray(0, SALT_LEN)
  const encKey = deriveEncKey(passphrase, salt)
  const page = decryptPage(blob.subarray(0, PAGE_SIZE), encKey, 1)
  return { ok: page.subarray(0, 16).equals(SQLITE_MAGIC), salt: salt.toString('hex') }
}

/* ------------------------------------------------------------- 整库解密 */

export interface DecryptBlobResult {
  data: Buffer
  pages: number
  /** 抽样页 b-tree 类型不合法数量（自由页会天然命中，只作参考） */
  sampledBad: number
  sampledTotal: number
}

export function decryptDatabase(blob: Buffer, passphrase: Buffer, options?: { sample?: number }): DecryptBlobResult {
  const salt = blob.subarray(0, SALT_LEN)
  const encKey = deriveEncKey(passphrase, salt)
  const pages = Math.floor(blob.length / PAGE_SIZE)
  const out = Buffer.alloc(pages * PAGE_SIZE)

  for (let i = 0; i < pages; i += 1) {
    decryptPage(blob.subarray(i * PAGE_SIZE, (i + 1) * PAGE_SIZE), encKey, i + 1).copy(out, i * PAGE_SIZE)
  }

  const step = Math.max(1, Math.floor(pages / (options?.sample ?? 64)))
  let sampledBad = 0
  let sampledTotal = 0
  for (let pg = 2; pg <= pages; pg += step) {
    sampledTotal += 1
    if (!VALID_BTREE_TYPES.has(out[(pg - 1) * PAGE_SIZE] ?? 0xff)) sampledBad += 1
  }
  return { data: out, pages, sampledBad, sampledTotal }
}

/* ---------------------------------------------------------------- WAL */

export interface WalFrame {
  pageNumber: number
  page: Buffer
  salt: Buffer
}

/**
 * 读出 WAL 里全部帧。
 * 注意：同一个 WAL 文件内 salt 会多次轮换（每次重启写新 salt），
 * 所以遇到 salt 变化绝不能 break——那样只会读到最初十几帧。
 */
export function readWalFrames(walPath: string): WalFrame[] {
  let fd: number | null = null
  try {
    const size = statSync(walPath).size
    if (size < 32 + WAL_FRAME_SIZE) return []
    fd = openSync(walPath, 'r')
    const header = Buffer.alloc(32)
    readSync(fd, header, 0, 32, 0)
    if (!WAL_MAGIC.has(header.readUInt32BE(0))) return []
    if (header.readUInt32BE(8) !== PAGE_SIZE) return []
    const frameCount = Math.floor((size - 32) / WAL_FRAME_SIZE)
    const frames: WalFrame[] = []
    const buffer = Buffer.alloc(WAL_FRAME_SIZE)
    let offset = 32
    for (let i = 0; i < frameCount; i += 1) {
      readSync(fd, buffer, 0, WAL_FRAME_SIZE, offset)
      offset += WAL_FRAME_SIZE
      const pageNumber = buffer.readUInt32BE(0)
      if (pageNumber === 0) continue
      frames.push({
        pageNumber,
        page: Buffer.from(buffer.subarray(24, WAL_FRAME_SIZE)),
        salt: Buffer.from(buffer.subarray(8, 16))
      })
    }
    return frames
  } catch {
    return []
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

/** 把帧按页号覆盖到主库镜像上（同页多帧时后写的胜出） */
export function mergeWal(blob: Buffer, frames: WalFrame[]): Buffer {
  const maxPage = frames.reduce((max, f) => Math.max(max, f.pageNumber), 0)
  const need = Math.max(blob.length, maxPage * PAGE_SIZE)
  const out = Buffer.alloc(need)
  blob.copy(out, 0)
  for (const frame of frames) {
    frame.page.copy(out, (frame.pageNumber - 1) * PAGE_SIZE)
  }
  return out
}

/* ------------------------------------------------------------- 结构自检 */

export function inspectHeader(data: Buffer): SqliteHeaderInspection | null {
  if (data.length < 100 || !data.subarray(0, 16).equals(SQLITE_MAGIC)) return null
  const rawPageSize = data.readUInt16BE(16)
  return {
    magic: 'SQLite format 3',
    pageSize: rawPageSize === 1 ? 65536 : rawPageSize,
    reservedSpace: data.readUInt8(20),
    dbSizePages: data.readUInt32BE(28),
    actualPages: Math.floor(data.length / PAGE_SIZE),
    textEncoding: data.readUInt32BE(56)
  }
}

export function isStructurallyValid(data: Buffer, sample = 64): { ok: boolean; reasons: string[] } {
  const reasons: string[] = []
  if (data.length === 0) return { ok: false, reasons: ['解密结果为空'] }
  if (data.length % PAGE_SIZE !== 0) reasons.push(`文件大小 ${data.length} 不是 4096 的整数倍`)
  if (!data.subarray(0, 16).equals(SQLITE_MAGIC)) {
    reasons.push('页 1 缺少 SQLite magic（多半是密钥不对）')
    return { ok: false, reasons }
  }
  const header = inspectHeader(data)
  if (header && header.pageSize !== PAGE_SIZE) reasons.push(`页 1 头 page_size=${header.pageSize}`)
  const pages = Math.floor(data.length / PAGE_SIZE)
  const step = Math.max(1, Math.floor(pages / sample))
  let bad = 0
  let total = 0
  for (let pg = 2; pg <= pages; pg += step) {
    total += 1
    if (!VALID_BTREE_TYPES.has(data[(pg - 1) * PAGE_SIZE] ?? 0xff)) bad += 1
  }
  if (total > 0 && bad > total * 0.2) {
    reasons.push(`${bad}/${total} 个抽样页首字节不是合法 b-tree 类型（IV 偏移错是最常见原因）`)
  }
  return { ok: reasons.length === 0, reasons }
}

/* ------------------------------------------------------- 库文件发现与落盘 */

export interface DiscoveredDb {
  relPath: string
  absPath: string
  bytes: number
  /** 侧边 WAL 大小 */
  walBytes: number
}

const SKIP_SUFFIX = ['.db-shm', '.db-wal', '.db-first.material', '.db-last.material', '.db-incremental.material', '.kvdb', '.kvdb-shm', '.kvdb-wal']

/** 扫描 db_storage，挑出所有 SQLCipher 库（*.db，排除 -shm/-wal/material/kvdb） */
export function discoverDatabases(dbStorage: string): DiscoveredDb[] {
  const found: DiscoveredDb[] = []
  const walk = (dir: string, depth: number): void => {
    if (depth > 2) return
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full, depth + 1)
        continue
      }
      if (!entry.name.endsWith('.db')) continue
      if (SKIP_SUFFIX.some((s) => entry.name.endsWith(s))) continue
      try {
        const stat = statSync(full)
        if (stat.size < PAGE_SIZE * 2) continue
        // 未加密的库（明文头）不需要解密，直接标注跳过
        const head = Buffer.alloc(16)
        const fd = openSync(full, 'r')
        readSync(fd, head, 0, 16, 0)
        closeSync(fd)
        if (head.equals(SQLITE_MAGIC)) continue
        const walPath = `${full}-wal`
        let walBytes = 0
        try {
          walBytes = statSync(walPath).size
        } catch {
          walBytes = 0
        }
        found.push({
          relPath: full.slice(dbStorage.length + 1).replace(/\\/g, '/'),
          absPath: full,
          bytes: stat.size,
          walBytes
        })
      } catch {
        /* 忽略读不到的文件 */
      }
    }
  }
  walk(dbStorage, 0)
  return found.sort((a, b) => b.bytes - a.bytes)
}

export function writeDecrypted(outPath: string, data: Buffer): string {
  ensureDir(dirname(outPath))
  writeFileSync(outPath, data)
  return outPath
}

/* ------------------------------------------------- 择优：主库 vs 主库+WAL */

export interface CandidateResult {
  probe: DbProbeResult
  data: Buffer
  outPath: string | null
}

export interface FreshnessReading {
  newest: number | null
  rows: number
  note: string
}

/**
 * 从解密后的库里读「最新消息时间 + 消息总行数」。
 * 这是唯一能证伪「数据是否最新」的判据：主库与 WAL 的 mtime 完全相同，
 * 时间戳不可信，只能看数据本身。
 */
export type FreshnessReader = (file: string) => Promise<FreshnessReading>

export interface ChooseFreshOptions {
  sourceName: string
  key: string
  blob: Buffer
  frames: WalFrame[]
  /** 落盘目录；传 null 表示只在内存里比（用于快速预检） */
  outDir: string | null
  readFreshness: FreshnessReader
  onLog?: (message: string, level?: 'info' | 'warn' | 'success') => void
}

export interface ChooseFreshOutcome {
  chosen: 'main-only' | 'wal-merged' | 'none'
  reason: string
  mainOnly: CandidateResult | null
  walMerged: CandidateResult | null
  final: CandidateResult | null
}

/**
 * 跑两条路径（只用主库 / 主库+全部 WAL 帧），按「最新消息时间 → 消息总行数」择优。
 *
 * 为什么必须有第二判据：另一个活跃会话会把两条路径的 max(create_time) 拉到同一个值，
 * 此时只有行数能暴露「WAL 是过期代、合并后凭空少几千行」。
 */
export async function chooseFreshest(options: ChooseFreshOptions): Promise<ChooseFreshOutcome> {
  const { sourceName, key, blob, frames, outDir, readFreshness, onLog } = options
  const passphrase = keyToPassphrase(key)

  const build = async (
    strategy: 'main-only' | 'wal-merged',
    input: Buffer,
    frameCount: number
  ): Promise<CandidateResult> => {
    const decrypted = decryptDatabase(input, passphrase)
    const structural = isStructurallyValid(decrypted.data)
    const header = inspectHeader(decrypted.data)
    const probe: DbProbeResult = {
      strategy,
      newest: null,
      rows: 0,
      frames: frameCount,
      pageAligned: decrypted.data.length % PAGE_SIZE === 0,
      headerOk: header !== null && header.pageSize === PAGE_SIZE,
      schemaReadable: false,
      header
    }
    let outPath: string | null = null
    if (outDir) {
      const suffix = strategy === 'main-only' ? 'mainonly.dec' : 'walmerged.dec'
      outPath = writeDecrypted(join(outDir, `${basename(sourceName, '.db')}.${suffix}`), decrypted.data)
      try {
        const reading = await readFreshness(outPath)
        probe.newest = reading.newest ? new Date(reading.newest * 1000).toISOString() : null
        probe.rows = reading.rows
        probe.schemaReadable = reading.note === 'ok'
      } catch (error) {
        probe.newest = null
        probe.rows = 0
        probe.schemaReadable = false
        onLog?.(`${sourceName} 的 ${strategy} 产物无法读取：${(error as Error).message}`, 'warn')
      }
    }
    if (!structural.ok) {
      onLog?.(`${sourceName} [${strategy}] 结构自检未通过：${structural.reasons.join('；')}`, 'warn')
    }
    return { probe, data: decrypted.data, outPath }
  }

  const mainOnly = await build('main-only', blob, 0)
  let walMerged: CandidateResult | null = null
  if (frames.length > 0) {
    walMerged = await build('wal-merged', mergeWal(blob, frames), frames.length)
  }

  const usable = [mainOnly, walMerged].filter((c): c is CandidateResult => c !== null && c.probe.schemaReadable)
  if (usable.length === 0) {
    return {
      chosen: 'none',
      reason: '两种策略解出的库都无法读出 schema，请先确认密钥是否正确',
      mainOnly,
      walMerged,
      final: null
    }
  }

  const score = (c: CandidateResult): [number, number] => [
    c.probe.newest ? Date.parse(c.probe.newest) : 0,
    c.probe.rows
  ]
  usable.sort((a, b) => {
    const [at, ar] = score(a)
    const [bt, br] = score(b)
    return bt - at || br - ar
  })
  const best = usable[0] as CandidateResult
  const loser = usable[1]
  const reason = loser
    ? `${best.probe.strategy} 胜出（newest=${best.probe.newest ?? 'n/a'} rows=${best.probe.rows}）；` +
      `${loser.probe.strategy} 被拒（newest=${loser.probe.newest ?? 'n/a'} rows=${loser.probe.rows}）`
    : `${best.probe.strategy} 是唯一可用结果（newest=${best.probe.newest ?? 'n/a'} rows=${best.probe.rows}）`

  if (loser && loser.probe.strategy === 'wal-merged' && best.probe.strategy === 'main-only') {
    onLog?.(
      `${sourceName}：WAL 合并结果更旧（少 ${best.probe.rows - loser.probe.rows} 行），已拒绝合并 —— 这正是「坑 3」`,
      'warn'
    )
  }
  return { chosen: best.probe.strategy, reason, mainOnly, walMerged, final: best }
}

export { humanBytes }
