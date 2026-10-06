/**
 * 把自检产物整理成正式的默认工作区（文档/WeChatExportStudio）。
 *
 * 背景：npm run smoke 会把解密产物写到 %TEMP%/wes-smoke 并把应用配置指向那里；
 * 交付时希望应用落在默认目录，且开箱就是「已解密 + 有导出记录」的状态。
 *
 * 三条规矩：
 *  1. 只搬需要的子库，丢掉中间产物（*.mainonly.dec / *.walmerged.dec）
 *  2. 导出目录只留「不带序号」的那一组（多次冒烟会产出 `名字 (7).txt` 这类副本）
 *  3. history.json 重写，保证记录里引用的文件确实存在
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const source = join(tmpdir(), 'wes-smoke')
const target = join(process.env.USERPROFILE ?? '', 'Documents', 'WeChatExportStudio')
const neededStores = ['message', 'contact', 'session', 'bizchat']

mkdirSync(target, { recursive: true })

/* ------------------------------------------------------------ 1. 解密产物 */
let copied = 0
let bytes = 0
for (const store of neededStores) {
  const from = join(source, 'decrypted', store)
  if (!existsSync(from)) continue
  const to = join(target, 'decrypted', store)
  mkdirSync(to, { recursive: true })
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    if (/\.(mainonly|walmerged)\.dec/.test(entry.name)) continue
    if (/\.dec-(shm|wal)$/.test(entry.name)) continue
    if (/-shm$|-wal$/.test(entry.name)) continue
    const src = join(from, entry.name)
    copyFileSync(src, join(to, entry.name))
    copied += 1
    bytes += statSync(src).size
  }
}
if (existsSync(join(source, 'key.txt'))) copyFileSync(join(source, 'key.txt'), join(target, 'key.txt'))

/* ------------------------------------------------- 2/3. 导出产物与历史 */
const exportsDir = join(target, 'exports')
mkdirSync(exportsDir, { recursive: true })
const sourceExports = join(source, 'exports')

/** `张文亭 (11).txt` → { stem:'张文亭', index:11, ext:'.txt' }；`张文亭.prompt.md` → index 0 */
function parseName(name) {
  const match = /^(.*?)(?: \((\d+)\))?(\.[^.]+)$/.exec(name)
  if (!match) return { stem: name, index: 0 }
  return { stem: match[1], index: Number(match[2] ?? 0) }
}

let kept = 0
let history = []
if (existsSync(sourceExports)) {
  for (const entry of readdirSync(sourceExports, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    const parsed = parseName(entry.name)
    // 带序号的是冒烟跑出来的副本，不入正式工作区
    if (parsed.index !== 0) continue
    copyFileSync(join(sourceExports, entry.name), join(exportsDir, entry.name))
    kept += 1
  }

  const historyFile = join(sourceExports, 'history.json')
  if (existsSync(historyFile)) {
    const parsed = JSON.parse(readFileSync(historyFile, 'utf8'))
    history = parsed
      .map((record) => ({
        ...record,
        artifacts: record.artifacts
          .filter((artifact) => existsSync(artifact.path) && parseName(artifact.path.split('\\').pop()).index === 0)
          .map((artifact) => ({ ...artifact, path: join(exportsDir, artifact.path.split('\\').pop()) }))
      }))
      .filter((record) => record.artifacts.length > 0)
      .slice(0, 2)
  }
  writeFileSync(join(exportsDir, 'history.json'), `${JSON.stringify(history, null, 2)}\n`, 'utf8')
}

console.log(`解密产物：${copied} 个文件（${(bytes / 1048576).toFixed(1)} MB）→ ${join(target, 'decrypted')}`)
console.log(`导出产物：${kept} 个文件 → ${exportsDir}`)
console.log(`导出历史：${history.length} 条（时间跨度 ${history[0]?.firstTime ?? '—'} → ${history[0]?.lastTime ?? '—'}）`)
