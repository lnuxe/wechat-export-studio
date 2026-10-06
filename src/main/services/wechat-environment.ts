import { execFile } from 'node:child_process'
import type { Dirent } from 'node:fs'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { WeChatAccount, WeChatInstallation, WeChatVariant } from '@shared/types'
import { expandEnv, readRegistryString } from '../core/registry'
import { readPeVersionInfo } from '../core/pe-version'
import { dirSize } from '../core/fsx'
import { log } from '../core/logger'

const run = promisify(execFile)

const APPDATA = process.env.APPDATA ?? ''
const LOCALAPPDATA = process.env.LOCALAPPDATA ?? ''
const USERPROFILE = process.env.USERPROFILE ?? ''

/** 微信 4.x 的数据根目录候选（xwechat_files 是 4.x 的标志） */
const V4_DATA_ROOTS = [
  join(USERPROFILE, 'Documents', 'xwechat_files'),
  join(USERPROFILE, 'OneDrive', 'Documents', 'xwechat_files'),
  join(USERPROFILE, '文档', 'xwechat_files'),
  join(USERPROFILE, 'Documents', 'WeChat Files')
]

/** 微信 3.x 的数据根目录候选（旧版 PyWxDump 路线用） */
const V3_DATA_ROOTS = [
  join(USERPROFILE, 'Documents', 'WeChat Files'),
  join(USERPROFILE, 'OneDrive', 'Documents', 'WeChat Files')
]

const INSTALL_HINTS = [
  'C:\\Program Files\\Tencent\\Weixin',
  'C:\\Program Files (x86)\\Tencent\\Weixin',
  'C:\\Program Files\\Tencent\\WeChat',
  'C:\\Program Files (x86)\\Tencent\\WeChat'
]

/** 注册表里可能记录数据目录的值名（4.x 实测 InstallPath 指向程序目录，数据目录常在其旁边） */
const REGISTRY_DATA_VALUES = [
  'FileSavePath',
  'SavePath',
  'DataPath',
  'InstallPath',
  'InstallDir'
]

async function installedPathFromRegistry(): Promise<{ path: string; variant: WeChatVariant } | null> {
  const probes: { key: string; value: string; variant: WeChatVariant }[] = [
    { key: 'HKCU\\Software\\Tencent\\Weixin', value: 'InstallPath', variant: 'wechat-4x' },
    { key: 'HKCU\\Software\\Tencent\\WeChat', value: 'InstallPath', variant: 'wechat-3x' },
    { key: 'HKLM\\SOFTWARE\\Tencent\\Weixin', value: 'InstallPath', variant: 'wechat-4x' },
    { key: 'HKLM\\SOFTWARE\\WOW6432Node\\Tencent\\Weixin', value: 'InstallPath', variant: 'wechat-4x' },
    { key: 'HKLM\\SOFTWARE\\WOW6432Node\\Tencent\\WeChat', value: 'InstallPath', variant: 'wechat-3x' },
    { key: 'HKCU\\Software\\Tencent\\Weixin', value: 'FileSavePath', variant: 'wechat-4x' }
  ]
  for (const probe of probes) {
    const value = await readRegistryString(probe.key, probe.value)
    if (!value) continue
    const path = expandEnv(value.trim().replace(/^"|"$/g, ''))
    if (existsSync(path)) return { path, variant: probe.variant }
  }
  return null
}

async function runningProcesses(): Promise<{ name: string; path: string | null; version: string | null }[]> {
  const script =
    "Get-CimInstance Win32_Process -Filter \"Name='Weixin.exe' or Name='WeChat.exe'\" | " +
    'Select-Object -First 5 Name,ExecutablePath | ConvertTo-Json -Compress'
  try {
    const { stdout } = await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: 8000, windowsHide: true, maxBuffer: 1 << 20 }
    )
    const parsed = JSON.parse(stdout.trim() || 'null') as
      | { Name: string; ExecutablePath: string | null }
      | { Name: string; ExecutablePath: string | null }[]
      | null
    if (!parsed) return []
    const list = Array.isArray(parsed) ? parsed : [parsed]
    return list.map((p) => ({ name: p.Name, path: p.ExecutablePath ?? null, version: null }))
  } catch {
    return []
  }
}

/** 从主程序 exe 的 PE 资源里抠版本号（版本块是 UTF-16LE，不能用 ASCII 搜） */
function peFileVersion(file: string): string | null {
  try {
    const size = statSync(file).size
    if (size <= 0 || size > 256 * 1024 * 1024) return null
    const info = readPeVersionInfo(readFileSync(file))
    if (info.version) {
      log.debug('wechat', `版本资源：${info.productName ?? '—'} / ${info.companyName ?? '—'}（来源 ${info.source}）`)
    }
    return info.version
  } catch {
    return null
  }
}

function primaryExe(dir: string): string | null {
  for (const name of ['Weixin.exe', 'WeChat.exe']) {
    const candidate = join(dir, name)
    if (existsSync(candidate)) return candidate
  }
  try {
    const entry = readdirSync(dir).find((f) => /^We(ixin|Chat)\.exe$/i.test(f))
    return entry ? join(dir, entry) : null
  } catch {
    return null
  }
}

/**
 * 探测本机微信环境。
 * 结论只依赖三件事：注册表/常见目录里的安装路径、进程列表、数据目录候选是否存在。
 */
export async function detectInstallation(): Promise<WeChatInstallation> {
  const processes = await runningProcesses()
  const running = processes.length > 0
  const processName = running ? (processes[0]?.name ?? null) : null

  let installPath: string | null = null
  let variant: WeChatVariant = 'unknown'
  let version: string | null = null

  const fromRegistry = await installedPathFromRegistry()
  const fromProcess = processes.find((p) => p.path)?.path ?? null
  const fromHint = INSTALL_HINTS.find((dir) => existsSync(dir)) ?? null
  const installDir =
    (fromRegistry?.path && !fromRegistry.path.toLowerCase().endsWith('.exe') ? fromRegistry.path : null) ??
    (fromProcess ? fromProcess.slice(0, fromProcess.lastIndexOf('\\')) : null) ??
    fromHint

  if (installDir) {
    installPath = primaryExe(installDir) ?? installDir
    const exeName = installPath.toLowerCase()
    variant = exeName.includes('weixin') ? 'wechat-4x' : exeName.includes('wechat') ? 'wechat-3x' : (fromRegistry?.variant ?? 'unknown')
    version = peFileVersion(installPath)
  }

  const storageCandidates = (await dataRootCandidates()).filter((dir) => existsSync(dir))
  if (variant === 'unknown') {
    variant = storageCandidates.some((dir) => dir.includes('xwechat_files')) ? 'wechat-4x' : 'unknown'
  }

  const result: WeChatInstallation = {
    running,
    processName,
    variant,
    version,
    installPath,
    storageCandidates
  }
  log.info(
    'wechat',
    `环境探测：${variant}${version ? ` v${version}` : ''}，进程${running ? '运行中' : '未运行'}，数据目录候选 ${storageCandidates.length} 个`
  )
  return result
}

/**
 * 所有可能的数据根目录。
 *
 * 实测坑：微信 4.x 会把数据放在「程序目录旁边」而不是文档目录——
 * 这台机器上是 `D:\Program Files\xwechat_files`，注册表 InstallPath 指向
 * `D:\ProgramData\Weixin`。所以除了常规位置，还要把安装路径的父目录与其同级
 * 的 `xwechat_files` 也纳入候选，否则永远扫不到账号。
 */
export async function dataRootCandidates(extra?: string | null): Promise<string[]> {
  const list: string[] = []
  if (extra) list.push(extra)

  const registryPaths: string[] = []
  for (const key of ['HKCU\\Software\\Tencent\\Weixin', 'HKCU\\Software\\Tencent\\WeChat']) {
    for (const value of REGISTRY_DATA_VALUES) {
      const raw = await readRegistryString(key, value)
      if (!raw) continue
      const expanded = expandEnv(raw.trim().replace(/^"|"$/g, ''))
      if (expanded) registryPaths.push(expanded)
    }
  }
  for (const path of registryPaths) {
    list.push(path)
    const parent = path.replace(/[\\/][^\\/]*$/, '')
    if (parent) {
      list.push(join(parent, 'xwechat_files'))
      list.push(parent)
    }
    list.push(join(path, 'xwechat_files'))
  }

  list.push(...V4_DATA_ROOTS, ...V3_DATA_ROOTS, join(APPDATA, 'Tencent', 'WeChat'), join(LOCALAPPDATA, 'Tencent'))

  // 去重 + 只保留真实存在的目录
  const seen = new Set<string>()
  const out: string[] = []
  for (const dir of list) {
    if (!dir) continue
    const normalized = dir.replace(/[\\/]+$/, '')
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(normalized)
  }
  return out
}

/**
 * 列出所有微信账号目录。
 * 4.x 结构：<root>/<账号目录>/db_storage/{contact,message,session,...}/*.db
 * 这里不假设账号目录名一定是 wxid_ 开头（实测有手机号、自定义串），
 * 而是要求它下面真的存在 db_storage。
 */
export async function listAccounts(extra?: string | null): Promise<WeChatAccount[]> {
  const accounts: WeChatAccount[] = []
  const seenRoots = new Set<string>()

  const roots = (await dataRootCandidates(extra)).filter((root) => {
    const key = root.toLowerCase()
    if (!existsSync(root) || seenRoots.has(key)) return false
    seenRoots.add(key)
    return true
  })

  // 常规候选全落空时，做一次有界深度搜索：微信 4.x 允许把数据目录放在任意盘符，
  // 实测有「D:\Program Files\xwechat_files」这种既不在文档目录、注册表也不记录的位置。
  if (roots.length === 0 || roots.every((root) => !containsAccount(root))) {
    const discovered = await deepScanForDataRoots()
    for (const root of discovered) {
      const key = root.toLowerCase()
      if (seenRoots.has(key)) continue
      seenRoots.add(key)
      roots.push(root)
      log.info('wechat', `深度搜索命中数据根目录：${root}`)
    }
  }

  for (const root of roots) {
    let entries: string[]
    try {
      entries = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    } catch {
      continue
    }
    for (const name of entries) {
      const accountRoot = join(root, name)
      const dbStorage = join(accountRoot, 'db_storage')
      // 也允许用户直接选中 db_storage 本身
      const storagePath = existsSync(dbStorage) ? dbStorage : looksLikeDbStorage(accountRoot) ? accountRoot : null
      if (!storagePath) continue
      const stores = readdirSync(storagePath, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => {
          const dir = join(storagePath, e.name)
          let files = 0
          let bytes = 0
          try {
            for (const f of readdirSync(dir, { withFileTypes: true })) {
              if (!f.isFile()) continue
              files += 1
              bytes += statSync(join(dir, f.name)).size
            }
          } catch {
            /* 无权限的子目录跳过 */
          }
          return { name: e.name, path: dir, files, bytes }
        })
        .filter((s) => s.files > 0)
      const total = stores.reduce((sum, s) => sum + s.bytes, 0)
      accounts.push({
        id: name,
        root: accountRoot,
        dbStoragePath: storagePath,
        stores,
        totalBytes: total,
        lastModified: lastModifiedOf(storagePath)
      })
    }
  }
  const deduped = new Map(accounts.map((a) => [a.dbStoragePath, a]))
  const result = [...deduped.values()].sort((a, b) => b.totalBytes - a.totalBytes)
  log.info('wechat', `发现 ${result.length} 个账号数据目录`)
  return result
}

function looksLikeDbStorage(dir: string): boolean {
  if (!existsSync(dir)) return false
  try {
    const names = readdirSync(dir)
    return names.includes('message') && names.includes('contact')
  } catch {
    return false
  }
}

/** 该目录下是否至少有一个带 db_storage 的账号目录 */
function containsAccount(root: string): boolean {
  try {
    return readdirSync(root, { withFileTypes: true }).some(
      (entry) => entry.isDirectory() && existsSync(join(root, entry.name, 'db_storage'))
    )
  } catch {
    return false
  }
}

const DATA_ROOT_NAMES = new Set(['xwechat_files', 'wechat files'])

/**
 * 有界深度搜索：在所有固定盘符里找 `xwechat_files` / `WeChat Files`（深度 ≤ 3）。
 *
 * 实现要点：用广度优先而不是深度优先——深度优先很容易在 C 盘系统目录里把 3 秒预算耗光，
 * 结果漏掉 D 盘这种「程序目录旁边放数据」的位置。按层并行推进可以保证每个盘符都被公平扫到。
 */
async function deepScanForDataRoots(): Promise<string[]> {
  const budgetMs = 4000
  const started = Date.now()
  const found: string[] = []
  const skipNames = new Set([
    'windows',
    'winsxs',
    'system32',
    'syswow64',
    '$recycle.bin',
    'node_modules',
    'appdata',
    'assembly',
    'installer',
    'driverstore',
    'servicing',
    'system volume information'
  ])

  const { readdir } = await import('node:fs/promises')

  // 盘符枚举：`readdir('\\')` 在 Electron 里返回空数组（不是抛错），
  // 所以退化为「扫描所有存在的盘符」。最多 26 次 existsSync，代价可忽略。
  const allDrives = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((letter) => `${letter}:\\`)
  const drives = allDrives.filter((drive) => existsSync(drive))
  if (drives.length === 0) return []

  let frontier = drives
  for (let depth = 0; depth <= 3 && frontier.length > 0; depth += 1) {
    if (Date.now() - started > budgetMs) break
    const next: string[] = []
    for (const dir of frontier) {
      if (Date.now() - started > budgetMs) break
      let entries: Dirent[]
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        continue
      }
      let visited = 0
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        if (entry.name.startsWith('$') || entry.name.startsWith('.')) continue
        const lower = entry.name.toLowerCase()
        if (skipNames.has(lower)) continue
        const full = join(dir, entry.name)
        if (DATA_ROOT_NAMES.has(lower)) {
          found.push(full)
          continue
        }
        if (depth >= 3 || visited >= 32) continue
        visited += 1
        next.push(full)
      }
    }
    frontier = next
  }
  return found
}

function lastModifiedOf(dir: string): string | null {
  try {
    return statSync(dir).mtime.toISOString()
  } catch {
    return null
  }
}

export { dirSize }
