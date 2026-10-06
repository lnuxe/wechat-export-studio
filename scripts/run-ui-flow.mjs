/**
 * 启动「全链路 UI 验收」的包装脚本。
 *
 * 需要先把解密产物准备好（npm run smoke 会写到 %TEMP%/wes-smoke），
 * 并且把应用的 workDir 钉在这个临时目录上（WES_WORKDIR），避免污染真实工作区。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const smokeDir = join(tmpdir(), 'wes-smoke')
if (!existsSync(join(smokeDir, 'decrypted', 'message'))) {
  console.error(`没有找到解密产物：${join(smokeDir, 'decrypted')}`)
  console.error('请先运行 npm run smoke（它会用真实微信库跑一遍解密与导出）')
  process.exit(2)
}

const electron = require('electron')
const child = spawn(electron, ['.', '--wes-ui-flow'], {
  stdio: 'inherit',
  env: { ...process.env, WES_WORKDIR: smokeDir }
})
child.on('exit', (code) => process.exit(code ?? 1))
