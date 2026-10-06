/**
 * 发布安装包到 GitHub Release。
 *
 * 为什么不直接用 electron-builder 的 `--publish always`：
 *  - 它会把「构建」和「发布」耦合成一步，本地想只打包不发版时反而麻烦；
 *  - 它的 Release 正文来自配置里的一段静态文本，改文案就要动 yml；
 *  - 发布后拿不到资产摘要，无法把 sha256 回填进说明里（我们想给用户这个）。
 *
 * 所以这里用 API 自己做：创建/复用 Release → 上传资产 → 回写 sha256 → 打印下载地址。
 * 幂等：同名资产已存在会先删掉再传，重复跑不会失败。
 *
 * 用法：
 *   GITHUB_TOKEN=... node scripts/publish-release.mjs            # 按 package.json 版本发
 *   GITHUB_TOKEN=... node scripts/publish-release.mjs --dry-run  # 只打印将要做什么
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const version = pkg.version
const tag = `v${version}`
const dryRun = process.argv.includes('--dry-run')

const repository = process.env.GITHUB_REPOSITORY || detectRepository()
const [owner, repo] = repository.split('/')
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || ''
const api = 'https://api.github.com'

const installer = `WeChat Export Studio-${version}-setup.exe`
const installerPath = join(ROOT, 'release', installer)
const notesPath = join(ROOT, 'scripts', `release-notes-${tag}.md`)

function detectRepository() {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim()
    const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/)
    if (match) return `${match[1]}/${match[2]}`
  } catch {
    /* 没有 remote 时留给下面的报错处理 */
  }
  return ''
}

function fail(message) {
  console.error(`✗ ${message}`)
  process.exit(1)
}

if (!repository) fail('无法确定仓库（设置 GITHUB_REPOSITORY=owner/repo）')
if (!existsSync(installerPath)) fail(`找不到安装包：${installerPath}\n  先执行 npm run dist:win`)

const bytes = readFileSync(installerPath)
const sha256 = createHash('sha256').update(bytes).digest('hex')
const sizeMb = (bytes.length / 1024 / 1024).toFixed(1)

console.log(`仓库    : ${repository}`)
console.log(`标签    : ${tag}`)
console.log(`资产    : ${installer}（${sizeMb} MB）`)
console.log(`sha256  : ${sha256}`)

if (dryRun) {
  console.log('\n--dry-run：只校验到这一步，不做任何写操作。')
  process.exit(0)
}

if (!token) fail('缺少 GITHUB_TOKEN（需要 repo 权限）')

const headers = {
  Authorization: `token ${token}`,
  'User-Agent': 'wes-publish',
  Accept: 'application/vnd.github+json'
}

/**
 * 调用 GitHub API。
 *
 * `target` 既可以是相对路径（`/repos/...`，拼到 api.github.com），
 * 也可以是完整 URL（上传资产用的是 uploads.github.com，域名不同）。
 * 这里必须显式判断——第一版无脑拼接，把完整 URL 变成了
 * `api.github.comhttps://...`，报 ENOTFOUND 却看不出原因。
 */
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
  if (!response.ok) {
    const error = new Error(`${init.method || 'GET'} ${url} → ${response.status} ${body?.message ?? ''}`)
    error.status = response.status
    throw error
  }
  return body
}

/** 正文：优先用专门的 release notes 文件，其次用包描述，并总是附上摘要 */
function buildBody() {
  let base = ''
  if (existsSync(notesPath)) {
    base = readFileSync(notesPath, 'utf8')
  } else {
    base = `## ${pkg.name} ${tag}\n\n${pkg.description ?? ''}\n`
  }
  const fingerprint = [
    '',
    '---',
    '',
    '### 资产指纹',
    '',
    '| 文件 | 大小 | SHA256 |',
    '| --- | --- | --- |',
    `| \`${installer}\` | ${sizeMb} MB | \`${sha256}\` |`,
    '',
    '校验：`certutil -hashfile "<下载的文件>" SHA256`',
    ''
  ].join('\n')
  // 正文里如果已经写了某个 sha256，就不再重复追加指纹表（避免两份互相矛盾）
  return base.includes(sha256) ? base : base + fingerprint
}

const release = await call(`/repos/${repository}/releases/tags/${tag}`).catch(async (error) => {
  if (error.status !== 404) throw error
  console.log(`\nRelease ${tag} 不存在，创建中…`)
  return await call(`/repos/${repository}/releases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tag_name: tag,
      target_commitish: 'main',
      name: `${tag} · ${pkg.version}`,
      body: buildBody(),
      draft: false,
      prerelease: false
    })
  })
})

console.log(`\nRelease : ${release.html_url}`)

// 同名资产先删后传，保证幂等
for (const asset of release.assets ?? []) {
  if (asset.name === installer || asset.name === installer.replace(/ /g, '.')) {
    console.log(`删除旧资产 ${asset.name}…`)
    await call(`/repos/${repository}/releases/assets/${asset.id}`, { method: 'DELETE' })
  }
}

console.log('上传中…')
const uploaded = await call(
  `https://uploads.github.com/repos/${repository}/releases/${release.id}/assets?name=${encodeURIComponent(installer)}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: bytes
  }
)

console.log(`\n✓ 发布完成`)
console.log(`  资产    : ${uploaded.name}（${(uploaded.size / 1024 / 1024).toFixed(1)} MB）`)
console.log(`  远端摘要: ${uploaded.digest ?? '(未返回)'}`)
console.log(`  本地摘要: sha256:${sha256}`)
console.log(`  一致    : ${uploaded.digest === `sha256:${sha256}` ? '是' : '否（请人工核对）'}`)
console.log(`  下载页  : ${release.html_url}`)
