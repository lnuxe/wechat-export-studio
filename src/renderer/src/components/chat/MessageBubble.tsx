import type { ChatMessage, MessageExtra, MessageKind } from '@shared/types'
import { IconCheck } from '../art/icons'
import { cx, highlight, truncate } from '../../lib/format'

/** 每种消息类型的短标签（只在这里维护一处） */
export const KIND_LABEL: Record<MessageKind, string> = {
  text: '文字',
  image: '图片',
  voice: '语音',
  video: '视频',
  sticker: '表情',
  file: '文件',
  link: '链接',
  card: '名片',
  location: '位置',
  transfer: '转账',
  redpacket: '红包',
  call: '通话',
  quote: '引用',
  system: '系统',
  recall: '撤回',
  unknown: '无法解析'
}

/** 图片/语音这类以「卡片」形态呈现的类型 */
const MEDIA_KINDS = new Set<MessageKind>(['image', 'voice', 'video', 'sticker', 'file', 'link', 'card', 'location', 'transfer', 'redpacket', 'call'])

/**
 * 单条消息气泡。
 *
 * 与上一版的差别：去掉了「压缩方式」「原始类型」这类调试角标，
 * 同一个人连续发言时合并头像与名字，视觉上更接近聊天软件本身。
 */
export function MessageBubble({
  message,
  keyword,
  previous
}: {
  message: ChatMessage
  keyword: string
  previous?: ChatMessage
}): React.JSX.Element | null {
  const out = message.direction === 'out'

  if (message.direction === 'system') {
    return (
      <div className="flex justify-center py-1">
        <span className="max-w-[80%] truncate rounded-full bg-ink/5 px-3 py-1 text-[11px] text-ink-faint">
          {message.text || KIND_LABEL[message.kind]}
        </span>
      </div>
    )
  }

  const grouped = Boolean(previous) && previous?.sender.id === message.sender.id && previous?.direction === message.direction
  const parts = highlight(message.text || '', keyword)
  const isMedia = MEDIA_KINDS.has(message.kind)

  return (
    <div className={cx('flex flex-col', out ? 'items-end' : 'items-start', grouped ? 'mt-0.5' : 'mt-2')}>
      {!grouped ? (
        <div className={cx('mb-1 flex items-center gap-2 px-1 text-[10.5px] text-ink-faint', out && 'flex-row-reverse')}>
          <span className="font-medium text-ink-soft">{message.sender.displayName}</span>
          <span className="text-tabular">{message.timeText.slice(11, 16)}</span>
        </div>
      ) : null}

      <div
        className={cx(
          'max-w-[74%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed break-words whitespace-pre-wrap',
          out
            ? 'rounded-br-md bg-jade text-paper-2 shadow-[0_10px_24px_-20px_rgba(47,107,95,.95)]'
            : 'rounded-bl-md border border-line bg-paper-3',
          isMedia && 'inline-flex items-center gap-2'
        )}
      >
        {message.extra?.quotedText ? (
          <p
            className={cx(
              'mb-1.5 rounded-lg border-l-2 px-2 py-1 text-[11.5px]',
              out ? 'border-paper-2/50 bg-black/10' : 'border-jade/40 bg-jade-wash/70 text-ink-soft'
            )}
          >
            {truncate(message.extra.quotedText, 110)}
          </p>
        ) : null}

        {isMedia ? <MediaBody message={message} extra={message.extra} out={out} /> : null}

        {message.text
          ? parts.map((part, index) =>
              part.hit ? (
                <mark key={index} className="rounded bg-gold/35 px-0.5 text-ink">
                  {part.text}
                </mark>
              ) : (
                <span key={index}>{part.text}</span>
              )
            )
          : null}

        {message.kind === 'recall' ? <span className="opacity-80">撤回了一条消息</span> : null}
      </div>
    </div>
  )
}

function MediaBody({
  message,
  extra,
  out
}: {
  message: ChatMessage
  extra?: MessageExtra
  out: boolean
}): React.JSX.Element {
  if (message.kind === 'image') {
    return (
      <span
        className={cx(
          'grid size-24 place-items-center rounded-lg text-[11px]',
          out ? 'bg-black/15 text-paper-2/80' : 'bg-jade-wash/70 text-jade'
        )}
      >
        图片
      </span>
    )
  }

  const label = KIND_LABEL[message.kind]
  const detail = extra?.title ?? extra?.fileName

  return (
    <span className={cx('flex items-center gap-1.5 text-[12.5px]', out ? 'text-paper-2' : 'text-ink')}>
      <span className={cx('rounded-md px-1.5 py-0.5 text-[10.5px]', out ? 'bg-black/20' : 'bg-ink/6 text-ink-soft')}>
        {label}
      </span>
      {detail ? <span className="max-w-[220px] truncate">{detail}</span> : null}
    </span>
  )
}

/** 导出用的兜底文案（外部分享时保持一致） */
export function placeholderFor(kind: MessageKind): string {
  return KIND_LABEL[kind] ?? '消息'
}

export { IconCheck }
