import { EventEmitter } from 'node:events'
import { appendFileSync } from 'node:fs'
import type { LogEntry, LogLevel } from '@shared/types'
import { ensureDir } from './fsx'
import { dirname } from 'node:path'

const RING_SIZE = 500

/**
 * 进程内日志总线：
 *  - 保留最近 RING_SIZE 条，供 UI 首次挂载时 `log:tail` 补齐
 *  - 每次写入都通过 EventEmitter 广播，由 IPC 层转成 `event:log`
 *  - 同时落盘一份 jsonl，方便事后排查（不落盘聊天内容，只有操作与统计）
 */
class LogBus extends EventEmitter {
  private ring: LogEntry[] = []
  private seq = 0
  private logFile: string | null = null

  attachFile(file: string): void {
    ensureDir(dirname(file))
    this.logFile = file
  }

  private push(level: LogLevel, scope: LogEntry['scope'], message: string, detail?: string): LogEntry {
    const entry: LogEntry = {
      id: ++this.seq,
      time: new Date().toISOString(),
      level,
      scope,
      message,
      ...(detail ? { detail } : {})
    }
    this.ring.push(entry)
    if (this.ring.length > RING_SIZE) this.ring.splice(0, this.ring.length - RING_SIZE)
    this.emit('entry', entry)
    if (this.logFile) {
      try {
        appendFileSync(this.logFile, `${JSON.stringify(entry)}\n`, 'utf8')
      } catch {
        /* 日志写失败不能影响主流程 */
      }
    }
    return entry
  }

  debug(scope: LogEntry['scope'], message: string, detail?: string): LogEntry {
    return this.push('debug', scope, message, detail)
  }
  info(scope: LogEntry['scope'], message: string, detail?: string): LogEntry {
    return this.push('info', scope, message, detail)
  }
  success(scope: LogEntry['scope'], message: string, detail?: string): LogEntry {
    return this.push('success', scope, message, detail)
  }
  warn(scope: LogEntry['scope'], message: string, detail?: string): LogEntry {
    return this.push('warn', scope, message, detail)
  }
  error(scope: LogEntry['scope'], message: string, detail?: string): LogEntry {
    return this.push('error', scope, message, detail)
  }

  tail(limit = RING_SIZE): LogEntry[] {
    return this.ring.slice(-limit)
  }

  clear(): void {
    this.ring = []
  }
}

export const logBus = new LogBus()

/** 便捷别名，避免到处写 logBus.info(...) */
export const log = {
  debug: logBus.debug.bind(logBus),
  info: logBus.info.bind(logBus),
  success: logBus.success.bind(logBus),
  warn: logBus.warn.bind(logBus),
  error: logBus.error.bind(logBus),
  tail: logBus.tail.bind(logBus),
  attachFile: logBus.attachFile.bind(logBus)
}
