import { useCallback, useEffect, useRef } from 'react'
import { useStudio } from '../store/studio'

/**
 * 对话窗的「实时」刷新。
 *
 * 说清楚它是什么：**对已解密数据库的短轮询**，不是微信推送。
 * 因此有两条硬边界，界面文案里也必须体现：
 *  1. 只能看到「最后一次解密」那一刻的数据；微信还在写新消息的话，库里没有就是没有；
 *  2. 轮询间隔不宜太短（1.5s 已足够快），窗口失焦时暂停，避免无意义 IO。
 */
export function useLiveSync(intervalMs = 1500): { syncNow: () => void } {
  const liveMode = useStudio((s) => s.liveMode)
  const selectedUsername = useStudio((s) => s.selected?.username ?? null)
  const syncNow = useStudio((s) => s.syncNow)
  const busy = useStudio((s) => s.busy)
  const syncing = useStudio((s) => s.syncing)

  // 最新的回调与状态都放 ref：定时器只建一次，不因为 busy/syncing 抖动反复重建
  const callback = useRef(syncNow)
  callback.current = syncNow
  const blocked = useRef(false)
  blocked.current = Boolean(busy) || syncing

  const manual = useCallback(() => {
    void callback.current({ silent: true })
  }, [])

  useEffect(() => {
    if (!liveMode || !selectedUsername) return
    let timer: ReturnType<typeof setInterval> | null = null

    const tick = (): void => {
      if (blocked.current) return
      void callback.current({ silent: true })
    }
    const start = (): void => {
      if (timer) return
      timer = setInterval(tick, intervalMs)
    }
    const stop = (): void => {
      if (timer) clearInterval(timer)
      timer = null
    }
    const onVisibility = (): void => {
      if (document.hidden) stop()
      else {
        tick()
        start()
      }
    }

    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [liveMode, selectedUsername, intervalMs])

  return { syncNow: manual }
}
