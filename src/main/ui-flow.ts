/**
 * 全链路 UI 验收：用真实解密产物驱动界面，走完「连接 → 会话 → 导出」并抓图。
 *
 * 前置：先跑 `npm run smoke`（产物写到 %TEMP%/wes-smoke）。
 * 用法：node scripts/run-ui-flow.mjs（内部会带 WES_WORKDIR 与独立 userData）
 */
import { app, BrowserWindow } from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')

const outDir = join(tmpdir(), 'wes-ui')

/** 冒烟自检留下的「已完成」标记：没有它就说明这台机器没有真实数据 */
const smokeMarker = join(tmpdir(), 'wes-smoke', 'smoke-ok.json')

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
  '  const threadTotal = document.querySelector("main header p span.text-tabular")',
  '  const totalText = threadTotal ? threadTotal.textContent || "" : ""',
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

  /**
   * 前置检查：这套验收要用真实解密产物驱动界面（选会话、读消息、导出），
   * 所以必须先跑过 `npm run smoke`。没有产物就优雅退出 0——
   * 这样它也能接进 CI（runner 上没装微信，自然没有产物）。
   */
  if (!existsSync(smokeMarker)) {
    console.log('SKIP  UI 全链路验收：没有找到真实数据产物。')
    console.log(`      期望的标记文件：${smokeMarker}`)
    console.log('      请先执行 `npm run smoke`（需要本机装有微信并已拿到密钥）。')
    return 0
  }

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

  /**
   * 打开会话：不按「列表第 N 项」点击。
   *
   * 早先是 `[0] / [1] / [2]` 依次试三次，但微信只为「已同步」的会话建消息表
   * （实测前 20 个会话里只有 1~2 个能定位），到底哪一项能打开取决于
   * 搜索结果的排序，会随数据变化——这条断言因此偶发失败（约 1/5）。
   * 现在改成：先把搜索范围收窄到具体名字，点它，然后轮询等消息渲染出来。
   */
  const targetName = '张文亭'
  await window.webContents.executeJavaScript(typeCode('main input[placeholder*="搜索联系人"]', targetName))
  await settle(1500)

  const clicked = await window.webContents.executeJavaScript(
    [
      '(() => {',
      `  const nodes = Array.from(document.querySelectorAll("main ul li button"))`,
      `  const hit = nodes.find((n) => (n.textContent || "").includes(${JSON.stringify(targetName)}))`,
      '  if (!hit) return false',
      '  hit.click()',
      '  return true',
      '})()'
    ].join('\n')
  )
  check(`在列表中找到并点击「${targetName}」`, clicked === true)

  // 轮询等待：气泡渲染出来才算真的打开了
  let bubbles = 0
  let opened = false
  for (let attempt = 0; attempt < 25 && !opened; attempt += 1) {
    await settle(400)
    const trace = await readTrace()
    const located = trace.some((line) => line.startsWith('openConversation:locate "Msg_'))
    const snapshot = await probe()
    bubbles = Number(snapshot.bubbles ?? 0)
    if (located && bubbles > 0) opened = true
  }
  check('打开会话并渲染消息', opened && bubbles > 0, `${bubbles} 个气泡`)

  // 直接读页面里的滚动探针，而不是靠 sleep 猜时序
  const scrollTrace = await window.webContents.executeJavaScript('window.__scrollTrace || []')
  console.log(`      滚动探针：${JSON.stringify(scrollTrace.slice(-6))}`)

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

  /**
   * 4a. 连续翻页必须逐页推进，不能自我增殖。
   *
   * 这条是回归防线：曾经因为后端分页方向写反（desc 时 start 用了 offset），
   * 「往上翻一页」拿回来的是较新的消息，前端前置插入后内容无限膨胀——
   * 界面高度涨到 15 万像素，而翻页记录里看不出异常。
   * 判据：每次翻页只增加约一页的量，且绝不倒退。
   */
  let previousCount = Number(afterTop.bubbles ?? 0)
  let monotonic = true
  const steps: number[] = []
  const threadTotal = await window.webContents.executeJavaScript(
    `(() => { const el = document.querySelector("main header span.text-tabular"); return el ? el.textContent || "" : "" })()`
  )
  for (let round = 0; round < 3; round += 1) {
    // 必须「先往下滚、再滚回顶部」：一直停在 0 不会产生新的 scroll 事件，
    // 翻页闸门也就不会重新打开（这是刻意设计，防止一次手势连翻多页）。
    await window.webContents.executeJavaScript(scrollCode(1200))
    await settle(500)
    await window.webContents.executeJavaScript(scrollCode(0))
    await settle(2200)
    const snapshot = await probe()
    const count = Number(snapshot.bubbles ?? 0)
    steps.push(count)
    if (count < previousCount) monotonic = false
    previousCount = count
  }
  const last = steps.at(-1) ?? Number(afterTop.bubbles ?? 0)
  const pageGrowth = last - Number(afterTop.bubbles ?? 0)
  check(
    '连续翻页逐页推进（不增殖）',
    monotonic && pageGrowth > 0 && pageGrowth < 700,
    `气泡 ${afterTop.bubbles} → ${steps.join(' → ')}（共 +${pageGrowth}，会话总量 ${threadTotal}）`
  )

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

  /**
   * 等滚动真正稳定后再判定。
   *
   * 单次 sleep + 一次探针是不够的：点击后内容还在继续插入（翻页 / 平滑滚动），
   * 那一瞬间读到的是上一帧布局，会得出「距底 13942px」的假结论，
   * 而应用自己的探针在同一时刻记录的是 dist=0。
   * 所以这里连续采样，取「连续两次读数一致」作为稳定判据。
   */
  let distance = Number.POSITIVE_INFINITY
  let stable = 0
  let previous = -1
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await settle(400)
    const snapshot = await probe()
    distance = Math.round(
      Number(snapshot.scrollHeight ?? 0) - Number(snapshot.scrollTop ?? 0) - Number(snapshot.clientHeight ?? 0)
    )
    if (distance === previous && distance < 160) {
      stable += 1
      if (stable >= 2) break
    } else {
      stable = 0
    }
    previous = distance
  }
  const jumpTrace = await window.webContents.executeJavaScript('window.__scrollTrace || []')
  console.log(`      探针共 ${jumpTrace.length} 条，最近 8 条：`)
  for (const line of jumpTrace.slice(-8)) console.log(`        ${line}`)
  console.log(`      稳定后距底：${distance}px`)
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
