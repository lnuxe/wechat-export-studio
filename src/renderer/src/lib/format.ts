/** 纯前端工具：格式化、类名合并、节流 */

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

export function humanBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** index
  return `${value >= 100 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`
}

export function formatTime(ts: number | null | undefined, withSeconds = false): string {
  if (!ts) return '—'
  const date = new Date(ts * 1000)
  const p = (n: number): string => String(n).padStart(2, '0')
  const base = `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`
  return withSeconds ? `${base}:${p(date.getSeconds())}` : base
}

export function relativeTime(iso: string | number | null | undefined): string {
  if (!iso) return '—'
  const ms = typeof iso === 'number' ? iso * 1000 : Date.parse(iso)
  if (!Number.isFinite(ms)) return '—'
  const diff = Date.now() - ms
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 172_800_000) return '昨天'
  if (diff < 2_592_000_000) return `${Math.floor(diff / 86_400_000)} 天前`
  return new Date(ms).toLocaleDateString('zh-CN')
}

export function dayKey(ts: number): string {
  const date = new Date(ts * 1000)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function prettyDayLabel(key: string): string {
  const today = dayKey(Date.now() / 1000)
  const yesterday = dayKey(Date.now() / 1000 - 86_400)
  if (key === today) return '今天'
  if (key === yesterday) return '昨天'
  const [year, month, day] = key.split('-')
  const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][
    new Date(`${key}T00:00:00`).getDay() ?? 0
  ]
  void year
  return `${Number(month)} 月 ${Number(day)} 日 · ${weekday}`
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** 关键字高亮：返回片段数组，调用方自行渲染 <mark> */
export function highlight(text: string, keyword: string): { text: string; hit: boolean }[] {
  const needle = keyword.trim()
  if (!needle) return [{ text, hit: false }]
  const lower = text.toLowerCase()
  const target = needle.toLowerCase()
  const out: { text: string; hit: boolean }[] = []
  let cursor = 0
  let index = lower.indexOf(target)
  while (index >= 0) {
    if (index > cursor) out.push({ text: text.slice(cursor, index), hit: false })
    out.push({ text: text.slice(index, index + target.length), hit: true })
    cursor = index + target.length
    index = lower.indexOf(target, cursor)
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor), hit: false })
  return out
}

/** 极简节流：搜索输入用 */
export function throttle<A extends unknown[]>(fn: (...args: A) => void, wait = 220): (...args: A) => void {
  let last = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  return (...args: A) => {
    const now = Date.now()
    const remaining = wait - (now - last)
    if (remaining <= 0) {
      last = now
      fn(...args)
    } else if (!timer) {
      timer = setTimeout(() => {
        last = Date.now()
        timer = null
        fn(...args)
      }, remaining)
    }
  }
}
