/**
 * UI 自检：启动窗口、逐个切页、抓图、收集渲染错误。
 * 用法：electron . --wes-ui-check
 * 输出：%TEMP%/wes-ui/*.png
 *
 * 说明：注入到页面的脚本一律走 executeJavaScript(code, userGesture, ...args) 的字符串形式，
 * 不拼模板字面量——之前那版把反引号嵌在模板字符串里，编译器解析出的行号会漂移，很难查。
 */
import { app, BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')

const outDir = join(tmpdir(), 'wes-ui')

export function uiCheckRequested(): boolean {
  return process.argv.includes('--wes-ui-check')
}

const PROBE = [
  '(() => {',
  '  const root = document.getElementById("root")',
  '  const text = document.body.innerText',
  '  const main = document.querySelector("main[data-page]")',
  '  return {',
  '    rootChildren: root ? root.children.length : 0,',
  '    bodyTextLength: text.length,',
  '    page: main ? main.getAttribute("data-page") : null,',
  '    headline: (document.querySelector("h1") || {}).textContent || "",',
  '    navItems: Array.from(document.querySelectorAll("nav button")).map((b) => (b.innerText.split("\\n")[0] || "").trim()).filter(Boolean),',
  '    svgCount: document.querySelectorAll("svg").length,',
  '    cardCount: document.querySelectorAll("section").length,',
  '    hasStudioApi: typeof window.studio === "object",',
  '    sample: text.slice(0, 200)',
  '  }',
  '})()'
].join('\n')

const clickNavCode = (label: string): string =>
  [
    '(() => {',
    `  const target = Array.from(document.querySelectorAll("nav button")).find((b) => b.innerText.includes(${JSON.stringify(label)}))`,
    '  if (!target) return false',
    '  target.click()',
    '  return true',
    '})()'
  ].join('\n')

export async function runUiCheck(): Promise<number> {
  mkdirSync(outDir, { recursive: true })
  const errors: string[] = []

  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    show: false,
    backgroundColor: '#f4efe4',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  window.webContents.on('console-message', (event) => {
    const record = `[console:${event.level}] ${event.message} (${event.sourceId}:${event.lineNumber})`
    if (event.level === 'error' || event.level === 'warning') errors.push(record)
  })
  window.webContents.on('render-process-gone', (_event, details) => errors.push(`render-process-gone: ${details.reason}`))
  window.webContents.on('did-fail-load', (_event, code, description, url) =>
    errors.push(`did-fail-load ${code} ${description} ${url}`)
  )
  window.webContents.on('preload-error', (_event, path, error) => errors.push(`preload-error ${path}: ${error.message}`))

  const settle = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
  const probe = async (): Promise<Record<string, unknown>> =>
    (await window.webContents.executeJavaScript(PROBE)) as Record<string, unknown>
  const shoot = async (name: string): Promise<void> => {
    const image = await window.webContents.capturePage()
    writeFileSync(join(outDir, name), image.toPNG())
  }

  await window.loadFile(join(__dirname, '../renderer/index.html'))
  // 首屏 + 后台的环境探测（含盘符深度搜索）都跑完再抓图
  await settle(8000)

  const overview = await probe()
  await shoot('01-overview.png')

  const pages: { label: string; file: string; key: string }[] = [
    { label: '会话', file: '02-chats.png', key: 'chats' },
    { label: '导出', file: '03-exports.png', key: 'exports' },
    { label: '连接', file: '04-setup.png', key: 'setup' }
  ]

  const visited: Record<string, Record<string, unknown>> = {}
  for (const page of pages) {
    const clicked = (await window.webContents.executeJavaScript(clickNavCode(page.label))) as boolean
    await settle(1100)
    visited[page.key] = await probe()
    await shoot(page.file)
    console.log(`切到「${page.label}」：${clicked ? 'ok' : '未找到按钮'} → data-page=${String(visited[page.key]?.page ?? 'null')}`)
  }

  const rendered = Number(overview.rootChildren ?? 0) > 0 && Number(overview.bodyTextLength ?? 0) > 200
  const navItems = (overview.navItems as string[]) ?? []
  const routingOk = pages.every((page) => visited[page.key]?.page === page.key)

  console.log('\n===== UI 自检 =====')
  console.log(`根节点渲染：${rendered ? 'PASS' : 'FAIL'}（子节点 ${overview.rootChildren}，文本 ${overview.bodyTextLength} 字符）`)
  console.log(`侧栏导航：${navItems.length >= 3 ? 'PASS' : 'FAIL'}（${JSON.stringify(navItems)}）`)
  console.log(`preload 桥：${overview.hasStudioApi ? 'PASS' : 'FAIL'}`)
  console.log(`页面路由：${routingOk ? 'PASS' : 'FAIL'}`)
  console.log(`SVG 元素：${overview.svgCount} 个，卡片：${overview.cardCount} 个`)
  console.log(`首屏标题：${JSON.stringify(overview.headline)}`)
  console.log(`正文片段：${JSON.stringify(String(overview.sample ?? '').slice(0, 150))}`)
  console.log(`截图目录：${outDir}`)
  console.log(errors.length ? `渲染错误（${errors.length}）：` : '渲染错误：无')
  for (const error of errors.slice(0, 10)) console.log(`  ${error}`)

  return rendered && navItems.length >= 3 && routingOk && overview.hasStudioApi === true && errors.length === 0 ? 0 : 1
}
