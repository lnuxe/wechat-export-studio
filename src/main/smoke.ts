/**
 * 端到端冒烟自检（在真实主进程里跑，覆盖 解密 → 会话 → 导出 全链路）。
 *
 * 用法：electron . --wes-smoke   或   WES_SMOKE=1 electron .
 * 产物写入 %TEMP%/wes-smoke，不污染真实工作目录；退出码 0=全部通过。
 *
 * 为什么要放在应用内：解密/读取依赖 Electron 的 node:sqlite 与工作区配置，
 * 只有跑在真实运行时里，验证才有意义（构建产物是否能跑通是另一回事）。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { workspace } from './core/workspace'
import { log } from './core/logger'
import { capabilities } from './core/env'
import { detectInstallation, listAccounts } from './services/wechat-environment'
import type { ChatStore } from './services/chat-store'

interface Check {
  name: string
  /** pass=通过，fail=失败，skip=环境不具备（例如 CI 机器上根本没装微信） */
  status: 'pass' | 'fail' | 'skip'
  detail: string
}

export function smokeRequested(): boolean {
  return process.argv.includes('--wes-smoke') || process.env.WES_SMOKE === '1'
}

/**
 * 汇总并决定退出码。
 *
 * **只有 fail 才返回非 0**：skip 表示「这台机器没有微信数据」（CI runner 的常态），
 * 若把 skip 也算失败，冒烟就没法进流水线做前置校验。
 */
function finishSmoke(checks: Check[], started: number, smokeWorkDir: string): number {
  const failed = checks.filter((check) => check.status === 'fail')
  const passed = checks.filter((check) => check.status === 'pass')
  const skipped = checks.filter((check) => check.status === 'skip')
  console.log(
    `\n===== 冒烟结果：${passed.length}/${checks.length - skipped.length} 通过` +
      `${skipped.length ? ` · ${skipped.length} 项跳过` : ''} · ${((Date.now() - started) / 1000).toFixed(1)}s =====`
  )
  if (failed.length) {
    console.log('失败项：')
    for (const item of failed) console.log(`  - ${item.name}: ${item.detail}`)
  }
  if (skipped.length) {
    console.log('跳过项（环境缺失，不是失败）：')
    for (const item of skipped) console.log(`  - ${item.name}: ${item.detail}`)
  }
  console.log(`产物目录：${join(smokeWorkDir, 'exports')}`)
  log.info('app', `冒烟自检结束：通过 ${passed.length} · 失败 ${failed.length} · 跳过 ${skipped.length}`)

  // 留下标记：UI 全链路验收（--wes-ui-flow）要用这份产物驱动界面，
  // 它靠这个文件判断「本机有没有真实数据」——没有就优雅跳过而不是失败，
  // 于是这条验收也能接进 CI（runner 上没装微信，自然没有产物）。
  const marker = join(smokeWorkDir, 'smoke-ok.json')
  if (failed.length === 0) {
    writeFileSync(
      marker,
      `${JSON.stringify({ finishedAt: new Date().toISOString(), passed: passed.length, skipped: skipped.length }, null, 2)}\n`,
      'utf8'
    )
    console.log(`标记文件：${marker}`)
  } else {
    // 有失败项就把旧标记删掉，避免 UI 全链路拿一份不可信的产物去验收
    rmSync(marker, { force: true })
  }

  // 只有真实失败才返回非 0：环境缺失不算失败，否则无法把冒烟接进 CI 做前置校验
  return failed.length === 0 ? 0 : 1
}

export async function runSmoke(): Promise<number> {
  const started = Date.now()
  const checks: Check[] = []
  const step = (name: string, ok: boolean, detail = ''): void => {
    checks.push({ name, status: ok ? 'pass' : 'fail', detail })
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
  }
  /**
   * 环境不具备时记为 SKIP 而不算失败。
   *
   * 为什么需要：这套断言依赖「本机装了微信 + 有真实密钥」，CI runner 上两者都没有。
   * 如果它们算失败，就无法把冒烟接进流水线做前置校验。
   * 注意 SKIP 只用于「环境缺失」，真实断言失败仍然是 FAIL。
   */
  const skip = (name: string, reason: string): void => {
    checks.push({ name, status: 'skip', detail: reason })
    console.log(`SKIP  ${name}  — ${reason}`)
  }
  /** 记录「因为环境缺失而跳过」的次数，用于结尾的汇总 */
  let skipped = 0
  const skips = (name: string, reason: string): void => {
    skipped += 1
    skip(name, reason)
  }

  const smokeWorkDir = join(tmpdir(), 'wes-smoke')
  mkdirSync(smokeWorkDir, { recursive: true })

  try {
    // 内置测试密钥（若本机已取过）——没有就走人工验证路径
    const knownKeyPaths = [
      join(process.env.USERPROFILE ?? '', 'Desktop', 'wx_export', 'key.txt'),
      join(smokeWorkDir, 'key.txt')
    ]
    const knownKey = knownKeyPaths.map((path) => (existsSync(path) ? readFileSync(path, 'utf8').trim() : '')).find(Boolean)
    if (knownKey) writeFileSync(join(smokeWorkDir, 'key.txt'), `${knownKey}\n`, 'utf8')

    const config = workspace.patch({
      workDir: smokeWorkDir,
      ...(knownKey ? { savedKey: knownKey } : {})
    })
    step('工作区初始化（独立 userData，不影响用户配置）', existsSync(config.decryptDir), config.workDir)

    const caps = await capabilities()
    step('运行时能力', caps.sqlite, `sqlite=${caps.sqliteVersion} python=${caps.pythonVersion ?? 'n/a'}`)

    const installation = await detectInstallation()
    if (!installation.installPath && installation.storageCandidates.length === 0) {
      skips('微信环境探测', '本机没有安装微信（CI runner 属正常情况）')
      skips('账号目录扫描', '没有微信数据目录，无法继续后面的真实链路断言')
      skips('密钥读取', '同上')
      skips('解密 / 会话 / 导出全链路', '缺少真实微信数据与密钥')
      console.log('\n      这类环境下能验证的是：构建产物可启动、运行时能力、模块可加载。')
    } else {
      step(
        '微信环境探测',
        Boolean(installation.installPath || installation.storageCandidates.length),
        `${installation.variant} 版本=${installation.version ?? '未解析'} running=${installation.running}`
      )
      step('微信版本解析（PE 版本资源）', Boolean(installation.version), installation.version ?? '未解析出 x.y.z')
    }

    const accounts = installation.installPath || installation.storageCandidates.length > 0 ? await listAccounts() : []
    const account = accounts[0]
    if (accounts.length === 0 && (installation.installPath || installation.storageCandidates.length > 0)) {
      const { dataRootCandidates } = await import('./services/wechat-environment')
      const candidates = await dataRootCandidates(workspace.get().wechatDataDir)
      console.log('      数据根候选：')
      for (const candidate of candidates) console.log(`        ${existsSync(candidate) ? '[有]' : '[无]'} ${candidate}`)
      skips('账号目录扫描', '没有可用的微信账号目录')
    } else if (account) {
      step('账号目录扫描', true, accounts.map((a) => `${a.id}(${a.stores.length}库)`).join(', '))
    }

    if (!account) {
      // 环境缺失：跳过真实链路，但仍然完成「进程能起来、模块能加载」的验证
      const sqlcipher = await import('./services/sqlcipher')
      step(
        'SQLCipher 参数自检',
        sqlcipher.PAGE_SIZE === 4096 && sqlcipher.IV_OFFSET === 4016 && sqlcipher.KDF_ITERATIONS === 256000,
        `page=${sqlcipher.PAGE_SIZE} iv@${sqlcipher.IV_OFFSET} iter=${sqlcipher.KDF_ITERATIONS}`
      )
      return finishSmoke(checks, started, smokeWorkDir)
    }

    workspace.patch({ wechatDataDir: account.dbStoragePath })

    const { KeyService } = await import('./services/key-service')
    const { DecryptRunner } = await import('./services/decrypt-runner')
    const { ChatStore: Store } = await import('./services/chat-store')
    const { ExportRunner } = await import('./services/export-runner')
    const sqlcipher = await import('./services/sqlcipher')

    const keyService = new KeyService(workspace.get())
    const inspection = keyService.inspectFromFile()
    step('密钥读取', Boolean(inspection.normalized), inspection.message)
    const key = inspection.normalized
    if (!key) throw new Error('没有可用密钥，无法继续')

    const verification = keyService.verify(key, account.dbStoragePath)
    step('密钥校验（页 1 magic）', verification.ok, verification.message)

    const runner = new DecryptRunner(workspace.get())
    const plan = runner.plan(account.dbStoragePath)
    const valuable = plan.filter((item) => item.decryptable)
    step('解密计划', valuable.length > 0, `${plan.length} 个库 / ${valuable.length} 个有价值`)

    const report = await runner.run({ dbStoragePath: account.dbStoragePath, key })
    const okFiles = report.files.filter((file) => file.strategy !== 'skipped')
    step(
      '解密执行',
      okFiles.length >= 3,
      `${okFiles.length}/${report.files.length} 成功 · ${(report.totalBytes / 1048576).toFixed(1)}MB · ${(report.elapsedMs / 1000).toFixed(1)}s · walGuard=${report.walGuardTriggered}`
    )

    const msgDb = report.files.find((file) => file.relPath.includes('message_0.db'))
    step(
      'message_0.db 产物',
      Boolean(msgDb && existsSync(msgDb.outPath)),
      msgDb?.probe ? `rows=${msgDb.probe.rows} newest=${msgDb.probe.newest}` : ''
    )
    step('产物页对齐（% 4096 == 0）', Boolean(msgDb && msgDb.bytes % 4096 === 0), msgDb ? `${msgDb.bytes} % 4096 = ${msgDb.bytes % 4096}` : '')
    step(
      'SQLCipher 参数',
      sqlcipher.PAGE_SIZE === 4096 && sqlcipher.IV_OFFSET === 4016 && sqlcipher.KDF_ITERATIONS === 256000,
      `page=${sqlcipher.PAGE_SIZE} iv@${sqlcipher.IV_OFFSET} iter=${sqlcipher.KDF_ITERATIONS}`
    )

    const store: ChatStore = new Store(workspace.get())
    const conversations = await store.listConversations(undefined, 50)
    step('会话列表', conversations.length > 0, `${conversations.length} 个，首个=${conversations[0]?.displayName ?? 'n/a'}`)
    const owner = await store.ownerWxid()
    const ownerFolder = (workspace.get().wechatDataDir ?? '').split(/[\\/]/).filter(Boolean).pop()
    step('本人 wxid 识别', Boolean(owner), `${owner}（账号目录 ${ownerFolder}）`)

    // 会话定位命中率：微信只对「已同步」的会话建消息表，
    // 因此并非每个会话都能定位到（这是数据侧事实，不是 bug），这里报告命中率。
    let hitRate = 0
    let attempts = 0
    let target: (typeof conversations)[number] | undefined
    let location: Awaited<ReturnType<ChatStore['locateConversation']>> = null
    for (const item of conversations.slice(0, 20)) {
      attempts += 1
      const found = await store.locateConversation(item.username)
      if (!found) continue
      hitRate += 1
      if (!target && item.kind === 'private') {
        target = item
        location = found
      }
    }
    step('会话定位命中率', hitRate > 0, `前 ${attempts} 个会话命中 ${hitRate} 个（微信只为已同步会话建消息表）`)
    if (!target) target = conversations[0]
    if (!location && target) location = await store.locateConversation(target.username)
    if (!target || !location) throw new Error('没有可定位的会话，无法继续')
    step(
      '会话定位',
      true,
      `${target.displayName} → ${location.dbRelPath}::${location.table} rows=${location.rows} newest=${location.newest}`
    )

    const page = await store.queryMessages({ username: target.username, offset: 0, limit: 30, order: 'desc' })
    const textCount = page.messages.filter((message) => message.kind === 'text' && message.text.length > 0).length
    const decompressed = page.messages.filter((message) => message.compressed).length
    step(
      '消息读取',
      page.messages.length > 0,
      `总 ${page.total} 条 · 本页 ${page.messages.length} · 文字 ${textCount} · 解压 ${decompressed}`
    )
    const sample = page.messages.find((message) => message.kind === 'text' && message.text)
    step(
      '正文解码（剥前缀 + zstd）',
      Boolean(sample),
      sample ? `${sample.timeText} ${sample.sender.displayName}: ${sample.text.slice(0, 30)}` : '无文本样本'
    )

    const stats = await store.stats(target.username)
    step(
      '会话统计',
      stats.messageCount > 0,
      `${stats.messageCount} 条 · ${stats.spanDays} 天 · 我 ${stats.mine} / 对方 ${stats.theirs} · 中位回复 ${stats.medianReplySeconds ?? 'n/a'}s`
    )

    const exportRunner = new ExportRunner(workspace.get(), store, join(config.exportDir, 'history.json'))
    const request = {
      username: target.username,
      displayName: target.displayName,
      formats: ['txt', 'md', 'json', 'csv', 'html'] as const,
      includeStats: true,
      includeSystem: true,
      withSeconds: true,
      includeAnalysisPrompt: true,
      location
    }
    const planned = await exportRunner.plan({ ...request, formats: [...request.formats] })
    step('导出预检', planned.estimatedMessages > 0, `预计 ${planned.estimatedMessages} 条 · ${planned.outputs.length} 个产物`)

    const record = await exportRunner.run({ ...request, formats: [...request.formats] })
    step('导出执行', record.artifacts.length === 6, `${record.artifacts.length} 个文件`)
    for (const artifact of record.artifacts) {
      const size = existsSync(artifact.path) ? statSync(artifact.path).size : 0
      step(`  · ${artifact.format}`, size > 0, `${artifact.path.split('\\').slice(-1)[0]} ${size}B`)
    }

    const txt = record.artifacts.find((artifact) => artifact.format === 'txt')
    if (txt) {
      const content = readFileSync(txt.path, 'utf8')
      const lines = content.split('\n').filter(Boolean)
      const wellFormed = lines.filter((line) => /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] .+: /.test(line)).length
      step(
        'chat.txt 行格式（泡菜鱼 pipeline 兼容）',
        wellFormed / Math.max(1, lines.length) > 0.9,
        `${wellFormed}/${lines.length} 行符合 [时间] 发言人: 内容`
      )
      // 正文可读性：替换符（U+FFFD）比例应接近 0，否则说明解码路径有问题
      const replacement = (content.match(/\uFFFD/g) ?? []).length
      step(
        '正文解码无乱码',
        replacement / Math.max(1, content.length) < 0.001,
        `替换符 ${replacement} / ${content.length} 字符（${((replacement / Math.max(1, content.length)) * 100).toFixed(3)}%）`
      )
      if (replacement > 0) {
        const index = content.indexOf('\uFFFD')
        console.log(`      乱码上下文：${JSON.stringify(content.slice(Math.max(0, index - 50), index + 30))}`)
        const badLine = content.slice(0, index).split('\n').slice(-1)[0] ?? ''
        console.log(`      所在行：${JSON.stringify(badLine.slice(0, 120))}`)
      }
      const placeholders = (content.match(/\[无法解析\]/g) ?? []).length
      console.log(`      样例：${lines.slice(-2).join(' | ').slice(0, 200)}`)
      console.log(`      无法解析占位：${placeholders} 条（库中非可读文本的行，已标注而非输出乱码）`)
    }

    const html = record.artifacts.find((artifact) => artifact.format === 'html')
    if (html) {
      const markup = readFileSync(html.path, 'utf8')
      step(
        'HTML 阅读器自包含',
        markup.includes('<style>') && markup.includes('<script>') && !/https?:\/\/cdn/.test(markup),
        `${(markup.length / 1024).toFixed(0)}KB`
      )
    }

    const prompt = record.artifacts.find((artifact) => artifact.path.includes('.prompt'))
    step('泡菜鱼分析提示词', Boolean(prompt && existsSync(prompt.path)), prompt?.path.split('\\').slice(-1)[0] ?? '未生成')
    step('导出历史持久化', exportRunner.list().length > 0, `${exportRunner.list().length} 条`)

    const decryptedMessageFiles = readdirSync(join(config.decryptDir, 'message')).filter((file) => file.endsWith('.db'))
    step('解密产物清单', decryptedMessageFiles.length > 0, decryptedMessageFiles.join(', '))
  } catch (error) {
    step('未捕获异常', false, (error as Error).message)
    console.error(error)
  }

  return finishSmoke(checks, started, smokeWorkDir)
}
