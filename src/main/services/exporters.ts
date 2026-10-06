import { writeFileSync } from 'node:fs'
import type { ChatMessage, ConversationStats, ExportFormat } from '@shared/types'
import { humanBytes, uniquePath } from '../core/fsx'
import { kindPlaceholder, toSingleLine } from './message-codec'

/**
 * 导出器集合：每个格式一个纯函数（messages → 文本），
 * 落盘和命名由 export-runner 统一处理，方便单测与复用。
 */

export interface ExportContext {
  displayName: string
  username: string
  meLabel: string
  withSeconds: boolean
  includeSystem: boolean
  includeStats: boolean
  stats: ConversationStats | null
  location: { dbRelPath: string; table: string; rows: number } | null
  generatedAt: Date
  /** 消息已被时间/类型过滤 */
  totalInConversation: number
}

function bodyOf(message: ChatMessage): string {
  if (message.kind === 'text') return toSingleLine(message.text)
  const placeholder = kindPlaceholder(message.kind, message.extra)
  return placeholder || toSingleLine(message.text)
}

function timeOf(message: ChatMessage, withSeconds: boolean): string {
  return withSeconds ? message.timeText : message.timeText.slice(0, 16)
}

/* ------------------------------------------------------------------- TXT */

/** 与 pickled-fish 的 local-chat-pipeline 完全一致的行格式，下游脚本可直接吃 */
export function renderTxt(messages: ChatMessage[], context: ExportContext): { content: string; lines: number } {
  const lines = messages.map(
    (message) => `[${timeOf(message, context.withSeconds)}] ${message.sender.displayName}: ${bodyOf(message)}`
  )
  return { content: `${lines.join('\n')}\n`, lines: lines.length }
}

/* -------------------------------------------------------------------- MD */

export function renderMarkdown(messages: ChatMessage[], context: ExportContext): { content: string; lines: number } {
  const out: string[] = []
  out.push(`# ${context.displayName} · 聊天记录`, '')
  out.push(
    `> 会话 \`${context.username}\` ｜ ${messages.length} 条消息 ｜ 导出时间 ${context.generatedAt.toLocaleString('zh-CN')}`,
    ''
  )
  if (context.includeStats && context.stats) {
    const stats = context.stats
    out.push(
      '| 指标 | 值 |',
      '| --- | --- |',
      `| 消息总数 | ${stats.messageCount} |`,
      `| 我 / 对方 | ${stats.mine} / ${stats.theirs} |`,
      `| 时间跨度 | ${stats.firstTime ?? '—'} → ${stats.lastTime ?? '—'}（${stats.spanDays} 天）|`,
      `| 平均字数 | ${stats.avgChars} |`,
      `| 中位回复间隔 | ${stats.medianReplySeconds !== null ? `${Math.round(stats.medianReplySeconds / 60)} 分钟` : '—'} |`,
      ''
    )
  }
  let lastDate = ''
  for (const message of messages) {
    const date = message.timeText.slice(0, 10)
    if (date !== lastDate) {
      out.push(`## ${date}`, '')
      lastDate = date
    }
    const time = timeOf(message, context.withSeconds).slice(11)
    out.push(`- \`${time}\` **${message.sender.displayName}**：${bodyOf(message)}`)
  }
  out.push('')
  return { content: out.join('\n'), lines: out.length }
}

/* ------------------------------------------------------------------ JSON */

export function renderJson(messages: ChatMessage[], context: ExportContext): { content: string; lines: number } {
  const payload = {
    schema: 'wechat-export-studio/1',
    exportedAt: context.generatedAt.toISOString(),
    conversation: {
      username: context.username,
      displayName: context.displayName,
      messageCount: messages.length,
      totalInConversation: context.totalInConversation,
      location: context.location,
      meLabel: context.meLabel
    },
    stats: context.includeStats ? context.stats : null,
    messages: messages.map((message) => ({
      localId: message.localId,
      timestamp: message.timestamp,
      time: message.timeText,
      direction: message.direction,
      kind: message.kind,
      rawType: message.rawType,
      sender: message.sender,
      text: message.text,
      ...(message.extra ? { extra: message.extra } : {}),
      compressed: message.compressed
    }))
  }
  const content = `${JSON.stringify(payload, null, 2)}\n`
  return { content, lines: content.split('\n').length }
}

/* ------------------------------------------------------------------- CSV */

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function renderCsv(messages: ChatMessage[], context: ExportContext): { content: string; lines: number } {
  void context
  const header = ['时间', '发言人', '方向', '类型', '内容', '附件/标题']
  const rows = messages.map((message) => [
    message.timeText,
    message.sender.displayName,
    message.direction === 'out' ? '我' : message.direction === 'in' ? '对方' : '系统',
    message.kind,
    message.text.replace(/\r?\n/g, '\\n'),
    message.extra?.title ?? message.extra?.fileName ?? ''
  ])
  const content = `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`
  return { content, lines: rows.length + 1 }
}

/* ------------------------------------------------------------------ HTML */

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * 单文件 HTML 阅读器：内联样式 + 内联脚本，双击即可离线打开、可搜索、可打印。
 * 美术资源全部用内联 SVG/CSS 绘制，不依赖任何外部图片，保证单文件能带走。
 */
export function renderHtml(messages: ChatMessage[], context: ExportContext): { content: string; lines: number } {
  const stats = context.stats
  const dayBars = stats?.perDay.slice(-60) ?? []
  const maxDay = Math.max(1, ...dayBars.map((d) => d.count))
  const sparkline = dayBars
    .map((d, index) => {
      const height = Math.max(2, Math.round((d.count / maxDay) * 34))
      const x = index * 8
      return `<rect x="${x}" y="${36 - height}" width="5" height="${height}" rx="2" fill="url(#barGrad)"><title>${d.date} · ${d.count} 条</title></rect>`
    })
    .join('')
  const hourBars = (stats?.perHour ?? []).map((count, hour) => {
    const max = Math.max(1, ...(stats?.perHour ?? [1]))
    const height = Math.max(1, Math.round((count / max) * 22))
    return `<rect x="${hour * 9}" y="${24 - height}" width="6" height="${height}" rx="2" fill="#7ba7a0" opacity="0.85"><title>${hour} 时 · ${count} 条</title></rect>`
  })

  const rowsHtml: string[] = []
  let lastDate = ''
  let lastSender = ''
  for (const message of messages) {
    const date = message.timeText.slice(0, 10)
    if (date !== lastDate) {
      rowsHtml.push(
        `<div class="day"><span>${date}</span></div>`
      )
      lastDate = date
      lastSender = ''
    }
    const side = message.direction === 'out' ? 'out' : message.direction === 'in' ? 'in' : 'sys'
    if (side === 'sys') {
      rowsHtml.push(`<div class="sys">${escapeHtml(bodyOf(message))}</div>`)
      continue
    }
    const grouped = message.sender.displayName === lastSender
    lastSender = message.sender.displayName
    const time = timeOf(message, context.withSeconds).slice(11)
    const text = message.kind === 'text' ? escapeHtml(message.text).replace(/\n/g, '<br>') : escapeHtml(bodyOf(message))
    const quoted = message.extra?.quotedText
      ? `<blockquote>${escapeHtml(message.extra.quotedText)}</blockquote>`
      : ''
    rowsHtml.push(
      `<div class="row ${side}${grouped ? ' grouped' : ''}" data-kind="${message.kind}">` +
        `<div class="meta"><span class="who">${escapeHtml(grouped ? '' : message.sender.displayName)}</span><span class="t">${time}</span></div>` +
        `<div class="bubble ${message.kind}">${quoted}${text || '<em>（无正文）</em>'}</div>` +
        `</div>`
    )
  }

  const kpi = stats
    ? `<div class="kpis">
        <div class="kpi"><b>${stats.messageCount}</b><span>消息</span></div>
        <div class="kpi"><b>${stats.mine}</b><span>我发出</span></div>
        <div class="kpi"><b>${stats.theirs}</b><span>对方</span></div>
        <div class="kpi"><b>${stats.spanDays}</b><span>天跨度</span></div>
        <div class="kpi"><b>${stats.avgChars}</b><span>平均字数</span></div>
        <div class="kpi"><b>${stats.medianReplySeconds !== null ? Math.round(stats.medianReplySeconds / 60) : '—'}</b><span>中位回复(分)</span></div>
      </div>`
    : ''

  const content = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(context.displayName)} · 聊天记录</title>
<style>
  :root{
    --ink:#25201c; --ink-soft:#6a5f56; --paper:#f6f1e7; --paper-2:#fffdf8;
    --jade:#2f6b5f; --jade-soft:#dbe9e4; --gold:#c08a3e; --line:#e4dbcb;
    --bubble-out:linear-gradient(135deg,#2f6b5f,#3c8577); --bubble-in:#fffdf8;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--paper);color:var(--ink);
    font:15px/1.65 "PingFang SC","Microsoft YaHei",system-ui,-apple-system,"Segoe UI",sans-serif;}
  .grain{position:fixed;inset:0;pointer-events:none;opacity:.35;mix-blend-mode:multiply;
    background-image:radial-gradient(rgba(0,0,0,.05) 1px,transparent 1px);background-size:4px 4px;}
  header{padding:38px 26px 20px;background:
    radial-gradient(1200px 220px at 10% -40%,rgba(47,107,95,.16),transparent 70%),
    radial-gradient(900px 200px at 90% -60%,rgba(192,138,62,.18),transparent 70%);
    border-bottom:1px solid var(--line);}
  .wrap{max-width:940px;margin:0 auto;padding:0 22px 80px}
  h1{margin:0 0 6px;font-size:26px;letter-spacing:.5px;display:flex;align-items:center;gap:12px}
  h1 svg{flex:none}
  .sub{color:var(--ink-soft);font-size:13px}
  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(104px,1fr));gap:10px;margin:22px 0 8px}
  .kpi{background:var(--paper-2);border:1px solid var(--line);border-radius:14px;padding:12px 14px;
    box-shadow:0 1px 0 #fff inset,0 6px 18px -14px rgba(37,32,28,.5)}
  .kpi b{display:block;font-size:20px;color:var(--jade)}
  .kpi span{font-size:12px;color:var(--ink-soft)}
  .charts{display:flex;gap:22px;flex-wrap:wrap;margin:16px 0 4px;align-items:flex-end}
  .chart{background:var(--paper-2);border:1px solid var(--line);border-radius:14px;padding:10px 12px}
  .chart h3{margin:0 0 6px;font-size:12px;color:var(--ink-soft);font-weight:600}
  .toolbar{position:sticky;top:0;z-index:5;backdrop-filter:blur(8px);background:rgba(246,241,231,.86);
    border-bottom:1px solid var(--line);padding:10px 0;display:flex;gap:10px;flex-wrap:wrap;align-items:center}
  input[type=search],select{font:inherit;padding:7px 12px;border:1px solid var(--line);border-radius:999px;
    background:#fff;color:var(--ink);outline:none}
  input[type=search]{min-width:230px}
  .count{font-size:12px;color:var(--ink-soft);margin-left:auto}
  .day{display:flex;justify-content:center;margin:26px 0 14px}
  .day span{background:rgba(37,32,28,.06);color:var(--ink-soft);font-size:12px;padding:3px 12px;border-radius:999px}
  .row{display:flex;flex-direction:column;margin:10px 0;max-width:76%}
  .row.out{align-self:flex-end;margin-left:auto;align-items:flex-end}
  .row.in{align-items:flex-start}
  .row.grouped{margin-top:3px}
  .meta{display:flex;gap:8px;align-items:baseline;font-size:11px;color:var(--ink-soft);padding:0 6px 3px}
  .row.out .meta{flex-direction:row-reverse}
  .bubble{padding:10px 14px;border-radius:16px;white-space:pre-wrap;word-break:break-word;
    box-shadow:0 10px 24px -20px rgba(37,32,28,.9)}
  .row.in .bubble{background:var(--bubble-in);border:1px solid var(--line);border-top-left-radius:6px}
  .row.out .bubble{background:var(--bubble-out);color:#f4fffb;border-top-right-radius:6px}
  .bubble.image,.bubble.voice,.bubble.video,.bubble.sticker,.bubble.file,.bubble.link,
  .bubble.card,.bubble.location,.bubble.transfer,.bubble.redpacket,.bubble.call{font-style:normal;opacity:.95}
  .row.in .bubble.image,.row.in .bubble.voice,.row.in .bubble.video,.row.in .bubble.sticker{background:var(--jade-soft)}
  blockquote{margin:0 0 8px;padding:6px 10px;border-left:3px solid rgba(255,255,255,.45);
    background:rgba(0,0,0,.08);border-radius:8px;font-size:13px;opacity:.92;white-space:pre-wrap}
  .row.in blockquote{border-left-color:var(--jade);background:rgba(47,107,95,.07)}
  .sys{text-align:center;font-size:12px;color:var(--ink-soft);margin:8px 0}
  .msg-wrap{display:flex;flex-direction:column}
  footer{margin-top:46px;padding-top:18px;border-top:1px dashed var(--line);color:var(--ink-soft);font-size:12px}
  mark{background:#ffe9a8;padding:0 2px;border-radius:3px}
  @media print{.toolbar{display:none}.grain{display:none}body{background:#fff}}
</style>
</head>
<body>
<div class="grain"></div>
<header>
  <div class="wrap" style="padding-bottom:0">
    <h1>
      <svg width="30" height="30" viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <path d="M6 21c0-6.6 5-11.5 11-11.5S28 14 28 19.4c0 5.4-4.9 9.8-11 9.8-1.2 0-2.4-.2-3.5-.5L8 30l1.2-4.2A10.6 10.6 0 0 1 6 21Z" fill="#2f6b5f"/>
        <circle cx="12.6" cy="19" r="1.7" fill="#f6f1e7"/><circle cx="20.4" cy="19" r="1.7" fill="#f6f1e7"/>
      </svg>
      ${escapeHtml(context.displayName)}
      <span style="font-size:12px;color:var(--ink-soft);font-weight:400">${escapeHtml(context.username)}</span>
    </h1>
    <div class="sub">由 WeChat Export Studio 导出 · ${context.generatedAt.toLocaleString('zh-CN')} · 共 ${messages.length} 条（会话总计 ${context.totalInConversation} 条）</div>
    ${kpi}
    <div class="charts">
      <div class="chart">
        <h3>每日消息量（近 60 天）</h3>
        <svg width="${Math.max(120, dayBars.length * 8)}" height="40" role="img">
          <defs><linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#3c8577"/><stop offset="100%" stop-color="#2f6b5f" stop-opacity=".55"/>
          </linearGradient></defs>${sparkline}
        </svg>
      </div>
      <div class="chart">
        <h3>活跃时段分布</h3>
        <svg width="220" height="28" role="img">${hourBars}</svg>
      </div>
    </div>
  </div>
</header>
<div class="wrap">
  <div class="toolbar">
    <input type="search" id="q" placeholder="搜索聊天内容…" autocomplete="off">
    <select id="kind">
      <option value="">全部类型</option>
      <option value="text">仅文字</option>
      <option value="image">图片</option>
      <option value="voice">语音</option>
      <option value="link">链接</option>
    </select>
    <span class="count" id="count">${messages.length} 条</span>
  </div>
  <div class="msg-wrap" id="list">
${rowsHtml.join('\n')}
  </div>
  <footer>
    本文件由本地工具生成，含个人隐私内容：请勿上传网盘、勿提交 git、勿转发给第三方。<br>
    解密参数（微信 4.x）：page=4096 / reserve=80 / IV@4016 / PBKDF2-HMAC-SHA512 × 256000。
  </footer>
</div>
<script>
(function(){
  var q=document.getElementById('q'),k=document.getElementById('kind'),
      list=document.getElementById('list'),count=document.getElementById('count');
  var rows=[].slice.call(list.querySelectorAll('.row'));
  var days=[].slice.call(list.querySelectorAll('.day'));
  function apply(){
    var needle=q.value.trim().toLowerCase(), kind=k.value, shown=0;
    rows.forEach(function(row){
      var okKind=!kind||row.dataset.kind===kind||(kind==='text'&&row.dataset.kind==='text');
      var text=row.querySelector('.bubble').textContent.toLowerCase();
      var okText=!needle||text.indexOf(needle)>=0;
      var show=okKind&&okText;
      row.style.display=show?'':'none';
      if(show)shown++;
    });
    days.forEach(function(day){
      var n=day.nextElementSibling,any=false;
      while(n&&!n.classList.contains('day')){
        if(n.classList.contains('row')&&n.style.display!=='none'){any=true;break}
        n=n.nextElementSibling;
      }
      day.style.display=any?'':'none';
    });
    count.textContent=shown+' 条';
  }
  q.addEventListener('input',apply);k.addEventListener('change',apply);
})();
</script>
</body>
</html>
`
  return { content, lines: content.split('\n').length }
}

/* --------------------------------------------------------------- 调度 */

export const RENDERERS: Record<
  ExportFormat,
  { ext: string; render: (messages: ChatMessage[], context: ExportContext) => { content: string; lines: number }; binary?: boolean }
> = {
  txt: { ext: '.txt', render: renderTxt },
  md: { ext: '.md', render: renderMarkdown },
  json: { ext: '.json', render: renderJson },
  csv: { ext: '.csv', render: renderCsv },
  html: { ext: '.html', render: renderHtml }
}

export function writeArtifact(dir: string, base: string, format: ExportFormat, content: string): string {
  const path = uniquePath(dir, base, RENDERERS[format].ext)
  writeFileSync(path, content, 'utf8')
  return path
}

export function estimateBytes(format: ExportFormat, messages: ChatMessage[]): number {
  const averageChars =
    messages.length === 0
      ? 40
      : messages.reduce((sum, m) => sum + m.text.length + 30, 0) / messages.length
  const multiplier = format === 'html' ? 6 : format === 'json' ? 4.2 : format === 'csv' ? 1.3 : 1.1
  return Math.round(averageChars * messages.length * multiplier)
}

export { humanBytes }
