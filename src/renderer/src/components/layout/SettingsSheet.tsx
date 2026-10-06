import { useState } from 'react'
import { IconClose, IconFolder, IconPalette, IconShield } from '../art/icons'
import { LogSection } from './LogSection'
import { Button, Field, InlineNote, Switch } from '../ui/primitives'
import { appApi, workspaceApi } from '../../api/studio'
import { cx, humanBytes, relativeTime } from '../../lib/format'
import { useStudio } from '../../store/studio'

/**
 * 设置抽屉（原「设置页」改成浮层）。
 *
 * 理由：设置是低频操作，占一个顶级导航位不值当；同时它也正好收纳了
 * 「不该出现在主界面上」的技术信息（绝对路径、解密参数、运行时版本）。
 */
export function SettingsSheet({ onClose }: { onClose: () => void }): React.JSX.Element {
  const workspace = useStudio((s) => s.workspace)
  const appInfo = useStudio((s) => s.appInfo)
  const decryptStatus = useStudio((s) => s.decryptStatus)
  const patchWorkspace = useStudio((s) => s.patchWorkspace)
  const toast = useStudio((s) => s.toast)
  const [workDirDraft, setWorkDirDraft] = useState<string | null>(null)

  const workDir = workDirDraft ?? workspace?.workDir ?? ''
  const theme = workspace?.ui.theme ?? 'paper'

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-label="设置">
      {/* 背板：点击即关 */}
      <button
        type="button"
        aria-label="关闭设置"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-ink/25 backdrop-blur-[2px]"
      />
      <aside
        data-settings-sheet
        className="surface relative flex h-full w-[392px] flex-col overflow-hidden rounded-none border-y-0 border-r-0"
        style={{ animation: 'wes-slide-in .3s cubic-bezier(.22,1,.36,1) both' }}
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-line/70 px-4 py-3">
          <span className="grid size-7 place-items-center rounded-lg bg-jade-wash text-jade">
            <IconPalette size={15} />
          </span>
          <p className="flex-1 text-[13.5px] font-semibold text-ink">设置</p>
          <button
            type="button"
            onClick={onClose}
            className="grid size-7 place-items-center rounded-lg text-ink-faint transition-colors hover:bg-ink/5 hover:text-ink"
            aria-label="关闭"
          >
            <IconClose size={15} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
          {/* 皮肤 */}
          <section className="flex flex-col gap-3">
            <h3 className="text-[12px] font-semibold tracking-wide text-ink-faint">外观</h3>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { value: 'paper', label: '暖纸', dot: 'bg-[#f4efe4]', ring: 'ring-[#2f6b5f]' },
                  { value: 'midnight', label: '冷墨', dot: 'bg-[#16181c]', ring: 'ring-[#64b3a1]' },
                  { value: 'system', label: '跟随系统', dot: 'bg-gradient-to-br from-[#f4efe4] to-[#16181c]', ring: 'ring-[#c08a3e]' }
                ] as const
              ).map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => void patchWorkspace({ ui: { theme: item.value } })}
                  className={cx(
                    'flex flex-col items-center gap-2 rounded-xl border px-2 py-3 transition-all',
                    theme === item.value
                      ? 'border-jade/40 bg-jade-wash ring-1 ring-jade/30'
                      : 'border-line hover:border-line-strong'
                  )}
                >
                  <span className={cx('size-7 rounded-full border border-line', item.dot)} />
                  <span className="text-[11.5px] text-ink">{item.label}</span>
                </button>
              ))}
            </div>
            <Switch
              checked={workspace?.ui.hideSystemMessages ?? false}
              onChange={(next) => void patchWorkspace({ ui: { hideSystemMessages: next } })}
              label="读消息时隐藏系统提示"
            />
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-[12px] font-semibold tracking-wide text-ink-faint">工作目录</h3>
            <Field label="产物落点" hint="解密库、导出文件、日志都放在这里">
              <div className="flex gap-2">
                <input
                  value={workDir}
                  onChange={(event) => setWorkDirDraft(event.target.value)}
                  spellCheck={false}
                  className="h-9 min-w-0 flex-1 rounded-xl border border-line bg-paper-3/80 px-3 font-mono text-[11px] text-ink focus:border-jade/60"
                />
                <Button
                  tone="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={async () => {
                    const picked = await appApi.pickDirectory({ title: '选择工作目录', defaultPath: workDir })
                    if (picked) setWorkDirDraft(picked)
                  }}
                >
                  浏览
                </Button>
              </div>
            </Field>
            <div className="flex gap-2">
              <Button
                tone="primary"
                size="sm"
                disabled={!workDirDraft || workDirDraft === workspace?.workDir}
                onClick={async () => {
                  await patchWorkspace({ workDir: workDirDraft ?? undefined })
                  setWorkDirDraft(null)
                  toast({ tone: 'success', title: '工作目录已更新' })
                }}
              >
                应用
              </Button>
              <Button tone="ghost" size="sm" icon={IconFolder} onClick={() => workspace && void appApi.open(workspace.workDir)}>
                打开目录
              </Button>
              <Button
                tone="ghost"
                size="sm"
                onClick={async () => {
                  await workspaceApi.reset()
                  setWorkDirDraft(null)
                  toast({ tone: 'info', title: '已恢复默认设置（不会删除已有文件）' })
                }}
              >
                重置
              </Button>
            </div>
            {decryptStatus?.ready ? (
              <p className="text-[11px] text-ink-faint">
                当前解密产物 {decryptStatus.stores.length} 个库 · {humanBytes(decryptStatus.totalBytes)}
                {decryptStatus.modified ? ` · ${relativeTime(decryptStatus.modified)}` : ''}
              </p>
            ) : null}
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-[12px] font-semibold tracking-wide text-ink-faint">运行环境</h3>
            <dl className="flex flex-col gap-1 text-[11.5px]">
              <Row label="应用" value={`v${appInfo?.appVersion ?? '—'}`} />
              <Row label="Electron / Node" value={`${appInfo?.electronVersion ?? '—'} / ${appInfo?.nodeVersion ?? '—'}`} />
              <Row label="SQLite 驱动" value={appInfo?.sqliteDriver ?? '—'} />
              <Row label="Python 兜底" value={appInfo?.pythonAvailable ? (appInfo.pythonVersion ?? '可用') : '不可用'} />
            </dl>
            <InlineNote tone={appInfo?.sqliteDriver === 'node:sqlite' ? 'success' : 'warn'}>
              {appInfo?.sqliteDriver === 'node:sqlite'
                ? '进程内 node:sqlite 直读，无需任何原生模块编译。'
                : '回退到 python sqlite3 桥接，功能一致但略慢。'}
            </InlineNote>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="flex items-center gap-1.5 text-[12px] font-semibold tracking-wide text-ink-faint">
              <IconShield size={12} />
              数据与解密
            </h3>
            <ul className="flex flex-col gap-1.5 text-[11px] leading-relaxed text-ink-soft">
              <li>· 解密与导出全部在本机完成，应用不发起任何网络请求。</li>
              <li>· 密钥只写入本机配置文件与工作目录的 key.txt，供 skill 里的脚本复用。</li>
              <li>· 解密产物是明文数据库，请勿同步到网盘或提交到 git。</li>
              <li>
                · 解密参数（微信 4.x，实测值）：页 4096 / 保留 80 字节 / IV 偏移 4016 /
                PBKDF2-HMAC-SHA512 × 256000。
              </li>
              <li>· 页尾 64 字节标签不参与校验：WCDB 改过 MAC 方案，判定密钥是否有效只看能否读出 schema。</li>
            </ul>
          </section>
          <LogSection />
        </div>
      </aside>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-soft">{label}</dt>
      <dd className="truncate font-mono text-[11px] text-ink">{value}</dd>
    </div>
  )
}
