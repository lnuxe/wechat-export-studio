/**
 * 源码编码体检。
 *
 * 为什么需要它：这个仓库里有大量中文注释，而 Windows 上稍不留神就会
 * 用 GBK 读、UTF-8 写，把注释写成乱码、甚至把代码里的模板字符串写坏
 * （踩过一次：反引号被写成别的字符，编译报错的行号还完全对不上）。
 * 所以把「BOM / 替换符 / 正文里的替换符」做成可执行的检查。
 *
 * 允许全角标点：中文注释与界面文案里本来就会出现（），不属于事故。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const roots = ['src/main', 'src/preload', 'src/renderer/src', 'src/shared', 'scripts']
const problems = []
let scanned = 0

const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full)
      continue
    }
    if (!/\.(ts|tsx|mjs|css|html)$/.test(entry.name)) continue
    scanned += 1
    const buffer = readFileSync(full)
    const issues = []
    if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) issues.push('BOM')
    const text = buffer.toString('utf8')
    const replacements = (text.match(/\uFFFD/g) ?? []).length
    if (replacements) issues.push(`替换符 ${replacements}`)
    if (text.includes('\u0000')) issues.push('NUL 字节')
    if (issues.length) problems.push(`${full}: ${issues.join(', ')}`)
  }
}

for (const root of roots) walk(root)

console.log(`扫描 ${scanned} 个源文件`)
if (problems.length) {
  console.log('发现问题：')
  for (const problem of problems) console.log(`  ${problem}`)
  process.exit(1)
}
console.log('编码体检通过：无 BOM、无替换符、无 NUL 字节')
