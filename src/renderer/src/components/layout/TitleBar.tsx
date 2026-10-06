import { IconLive, IconPause, IconSettings } from '../art/icons'
import { KoiMarkAnimated } from '../art/animated'
import { cx } from '../../lib/format'
import { useStudio } from '../../store/studio'

/**
 * 标题栏。
 *
 * 这一版只留三样东西：品牌标、微信连接状态、设置入口。
 * 解密库数量、密钥状态这些细节都挪到了「连接」页——标题栏不该是仪表盘。
 */
export function TitleBar({ onOpenSettings }: { onOpenSettings: () => void }): React.JSX.Element {
  const wechat = useStudio((s) => s.wechat)
  const liveMode = useStudio((s) => s.liveMode)
  const setLiveMode = useStudio((s) => s.setLiveMode)
  const selected = useStudio((s) => s.selected)
  const page = useStudio((s) => s.page)

  const connected = Boolean(wechat?.installPath || wechat?.running)

  return (
    <div className="drag-region flex h-10 shrink-0 items-center gap-3 border-b border-line/70 bg-paper-2/60 pr-[150px] pl-4 backdrop-blur">
      <div className="flex items-center gap-2">
        <KoiMarkAnimated size={20} />
        <span className="font-serif text-[13.5px] font-semibold tracking-wide text-ink">泡菜鱼 · 导出工作台</span>
      </div>

      <span className="h-4 w-px bg-line" />

      <div className="no-drag flex items-center gap-2 text-[11.5px] text-ink-soft">
        <span className="relative grid size-2.5 place-items-center">
          <span className={cx('size-1.5 rounded-full', connected ? 'bg-jade' : 'bg-gold')} />
          {connected && wechat?.running ? (
            <span className="absolute size-2.5 animate-ping rounded-full bg-jade/40" />
          ) : null}
        </span>
        <span>
          {wechat?.running
            ? `微信已连接${wechat.version ? ` · ${wechat.version}` : ''}`
            : connected
              ? '微信未运行'
              : '未找到微信'}
        </span>
      </div>

      {/* 只在会话页显示实时开关：其它页面没有可同步的对象 */}
      {page === 'chats' && selected ? (
        <button
          type="button"
          onClick={() => setLiveMode(!liveMode)}
          className={cx(
            'no-drag flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] transition-colors',
            liveMode ? 'text-jade hover:bg-jade-wash' : 'text-ink-faint hover:bg-ink/5'
          )}
          title={liveMode ? '点击暂停实时刷新' : '点击开启实时刷新'}
        >
          {liveMode ? <IconLive size={13} /> : <IconPause size={13} />}
          {liveMode ? '实时' : '已暂停'}
        </button>
      ) : null}

      <button
        type="button"
        onClick={onOpenSettings}
        data-settings-open
        className="no-drag ml-auto grid size-7 place-items-center rounded-lg text-ink-soft transition-colors hover:bg-ink/5 hover:text-ink"
        title="设置"
      >
        <IconSettings size={16} />
      </button>
    </div>
  )
}
