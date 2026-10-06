import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * 注册表最小读取层。
 *
 * 为什么不用 `reg query` 一把梭？因为这台机器上 reg.exe 可能被策略挡住，
 * 而微信安装位置/文档目录（User Shell Folders）恰好都只在注册表里。
 * 所以：先试 `reg.exe`（快、覆盖全），失败再用下面这个纯 Node 的最小 hive 解析器。
 *
 * 解析器只做三件事，够用就行：
 *  - LF/LH/LI 子键列表  → 定位路径
 *  - VK 值列表          → 取 name / type / size / data offset
 *  - UTF-16LE 解码      → 还原字符串
 * 不处理 hive bin 的完整性校验、事务日志、大值分片（微信相关键都不会命中）。
 */

export interface RegValue {
  name: string
  type: 'REG_SZ' | 'REG_EXPAND_SZ' | 'REG_DWORD' | 'REG_QWORD' | 'REG_BINARY' | 'REG_MULTI_SZ' | 'UNKNOWN'
  data: string
}

const REG_TYPES: Record<number, RegValue['type']> = {
  1: 'REG_SZ',
  2: 'REG_EXPAND_SZ',
  3: 'REG_BINARY',
  4: 'REG_DWORD',
  7: 'REG_MULTI_SZ',
  11: 'REG_QWORD'
}

function decodeUtf16(buffer: Buffer): string {
  return buffer.toString('utf16le').replace(/\0+$/g, '')
}

class HiveFile {
  readonly data: Buffer
  readonly rootOffset: number

  constructor(data: Buffer) {
    this.data = data
    if (data.length < 4096 || data.toString('latin1', 0, 4) !== 'regf') {
      throw new Error('不是合法的注册表 hive 文件（缺少 regf 签名）')
    }
    this.rootOffset = data.readUInt32LE(0x24) + 0x1000
  }

  /** 按 `\` 分隔的路径逐级下钻，返回键的绝对偏移；找不到返回 null */
  findKey(path: string): number | null {
    let offset = this.rootOffset
    const parts = path.split('\\').filter(Boolean)
    for (const part of parts) {
      const next = this.findChild(offset, part)
      if (next === null) return null
      offset = next
    }
    return offset
  }

  private findChild(keyOffset: number, name: string): number | null {
    const subkeyCount = this.data.readUInt32LE(keyOffset + 0x14)
    if (subkeyCount === 0) return null
    const listOffset = this.data.readUInt32LE(keyOffset + 0x1c) + 0x1000
    const target = name.toLowerCase()
    const signature = this.data.toString('latin1', listOffset, listOffset + 2)

    if (signature === 'lf' || signature === 'lh') {
      const count = this.data.readUInt16LE(listOffset + 2)
      for (let i = 0; i < count; i += 1) {
        const entry = listOffset + 4 + i * 8
        const childOffset = this.data.readUInt32LE(entry) + 0x1000
        if (this.keyName(childOffset).toLowerCase() === target) return childOffset
      }
      return null
    }

    if (signature === 'li') {
      const count = this.data.readUInt16LE(listOffset + 2)
      for (let i = 0; i < count; i += 1) {
        const childOffset = this.data.readUInt32LE(listOffset + 4 + i * 4) + 0x1000
        if (this.keyName(childOffset).toLowerCase() === target) return childOffset
      }
      return null
    }

    if (signature === 'ri') {
      const count = this.data.readUInt16LE(listOffset + 2)
      for (let i = 0; i < count; i += 1) {
        const sub = this.data.readUInt32LE(listOffset + 4 + i * 4) + 0x1000
        const found = this.findChild(sub, name)
        if (found !== null) return found
      }
    }
    return null
  }

  keyName(keyOffset: number): string {
    const nameLength = this.data.readUInt16LE(keyOffset + 0x48)
    if (nameLength === 0) return ''
    const compressed = (this.data.readUInt16LE(keyOffset + 0x02) & 0x20) !== 0
    const start = keyOffset + 0x4c
    return compressed
      ? this.data.toString('latin1', start, start + nameLength)
      : this.data.toString('utf16le', start, start + nameLength)
  }

  /** 读取某个键下所有值（跳过默认值的空名也可以按需保留） */
  values(keyOffset: number): RegValue[] {
    const valueCount = this.data.readUInt32LE(keyOffset + 0x18)
    if (valueCount === 0) return []
    const listOffset = this.data.readUInt32LE(keyOffset + 0x28) + 0x1000
    const out: RegValue[] = []
    for (let i = 0; i < valueCount; i += 1) {
      const entry = listOffset + i * 20
      const nameLength = this.data.readUInt16LE(entry + 0x02)
      const dataLength = this.data.readUInt32LE(entry + 0x04)
      const dataOffset = this.data.readUInt32LE(entry + 0x08)
      const typeCode = this.data.readUInt32LE(entry + 0x0c)
      const flags = this.data.readUInt16LE(entry + 0x10)
      const name =
        nameLength === 0
          ? ''
          : flags & 1
            ? this.data.toString('latin1', entry + 0x14, entry + 0x14 + nameLength)
            : this.data.toString('utf16le', entry + 0x14, entry + 0x14 + nameLength)
      const type = REG_TYPES[typeCode] ?? 'UNKNOWN'
      const raw =
        dataLength > 4 || (dataLength > 0 && type === 'REG_BINARY')
          ? this.data.subarray(dataOffset + 0x1000, dataOffset + 0x1000 + dataLength)
          : this.data.subarray(entry + 0x08, entry + 0x08 + dataLength)
      let data = ''
      if (type === 'REG_SZ' || type === 'REG_EXPAND_SZ') data = decodeUtf16(raw)
      else if (type === 'REG_MULTI_SZ') data = decodeUtf16(raw).split('\0').filter(Boolean).join('; ')
      else if (type === 'REG_DWORD') data = String(raw.readUInt32LE(0))
      else if (type === 'REG_QWORD') data = String(raw.readBigUInt64LE(0))
      else data = raw.toString('hex')
      out.push({ name, type, data })
    }
    return out
  }

  value(keyPath: string, valueName: string): string | null {
    const keyOffset = this.findKey(keyPath)
    if (keyOffset === null) return null
    const found = this.values(keyOffset).find(
      (v) => v.name.toLowerCase() === valueName.toLowerCase()
    )
    return found ? found.data : null
  }
}

/* --------------------------------------------------------------- 对外接口 */

let regExeAvailable: boolean | null = null

async function regQuery(key: string, value: string): Promise<string | null> {
  try {
    const { stdout } = await run('reg', ['query', key, '/v', value], { timeout: 5000, windowsHide: true })
    // 输出形如：`    InstallPath    REG_SZ    C:\Program Files\Tencent\Weixin`
    const line = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.toLowerCase().startsWith(value.toLowerCase()))
    if (!line) return null
    const parts = line.split(/\s{2,}/)
    return parts.length >= 3 ? parts.slice(2).join('  ').trim() : null
  } catch {
    return null
  }
}

const hives = new Map<string, HiveFile | null>()

function hiveFor(root: 'HKCU' | 'HKLM'): HiveFile | null {
  if (hives.has(root)) return hives.get(root) ?? null
  let parsed: HiveFile | null = null
  try {
    const home = process.env.USERPROFILE ?? ''
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
    const target = root === 'HKCU' ? `${home}\\NTUSER.DAT` : `${systemRoot}\\System32\\config\\SOFTWARE`
    parsed = new HiveFile(readFileSync(target))
  } catch {
    parsed = null
  }
  hives.set(root, parsed)
  return parsed
}

/**
 * 读注册表字符串值。`key` 形如 `HKCU\Software\Tencent\Weixin`。
 * 返回 null 表示“确实没有这个值”或“两条路都走不通”，调用方继续找别的线索即可。
 */
export async function readRegistryString(key: string, value: string): Promise<string | null> {
  const [root, ...rest] = key.split('\\')
  if (regExeAvailable !== false && (root === 'HKCU' || root === 'HKLM')) {
    const viaExe = await regQuery(key, value)
    if (viaExe) {
      regExeAvailable = true
      return viaExe
    }
    regExeAvailable = regExeAvailable === true ? true : false
  }
  if (root !== 'HKCU' && root !== 'HKLM') return null
  const hive = hiveFor(root)
  if (!hive) return null
  // HKCU hive 的根就是 HKEY_CURRENT_USER；HKLM 的 SOFTWARE hive 根下直接是 SOFTWARE
  return hive.value(rest.join('\\'), value)
}

export function expandEnv(value: string): string {
  return value.replace(/%([^%]+)%/g, (_, name: string) => process.env[name] ?? `%${name}%`)
}
