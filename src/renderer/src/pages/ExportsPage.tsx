import { useMemo } from 'react'
import { KoiSwimming, SealStampAnimated } from '../components/art/animated'
import { IconArchive, IconChevron, IconDownload, IconFolder, IconTrash } from '../components/art/icons'
import { Button, EmptyState, SectionTitle } from '../components/ui/primitives'
import { appApi } from '../api/studio'
import { cx, humanBytes, relativeTime } from '../lib/format'
import { useStudio } from '../store/studio'

/**
 * 导出中心。
 *
 * 相较上一版：不再逐条列出绝对路径（那是最容易被吐槽的噪音），
 * 只显示文件名 + 体积 + 行数；需要定位时用「在文件夹中显示」。
 */
export function ExportsPage(): React.JSX.Element {
  const history = useStudio((s) => s.history)
  const workspace = useStudio((s) => s.workspace)
  const loadHistory = useStudio((s) => s.loadHistory)
  const deleteHistory = useStudio((s) => s.deleteHistory)
  const setPage = useStudio((s) => s.setPage)

  const totals = useMemo(
    () =>
      history.reduce(
        (acc, record) => {
          acc.files += record.artifacts.length
          acc.bytes += record.artifacts.reduce((sum, artifact) => sum + artifact.bytes, 0)
          acc.messages += record.messageCount
          return acc
        },
        { files: 0, bytes: 0, messages: 0 }
      ),
    [history]
  )

  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-col gap-4">
      <SectionTitle
        eyebrow="Exports"
        title="导出记录"
        detail="每次导出的产物都记在这里：点文件名用系统默认程序打开，点右侧「在文件夹中显示」定位。"
        actions={
          <>
            <Button tone="ghost" size="sm" icon={IconFolder} onClick={() => workspace && void appApi.open(workspace.exportDir)}>
              打开目录
            </Button>
            <Button tone="outline" size="sm" icon={IconDownload} onClick={() => setPage('chats')}>
              去导出
            </Button>
          </>
        }
      />

      {history.length > 0 ? (
        <div className="surface flex items-center gap-5 px-5 py-3.5">
          <SealStampAnimated label={`${history.length}`} size={52} tone="ink" />
          <div className="grid flex-1 grid-cols-3 gap-4">
            <Metric label="产物文件" value={totals.files} />
            <Metric label="已导出消息" value={totals.messages} tone="jade" />
            <Metric label="累计体积" value={humanBytes(totals.bytes)} />
          </div>
          <Button tone="ghost" size="sm" onClick={() => void loadHistory()}>
            刷新
          </Button>
        </div>
      ) : null}

      {history.length === 0 ? (
        <div className="surface">
          <EmptyState
            art={<KoiSwimming size={190} />}
            title="还没有导出过"
            detail="去「会话」挑一个聊天，点右上角导出即可。默认会给 chat.txt（给泡菜鱼分析）和网页版。"
            action={
              <Button tone="primary" icon={IconDownload} onClick={() => setPage('chats')}>
                去挑一个会话
              </Button>
            }
          />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {history.map((record) => (
            <section key={record.id} className="surface overflow-hidden">
              <header className="flex items-center gap-3 border-b border-line/70 px-4 py-2.5">
                <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-jade-wash text-jade">
                  <IconArchive size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-semibold text-ink">{record.displayName}</p>
                  <p className="text-[11px] text-ink-faint text-tabular">
                    {record.messageCount} 条 · {record.firstTime?.slice(0, 10) ?? '—'} → {record.lastTime?.slice(0, 10) ?? '—'}
                    {record.stats ? ` · ${record.stats.spanDays} 天` : ''}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] text-ink-faint">{relativeTime(record.createdAt)}</span>
                <button
                  type="button"
                  onClick={() => void deleteHistory(record.id)}
                  className="grid size-7 place-items-center rounded-lg text-ink-faint transition-colors hover:bg-clay-wash hover:text-clay"
                  title="只移除这条记录，不删除文件"
                >
                  <IconTrash size={14} />
                </button>
              </header>

              <ul className="flex flex-col">
                {record.artifacts.map((artifact) => {
                  const name = artifact.path.split(/[\\/]/).pop() ?? artifact.path
                  return (
                    <li key={artifact.path} className="flex items-center gap-3 border-b border-line/40 px-4 py-2 last:border-b-0">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] text-ink">{name}</span>
                        <span className="text-[10.5px] text-ink-faint text-tabular">
                          {humanBytes(artifact.bytes)}
                          {artifact.lines ? ` · ${artifact.lines} 行` : ''}
                        </span>
                      </span>
                      <Button tone="ghost" size="sm" icon={IconChevron} onClick={() => void appApi.open(artifact.path)}>
                        打开
                      </Button>
                      <Button tone="ghost" size="sm" onClick={() => void appApi.reveal(artifact.path)}>
                        定位
                      </Button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function Metric({ label, value, tone }: { label: string; value: string | number; tone?: 'jade' }): React.JSX.Element {
  return (
    <div>
      <p className={cx('text-[17px] font-semibold text-tabular', tone === 'jade' ? 'text-jade' : 'text-ink')}>{value}</p>
      <p className="text-[10.5px] text-ink-faint">{label}</p>
    </div>
  )
}
