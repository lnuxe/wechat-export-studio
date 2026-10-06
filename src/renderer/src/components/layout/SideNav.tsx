import { ScaleMotif } from '../art/artwork'
import { IconArchive, IconChats, IconLink2, IconSettings, type IconProps } from '../art/icons'
import { cx, humanBytes } from '../../lib/format'
import { useStudio, type PageKey } from '../../store/studio'

const NAV: { key: PageKey; label: string; Icon: (props: IconProps) => React.JSX.Element }[] = [
  { key: 'setup', label: '连接', Icon: IconLink2 },
  { key: 'chats', label: '会话', Icon: IconChats },
  { key: 'exports', label: '导出', Icon: IconArchive }
]

/**
 * 左侧导航：图标 + 文字，紧贴聊天列表。
 *
 * 这一版把它压到 88px：主界面让位给消息内容，
 * 设置从顶级导航下沉为标题栏按钮（设置是低频操作，不值得占一格）。
 */
export function SideNav({ onOpenSettings }: { onOpenSettings: () => void }): React.JSX.Element {
  const page = useStudio((s) => s.page)
  const setPage = useStudio((s) => s.setPage)
  const conversationTotal = useStudio((s) => s.conversationTotal)
  const conversations = useStudio((s) => s.conversations)
  const history = useStudio((s) => s.history)
  const decryptStatus = useStudio((s) => s.decryptStatus)

  const exportedBytes = history.reduce(
    (sum, record) => sum + record.artifacts.reduce((inner, artifact) => inner + artifact.bytes, 0),
    0
  )

  return (
    <nav className="relative flex w-[88px] shrink-0 flex-col items-center gap-1 overflow-hidden border-r border-line/70 bg-paper-2/50 py-3">
      <ScaleMotif className="pointer-events-none absolute -bottom-2 -left-4 text-jade" opacity={0.12} />

      {NAV.map(({ key, label, Icon }) => {
        const active = page === key
        const badge =
          key === 'chats'
            ? conversationTotal || conversations.length
            : key === 'exports'
              ? history.length
              : decryptStatus?.stores.length
        return (
          <button
            key={key}
            type="button"
            onClick={() => setPage(key)}
            className={cx(
              'relative flex w-[68px] flex-col items-center gap-1 rounded-2xl px-2 py-2.5 transition-all duration-150',
              active ? 'bg-jade-wash text-jade' : 'text-ink-soft hover:bg-paper-3/70 hover:text-ink'
            )}
          >
            <Icon size={19} />
            <span className="text-[11.5px] font-medium">{label}</span>
            {badge ? (
              <span className="text-[10px] text-ink-faint text-tabular">
                {badge > 999 ? '999+' : badge}
              </span>
            ) : null}
            {active ? <span className="absolute top-1/2 -left-[10px] h-6 w-[3px] -translate-y-1/2 rounded-full bg-jade" /> : null}
          </button>
        )
      })}

      <div className="mt-auto flex flex-col items-center gap-2">
        <span className="text-[10px] text-ink-faint text-tabular">{exportedBytes ? humanBytes(exportedBytes) : ''}</span>
        <button
          type="button"
          onClick={onOpenSettings}
          className="grid size-9 place-items-center rounded-xl text-ink-soft transition-colors hover:bg-paper-3/70 hover:text-ink"
          title="设置"
        >
          <IconSettings size={17} />
        </button>
      </div>
    </nav>
  )
}
