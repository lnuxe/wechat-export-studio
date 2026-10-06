import { AppError } from '../core/errors'
import { capabilities, pythonExecutable } from '../core/env'

export type SqlValue = string | number | bigint | Uint8Array | null

export interface SqliteReader {
  readonly driver: 'node:sqlite' | 'python'
  all<T = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): Promise<T[]>
  get<T = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): Promise<T | null>
  readonly tables: string[]
  close(): Promise<void>
}

const T = (value: SqlValue): string => (typeof value === 'string' ? value : String(value ?? ''))
const N = (value: SqlValue): number => {
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'string') return Number(value) || 0
  return 0
}

/**
 * 把列值还原成「原始字节」。
 *
 * 关键坑：同一列在不同行上可能是 BLOB（Uint8Array）也可能是 TEXT（string）。
 * 对 string 一律用 latin1 回编码是错的——多字节字符会被拆成多个字节导致正文乱码；
 * 实测 `message_content` 里既有 `Uint8Array`（zstd 压缩体）也有含中文的 `string`。
 * 判据：latin1 回编码后长度变大，说明含非 latin1 字符（中文），此时必须走 utf8。
 */
const B = (value: SqlValue): Buffer => {
  if (value instanceof Uint8Array) return Buffer.from(value)
  if (typeof value === 'string') {
    const latin1 = Buffer.from(value, 'latin1')
    return latin1.length === value.length ? latin1 : Buffer.from(value, 'utf8')
  }
  if (typeof value === 'bigint' || typeof value === 'number') return Buffer.from(String(value), 'utf8')
  return Buffer.alloc(0)
}
const BON = (value: SqlValue): Buffer | null => (value === null || value === undefined ? null : B(value))

export const as = { text: T, num: N, buf: B, bufOrNull: BON }

/* ------------------------------------------------------------ node:sqlite */

interface NodeSqliteStatement {
  all(...params: unknown[]): unknown[]
  get(...params: unknown[]): unknown
  run(...params: unknown[]): { changes: number | bigint }
}

interface NodeSqliteDatabase {
  prepare(sql: string): NodeSqliteStatement
  close(): void
}

async function openNodeSqlite(file: string): Promise<SqliteReader> {
  const mod = (await import('node:sqlite')) as typeof import('node:sqlite')
  // readonly: 微信库只读，避免误写坏解密产物
  const db = new mod.DatabaseSync(file, { readOnly: true }) as unknown as NodeSqliteDatabase
  const tables = (db.prepare("select name from sqlite_master where type='table'").all() as { name: unknown }[]).map((r) =>
    T(r.name as SqlValue)
  )
  return {
    driver: 'node:sqlite',
    tables,
    all: async <R>(sql: string, params: SqlValue[] = []) => db.prepare(sql).all(...params) as R[],
    get: async <R>(sql: string, params: SqlValue[] = []) => (db.prepare(sql).get(...params) as R) ?? null,
    close: async () => db.close()
  }
}

/* --------------------------------------------------- python 兜底（无原生模块时） */

const PY_BRIDGE = String.raw`
import json, sqlite3, sys, base64
path = sys.argv[1]
con = sqlite3.connect('file:' + path.replace('\\', '/') + '?mode=ro', uri=True)
def enc(v):
    if isinstance(v, (bytes, bytearray, memoryview)):
        return {'__b64__': base64.b64encode(bytes(v)).decode()}
    return v
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    req = json.loads(line)
    try:
        cur = con.execute(req['sql'], req.get('params') or [])
        cols = [d[0] for d in cur.description] if cur.description else []
        rows = cur.fetchall()
        if req.get('mode') != 'all':
            rows = rows[:1]
        payload = {'ok': True, 'rows': [dict(zip(cols, [enc(x) for x in r])) for r in rows]}
    except Exception as e:
        payload = {'ok': False, 'error': str(e)}
    sys.stdout.write(json.dumps(payload) + '\n')
    sys.stdout.flush()
`

async function openPython(file: string): Promise<SqliteReader> {
  const exe = pythonExecutable()
  if (!exe) {
    throw new AppError('E_UNSUPPORTED', '当前环境既没有 node:sqlite 也没有可用的 python3', {
      hint: '安装 Node 22.5+ 或 Python 3.10+ 后重启应用'
    })
  }
  const { spawn } = await import('node:child_process')
  const child = spawn(exe, ['-c', PY_BRIDGE, file], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  const pending: { resolve: (v: unknown) => void; reject: (e: Error) => void }[] = []
  let buffer = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk
    let idx = buffer.indexOf('\n')
    while (idx >= 0) {
      const line = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 1)
      const next = pending.shift()
      if (next) {
        try {
          next.resolve(JSON.parse(line))
        } catch (error) {
          next.reject(error as Error)
        }
      }
      idx = buffer.indexOf('\n')
    }
  })
  child.stderr.setEncoding('utf8')
  let stderr = ''
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk
  })
  child.on('exit', (code) => {
    while (pending.length) {
      pending.shift()?.reject(new AppError('E_SQLITE', `python sqlite 桥接退出（code=${code}）`, { detail: stderr }))
    }
  })

  const call = async (payload: Record<string, unknown>): Promise<{ rows: Record<string, SqlValue>[] }> => {
    const res = (await new Promise((resolve, reject) => {
      pending.push({ resolve: resolve as (v: unknown) => void, reject })
      child.stdin.write(`${JSON.stringify(payload)}\n`)
    })) as { ok: boolean; rows?: Record<string, SqlValue>[]; error?: string }
    if (!res.ok) throw new AppError('E_SQLITE', res.error ?? 'python sqlite 执行失败')
    return { rows: res.rows ?? [] }
  }

  const revive = (row: Record<string, unknown>): Record<string, SqlValue> => {
    const out: Record<string, SqlValue> = {}
    for (const [key, value] of Object.entries(row)) {
      if (value && typeof value === 'object' && '__b64__' in (value as object)) {
        out[key] = Buffer.from((value as { __b64__: string }).__b64__, 'base64')
      } else {
        out[key] = value as SqlValue
      }
    }
    return out
  }

  const tables = (await call({ sql: "select name from sqlite_master where type='table'", mode: 'all' })).rows.map((r) =>
    T(r.name ?? null)
  )

  return {
    driver: 'python',
    tables,
    all: async <R>(sql: string, params: SqlValue[] = []) => {
      const res = await call({ sql, params, mode: 'all' })
      return res.rows.map((r) => revive(r) as R)
    },
    get: async <R>(sql: string, params: SqlValue[] = []) => {
      const res = await call({ sql, params, mode: 'one' })
      const first = res.rows[0]
      return first ? (revive(first) as R) : null
    },
    close: async () => {
      child.stdin.end()
      child.kill()
    }
  }
}

/* ------------------------------------------------------------------ 入口 */

const openCache = new Map<string, Promise<SqliteReader>>()

/** 打开一个只读 sqlite 连接（按路径缓存，重复打开同一库不重复握手） */
export async function openReadonly(file: string): Promise<SqliteReader> {
  const cached = openCache.get(file)
  if (cached) return cached
  const promise = (async () => {
    const caps = await capabilities()
    if (caps.sqlite) {
      try {
        return await openNodeSqlite(file)
      } catch (error) {
        if (!caps.python) {
          throw new AppError('E_SQLITE', `无法打开 ${file}：${(error as Error).message}`, {
            hint: '若这是解密产物，说明解密不完整；重新跑一次解密'
          })
        }
      }
    }
    return await openPython(file)
  })()
  openCache.set(file, promise)
  try {
    return await promise
  } catch (error) {
    openCache.delete(file)
    throw error
  }
}

export async function closeAll(): Promise<void> {
  const entries = [...openCache.values()]
  openCache.clear()
  await Promise.allSettled(entries.map(async (p) => (await p).close()))
}

export async function withReader<T>(file: string, fn: (reader: SqliteReader) => Promise<T>): Promise<T> {
  const reader = await openReadonly(file)
  return fn(reader)
}
