/**
 * PE 版本资源（VS_VERSIONINFO）解析。
 *
 * 为什么不能像最初那样直接扫 `ProductVersion` 的 ASCII 字面量：
 * 整个版本块是 UTF-16LE，键与值都是宽字符，ASCII 搜索一无所获（实测 ascii=-1 / utf16=2906114）。
 * 这里做两件事：
 *  1. 定位资源目录里的 VERSION 资源（type 16），用 v=v 算法还原；
 *  2. 解析成 key → value（UTF-16LE、NUL 分隔），拿 FileVersion / ProductVersion；
 *  3. 兜底：在整份文件里按 UTF-16LE 找 `x.y.z.w` 形态的版本串。
 */

export interface PeVersionInfo {
  /** 完整版本，形如 4.1.16.7 */
  version: string | null
  /** 资源里的产品名（可选） */
  productName: string | null
  companyName: string | null
  source: 'resource' | 'scan' | 'none'
}

const VERSION_RE = /^\d+\.\d+\.\d+(?:\.\d+)?$/

function rvaToOffset(buffer: Buffer, peOffset: number, rva: number): number | null {
  const sectionCount = buffer.readUInt16LE(peOffset + 0x06)
  const optionalSize = buffer.readUInt16LE(peOffset + 0x14)
  for (let index = 0; index < sectionCount; index += 1) {
    const section = peOffset + 0x18 + optionalSize + index * 40
    if (section + 40 > buffer.length) return null
    const virtualSize = buffer.readUInt32LE(section + 8)
    const virtualAddress = buffer.readUInt32LE(section + 12)
    const rawSize = buffer.readUInt32LE(section + 16)
    const rawPointer = buffer.readUInt32LE(section + 20)
    if (rva >= virtualAddress && rva < virtualAddress + Math.max(virtualSize, rawSize)) {
      return rawPointer + (rva - virtualAddress)
    }
  }
  return null
}

/** 把 VS_VERSIONINFO 块解析成 key → value（键值均为 UTF-16LE，NUL 结尾） */
function parseVersionBlock(block: Buffer): Map<string, string> {
  const out = new Map<string, string>()
  // 先按 UTF-16LE 转成文本，再用 NUL 切开；字符串表正好是 [key, value, key, value…]
  const text = block.toString('utf16le')
  const parts = text.split('\u0000').map((part) => part.replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim())
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index] ?? ''
    const value = parts[index + 1] ?? ''
    if (/^[A-Za-z][A-Za-z0-9_]{2,31}$/.test(key) && value && !/^[A-Za-z][A-Za-z0-9_]{2,31}$/.test(value)) {
      if (!out.has(key)) out.set(key, value)
    }
  }
  return out
}

export function readPeVersionInfo(buffer: Buffer): PeVersionInfo {
  const empty: PeVersionInfo = { version: null, productName: null, companyName: null, source: 'none' }
  try {
    if (buffer.length < 0x100 || buffer.toString('latin1', 0, 2) !== 'MZ') return empty
    const peOffset = buffer.readUInt32LE(0x3c)
    if (peOffset + 0x18 > buffer.length || buffer.toString('latin1', peOffset, peOffset + 4) !== 'PE\0\0') return empty

    const optionalMagic = buffer.readUInt16LE(peOffset + 0x18)
    const dataDirectory = peOffset + 0x18 + (optionalMagic === 0x20b ? 112 : 96)
    const resourceRva = buffer.readUInt32LE(dataDirectory + 2 * 8)
    const resourceOffset = resourceRva ? rvaToOffset(buffer, peOffset, resourceRva) : null

    let info: PeVersionInfo = empty
    if (resourceOffset !== null) {
      const namedCount = buffer.readUInt16LE(resourceOffset + 12)
      const idCount = buffer.readUInt16LE(resourceOffset + 14)
      for (let index = 0; index < namedCount + idCount; index += 1) {
        const entry = resourceOffset + 16 + index * 8
        const typeId = buffer.readUInt32LE(entry)
        const offset = buffer.readUInt32LE(entry + 4)
        if (typeId !== 16 || (offset & 0x80000000) === 0) continue
        // 第三层才是真正的数据项：type → name → language → data
        const level2 = resourceOffset + (offset & 0x7fffffff)
        const count2 = buffer.readUInt16LE(level2 + 12) + buffer.readUInt16LE(level2 + 14)
        for (let j = 0; j < count2; j += 1) {
          const level3 = resourceOffset + (buffer.readUInt32LE(level2 + 16 + j * 8 + 4) & 0x7fffffff)
          const count3 = buffer.readUInt16LE(level3 + 12) + buffer.readUInt16LE(level3 + 14)
          for (let k = 0; k < count3; k += 1) {
            const dataEntry = resourceOffset + buffer.readUInt32LE(level3 + 16 + k * 8 + 4)
            const dataRva = buffer.readUInt32LE(dataEntry)
            const dataSize = buffer.readUInt32LE(dataEntry + 4)
            const dataOffset = rvaToOffset(buffer, peOffset, dataRva)
            if (dataOffset === null || dataSize === 0 || dataOffset + dataSize > buffer.length) continue
            const values = parseVersionBlock(buffer.subarray(dataOffset, dataOffset + dataSize))
            const version = values.get('FileVersion') ?? values.get('ProductVersion') ?? null
            info = {
              version: version && VERSION_RE.test(version.replace(/\s/g, '')) ? version.replace(/\s/g, '') : null,
              productName: values.get('ProductName') ?? null,
              companyName: values.get('CompanyName') ?? null,
              source: version ? 'resource' : 'none'
            }
          }
        }
      }
    }
    if (info.version) return info

    // 兜底：UTF-16LE 全文件扫描，取第一个形如 x.y.z(.w) 的版本串
    const wide = buffer.toString('utf16le')
    const match = /(\d{1,2}\.\d{1,2}\.\d{1,3}(?:\.\d{1,4})?)/.exec(wide)
    if (match?.[1]) return { ...empty, version: match[1], source: 'scan' }
    return info
  } catch {
    return empty
  }
}
