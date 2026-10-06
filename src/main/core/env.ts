import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * 运行时能力探测。
 *
 * 为什么需要它：读取解密后的微信库有两个可能的后端——
 *  1. `node:sqlite`（Electron 内置 Node 自带，零依赖、最快）
 *  2. 外部 python3 的 sqlite3（老版本 Electron 或 Node 未编译 sqlite 时兜底）
 * 启动时探测一次并缓存，后面所有 DB 读取都按这个结果选实现。
 */
export interface RuntimeCapabilities {
  sqlite: boolean
  sqliteVersion: string | null
  python: boolean
  pythonCommand: string | null
  pythonVersion: string | null
}

let cached: RuntimeCapabilities | null = null

async function probeSqlite(): Promise<{ ok: boolean; version: string | null }> {
  try {
    const mod = (await import('node:sqlite')) as typeof import('node:sqlite')
    const db = new mod.DatabaseSync(':memory:')
    try {
      const row = db.prepare('select sqlite_version() as v').get() as { v?: string } | undefined
      return { ok: true, version: row?.v ?? null }
    } finally {
      db.close()
    }
  } catch {
    return { ok: false, version: null }
  }
}

async function probePython(): Promise<{ ok: boolean; command: string | null; version: string | null }> {
  const candidates = process.platform === 'win32' ? ['python', 'python3', 'py'] : ['python3', 'python']
  for (const command of candidates) {
    try {
      const { stdout } = await run(command, ['-c', 'import sqlite3,sys;print(sys.version.split()[0])'], {
        timeout: 4000,
        windowsHide: true
      })
      const version = stdout.trim()
      if (version) return { ok: true, command, version }
    } catch {
      /* 换下一个候选 */
    }
  }
  return { ok: false, command: null, version: null }
}

export async function capabilities(): Promise<RuntimeCapabilities> {
  if (cached) return cached
  const [sqlite, python] = await Promise.all([probeSqlite(), probePython()])
  cached = {
    sqlite: sqlite.ok,
    sqliteVersion: sqlite.version,
    python: python.ok,
    pythonCommand: python.command,
    pythonVersion: python.version
  }
  return cached
}

/** python 可执行文件的绝对路径（找不到就返回 null，调用方自行降级） */
export function pythonExecutable(): string | null {
  const fromEnv = process.env.PYTHON ?? process.env.PYTHON3
  if (fromEnv && existsSync(fromEnv)) return fromEnv
  return cached?.python ? cached.pythonCommand : null
}
