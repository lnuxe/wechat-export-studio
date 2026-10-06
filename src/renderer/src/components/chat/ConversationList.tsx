import { useMemo, useState } from 'react'
import type { ConversationSummary } from '@shared/types'
import { IconSearch, IconUsers } from '../art/icons'
import { TextInput } from '../ui/primitives'
import { cx, relativeTime, truncate } from '../../lib/format'

const KIND_TONE: Record<ConversationSummary['kind'], { label: string; cls: string }> = {
  private: { label: '私聊', cls: 'text-jade' },
  group: { label: '群聊', cls: 'text-gold' },
  official: { label: '公众号', cls: 'text-ink-faint' },
  service: { label: '服务', cls: 'text-ink-faint' },
  system: { label: '系统', cls: 'text-ink-faint' },
  unknown: { label: '其他', cls: 'text-ink-faint' }
}

/**
 * 会话列表。
 *
 * 相比上一版：去掉了「置信度/行数/表名」这类诊断信息，
 * 一行只保留 头像首字 · 名字 · 摘要 · 类型 · 时间 —— 与微信的列表心智一致。
 */
export function ConversationList({
  conversations,
  total,
  query,
  selected,
  onSearch,
  onPick
}: {
  conversations: ConversationSummary[]
  total: number
  query: string
  selected: ConversationSummary | null
  onSearch: (value: string) => void
  onPick: (conversation: ConversationSummary) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(query)

  const listId = useMemo(() => `conv-list-${Math.random().toString(36).slice(2, 8)}`, [])

  return (
    <aside className="surface flex w-[268px] shrink-0 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-line/70 px-3 py-2.5">
        <div className="relative">
          <IconSearch size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint" />
          <TextInput
            value={draft}
            placeholder="搜索联系人或群"
            className="h-9 pl-9 text-[12.5px]"
            onChange={(event) => {
              setDraft(event.target.value)
              onSearch(event.target.value)
            }}
          />
        </div>
        <p className="mt-1.5 px-1 text-[11px] text-ink-faint">
          {draft.trim() ? `找到 ${conversations.length} 个` : `共 ${total || conversations.length} 个会话`}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" id={listId}>
        {conversations.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <IconUsers size={26} className="text-ink-faint" />
            <p className="text-[12.5px] text-ink-faint">
              {draft.trim() ? '没有匹配的联系人' : '还没有可浏览的会话'}
            </p>
          </div>
        ) : (
          <ul className="flex flex-col">
            {conversations.map((conversation) => {
              const active = selected?.username === conversation.username
              const tone = KIND_TONE[conversation.kind]
              return (
                <li key={conversation.username}>
                  <button
                    type="button"
                    onClick={() => onPick(conversation)}
                    className={cx(
                      'flex w-full items-start gap-2.5 px-3 py-2.5 pr-3.5 text-left transition-colors',
                      active ? 'bg-jade-wash' : 'hover:bg-paper-3/70'
                    )}
                  >
                    <span
                      className={cx(
                        'mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl text-[12.5px] font-semibold',
                        active ? 'bg-paper-3 text-jade' : 'bg-ink/6 text-ink-soft'
                      )}
                    >
                      {conversation.displayName.slice(0, 1)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-1.5">
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
                          {conversation.displayName}
                        </span>
                        <span className="shrink-0 text-[10.5px] text-ink-faint">
                          {conversation.lastTimestamp ? relativeTime(conversation.lastTimestamp) : ''}
                        </span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5">
                        <span className={cx('shrink-0 text-[10.5px]', tone.cls)}>{tone.label}</span>
                        <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-soft">
                          {truncate(conversation.summary ?? '（无摘要）', 26)}
                        </span>
                        {conversation.unreadCount > 0 ? (
                          <span className="grid size-4 shrink-0 place-items-center rounded-full bg-clay text-[9.5px] font-semibold text-paper-2">
                            {conversation.unreadCount > 9 ? '9+' : conversation.unreadCount}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </aside>
  )
}
