/**
 * 就地修正某个 Release 的正文（把 {{占位符}} 换成该资产的真实摘要）。
 *
 * 背景：v0.1.0 第一次由 CI 发布时，说明文件里的 SHA256 还是本地构建的值，
 * 与 CI 资产不一致。这个脚本用于事后修正，也顺便验证「下载下来的资产」可用。
 *
 * 用法：GITHUB_TOKEN=... node scripts/sync-release-notes.mjs [tag]
 *   末尾加 --verify 会下载资产、重算摘要、并对安装包做一次真实运行验证。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const tag = process.argv[2]?.startsWith('v') ? process.argv[2] : `v${pkg.version}`
const repository = process.env.GITHUB_REPOSITORY || 'lnuxe/wechat-export-studio'
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || ''
const verify = process.argv.includes('--verify')
const api = 'https://api.github.com'

if (!token) {
  console.error('✗ 缺少 GITHUB_TOKEN')
  process.exit(1)
}

const headers = {
  Authorization: `token ${token}`,
  'User-Agent': 'wes-sync',
  Accept: 'application/vnd.github+json'
}

async function call(target, init = {}) {
  const url = /^https?:\/\//.test(target) ? target : `${api}${target}`
  const response = await fetch(url, { ...init, headers: { ...headers, ...(init.headers || {}) } })
  const text = await response.text()
  let body = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = { message: text.slice(0, 200) }
    }
  }
  if (!response.ok) throw new Error(`${init.method || 'GET'} ${url} → ${response.status} ${body?.message ?? ''}`)
  return body
}

const release = await call(`/repos/${repository}/releases/tags/${tag}`)
const asset = (release.assets ?? []).find((item) => item.name.endsWith('-setup.exe'))
if (!asset) {
  console.error(`✗ Release ${tag} 里没有找到 setup.exe 资产`)
  process.exit(1)
}

// 以资产真实摘要为准（API 的 digest 字段由 GitHub 计算，比正文里的更可信）
const digest = (asset.digest ?? '').replace(/^sha256:/, '')
const sizeMb = (asset.size / 1024 / 1024).toFixed(1)
console.log(`Release : ${tag}`)
console.log(`资产    : ${asset.name}（${sizeMb} MB）`)
console.log(`摘要    : ${digest || '(API 未返回 digest，将改用下载后计算)'}`)

let finalDigest = digest
if (!finalDigest && verify) {
  const dir = mkdtempSync(join(tmpdir(), 'wes-verify-'))
  const target = join(dir, asset.name)
  console.log(`下载到 ${target} …`)
  const response = await fetch(asset.browser_download_url)
  const buffer = Buffer.from(await response.arrayBuffer())
  writeFileSync(target, buffer)
  finalDigest = createHash('sha256').update(buffer).digest('hex')
  console.log(`下载后计算: ${finalDigest}`)
}

const notesPath = join(ROOT, 'scripts', `release-notes-${tag}.md`)
let body = existsSync(notesPath)
  ? readFileSync(notesPath, 'utf8')
      .replaceAll('{{SHA256}}', finalDigest.toUpperCase())
      .replaceAll('{{SIZE_MB}}', sizeMb)
      .replaceAll('{{VERSION}}', pkg.version)
  : release.body

// 兜底：正文里若还残留旧的 64 位十六进制摘要，替换成真实值
body = body.replace(/(SHA256[^\n]*?`)([0-9a-fA-F]{64})(`)/g, `$1${finalDigest.toUpperCase()}$3`)

const fingerprintRow = `| \`${asset.name}\` | ${sizeMb} MB | \`${finalDigest.toLowerCase()}\` |`
if (!body.includes(finalDigest)) {
  body += ['', '---', '', '### 资产指纹', '', '| 文件 | 大小 | SHA256 |', '| --- | --- | --- |', fingerprintRow, ''].join('\n')
}

await call(`/repos/${repository}/releases/${release.id}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ body })
})
console.log(`\n✓ 正文已更新：${release.html_url}`)

if (verify && finalDigest) {
  await downloadAndDigest(finalDigest)
}

/**
 * 下载 Release 资产并重算摘要。
 *
 * 为什么只做这一步：NSIS 安装包要跑起来必须真的安装（写注册表、建目录），
 * 不适合在脚本里静默做。所以「CI 产物能不能跑」用另一次本地构建验证：
 * 跑 `npm run dist:win` 后对 `release/win-unpacked/*.exe` 执行 `--wes-smoke`。
 */
async function downloadAndDigest(expected) {
  const dir = mkdtempSync(join(tmpdir(), 'wes-verify-'))
  const target = join(dir, asset.name)
  console.log(`\n下载 ${asset.name} …`)
  const response = await fetch(asset.browser_download_url)
  const buffer = Buffer.from(await response.arrayBuffer())
  writeFileSync(target, buffer)
  const actual = createHash('sha256').update(buffer).digest('hex')
  console.log(`  保存于  : ${target}`)
  console.log(`  大小    : ${(buffer.length / 1024 / 1024).toFixed(1)} MB`)
  console.log(`  下载摘要: ${actual}`)
  console.log(`  期望摘要: ${expected}`)
  console.log(`  一致    : ${actual === expected ? '✓ 是' : '✗ 否'}`)
}
