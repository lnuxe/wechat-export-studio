import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { KeyCandidate, KeyInspection, KeyVerification } from '@shared/types'
import { AppError } from '../core/errors'
import { mtimeIso } from '../core/fsx'
import { log } from '../core/logger'
import { normalizeKey, probeKeyOnHeader, keyToPassphrase } from './sqlcipher'
import type { WorkspaceConfig } from '@shared/types'

/**
 * 密钥管理。
 *
 * 背景（来自 wechat-win-export-v4 skill）：
 *  - 微信 4.x 的 SetDBKey 只在进程启动时调用一次，所以取密钥必须「关微信 → 工具拉起微信 → 立即 hook」；
 *    这一步依赖 wx_key.dll，本应用不重复实现，而是负责「找到已经取到的 key.txt」并验证它还能用。
 *  - 密钥是账号级持久的：salt 不变，旧密钥仍能解密，所以缓存 + 校验比反复提取更实际。
 */
export class KeyService {
  constructor(private readonly workspace: WorkspaceConfig) {}

  inspect(raw: string, source: KeyInspection['source'] = 'manual'): KeyInspection {
    const trimmed = raw.trim()
    const normalized = normalizeKey(trimmed)
    const status: KeyInspection['status'] = !trimmed
      ? 'empty'
      : normalized
        ? 'plausible'
        : 'malformed'
    return {
      raw: trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed,
      normalized,
      status,
      bytes: normalized ? 32 : Math.floor(trimmed.replace(/[^0-9a-fA-F]/g, '').length / 2),
      source,
      message: !trimmed
        ? '还没有密钥'
        : normalized
          ? '格式正确（64 位 hex / 32 字节），尚未验证能否解密'
          : '格式不对：需要 64 位十六进制字符（不含 0x 前缀与空格）'
    }
  }

  /** 从 key.txt 读取（默认 <workDir>/key.txt，也兼容 skill 约定的 桌面\wx_export\key.txt） */
  inspectFromFile(explicitPath?: string): KeyInspection {
    const candidates = [
      explicitPath,
      this.workspace.keyFilePath,
      join(process.env.USERPROFILE ?? '', 'Desktop', 'wx_export', 'key.txt'),
      join(process.env.USERPROFILE ?? '', 'Desktop', 'wx_export', 'key_status.txt')
    ].filter((p): p is string => Boolean(p))

    for (const path of candidates) {
      if (!existsSync(path)) continue
      try {
        const content = readFileSync(path, 'utf8').trim()
        if (!content) continue
        const inspection = this.inspect(content, 'file')
        if (inspection.normalized) {
          log.success('key', `已从 ${path} 读取密钥`)
          return { ...inspection, message: `从 ${path} 读取成功：${inspection.message}` }
        }
      } catch {
        /* 换下一个候选 */
      }
    }
    const envKey = process.env.WECHAT_DB_KEY
    if (envKey) {
      const inspection = this.inspect(envKey, 'env')
      if (inspection.normalized) return { ...inspection, message: `从环境变量 WECHAT_DB_KEY 读取：${inspection.message}` }
    }
    return {
      raw: '',
      normalized: null,
      status: 'empty',
      bytes: 0,
      source: 'unknown',
      message: '没有找到可用的 key.txt（可粘贴密钥，或用 wx_key.dll 工具先取一次）'
    }
  }

  /** 列出候选密钥来源，供「一键尝试」 */
  candidates(): KeyCandidate[] {
    const paths = [
      this.workspace.keyFilePath,
      join(process.env.USERPROFILE ?? '', 'Desktop', 'wx_export', 'key.txt')
    ]
    const out: KeyCandidate[] = []
    for (const path of paths) {
      if (!existsSync(path)) continue
      try {
        const key = readFileSync(path, 'utf8').trim()
        const normalized = normalizeKey(key)
        if (!normalized) continue
        out.push({ key: normalized, source: 'key.txt', path, modifiedAt: mtimeIso(path), verified: false })
      } catch {
        /* 忽略 */
      }
    }
    if (this.workspace.savedKey) {
      out.push({
        key: this.workspace.savedKey,
        source: '应用缓存',
        path: null,
        modifiedAt: null,
        verified: false
      })
    }
    const envKey = process.env.WECHAT_DB_KEY ? normalizeKey(process.env.WECHAT_DB_KEY) : null
    if (envKey) out.push({ key: envKey, source: 'WECHAT_DB_KEY', path: null, modifiedAt: null, verified: false })
    // 去重
    const seen = new Set<string>()
    return out.filter((candidate) => {
      if (seen.has(candidate.key)) return false
      seen.add(candidate.key)
      return true
    })
  }

  /** 用真实库验证密钥（只解页 1，代价极小） */
  verify(key: string, dbStoragePath?: string): KeyVerification {
    const normalized = normalizeKey(key)
    if (!normalized) throw new AppError('E_BAD_KEY', '密钥必须是 64 位十六进制字符串')
    const root = dbStoragePath ?? this.workspace.wechatDataDir
    if (!root) {
      throw new AppError('E_NOT_FOUND', '还没有选择微信数据目录', {
        hint: '先在「连接微信」里扫出账号目录，再验证密钥'
      })
    }

    const passphrase = keyToPassphrase(normalized)
    const files = this.probeFiles(root)
    let tried = 0
    for (const file of files) {
      tried += 1
      try {
        const head = readFileSync(file).subarray(0, 4096)
        const probe = probeKeyOnHeader(head, passphrase)
        if (probe.ok) {
          log.success('key', `密钥验证通过（样本库 ${file}）`)
          return {
            ok: true,
            verifiedCount: 1,
            tried,
            sampleDb: file,
            salt: probe.salt,
            message: '密钥有效：能正确解出 SQLite 页头'
          }
        }
      } catch {
        /* 换下一个 */
      }
    }
    log.warn('key', `密钥验证失败（试了 ${tried} 个库）`)
    return {
      ok: false,
      verifiedCount: 0,
      tried,
      sampleDb: null,
      salt: null,
      message: tried === 0 ? '没找到可验证的加密库' : `试了 ${tried} 个库都无法解密：密钥可能属于另一个账号`
    }
  }

  private probeFiles(dbStoragePath: string): string[] {
    const out: string[] = []
    for (const store of ['message', 'contact', 'session']) {
      const dir = join(dbStoragePath, store)
      if (!existsSync(dir)) continue
      try {
        for (const file of readdirSync(dir)) {
          if (!file.endsWith('.db')) continue
          out.push(join(dir, file))
          if (out.length >= 6) return out
        }
      } catch {
        /* 忽略 */
      }
    }
    return out
  }
}
