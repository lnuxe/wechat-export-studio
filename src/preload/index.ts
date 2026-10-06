import { contextBridge, ipcRenderer } from 'electron'
import type { IpcArgs, IpcChannelKey, IpcData, IpcEventMap } from '@shared/contracts'
import { IPC, IPC_EVENTS, type IpcResult } from '@shared/ipc'

/**
 * 预加载脚本：渲染层与主进程之间唯一的桥。
 *
 * 只暴露两件事：
 *  - `invoke(channel, ...args)`：走 IpcContract 的类型约束，通道名写错直接编译不过
 *  - `on(event, listener)`：订阅日志/进度/工作区/历史变更，返回取消订阅函数
 * 不存在任何 `require`、`fs`、`child_process` 透出；sandbox: true 下也拿不到。
 */

const allowedEvents = new Set<string>(Object.values(IPC_EVENTS))

const api = {
  invoke<K extends IpcChannelKey>(channel: K, ...args: IpcArgs<K>): Promise<IpcResult<IpcData<K>>> {
    if (!Object.values(IPC).includes(channel as never)) {
      return Promise.resolve({
        ok: false,
        error: { code: 'E_VALIDATION', message: `未授权的通道：${String(channel)}` }
      })
    }
    return ipcRenderer.invoke(channel, ...args) as Promise<IpcResult<IpcData<K>>>
  },

  on<E extends keyof IpcEventMap>(event: E, listener: (payload: IpcEventMap[E]) => void): () => void {
    if (!allowedEvents.has(event)) return () => undefined
    const wrapped = (_e: unknown, payload: unknown): void => listener(payload as IpcEventMap[E])
    ipcRenderer.on(event, wrapped)
    return () => ipcRenderer.removeListener(event, wrapped)
  },

  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  }
}

export type StudioApi = typeof api

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('studio', api)
} else {
  // 理论上不会走到：contextIsolation 默认开启且我们显式设成 true
  const globalWindow = globalThis as unknown as { studio: StudioApi }
  globalWindow.studio = api
}
