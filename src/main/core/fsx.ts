import { createHash, randomUUID } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'

export { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve, sep }

export function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true })
  return dir
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    if (!existsSync(file)) return fallback
    const raw = readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
    return { ...fallback, ...(JSON.parse(raw) as object) } as T
  } catch {
    return fallback
  }
}

export function writeJsonAtomic(file: string, value: unknown): void {
  ensureDir(dirname(file))
  const tmp = `${file}.${randomUUID().slice(0, 8)}.tmp`
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  try {
    renameSync(tmp, file)
  } catch {
    // Windows 上目标被占用时 rename 会失败：退化为直接覆盖写
    writeFileSync(file, readFileSync(tmp, 'utf8'), 'utf8')
    rmSync(tmp, { force: true })
  }
}

/** Windows 文件名净化：保留中文，去掉非法字符与尾随点空格 */
export function safeFileName(input: string, fallback = 'export'): string {
  const cleaned = input
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/[\s.]+$/g, '')
    .trim()
  const trimmed = cleaned.slice(0, 80)
  return trimmed.length > 0 ? trimmed : fallback
}

export function uniquePath(dir: string, base: string, ext: string): string {
  ensureDir(dir)
  let candidate = join(dir, `${base}${ext}`)
  let n = 1
  while (existsSync(candidate)) {
    candidate = join(dir, `${base} (${n})${ext}`)
    n += 1
  }
  return candidate
}

export function fileSize(file: string): number {
  try {
    return statSync(file).size
  } catch {
    return 0
  }
}

export function mtimeIso(file: string): string | null {
  try {
    return statSync(file).mtime.toISOString()
  } catch {
    return null
  }
}

export async function dirSize(dir: string): Promise<number> {
  const { readdir, stat } = await import('node:fs/promises')
  let total = 0
  const walk = async (current: string): Promise<void> => {
    let entries: Dirent[]
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isFile()) {
        try {
          total += (await stat(full)).size
        } catch {
          /* 文件在遍历中被删掉，忽略 */
        }
      }
    }
  }
  await walk(dir)
  return total
}

/** 稳定短 id：用于导出记录、日志分组 */
export function shortHash(input: string, length = 10): string {
  return createHash('sha1').update(input).digest('hex').slice(0, length)
}

export function humanBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** idx
  return `${value >= 100 || idx === 0 ? Math.round(value) : value.toFixed(1)} ${units[idx]}`
}

export function formatTime(ts: number | null | undefined, withSeconds = false): string {
  if (!ts || !Number.isFinite(ts)) return '—'
  const d = new Date(ts * 1000)
  const p = (n: number): string => String(n).padStart(2, '0')
  const base = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  return withSeconds ? `${base}:${p(d.getSeconds())}` : base
}

/** 相对时间：刚刚 / 3 分钟前 / 昨天 12:03 / 2026-10-05 */
export function relativeTime(ts: number | null | undefined): string {
  if (!ts) return '—'
  const diff = Date.now() / 1000 - ts
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  if (diff < 86400 * 2) return `昨天 ${formatTime(ts).slice(11)}`
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`
  return formatTime(ts).slice(0, 10)
}

/** 任何用户输入路径都先规范化，避免 `..` 逃逸出工作区 */
export function assertInside(parent: string, child: string): string {
  const p = resolve(parent)
  const c = resolve(child)
  const rel = relative(p, c)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`路径越界：${c} 不在 ${p} 内`)
  }
  return c
}
