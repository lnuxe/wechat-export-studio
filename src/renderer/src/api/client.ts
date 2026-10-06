import type { IpcArgs, IpcChannelKey, IpcData } from '@shared/contracts'
import type { IpcErrorPayload } from '@shared/ipc'

/**
 * 渲染层唯一的系统访问入口。
 *
 * 设计：把 IpcResult 信封在这里拆开——成功返回数据，失败抛 StudioError，
 * 上层组件用 try/catch（或 store 的 error 字段）处理即可，不必层层判 ok。
 */
export class StudioError extends Error {
  readonly code: IpcErrorPayload['code']
  readonly hint?: string
  readonly detail?: string

  constructor(payload: IpcErrorPayload) {
    super(payload.message)
    this.name = 'StudioError'
    this.code = payload.code
    this.hint = payload.hint
    this.detail = payload.detail
  }
}

export async function invoke<K extends IpcChannelKey>(
  channel: K,
  ...args: IpcArgs<K>
): Promise<IpcData<K>> {
  if (!window.studio) {
    throw new StudioError({
      code: 'E_UNSUPPORTED',
      message: '预加载桥未注入：请通过 Electron 启动应用，而不是直接打开 HTML'
    })
  }
  const result = await window.studio.invoke(channel, ...args)
  if (!result.ok) throw new StudioError(result.error)
  return result.data
}

export const api = { invoke }

/** 便捷：把任意异常转成可展示的错误对象 */
export function describeError(error: unknown): { message: string; hint?: string; code?: string } {
  if (error instanceof StudioError) {
    return { message: error.message, hint: error.hint, code: error.code }
  }
  if (error instanceof Error) return { message: error.message }
  return { message: String(error) }
}
