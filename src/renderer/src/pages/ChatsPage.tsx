import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChatMessage, ConversationSummary, MessageKind } from '@shared/types'
import { InkFlow, KoiSwimming, WhisperBubbles } from '../components/art/animated'
import { ConversationList } from '../components/chat/ConversationList'
import { ExportPanel } from '../components/chat/ExportPanel'
import { MessageBubble } from '../components/chat/MessageBubble'
import { Button, TextInput } from '../components/ui/primitives'
import {
  IconArrowDown,
  IconBolt,
  IconDownload,
  IconFilter,
  IconLive,
  IconSearch,
  IconSparkle
} from '../components/art/icons'
import { useLiveSync } from '../hooks/useLiveSync'
import { cx, dayKey, prettyDayLabel } from '../lib/format'
import { useStudio } from '../store/studio'

const KIND_LABEL: Partial<Record<MessageKind, string>> = {
  text: '文字',
  image: '图片',
  voice: '语音',
  video: '视频',
  sticker: '表情',
  file: '文件',
  link: '链接',
  quote: '引用',
  system: '系统',
  recall: '撤回'
}

/**
 * 会话页：一屏之内完成「找会话 → 读消息 → 导出」。
 *
 * 交互要点（这轮重做的核心）：
 *  - 消息区像聊天软件：默认贴底、往上滚自动加载更早的消息、来新消息时若在底部就自动跟随；
 *  - 「实时」= 对已解密库的短轮询（见 useLiveSync 的说明），界面上用一个小圆点和文案讲清楚；
 *  - 不再显示数据库路径/表名这类诊断信息，只保留「会话名 + 条数 + 时间」；
 *  - 导出收进右侧抽屉，默认收起，避免主界面被表单撑满。
 */
export function ChatsPage(): React.JSX.Element {
  const conversations = useStudio((s) => s.conversations)
  const conversationTotal = useStudio((s) => s.conversationTotal)
  const conversationQuery = useStudio((s) => s.conversationQuery)
  const loadConversations = useStudio((s) => s.loadConversations)
  const selected = useStudio((s) => s.selected)
  const openConversation = useStudio((s) => s.openConversation)
  const messages = useStudio((s) => s.messages)
  const messageTotal = useStudio((s) => s.messageTotal)
  const messageQuery = useStudio((s) => s.messageQuery)
  const setMessageQuery = useStudio((s) => s.setMessageQuery)
  const loadOlder = useStudio((s) => s.loadOlder)
  const loadingOlder = useStudio((s) => s.loadingOlder)
  const liveMode = useStudio((s) => s.liveMode)
  const setLiveMode = useStudio((s) => s.setLiveMode)
  const freshCount = useStudio((s) => s.freshCount)
  const syncing = useStudio((s) => s.syncing)
  const dbModified = useStudio((s) => s.dbModified)
  const busy = useStudio((s) => s.busy)
  const { syncNow } = useLiveSync(1500)

  const [showExport, setShowExport] = useState(false)
  const [keywordDraft, setKeywordDraft] = useState('')
  /** 「回到最新」的可见性：由真实滚动距离驱动，显示阈值远大于触发加载的阈值，避免在底部附近闪按钮 */
  const [showJump, setShowJump] = useState(false)

  const scroller = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const prevFirstId = useRef<number | null>(null)
  const prevCount = useRef(0)
  /** 往前插内容前记录的滚动高度，用于插完后把视口钉回原处 */
  const anchorHeight = useRef<number | null>(null)

  const refreshJump = useCallback(() => {
    const node = scroller.current
    setShowJump(node ? node.scrollHeight - node.scrollTop - node.clientHeight > 400 : false)
  }, [])

  /* ---------------------------------------------------------- 滚动行为 */

  /**
   * 贴底：先瞬时跳到底，再在「用户已经看到底部」的前提下不做平滑动画。
   * 之前用 smooth 走 1400+ 条消息的距离，动画根本来不及完成，
   * 结果「回到最新」按钮一直留在屏幕上（实测距底仍有 400px+）。
   */
  const scrollToBottom = useCallback(() => {
    const node = scroller.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [])

  const onScroll = useCallback(() => {
    const node = scroller.current
    if (!node) return
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight
    atBottom.current = distance < 80
    setShowJump(distance > 240)
    // 程序化调整滚动位置（翻页钉视口、贴底）会连带触发 scroll 事件，这里要忽略，
    // 否则会「翻一页 → 触发再翻一页」自我循环（实测一次点击能连翻好几页）。
    if (suppressScroll.current) return
    // 顶部 240px 内触发加载更早的消息；先把当前高度记下来，插完内容才能钉住视口
    if (node.scrollTop < 240 && !loadingOlderRef.current) {
      anchorHeight.current = node.scrollHeight
      void loadOlder()
    }
  }, [loadOlder])
  const loadingOlderRef = useRef(false)
  loadingOlderRef.current = loadingOlder
  const suppressScroll = useRef(false)

  // 换会话：直接贴底，并把「回到最新」复位
  useEffect(() => {
    prevFirstId.current = null
    prevCount.current = 0
    atBottom.current = true
    setShowJump(false)
    const timer = setTimeout(() => {
      scrollToBottom()
      const node = scroller.current
      if (node) node.scrollTop = node.scrollHeight
    }, 80)
    return () => clearTimeout(timer)
  }, [selected?.username, scrollToBottom])

  // 消息变化：区分「往上翻」与「来新消息」，分别保持位置 / 跟随到底
  useLayoutEffect(() => {
    const node = scroller.current
    const first = messages[0]?.localId ?? null
    const grew = messages.length > prevCount.current
    const prepended = first !== null && prevFirstId.current !== null && first !== prevFirstId.current
    prevFirstId.current = first
    prevCount.current = messages.length

    if (node && grew && prepended && anchorHeight.current !== null) {
      // 关键：往前插入消息后，把视口按「新增高度」往下推，视觉位置原地不动。
      // 不能依赖浏览器默认的滚动锚定——它在 flex + 分组渲染下并不可靠（实测会偏出上万像素）。
      const added = node.scrollHeight - anchorHeight.current
      suppressScroll.current = true
      if (added > 0) node.scrollTop += added
      anchorHeight.current = null
      requestAnimationFrame(() => {
        suppressScroll.current = false
      })
      return
    }
    if (grew && atBottom.current) {
      requestAnimationFrame(() => {
        suppressScroll.current = true
        scrollToBottom()
        setTimeout(() => {
          suppressScroll.current = false
          refreshJump()
        }, 160)
      })
    }
  }, [messages, scrollToBottom, refreshJump])

  const grouped = useMemo(() => groupByDay(messages), [messages])
  const systemHidden = useStudio((s) => s.workspace?.ui.hideSystemMessages ?? false)
  const visibleGroups = useMemo(
    () =>
      systemHidden
        ? grouped
            .map((group) => ({ ...group, items: group.items.filter((m) => m.direction !== 'system') }))
            .filter((group) => group.items.length > 0)
        : grouped,
    [grouped, systemHidden]
  )

  // 切到新会话时才重新计算「是否贴底」
  const refreshJumpUnused = refreshJump
  void refreshJumpUnused

  return (
    <div className="flex h-full min-h-0 gap-3">
      {/* ------------------------------------------------------- 会话列表 */}
      <ConversationList
        conversations={conversations}
        total={conversationTotal}
        query={conversationQuery}
        selected={selected}
        onSearch={(value) => void loadConversations(value)}
        onPick={(conversation: ConversationSummary) => void openConversation(conversation)}
      />

      {/* --------------------------------------------------------- 对话窗 */}
      <section className="surface flex min-h-0 flex-1 flex-col overflow-hidden">
        {!selected ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
            <WhisperBubbles size={190} />
            <div>
              <p className="font-serif text-[17px] font-semibold text-ink">选一个会话，从左边开始</p>
              <p className="mt-1.5 max-w-md text-[12.5px] leading-relaxed text-ink-soft">
                消息会像聊天软件一样贴着底部显示；往上滚自动加载更早的内容。
                打开「实时」后，每秒半自动检查一次有没有新消息。
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* 头部：只留会话名与关键状态 */}
            <header className="flex shrink-0 items-center gap-3 border-b border-line/70 px-4 py-2.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-jade-wash text-[13px] font-semibold text-jade">
                {selected.displayName.slice(0, 1)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold text-ink">{selected.displayName}</p>
                <p className="flex items-center gap-2 text-[11px] text-ink-faint">
                  <span className="text-tabular">{messageTotal} 条</span>
                  {dbModified ? <span>数据更新于 {relativeShort(dbModified)}</span> : null}
                  {liveMode ? (
                    <span className="flex items-center gap-1 text-jade">
                      <span className="relative grid size-2.5 place-items-center">
                        <span className="size-1.5 rounded-full bg-jade" />
                        <span className="absolute size-2.5 animate-ping rounded-full bg-jade/50" />
                      </span>
                      实时
                    </span>
                  ) : null}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setLiveMode(!liveMode)}
                title={liveMode ? '关闭实时刷新' : '开启实时刷新（对已解密库短轮询）'}
                className={cx(
                  'flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] transition-colors',
                  liveMode ? 'border-jade/30 bg-jade-wash text-jade' : 'border-line text-ink-soft hover:text-ink'
                )}
              >
                <IconLive size={14} />
                {liveMode ? '实时' : '已暂停'}
              </button>
              <button
                type="button"
                onClick={() => syncNow()}
                title="立即检查新消息"
                className={cx(
                  'grid size-8 place-items-center rounded-lg border border-line text-ink-soft transition-colors hover:text-ink',
                  syncing && 'text-jade'
                )}
              >
                <IconBolt size={15} className={syncing ? 'animate-pulse' : undefined} />
              </button>
              <Button
                tone={showExport ? 'primary' : 'outline'}
                size="sm"
                icon={IconDownload}
                data-action="export"
                onClick={() => setShowExport((v) => !v)}
              >
                导出
              </Button>
            </header>

            {/* 过滤条：收成一行，避免占地方 */}
            <div className="flex shrink-0 items-center gap-2 border-b border-line/70 px-4 py-2">
              <div className="relative min-w-[160px] flex-1">
                <IconSearch size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint" />
                <TextInput
                  value={keywordDraft}
                  placeholder="在消息里找…（回车）"
                  className="h-8 pl-9 text-[12.5px]"
                  onChange={(event) => setKeywordDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void setMessageQuery({ keyword: keywordDraft || undefined })
                    if (event.key === 'Escape') {
                      setKeywordDraft('')
                      void setMessageQuery({ keyword: undefined })
                    }
                  }}
                />
              </div>
              <div className="flex items-center gap-1">
                {(['', 'text', 'image', 'link'] as const).map((kind) => {
                  const active = (messageQuery.kinds?.[0] ?? '') === kind
                  return (
                    <button
                      key={kind || 'all'}
                      type="button"
                      onClick={() => void setMessageQuery({ kinds: kind ? [kind as MessageKind] : undefined })}
                      className={cx(
                        'rounded-lg px-2 py-1 text-[11.5px] transition-colors',
                        active ? 'bg-ink/8 text-ink' : 'text-ink-faint hover:text-ink'
                      )}
                    >
                      {kind === '' ? '全部' : KIND_LABEL[kind]}
                    </button>
                  )
                })}
              </div>
              {messageQuery.keyword ? (
                <button
                  type="button"
                  onClick={() => {
                    setKeywordDraft('')
                    void setMessageQuery({ keyword: undefined })
                  }}
                  className="flex items-center gap-1 rounded-lg bg-gold-wash px-2 py-1 text-[11.5px] text-gold"
                >
                  <IconFilter size={12} />
                  {messageQuery.keyword}
                </button>
              ) : null}
            </div>

            {/* 消息流 */}
            <div className="relative min-h-0 flex-1">
              <div
                ref={scroller}
                onScroll={onScroll}
                data-thread-scroller
                className="h-full overflow-y-auto px-5 py-4"
              >
                {loadingOlder ? (
                  <div className="flex justify-center py-3">
                    <InkFlow width={110} />
                  </div>
                ) : messages.length > 0 && messages.length >= messageTotal ? (
                  <p className="py-3 text-center text-[11px] text-ink-faint">已经是最早的一条了</p>
                ) : null}

                {visibleGroups.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center gap-3">
                    {busy === 'messages' ? (
                      <InkFlow width={140} />
                    ) : (
                      <>
                        <KoiSwimming size={150} />
                        <p className="text-[12.5px] text-ink-faint">
                          {messageQuery.keyword ? `没有包含「${messageQuery.keyword}」的消息` : '这里还没有消息'}
                        </p>
                      </>
                    )}
                  </div>
                ) : (
                  visibleGroups.map((group) => (
                    <section key={group.day}>
                      <div className="my-4 flex justify-center">
                        <span className="rounded-full bg-ink/6 px-3 py-1 text-[11px] text-ink-soft">
                          {prettyDayLabel(group.day)}
                        </span>
                      </div>
                      <div className="flex flex-col gap-2">
                        {group.items.map((message, index) => (
                          <MessageBubble
                            key={message.localId}
                            message={message}
                            keyword={messageQuery.keyword ?? ''}
                            previous={group.items[index - 1]}
                          />
                        ))}
                      </div>
                    </section>
                  ))
                )}
              </div>

              {/* 回到最新：只在真的离开底部时出现；新消息提示只在用户不在底部时才有意义 */}
              {showJump ? (
                <button
                  type="button"
                  onClick={() => {
                    suppressScroll.current = true
                    scrollToBottom()
                    atBottom.current = true
                    setTimeout(() => {
                      suppressScroll.current = false
                      refreshJump()
                    }, 160)
                  }}
                  className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-jade/30 bg-paper-3/95 px-3.5 py-1.5 text-[12px] text-jade shadow-[0_16px_32px_-24px_rgba(38,33,28,.9)] backdrop-blur transition-transform hover:-translate-y-0.5"
                >
                  <IconArrowDown size={14} />
                  {freshCount > 0 ? `${freshCount} 条新消息` : '回到最新'}
                </button>
              ) : null}            </div>

            <footer className="flex shrink-0 items-center gap-2 border-t border-line/70 px-4 py-1.5 text-[11px] text-ink-faint">
              <IconSparkle size={12} className="text-gold" />
              只读已解密的数据；想看到刚发的消息，回「连接」页重新解密一次即可。
            </footer>
          </>
        )}
      </section>

      {/* ------------------------------------------------------- 导出抽屉 */}
      {showExport && selected ? <ExportPanel onClose={() => setShowExport(false)} /> : null}
    </div>
  )
}

/* ------------------------------------------------------------------ 工具 */

function groupByDay(messages: ChatMessage[]): { day: string; items: ChatMessage[] }[] {
  const groups = new Map<string, ChatMessage[]>()
  for (const message of messages) {
    const key = dayKey(message.timestamp)
    const bucket = groups.get(key)
    if (bucket) bucket.push(message)
    else groups.set(key, [message])
  }
  return [...groups.entries()].map(([day, items]) => ({ day, items }))
}

function relativeShort(iso: string): string {
  const diff = Date.now() - Date.parse(iso)
  if (!Number.isFinite(diff) || diff < 0) return '刚刚'
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return `${Math.floor(diff / 86_400_000)} 天前`
}
