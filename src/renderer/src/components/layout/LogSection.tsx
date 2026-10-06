import { useEffect, useMemo, useRef } from 'react'
import type { LogEntry } from '@shared/types'
import { ICON_BY_SCOPE, IconTerminal } from '../art/icons'
import { cx } from '../../lib/format'
import { useStudio } from '../../store/studio'

const LEVEL_STYLE: Record<LogEntry['level'], string> = {
  debug: 'text-ink-faint',
  info: 'text-ink-soft',
  success: 'text-jade',
  warn: 'text-gold',
  error: 'text-clay'
}

const SCOPE_LABEL: Record<LogEntry['scope'], string> = {
  app: '应用',
  workspace: '工作区',
  wechat: '微信',
  key: '密钥',
  decrypt: '解密',
  store: '数据库',
  conversation: '会话',
  export: '导出'
}

/**
 * 运行日志（只放在设置里、默认展开但很短）。
 *
 * 这是这个工具「可验证」的落点：解密参数、WAL 择优理由、被拒绝的合并都在这里留痕。
 * 主界面不出现它，避免噪音；需要排查时打开设置即可。
 */
export function LogSection(): React.JSX.Element {
  const logs = useStudio((s) => s.logs)
  const scroller = useRef<HTMLDivElement>(null)

  const recent = useMemo(() => logs.slice(-60).reverse(), [logs])

  useEffect(() => {
    const node = scroller.current
    if (node) node.scrollTop = 0
  }, [recent.length])

  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-center gap-1.5 text-[12px] font-semibold tracking-wide text-ink-faint">
        <IconTerminal size={12} />
        运行日志（最近 {recent.length} 条）
      </h3>
      <div
        ref={scroller}
        className="max-h-[190px] overflow-y-auto rounded-xl border border-line/70 bg-paper-2/60 px-2.5 py-2 font-mono text-[10.5px] leading-relaxed"
      >
        {recent.length === 0 ? (
          <p className="py-3 text-center text-ink-faint">暂无日志</p>
        ) : (
          recent.map((entry) => {
            const Icon = ICON_BY_SCOPE[entry.scope] ?? IconTerminal
            return (
              <div key={entry.id} className="flex gap-1.5 py-[1px]">
                <span className="shrink-0 text-ink-faint text-tabular">{entry.time.slice(11, 19)}</span>
                <span className="flex shrink-0 items-center gap-0.5 text-ink-faint">
                  <Icon size={10} weight={1.8} />
                  {SCOPE_LABEL[entry.scope]}
                </span>
                <span className={cx('min-w-0 break-words', LEVEL_STYLE[entry.level])}>{entry.message}</span>
              </div>
            )
          })
        )}
      </div>
      <p className="text-[11px] leading-relaxed text-ink-faint">
        最新在最上面。解密时请留意每行的 newest 与 rows —— 那是判断数据是否最新的唯一硬证据。
      </p>
    </section>
  )
}
