import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type {
  ExportArtifact,
  ExportFormat,
  ExportPlan,
  ExportRecord,
  ExportRequest,
  WorkspaceConfig
} from '@shared/types'
import { AppError } from '../core/errors'
import { humanBytes, mtimeIso, safeFileName, shortHash, uniquePath } from '../core/fsx'
import { log } from '../core/logger'
import type { ChatStore } from './chat-store'
import { RENDERERS, estimateBytes, renderTxt } from './exporters'
import { kindPlaceholder } from './message-codec'
import type { ChatMessage } from '@shared/types'

const readText = (file: string): string => readFileSync(file, 'utf8')

/**
 * 导出编排：préparer（估算产物）→ run（真正写盘）→ history（历史记录）。
 * 关键设计：导出前先出「计划」，让用户在看到预计文件与体积后再确认，
 * 避免一口气写出几百 MB 的 HTML 才发现选错了会话。
 */
export class ExportRunner {
  constructor(
    private readonly workspace: WorkspaceConfig,
    private readonly store: ChatStore,
    private readonly historyFile: string
  ) {}

  private history(): ExportRecord[] {
    if (!existsSync(this.historyFile)) return []
    try {
      const parsed = JSON.parse(readText(this.historyFile)) as ExportRecord[]
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  private saveHistory(records: ExportRecord[]): void {
    mkdirSync(dirname(this.historyFile), { recursive: true })
    writeFileSync(this.historyFile, `${JSON.stringify(records.slice(0, 200), null, 2)}\n`, 'utf8')
  }

  list(): ExportRecord[] {
    return this.history().sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  deleteHistory(id: string): void {
    this.saveHistory(this.history().filter((record) => record.id !== id))
  }

  async plan(request: ExportRequest): Promise<ExportPlan> {
    const location = request.location ?? (await this.store.locateConversation(request.username))
    if (!location) {
      throw new AppError('E_NOT_FOUND', `没找到「${request.displayName}」的消息表`, {
        hint: '确认已完成解密；若刚聊过，请先关闭微信再重新解密以取到最新状态'
      })
    }
    const { messages } = await this.store.allMessages(request.username)
    const filtered = applyRequestFilters(messages, request)
    const base = safeFileName(request.fileName?.trim() || request.displayName, request.username)
    const warnings: string[] = []
    if (filtered.length === 0) warnings.push('当前筛选条件下没有消息，导出的文件会是空的')
    if (request.includeAnalysisPrompt) warnings.push('将额外生成一份泡菜鱼分析提示词（.prompt.md）')

    const outputs = request.formats.map((format) => {
      const ext = RENDERERS[format].ext
      return {
        format,
        path: join(this.workspace.exportDir, `${base}${ext}`),
        bytes: estimateBytes(format, filtered),
        exists: existsSync(join(this.workspace.exportDir, `${base}${ext}`))
      }
    })

    return { request: { ...request, location }, estimatedMessages: filtered.length, outputs, location, warnings }
  }

  async run(request: ExportRequest): Promise<ExportRecord> {
    const started = Date.now()
    const location = request.location ?? (await this.store.locateConversation(request.username))
    if (!location) throw new AppError('E_NOT_FOUND', `没找到「${request.displayName}」的消息表`)

    const { messages } = await this.store.allMessages(request.username)
    const filtered = applyRequestFilters(messages, request)
    const stats = request.includeStats === false ? null : await this.store.stats(request.username)
    const base = safeFileName(request.fileName?.trim() || request.displayName, request.username)
    mkdirSync(this.workspace.exportDir, { recursive: true })

    const context = {
      displayName: request.displayName,
      username: request.username,
      meLabel: request.meLabel?.trim() || '我',
      withSeconds: request.withSeconds ?? true,
      includeSystem: request.includeSystem ?? true,
      includeStats: request.includeStats ?? true,
      stats,
      location: { dbRelPath: location.dbRelPath, table: location.table, rows: location.rows },
      generatedAt: new Date(),
      totalInConversation: messages.length
    }

    const artifacts: ExportArtifact[] = []
    for (const format of request.formats) {
      const renderer = RENDERERS[format]
      const { content, lines } = renderer.render(filtered, context)
      const path = uniquePath(this.workspace.exportDir, base, renderer.ext)
      writeFileSync(path, content, 'utf8')
      artifacts.push({ format, path, bytes: Buffer.byteLength(content, 'utf8'), lines })
      log.success('export', `${format.toUpperCase()} 已写出：${path}（${humanBytes(Buffer.byteLength(content, 'utf8'))}）`)
    }

    if (request.includeAnalysisPrompt) {
      const promptPath = uniquePath(this.workspace.exportDir, `${base}.prompt`, '.md')
      const prompt = buildAnalysisPrompt(request, messages.length, filtered.length, stats)
      writeFileSync(promptPath, prompt, 'utf8')
      artifacts.push({ format: 'md', path: promptPath, bytes: Buffer.byteLength(prompt, 'utf8') })
      log.info('export', `分析提示词已写出：${promptPath}`)
    }

    const record: ExportRecord = {
      id: shortHash(`${request.username}:${Date.now()}`, 12),
      createdAt: new Date().toISOString(),
      username: request.username,
      displayName: request.displayName,
      kind: 'private',
      formats: request.formats,
      artifacts,
      messageCount: filtered.length,
      firstTime: filtered[0]?.timeText ?? null,
      lastTime: filtered[filtered.length - 1]?.timeText ?? null,
      elapsedMs: Date.now() - started,
      location,
      stats
    }
    this.saveHistory([record, ...this.history()])
    return record
  }

  /** 供「导出中心」快速查看：某个历史记录的文件是否还在 */
  artifactStatus(record: ExportRecord): { path: string; exists: boolean; bytes: number; modified: string | null }[] {
    return record.artifacts.map((artifact) => ({
      path: artifact.path,
      exists: existsSync(artifact.path),
      bytes: artifact.bytes,
      modified: mtimeIso(artifact.path)
    }))
  }

  /** 导出前预览前 N 行（防止“导完才发现格式不对”） */
  async preview(request: ExportRequest, limit = 40): Promise<string[]> {
    const { messages } = await this.store.allMessages(request.username)
    const filtered = applyRequestFilters(messages, request)
    const { content } = renderTxt(filtered, {
      displayName: request.displayName,
      username: request.username,
      meLabel: request.meLabel?.trim() || '我',
      withSeconds: request.withSeconds ?? true,
      includeSystem: request.includeSystem ?? true,
      includeStats: false,
      stats: null,
      location: request.location
        ? { dbRelPath: request.location.dbRelPath, table: request.location.table, rows: request.location.rows }
        : null,
      generatedAt: new Date(),
      totalInConversation: messages.length
    })
    return content.split('\n').slice(0, limit)
  }
}

export function applyRequestFilters(messages: ChatMessage[], request: ExportRequest): ChatMessage[] {
  return messages.filter((message) => {
    if (!request.includeSystem && message.direction === 'system') return false
    if (request.from && message.timestamp < request.from) return false
    if (request.to && message.timestamp > request.to) return false
    if (request.kinds?.length && !request.kinds.includes(message.kind)) return false
    return true
  })
}

/** 生成可直接粘给大模型的分析提示词（与 pickled-fish 的 local-chat-pipeline 对齐） */
function buildAnalysisPrompt(
  request: ExportRequest,
  total: number,
  exported: number,
  stats: Awaited<ReturnType<ChatStore['stats']>> | null
): string {
  const lines: string[] = []
  lines.push(`# 泡菜鱼 · 聊天记录分析请求`, '')
  lines.push(`- 会话：${request.displayName}（${request.username}）`)
  lines.push(`- 消息：导出 ${exported} 条 / 会话共 ${total} 条`)
  if (stats) {
    lines.push(
      `- 统计：我 ${stats.mine} 条 · 对方 ${stats.theirs} 条 · 跨度 ${stats.spanDays} 天 · 平均 ${stats.avgChars} 字`
    )
    if (stats.medianReplySeconds !== null) {
      lines.push(`- 我的中位回复间隔：约 ${Math.round(stats.medianReplySeconds / 60)} 分钟`)
    }
  }
  lines.push('', '## 请按这个流程分析', '')
  lines.push('1. 读导出的 chat.txt（每行 `[时间] 发言人: 内容`，与 local-chat-pipeline 格式一致）')
  lines.push('2. 从 knowledge/REGISTRY.md 选 ≤2 个 pack（怎么回/挽回 → qingsheng；依恋 → attachment-ecr；冲突 → nvc/lovelab）')
  lines.push('3. 输出：1–2 个关键点 + packs_used + 可直接发送的原文（或明确说「先不发」）')
  lines.push('', '## 安全边界', '')
  lines.push('- 对方明确拒绝/报警 → 停止联系优先于任何话术')
  lines.push('- 仅本人数据；不要把聊天内容提交到任何仓库或云端')
  lines.push('')
  lines.push('把 chat.txt 内容附在本提示词之后一起发送。')
  return lines.join('\n')
}

export { renderTxt, kindPlaceholder }
export type { ExportFormat }
