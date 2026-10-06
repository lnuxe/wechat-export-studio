import { app, BrowserWindow, shell } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { join } from 'node:path'
import { log } from './core/logger'
import { workspace } from './core/workspace'
import { registerIpc, setMainWindow } from './ipc'
import { closeAll } from './services/sqlite-reader'
import { smokeRequested } from './smoke'
import { uiCheckRequested } from './ui-check'
import { uiFlowRequested } from './ui-flow'

/**
 * 主进程入口。
 *
 * 安全基线（不要为了省事放宽）：
 *  - contextIsolation: true + nodeIntegration: false + sandbox: true
 *    → 渲染层只能通过 preload 暴露的白名单通道访问系统能力
 *  - 禁止渲染层导航到外部地址；外链一律交给系统浏览器
 *  - 拒绝所有权限请求（这个应用不需要摄像头/麦克风/通知权限）
 */

const isDev = is.dev

/**
 * 自检模式必须与用户配置隔离。
 *
 * 踩过的坑：`npm run smoke` 会通过 workspace.patch 把工作目录指到 %TEMP%，
 * 而配置写在 userData/config.json —— 于是自检完，用户的应用也被指去了临时目录。
 * 这里在 app ready 之前把 userData 换掉，自检有自己的一份配置，互不影响。
 */
function isolateUserDataForSelfCheck(): void {
  const selfCheck = process.argv.includes('--wes-smoke') || process.argv.includes('--wes-ui-flow')
  if (!selfCheck) return
  const dir = process.argv.includes('--wes-smoke') ? 'wes-smoke-profile' : 'wes-ui-flow-profile'
  app.setPath('userData', join(app.getPath('temp'), dir))
}

isolateUserDataForSelfCheck()

let mainWindow: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1080,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f4efe4',
    title: 'WeChat Export Studio · 微信聊天记录导出工作台',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: '#5b5348',
      height: 40
    },
    backgroundMaterial: 'mica',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false
    }
  })

  window.once('ready-to-show', () => {
    window.show()
    log.info('app', '主窗口已就绪')
  })

  // 外链一律走系统浏览器，绝不在应用内打开
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    const allowed = isDev && process.env.ELECTRON_RENDERER_URL && url.startsWith(process.env.ELECTRON_RENDERER_URL)
    if (!allowed) {
      event.preventDefault()
      log.warn('app', `已拦截渲染层导航：${url}`)
    }
  })

  window.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    log.warn('app', `已拒绝权限请求：${permission}`)
    callback(false)
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

// 单实例：多开会同时操作同一份解密产物，容易写坏文件
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.local.wechat-export-studio')
    workspace.init()
    registerIpc()

    // 冒烟自检模式：不建窗口，跑完真实链路直接退出（CI / 交付前自检用）
    if (smokeRequested()) {
      void import('./smoke')
        .then(async ({ runSmoke }) => {
          const code = await runSmoke()
          await closeAll()
          app.exit(code)
        })
        .catch((error: unknown) => {
          console.error('冒烟自检启动失败', error)
          app.exit(1)
        })
      return
    }

    // UI 自检模式：真的开一个窗口、抓图、收集渲染错误
    if (uiCheckRequested()) {
      void import('./ui-check')
        .then(async ({ runUiCheck }) => {
          const code = await runUiCheck()
          await closeAll()
          app.exit(code)
        })
        .catch((error: unknown) => {
          console.error('UI 自检启动失败', error)
          app.exit(1)
        })
      return
    }

    // 全链路 UI 验收：用真实解密产物驱动界面走完导出
    if (uiFlowRequested()) {
      void import('./ui-flow')
        .then(async ({ runUiFlow }) => {
          const code = await runUiFlow()
          await closeAll()
          app.exit(code)
        })
        .catch((error: unknown) => {
          console.error('UI 全链路验收启动失败', error)
          app.exit(1)
        })
      return
    }

    app.on('browser-window-created', (_event, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    mainWindow = createWindow()
    setMainWindow(mainWindow)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow()
        setMainWindow(mainWindow)
      }
    })
  })

  app.on('window-all-closed', () => {
    void closeAll().finally(() => {
      if (process.platform !== 'darwin') app.quit()
    })
  })

  app.on('before-quit', () => {
    void closeAll()
  })

  process.on('uncaughtException', (error) => {
    log.error('app', `未捕获异常：${error.message}`, error.stack)
  })
  process.on('unhandledRejection', (reason) => {
    log.error('app', `未处理的 Promise 拒绝：${String(reason)}`)
  })
}
