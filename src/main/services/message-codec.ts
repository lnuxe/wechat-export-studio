import { decompress } from 'fzstd'
import type { ChatMessage, MessageExtra, MessageKind, MessageSender } from '@shared/types'
import { as, type SqlValue } from './sqlite-reader'
import { formatTime } from '../core/fsx'

/**
 * 消息解码层。
 *
 * 微信 4.x 的三件事必须做对，否则导出结果会「看起来有内容、实际是乱码」：
 *  1. `message_content` 可能被 WCDB 用 zstd 压缩（`WCDB_CT_message_content = 4`），
 *     必须先解压；
 *  2. 正文带发言人前缀，形如 `wxid_xxx:\n真正的消息`，要按第一个换行剥掉；
 *  3. `local_type` 可能是 32 位以上的复合值（例如 21474836529），
 *     取模 2^32 再取模 10000 才是基础类型。
 */
export const WCDB_CT_ZSTD = 4

/** 基础类型（local_type % 2^32 % 10000）→ 领域语义 */
const KIND_BY_TYPE: Record<number, MessageKind> = {
  1: 'text',
  3: 'image',
  34: 'voice',
  42: 'card',
  43: 'video',
  47: 'sticker',
  48: 'location',
  49: 'link',
  50: 'call',
  10000: 'system',
  10002: 'recall'
}

export function baseType(localType: number): number {
  if (!Number.isFinite(localType)) return 0
  const unsigned = localType >>> 0
  return unsigned % 10000
}

export function kindOf(localType: number): MessageKind {
  const base = baseType(localType)
  const mapped = KIND_BY_TYPE[base]
  if (mapped === 'link') return 'link'
  return mapped ?? 'unknown'
}

/** 用 zstd 头魔数判断，比只看标志位更稳（标志位缺失时也能救回来） */
function looksZstd(buffer: Buffer): boolean {
  return buffer.length > 4 && buffer.readUInt32LE(0) === 0xfd2fb528
}

function maybeDecompress(raw: Buffer, flag: number | null): { data: Buffer; compressed: boolean } {
  const shouldTry = flag === WCDB_CT_ZSTD || looksZstd(raw)
  if (!shouldTry) return { data: raw, compressed: false }
  try {
    return { data: Buffer.from(decompress(raw)), compressed: true }
  } catch {
    return { data: raw, compressed: false }
  }
}

const PREFIX_RE = /^[A-Za-z0-9_@.\-]{2,64}:\r?\n/

/** 剥掉 `wxid_xxx:\n` 前缀，返回正文与发言人候选 */
export function splitPrefix(text: string): { prefix: string | null; body: string } {
  const match = PREFIX_RE.exec(text)
  if (!match) return { prefix: null, body: text }
  return { prefix: match[0].slice(0, -1).replace(/:$/, ''), body: text.slice(match[0].length) }
}

function decodeUtf8(buffer: Buffer): string {
  // 微信正文是 UTF-8；个别历史消息混入非法字节，用 replace 保证不抛异常
  return buffer.toString('utf8').replace(/\u0000+$/g, '')
}

/**
 * 判断一段字节是否是「读不出来的二进制」。
 *
 * 实测：少数消息的 message_content 既不是 UTF-8 文本也不是 zstd 体，而是密文/压缩残留
 * （同一表里混着 BLOB 与 TEXT 两种存储形态）。这类行如果硬当文本导出，会得到满屏
 * 替换符与不可见控制字符——比直接标注「内容无法解析」更糟：后者不会污染语料。
 */
export function looksBinary(buffer: Buffer): boolean {
  if (buffer.length === 0) return false
  if (buffer.length < 12) return false
  let control = 0
  for (const byte of buffer) {
    if (byte === 0x09 || byte === 0x0a || byte === 0x0d) continue
    if (byte < 0x20 || byte === 0x7f) control += 1
  }
  if (control / buffer.length > 0.12) return true
  // UTF-8 替换符比例高也算读不出来
  const decoded = buffer.toString('utf8')
  const replacements = (decoded.match(/\uFFFD/g) ?? []).length
  return replacements >= 3 && replacements / Math.max(1, decoded.length) > 0.08
}

function attr(xml: string, name: string): string | undefined {
  const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml)
  return match?.[1]?.trim() || undefined
}

function parseXmlExtra(kind: MessageKind, xml: string): MessageExtra {
  const extra: MessageExtra = {}
  const title = attr(xml, 'title')
  if (title) extra.title = title
  const url = attr(xml, 'url')
  if (url) extra.url = url
  const appType = attr(xml, 'type')
  if (appType && /^\d+$/.test(appType)) extra.appType = Number(appType)
  if (kind === 'file') {
    extra.fileName = attr(xml, 'title') ?? attr(xml, 'appname')
    const size = attr(xml, 'totallen')
    if (size && /^\d+$/.test(size)) extra.fileSize = Number(size)
  }
  if (kind === 'quote') {
    const refer = /<refermsg>([\s\S]*?)<\/refermsg>/.exec(xml)?.[1]
    if (refer) {
      extra.quotedSender = attr(refer, 'displayname') ?? attr(refer, 'fromusr')
      extra.quotedText = (attr(refer, 'content') ?? '').replace(/<[^>]+>/g, '').trim().slice(0, 500)
    }
  }
  if (kind === 'link') {
    const des = attr(xml, 'des')
    if (des && !extra.title) extra.title = des
  }
  extra.xml = xml.length > 4000 ? `${xml.slice(0, 4000)}…` : xml
  return extra
}

/** 有些类型（红包/转账/引用/文件）在 XML 里，从 <type> 细分 */
function refineKind(kind: MessageKind, xml: string | null): MessageKind {
  if (!xml) return kind
  const sub = attr(xml, 'type')
  if (kind === 'link' || kind === 'unknown') {
    if (sub === '2000') return 'transfer'
    if (sub === '2001') return 'redpacket'
    if (sub === '57') return 'quote'
    if (sub === '6') return 'file'
  }
  return kind
}

export interface RawMessageRow {
  local_id: SqlValue
  real_sender_id: SqlValue
  local_type: SqlValue
  create_time: SqlValue
  message_content: SqlValue
  WCDB_CT_message_content?: SqlValue
}

export interface DecodeOptions {
  /** rowid → username */
  nameById: Map<number, string>
  /** 我自己的 wxid */
  meWxid: string | null
  /** 对方显示名（用于 direction 判定失败时的兜底） */
  peerName: string
  /** 对方 wxid（会话对象） */
  peerWxid: string
  /** senderId → 显示名（群成员昵称） */
  displayNameById?: Map<number, string>
}

export function decodeMessage(row: RawMessageRow, options: DecodeOptions): ChatMessage {
  const localId = as.num(row.local_id)
  const rawType = as.num(row.local_type)
  const timestamp = as.num(row.create_time)
  const senderId = as.num(row.real_sender_id)
  const username = options.nameById.get(senderId) ?? ''
  const compressedFlag = row.WCDB_CT_message_content === undefined ? null : as.num(row.WCDB_CT_message_content)

  const raw = as.buf(row.message_content)
  const { data, compressed } = maybeDecompress(raw, compressedFlag)
  const unreadable = looksBinary(data)
  const decoded = unreadable ? '' : decodeUtf8(data)
  const { prefix, body } = splitPrefix(decoded)

  let kind = kindOf(rawType)
  let text = body
  let extra: MessageExtra | undefined

  const senderUsername = username || prefix || ''
  const isMe = Boolean(options.meWxid) && senderUsername === options.meWxid
  const isSystemType = kind === 'system' || kind === 'recall' || rawType === 10000 || rawType === 10002

  if (unreadable) {
    // 读不出来就明确标注，不要输出乱码污染下游语料
    kind = 'unknown'
    text = ''
    extra = { title: '内容无法解析（该条在库中不是可读文本）' }
  } else if (kind === 'text' || kind === 'unknown') {
    // 有些“文本”其实是 XML（引用、文件、链接），按内容二次判定
    const trimmed = body.trim()
    if (trimmed.startsWith('<msg') || trimmed.startsWith('<?xml')) {
      const refined = refineKind('unknown', trimmed)
      kind = refined === 'unknown' ? 'link' : refined
      extra = parseXmlExtra(kind, trimmed)
      text = extra.title ?? body
    } else if (kind === 'unknown') {
      kind = 'text'
    }
  } else if (kind === 'link' || kind === 'file' || kind === 'quote' || kind === 'card') {
    const xml = body.trim()
    kind = refineKind(kind, xml)
    extra = parseXmlExtra(kind, xml)
    text = extra.title ?? (kind === 'file' ? (extra.fileName ?? '') : '')
  } else if (kind === 'image') {
    extra = { title: '图片' }
    text = ''
  } else if (kind === 'voice') {
    extra = { title: '语音' }
    text = ''
  } else if (kind === 'video') {
    extra = { title: '视频' }
    text = ''
  } else if (kind === 'sticker') {
    extra = { title: '表情' }
    text = ''
  } else if (kind === 'location') {
    extra = { title: '位置' }
    text = ''
  } else if (kind === 'recall') {
    text = '撤回了一条消息'
  }

  const displayName = isMe
    ? '我'
    : senderUsername
      ? (options.displayNameById?.get(senderId) ?? senderUsername)
      : '系统'

  const sender: MessageSender = {
    id: senderId,
    username: senderUsername,
    displayName: isMe ? '我' : displayName,
    isMe
  }

  const direction: ChatMessage['direction'] = isSystemType ? 'system' : isMe ? 'out' : 'in'

  return {
    localId,
    serverId: null,
    timestamp,
    timeText: formatTime(timestamp, true),
    kind,
    rawType,
    sender,
    direction,
    text: sanitizeText(text),
    ...(extra ? { extra } : {}),
    compressed,
    rawBytes: raw.length
  }
}

/** 去掉控制字符、压缩连续空白；保留换行语义（导出时按需再处理） */
export function sanitizeText(input: string): string {
  let out = ''
  for (const char of input) {
    const code = char.codePointAt(0) ?? 0
    if (code === 10 || code === 13) {
      out += '\n'
      continue
    }
    if (code === 9) {
      out += ' '
      continue
    }
    if (code < 32 || code === 0x7f) continue
    out += char
  }
  return out.replace(/\n{3,}/g, '\n\n').trim()
}

/** 导出用的一行正文：把多行折成单行，避免破坏 txt 的「一行一消息」约定 */
export function toSingleLine(text: string): string {
  return text.replace(/\s*\n\s*/g, ' ⏎ ').trim()
}

/** 给导出层用的统一占位符 */
export function kindPlaceholder(kind: MessageKind, extra?: MessageExtra): string {
  switch (kind) {
    case 'unknown':
      return '[无法解析]'
    case 'image':
      return '[图片]'
    case 'voice':
      return '[语音]'
    case 'video':
      return '[视频]'
    case 'sticker':
      return '[表情]'
    case 'file':
      return `[文件] ${extra?.fileName ?? ''}`.trim()
    case 'link':
      return `[链接] ${extra?.title ?? ''}`.trim()
    case 'card':
      return `[名片] ${extra?.title ?? ''}`.trim()
    case 'location':
      return '[位置]'
    case 'transfer':
      return '[转账]'
    case 'redpacket':
      return '[红包]'
    case 'call':
      return '[通话]'
    case 'quote':
      return `[引用] ${extra?.quotedText ?? ''}`.trim()
    case 'recall':
      return '[撤回]'
    case 'system':
      return '[系统消息]'
    default:
      return ''
  }
}
