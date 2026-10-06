import type { ErrorCode, IpcErrorPayload } from '@shared/ipc'

/**
 * 领域错误：主进程里任何可预期的失败都抛它，
 * 由 IPC 边界统一转成 `IpcResult.error`，避免渲染层看到原始堆栈。
 */
export class AppError extends Error {
  readonly code: ErrorCode
  readonly hint?: string
  readonly detail?: string

  constructor(code: ErrorCode, message: string, options?: { hint?: string; detail?: string; cause?: unknown }) {
    super(message, options?.cause ? { cause: options.cause } : undefined)
    this.name = 'AppError'
    this.code = code
    this.hint = options?.hint
    this.detail = options?.detail
  }

  toPayload(): IpcErrorPayload {
    return {
      code: this.code,
      message: this.message,
      ...(this.hint ? { hint: this.hint } : {}),
      ...(this.detail ? { detail: this.detail } : {})
    }
  }
}

export const notFound = (what: string, hint?: string): AppError =>
  new AppError('E_NOT_FOUND', `${what} 不存在`, hint ? { hint } : undefined)

export const invalid = (message: string, hint?: string): AppError =>
  new AppError('E_VALIDATION', message, hint ? { hint } : undefined)

export const noKey = (message = '还没有可用的解密密钥'): AppError =>
  new AppError('E_NO_KEY', message, {
    hint: '先在「连接微信」里取密钥，或直接粘贴 64 位 hex 密钥'
  })

export const badKey = (message: string): AppError =>
  new AppError('E_BAD_KEY', message, { hint: '密钥必须是 64 位十六进制字符串（32 字节）' })

export const unsupported = (message: string, hint?: string): AppError =>
  new AppError('E_UNSUPPORTED', message, hint ? { hint } : undefined)

/** 把任意抛出物收敛成 AppError，保留原始信息进 detail */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error
  if (error instanceof Error) {
    const nodeErr = error as NodeJS.ErrnoException
    if (nodeErr.code === 'ENOENT') {
      return new AppError('E_NOT_FOUND', error.message, { detail: error.stack })
    }
    if (nodeErr.code === 'EACCES' || nodeErr.code === 'EPERM') {
      return new AppError('E_PERMISSION', error.message, {
        hint: '以管理员身份运行，或换一个可写的工作目录',
        detail: error.stack
      })
    }
    return new AppError('E_UNKNOWN', error.message, { detail: error.stack })
  }
  return new AppError('E_UNKNOWN', String(error))
}

/** 用于“尽力而为”的分支：失败就吞掉并交回默认值，但会把原因交给回调 */
export async function attempt<T>(fn: () => Promise<T> | T, fallback: T, onError?: (e: unknown) => void): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    onError?.(error)
    return fallback
  }
}
