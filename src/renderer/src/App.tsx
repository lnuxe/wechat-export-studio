import { useEffect, useState } from 'react'
import { PaperGrain } from './components/art/artwork'
import { SettingsSheet } from './components/layout/SettingsSheet'
import { SideNav } from './components/layout/SideNav'
import { TitleBar } from './components/layout/TitleBar'
import { Toasts } from './components/layout/Toasts'
import { Button, EmptyState } from './components/ui/primitives'
import { IconAlert } from './components/art/icons'
import { ChatsPage } from './pages/ChatsPage'
import { ExportsPage } from './pages/ExportsPage'
import { SetupPage } from './pages/SetupPage'
import { useStudio } from './store/studio'

/**
 * 应用外壳。
 *
 * 结构：标题栏（品牌 + 连接状态 + 设置）→ 88px 图标导航 → 内容。
 * 会话页需要撑满可用高度（消息区自己滚动），其余页面居中限宽、整页滚动。
 */
export function App(): React.JSX.Element {
  const ready = useStudio((s) => s.ready)
  const page = useStudio((s) => s.page)
  const bootstrap = useStudio((s) => s.bootstrap)
  const lastError = useStudio((s) => s.lastError)
  const clearError = useStudio((s) => s.clearError)
  const theme = useStudio((s) => s.workspace?.ui.theme ?? 'paper')
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  useEffect(() => {
    const root = document.documentElement
    const apply = (): void => {
      const resolved =
        theme === 'system'
          ? window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'midnight'
            : 'paper'
          : theme
      root.dataset.theme = resolved
    }
    apply()
    if (theme !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setSettingsOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (lastError) {
    return (
      <div className="relative grid h-screen place-items-center bg-paper">
        <PaperGrain className="pointer-events-none opacity-60" />
        <div className="surface w-[420px] px-6 py-5">
          <EmptyState
            art={<IconAlert size={32} className="text-clay" />}
            title="应用初始化失败"
            detail={lastError.message}
            action={
              <Button tone="outline" size="sm" onClick={clearError}>
                知道了
              </Button>
            }
          />
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-paper">
      <PaperGrain className="pointer-events-none z-0 opacity-70" />
      <div
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            'radial-gradient(1100px 420px at 6% -12%, rgba(47,107,95,.10), transparent 62%), radial-gradient(900px 380px at 96% -16%, rgba(192,138,62,.12), transparent 60%)'
        }}
      />

      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        <TitleBar onOpenSettings={() => setSettingsOpen(true)} />
        <div className="flex min-h-0 flex-1">
          <SideNav onOpenSettings={() => setSettingsOpen(true)} />
          {page === 'chats' ? (
            // 会话页自己管滚动：内容区不滚，交给消息区
            <main className="min-h-0 flex-1 overflow-hidden px-4 py-4" data-page={page}>
              {ready ? <ChatsPage /> : <BootHint />}
            </main>
          ) : (
            <main className="min-h-0 flex-1 overflow-y-auto px-5 py-5" data-page={page}>
              {!ready ? <BootHint /> : page === 'setup' ? <SetupPage /> : <ExportsPage />}
            </main>
          )}
        </div>
      </div>

      {settingsOpen ? <SettingsSheet onClose={() => setSettingsOpen(false)} /> : null}
      <Toasts />
    </div>
  )
}

function BootHint(): React.JSX.Element {
  return (
    <div className="grid h-full place-items-center">
      <span className="shimmer rounded-full px-4 py-1.5 text-[13px] text-ink-soft">正在读取工作区…</span>
    </div>
  )
}
