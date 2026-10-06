/**
 * 全链路 UI 验收：用真实解密产物驱动界面，走完「连接 → 会话 → 导出」并抓图。
 *
 * 前置：先跑 `npm run smoke`（产物写到 %TEMP%/wes-smoke）。
 * 用法：node scripts/run-ui-flow.mjs（内部会带 WES_WORKDIR 与独立 userData）
 */
import { app, BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')

const outDir = join(tmpdir(), 'wes-ui')

export function uiFlowRequested(): boolean {
  return process.argv.includes('--wes-ui-flow')
}

const PROBE = [
  '(() => {',
  '  const main = document.querySelector("main[data-page]")',
  '  const text = main ? main.textContent || "" : document.body.textContent || ""',
  '  const scroller = document.querySelector("main [data-thread-scroller]")',
  '  const sheet = document.querySelector("[data-settings-sheet], [data-export-panel]")',
  '  const overlayText = sheet ? sheet.textContent || "" : ""',
  '  const bubbles = Array.from(document.querySelectorAll("main div")).filter((d) =>',
  '    typeof d.className === "string" && d.className.includes("max-w-[74%]")',
  '  )',
  '  return {',
  '    page: main ? main.getAttribute("data-page") : null,',
  '    textLength: text.length,',
  '    listItems: document.querySelectorAll("main ul li").length,',
  '    bubbles: bubbles.length,',
  '    headline: (document.querySelector("main h1") || {}).textContent || "",',
  '    liveLabel: (Array.from(document.querySelectorAll("main button")).find((b) =>',
  '      b.textContent === "实时" || b.textContent === "已暂停",',
  '    ) || {}).textContent || null,',
  '    emptyHints: Array.from(document.querySelectorAll("main p")).map((p) => p.textContent).filter((t) => t && t.length < 40).slice(0, 6),',
  '    scrollTop: scroller ? scroller.scrollTop : null,',
  '    scrollHeight: scroller ? scroller.scrollHeight : null,',
  '    clientHeight: scroller ? scroller.clientHeight : null,',
  '    overlay: overlayText.replace(/\\s+/g, " ").slice(0, 220),',
  '    sample: text.replace(/\\s+/g, " ").slice(0, 320)',
  '  }',
  '})()'
].join('\n')

const clickNavCode = (label) =>
  [
    '(() => {',
    `  const target = Array.from(document.querySelectorAll("nav button")).find((b) => b.innerText.includes(${JSON.stringify(label)}))`,
    '  if (!target) return false',
    '  target.click()',
    '  return true',
    '})()'
  ].join('\n')

const clickByTextCode = (selector, text) =>
  [
    '(() => {',
    `  const nodes = Array.from(document.querySelectorAll(${JSON.stringify(selector)}))`,
    `  const target = nodes.find((n) => n.innerText.trim().startsWith(${JSON.stringify(text)})) || nodes[0]`,
    '  if (!target) return false',
    '  target.click()',
    '  return true',
    '})()'
  ].join('\n')

const typeCode = (selector, value) =>
  [
    '(() => {',
    `  const el = document.querySelector(${JSON.stringify(selector)})`,
    '  if (!el) return false',
    '  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set',
    '  setter.call(el, ' + JSON.stringify(value) + ')',
    '  el.dispatchEvent(new Event("input", { bubbles: true }))',
    '  return true',
    '})()'
  ].join('\n')

const scrollCode = (top) => `(() => { const s = document.querySelector("main [data-thread-scroller]"); if (!s) return false; s.scrollTop = ${top}; s.dispatchEvent(new Event("scroll")); return true })()`

/** 点击带 data-* 锚点的控件：比按文案匹配稳得多 */
const clickAnchorCode = (attribute) =>
  `(() => { const t = document.querySelector('[${attribute}]'); if (!t) return false; t.click(); return true })()`

const waitForCode = (selector, timeoutMs = 4000) =>
  [
    '(() => new Promise((resolve) => {',
    `  const started = Date.now()`,
    '  const tick = () => {',
    `    if (document.querySelector(${JSON.stringify(selector)})) return resolve(true)`,
    '    if (Date.now() - started > ' + timeoutMs + ') return resolve(false)',
    '    setTimeout(tick, 120)',
    '  }',
    '  tick()',
    '}))()'
  ].join('\n')

export async function runUiFlow(): Promise<number> {
  mkdirSync(outDir, { recursive: true })
  const errors: string[] = []
  const results: { name: string; ok: boolean; detail: string }[] = []
  const check = (name: string, ok: boolean, detail = ''): void => {
    results.push({ name, ok, detail })
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
  }

  const window = new BrowserWindow({
    width: 1500,
    height: 980,
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
    if (event.level === 'error') errors.push(`[console] ${event.message} (${event.sourceId}:${event.lineNumber})`)
  })
  window.webContents.on('preload-error', (_event, path, error) => errors.push(`preload-error ${path}: ${error.message}`))

  const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const probe = async () => await window.webContents.executeJavaScript(PROBE)
  const readTrace = async () => await window.webContents.executeJavaScript('window.__studioTrace || []')
  const shoot = async (name) => {
    window.webContents.invalidate()
    await settle(600)
    const image = await window.webContents.capturePage()
    writeFileSync(join(outDir, name), image.toPNG())
  }

  await window.loadFile(join(__dirname, '../renderer/index.html'))
  await window.webContents.executeJavaScript('window.__studioTrace = []; true')
  await settle(8000)

  /* 1. 启动落在连接页 */
  const setup = await probe()
  check('启动落在「连接」页', setup.page === 'setup', `data-page=${String(setup.page)} headline=${JSON.stringify(setup.headline)}`)
  console.log(`      连接页片段：${String(setup.sample ?? '').slice(0, 200)}`)
  await shoot('flow-01-setup.png')

  /* 2. 切到会话页 */
  check('导航切换到会话', await window.webContents.executeJavaScript(clickNavCode('会话')))
  await settle(2200)
  const chats = await probe()
  check('会话列表渲染', chats.page === 'chats' && Number(chats.listItems ?? 0) > 0, `${chats.listItems} 个会话`)
  await shoot('flow-02-chats.png')

  /* 3. 用搜索缩小范围后打开一个有消息的会话 */
  await window.webContents.executeJavaScript(typeCode('main input[placeholder*="搜索联系人"]', '张'))
  await settle(1600)
  const narrowed = await probe()
  console.log(`      搜索「张」后：${narrowed.listItems} 条`)

  let opened = false
  let bubbles = 0
  for (let index = 0; index < 3 && !opened; index += 1) {
    await window.webContents.executeJavaScript(clickNavCode('会话'))
    await settle(200)
    await window.webContents.executeJavaScript(
      `(() => { const n = Array.from(document.querySelectorAll("main ul li button"))[${index}]; if (!n) return false; n.click(); return true })()`
    )
    await settle(index === 0 ? 5000 : 3500)
    const trace = await readTrace()
    if (trace.some((line) => line.startsWith('openConversation:locate "Msg_'))) {
      opened = true
      bubbles = Number((await probe()).bubbles ?? 0)
    }
  }
  check('打开会话并渲染消息', opened && bubbles > 0, `${bubbles} 个气泡`)

  const thread = await probe()
  console.log(`      会话轨迹：${JSON.stringify((await readTrace()).slice(-3))}`)
  check('消息区启用实时', thread.liveLabel !== null, `实时开关=${String(thread.liveLabel)}`)
  check(
    '消息区贴底显示',
    Number(thread.scrollTop ?? 0) > 0 && Number(thread.scrollHeight ?? 0) > Number(thread.clientHeight ?? 0),
    `scrollTop=${thread.scrollTop} / 内容 ${thread.scrollHeight} 视口 ${thread.clientHeight}`
  )
  // 刚打开会话不应出现「N 条新消息」——第一轮轮询必须用会话最后时间当水位
  const jumpVisible = await window.webContents.executeJavaScript(
    `Boolean(Array.from(document.querySelectorAll("main button")).find((b) => (b.textContent || "").includes("条新消息")))`
  )
  check('首次进入不误报新消息', jumpVisible === false, jumpVisible ? '出现了「N 条新消息」假提示' : '无假提示')
  await shoot('flow-03-thread.png')

  /* 4. 往上滚 → 触发加载更早的消息 */
  const beforeTop = await probe()
  await window.webContents.executeJavaScript(scrollCode(0))
  await settle(2600)
  const afterTop = await probe()
  check(
    '滚到顶部加载更早消息',
    Number(afterTop.bubbles ?? 0) > Number(beforeTop.bubbles ?? 0),
    `气泡 ${beforeTop.bubbles} → ${afterTop.bubbles}`
  )
  await shoot('flow-04-scroll-older.png')

  /* 4b. 用界面上的「回到最新」按钮回到贴底状态 */
  const jumpClicked = await window.webContents.executeJavaScript(
    [
      '(() => {',
      '  const target = Array.from(document.querySelectorAll("main button")).find((b) =>',
      '    (b.textContent || "").includes("回到最新") || (b.textContent || "").includes("条新消息"),',
      '  )',
      '  if (!target) return false',
      '  target.click()',
      '  return true',
      '})()'
    ].join('\n')
  )
  check('出现并点击「回到最新」', jumpClicked === true, jumpClicked ? '按钮已点击' : '没有找到按钮')
  await settle(2500)
  const backBottom = await probe()
  const distance = Number(backBottom.scrollHeight ?? 0) - Number(backBottom.scrollTop ?? 0) - Number(backBottom.clientHeight ?? 0)
  check('回到最新后贴底', distance < 160, `距底 ${distance}px`)

  /* 5. 导出面板 */
  check('点击导出按钮', await window.webContents.executeJavaScript(clickAnchorCode('data-action="export"')))
  const panelOpened = await window.webContents.executeJavaScript(waitForCode('[data-export-panel]'))
  check('打开导出抽屉', panelOpened === true, panelOpened ? '面板已挂载' : '4s 内未出现面板')
  await shoot('flow-05-export-panel.png')

  await window.webContents.executeJavaScript(clickByTextCode('main button', '开始导出'))
  await settle(4500)
  const afterExport = await probe()
  check('导出后跳到导出记录', afterExport.page === 'exports', `data-page=${String(afterExport.page)}`)
  console.log(`      导出记录片段：${String(afterExport.sample ?? '').slice(0, 200)}`)
  await shoot('flow-06-exports.png')

  /* 6. 设置抽屉 */
  check('点击设置入口', await window.webContents.executeJavaScript(clickAnchorCode('data-settings-open')))
  const sheetOpened = await window.webContents.executeJavaScript(waitForCode('[data-settings-sheet]'))
  const settings = await probe()
  check(
    '打开设置抽屉',
    sheetOpened === true && String(settings.overlay ?? '').includes('外观'),
    `抽屉内容：${String(settings.overlay ?? '').slice(0, 90)}`
  )
  await shoot('flow-07-settings.png')

  /* 7. 皮肤切换：验证令牌层真的生效（data-theme + 背景色变化） */
  const lightBg = await window.webContents.executeJavaScript(
    'getComputedStyle(document.body).backgroundColor'
  )
  const switched = await window.webContents.executeJavaScript(
    [
      '(() => {',
      '  const target = Array.from(document.querySelectorAll("[data-settings-sheet] button")).find((b) =>',
      '    (b.textContent || "").includes("冷墨"),',
      '  )',
      '  if (!target) return false',
      '  target.click()',
      '  return true',
      '})()'
    ].join('\n')
  )
  await settle(1000)
  const darkBg = await window.webContents.executeJavaScript('getComputedStyle(document.body).backgroundColor')
  const darkTheme = await window.webContents.executeJavaScript('document.documentElement.dataset.theme')
  check(
    '皮肤切换到冷墨',
    switched === true && darkTheme === 'midnight' && darkBg !== lightBg,
    `theme=${String(darkTheme)} bg ${String(lightBg)} → ${String(darkBg)}`
  )
  await shoot('flow-08-midnight.png')

  // 切回暖纸，避免把偏好留在深色
  await window.webContents.executeJavaScript(
    [
      '(() => {',
      '  const target = Array.from(document.querySelectorAll("[data-settings-sheet] button")).find((b) =>',
      '    (b.textContent || "").includes("暖纸"),',
      '  )',
      '  if (!target) return false',
      '  target.click()',
      '  return true',
      '})()'
    ].join('\n')
  )
  await settle(800)

  await window.webContents.executeJavaScript(
    'window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape"})); true'
  )
  await settle(600)

  const failed = results.filter((item) => !item.ok)
  console.log(`\n===== UI 全链路：${results.length - failed.length}/${results.length} 通过 =====`)
  for (const item of failed) console.log(`  - ${item.name}: ${item.detail}`)
  console.log(`渲染错误：${errors.length ? errors.slice(0, 6).join(' / ') : '无'}`)
  console.log(`截图目录：${outDir}`)
  return failed.length === 0 && errors.length === 0 ? 0 : 1
}
