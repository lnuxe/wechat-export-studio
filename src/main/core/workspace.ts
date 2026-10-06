import { app } from 'electron'
import { EventEmitter } from 'node:events'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { WorkspaceConfig, WorkspacePatch } from '@shared/types'
import { ensureDir, readJson, writeJsonAtomic } from './fsx'
import { log } from './logger'

const DEFAULT_PREFS: WorkspaceConfig['ui'] = {
  theme: 'paper',
  density: 'cozy',
  hideSystemMessages: false
}

/** 默认工作目录：`<文档>/WeChatExportStudio`，比 userData 更容易被用户找到 */
function defaultWorkDir(): string {
  // 允许用环境变量覆盖（自检/自动化跑在临时目录，不污染真实工作区）
  const override = process.env.WES_WORKDIR
  if (override && override.trim()) return override.trim()
  const docs = app.getPath('documents')
  return join(docs, 'WeChatExportStudio')
}

function defaults(): WorkspaceConfig {
  const workDir = defaultWorkDir()
  return {
    workDir,
    wechatDataDir: null,
    decryptDir: join(workDir, 'decrypted'),
    exportDir: join(workDir, 'exports'),
    keyFilePath: join(workDir, 'key.txt'),
    savedKey: null,
    ui: { ...DEFAULT_PREFS }
  }
}

/**
 * 工作区设置：唯一持久化点（userData/config.json）。
 * 派生路径（decryptDir/exportDir/keyFilePath）永远由 workDir 推导，不允许外部直接改，
 * 避免出现「配置里写的目录和实际写文件的目录不一致」这种最难查的 bug。
 */
class WorkspaceStore extends EventEmitter {
  private file = ''
  private cache: WorkspaceConfig = defaults()
  /**
   * 配置版本号：每次 init/patch/reset 自增。
   * IPC 层用它判断「手上的服务实例是不是过期配置造出来的」——
   * 这是之前一个真实 bug 的修复：服务在模块加载时就建好了，
   * 之后给 workspace 设上 wechatDataDir 并不会重建服务，
   * 于是 ChatStore 永远读到 null 的数据目录，连「谁是我」都推不出来。
   */
  private revision = 0

  get version(): number {
    return this.revision
  }

  init(): WorkspaceConfig {
    this.file = join(app.getPath('userData'), 'config.json')
    const stored = readJson<Partial<WorkspaceConfig>>(this.file, {})
    this.cache = this.normalize({ ...defaults(), ...stored })
    ensureDir(this.cache.workDir)
    ensureDir(this.cache.decryptDir)
    ensureDir(this.cache.exportDir)
    log.attachFile(join(this.cache.workDir, 'logs', 'studio.jsonl'))
    log.info('workspace', `工作目录：${this.cache.workDir}`)
    // 顺手把上次的密钥读回来，省一次手动粘贴
    if (!this.cache.savedKey && existsSync(this.cache.keyFilePath)) {
      const key = readFileSync(this.cache.keyFilePath, 'utf8').trim()
      if (/^[0-9a-fA-F]{64}$/.test(key)) {
        this.cache.savedKey = key.toLowerCase()
        log.info('key', '已从 key.txt 恢复上次的密钥')
      }
    }
    return this.cache
  }

  private normalize(config: WorkspaceConfig): WorkspaceConfig {
    // 环境变量优先级最高：自检/自动化必须能把工作目录钉在临时目录里
    const override = process.env.WES_WORKDIR?.trim()
    const workDir = override && override.length > 0 ? override : config.workDir
    return {
      ...config,
      workDir,
      decryptDir: join(workDir, 'decrypted'),
      exportDir: join(workDir, 'exports'),
      keyFilePath: join(workDir, 'key.txt'),
      ui: { ...DEFAULT_PREFS, ...config.ui }
    }
  }

  get(): WorkspaceConfig {
    return this.cache
  }

  patch(patch: WorkspacePatch): WorkspaceConfig {
    const next: WorkspaceConfig = { ...this.cache }
    if (typeof patch.workDir === 'string' && patch.workDir.trim()) next.workDir = patch.workDir.trim()
    if (patch.wechatDataDir !== undefined) next.wechatDataDir = patch.wechatDataDir
    if (patch.savedKey !== undefined) next.savedKey = patch.savedKey
    if (patch.ui) next.ui = { ...next.ui, ...patch.ui }

    this.cache = this.normalize(next)
    ensureDir(this.cache.workDir)
    ensureDir(this.cache.decryptDir)
    ensureDir(this.cache.exportDir)
    writeJsonAtomic(this.file, this.cache)
    // 密钥单独落 key.txt：其它工具（skill 里的 python 脚本）也能直接读
    if (patch.savedKey) {
      writeFileSync(this.cache.keyFilePath, `${patch.savedKey}\n`, 'utf8')
    }
    log.attachFile(join(this.cache.workDir, 'logs', 'studio.jsonl'))
    this.revision += 1
    this.emit('changed', this.cache)
    return this.cache
  }

  reset(): WorkspaceConfig {
    this.cache = this.normalize({ ...defaults() })
    writeJsonAtomic(this.file, this.cache)
    this.revision += 1
    this.emit('changed', this.cache)
    log.warn('workspace', '工作区设置已重置为默认值')
    return this.cache
  }
}

export const workspace = new WorkspaceStore()
