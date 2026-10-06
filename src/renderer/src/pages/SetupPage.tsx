import { useMemo } from 'react'
import { InkFlow, KoiSwimming, SealStampAnimated } from '../components/art/animated'
import {
  IconBolt,
  IconChats,
  IconCheck,
  IconDatabase,
  IconFolder,
  IconKey,
  IconRefresh,
  IconShield
} from '../components/art/icons'
import { Button, Card, InlineNote, SectionTitle } from '../components/ui/primitives'
import { cx, humanBytes, relativeTime } from '../lib/format'
import { useStudio } from '../store/studio'

/**
 * 连接页（原「概览」+「导出管线」合并）。
 *
 * 合并理由：这两页此前讲的是同一件事（把数据准备好），拆开只让人来回跳。
 * 现在按「账号 → 密钥 → 解密」三步组织，一屏走完；
 * 所有绝对路径与运行时诊断信息都移入设置抽屉，主界面不再出现路径。
 */
export function SetupPage(): React.JSX.Element {
  const workspace = useStudio((s) => s.workspace)
  const accounts = useStudio((s) => s.accounts)
  const selectedAccount = useStudio((s) => s.selectedAccount)
  const conversations = useStudio((s) => s.conversations)
  const conversationTotal = useStudio((s) => s.conversationTotal)
  const decryptReport = useStudio((s) => s.decryptReport)
  const decryptStatus = useStudio((s) => s.decryptStatus)
  const decryptProgress = useStudio((s) => s.decryptProgress)
  const busy = useStudio((s) => s.busy)
  const keyDraft = useStudio((s) => s.keyDraft)
  const keyVerification = useStudio((s) => s.keyVerification)
  const setKeyDraft = useStudio((s) => s.setKeyDraft)
  const loadKeyFromFile = useStudio((s) => s.loadKeyFromFile)
  const verifyKey = useStudio((s) => s.verifyKey)
  const selectAccount = useStudio((s) => s.selectAccount)
  const chooseDataDir = useStudio((s) => s.chooseDataDir)
  const refreshWechat = useStudio((s) => s.refreshWechat)
  const runDecrypt = useStudio((s) => s.runDecrypt)
  const cancelDecrypt = useStudio((s) => s.cancelDecrypt)
  const loadDecryptStatus = useStudio((s) => s.loadDecryptStatus)
  const setPage = useStudio((s) => s.setPage)

  const account = accounts.find((item) => item.dbStoragePath === selectedAccount) ?? null
  const decrypted = Boolean(decryptReport) || Boolean(decryptStatus?.ready)
  const decryptedStores = decryptReport
    ? decryptReport.files.filter((file) => file.strategy !== 'skipped').length
    : (decryptStatus?.stores.length ?? 0)
  const decryptedBytes = decryptReport?.totalBytes ?? decryptStatus?.totalBytes ?? 0

  const steps = useMemo(
    () => [
      { key: 'data', title: '账号' },
      { key: 'key', title: '密钥' },
      { key: 'decrypt', title: '解密' }
    ],
    []
  )
  const doneMap = [Boolean(account), Boolean(workspace?.savedKey), decrypted]
  const doneCount = doneMap.filter(Boolean).length
  const decrypting = busy === 'decrypt'

  return (
    <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-4">
      <SectionTitle
        eyebrow="Connect"
        title={doneCount === 3 ? '数据已就绪' : '先花一分钟把数据接上'}
        detail="全程本地：探测微信数据目录 → 验证密钥 → 解密数据库。解密会同时跑「只用主库」与「主库 + WAL」两条路径，按最新时间与行数择优，过期 WAL 会被自动拒绝。"
        actions={
          doneCount === 3 ? (
            <Button tone="primary" icon={IconChats} onClick={() => setPage('chats')}>
              开始读会话
            </Button>
          ) : null
        }
      />

      {/* 三步进度 */}
      <div className="surface flex items-center gap-3 px-4 py-3">
        {steps.map((step, index) => (
          <div key={step.key} className="flex flex-1 items-center gap-2.5">
            <span
              className={cx(
                'grid size-7 shrink-0 place-items-center rounded-full border text-[12px] font-semibold',
                doneMap[index] ? 'border-jade/30 bg-jade text-paper-2' : 'border-line bg-paper-2 text-ink-faint'
              )}
            >
              {doneMap[index] ? <IconCheck size={14} weight={2.4} /> : index + 1}
            </span>
            <span className={cx('text-[12.5px]', doneMap[index] ? 'text-ink' : 'text-ink-faint')}>{step.title}</span>
            {index < steps.length - 1 ? (
              <span className={cx('h-px flex-1', doneMap[index] ? 'bg-jade/40' : 'bg-line')} />
            ) : null}
          </div>
        ))}
        <Button tone="ghost" size="sm" icon={IconRefresh} onClick={() => void refreshWechat()}>
          重新探测
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card
          title="微信账号"
          subtitle={account ? `${account.id} · ${humanBytes(account.totalBytes)}` : '未连接'}
          icon={IconFolder}
        >
          {accounts.length === 0 ? (
            <>
              <InlineNote tone="warn">没自动发现微信数据目录，若装在自定义位置，手动选一次即可。</InlineNote>
              <Button tone="outline" className="mt-3" icon={IconFolder} onClick={() => void chooseDataDir()}>
                手动选择目录
              </Button>
            </>
          ) : (
            <div className="flex flex-col gap-2">
              {accounts.map((item) => {
                const active = item.dbStoragePath === selectedAccount
                return (
                  <button
                    key={item.dbStoragePath}
                    type="button"
                    onClick={() => void selectAccount(item.dbStoragePath)}
                    className={cx(
                      'flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
                      active ? 'border-jade/35 bg-jade-wash' : 'border-line bg-paper-3/50 hover:border-line-strong'
                    )}
                  >
                    <span
                      className={cx(
                        'grid size-7 shrink-0 place-items-center rounded-lg',
                        active ? 'bg-paper-3 text-jade' : 'bg-ink/6 text-ink-faint'
                      )}
                    >
                      <IconCheck size={13} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">{item.id}</span>
                      <span className="block text-[11px] text-ink-faint">
                        {item.stores.length} 个子库 · 最近变动 {relativeTime(item.lastModified)}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </Card>

        <Card
          title="解密密钥"
          subtitle={keyVerification?.ok ? '已验证' : workspace?.savedKey ? '已保存，可直接解密' : '还没拿到'}
          icon={IconKey}
        >
          <div className="flex flex-col gap-2.5">
            <div className="flex gap-2">
              <input
                value={keyDraft}
                onChange={(event) => setKeyDraft(event.target.value)}
                placeholder="粘贴 64 位密钥，或点右侧读取"
                spellCheck={false}
                className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-paper-3/80 px-3 font-mono text-[11.5px] text-ink placeholder:text-ink-faint focus:border-jade/60"
              />
              <Button tone="outline" className="shrink-0" onClick={() => void loadKeyFromFile()}>
                读取
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button
                tone="primary"
                size="sm"
                icon={IconShield}
                loading={busy === 'verify-key'}
                disabled={!keyDraft.trim()}
                onClick={() => void verifyKey()}
              >
                验证密钥
              </Button>
              {keyVerification ? (
                <span className={cx('text-[11.5px]', keyVerification.ok ? 'text-jade' : 'text-clay')}>
                  {keyVerification.ok ? '密钥有效' : '无法解密，可能是别的账号的密钥'}
                </span>
              ) : (
                <span className="text-[11.5px] text-ink-faint">验证只读第 1 页，几毫秒</span>
              )}
            </div>
            <p className="text-[11px] leading-relaxed text-ink-faint">
              微信 4.x 的密钥只在进程启动时注入一次，所以要用 wx_key.dll 工具「先关微信 → 由工具拉起微信 → 立即抓取」。
              密钥是账号级持久的，取一次长期有效。
            </p>
          </div>
        </Card>
      </div>

      <Card
        title="解密数据库"
        subtitle={
          decrypted
            ? `已解出 ${decryptedStores} 个库 · ${humanBytes(decryptedBytes)}${decryptStatus?.modified ? ` · ${relativeTime(decryptStatus.modified)}` : ''}`
            : account
              ? '准备就绪'
              : '先选择账号目录'
        }
        icon={IconDatabase}
        actions={
          <>
            <Button tone="ghost" size="sm" icon={IconRefresh} onClick={() => void loadDecryptStatus()}>
              刷新
            </Button>
            {decrypting ? (
              <Button tone="danger" size="sm" onClick={() => void cancelDecrypt()}>
                取消
              </Button>
            ) : (
              <Button
                tone="primary"
                icon={IconBolt}
                loading={decrypting}
                disabled={!account || !keyDraft.trim()}
                onClick={() => void runDecrypt()}
              >
                {decrypted ? '重新解密' : '开始解密'}
              </Button>
            )}
          </>
        }
      >
        {decrypting && decryptProgress ? (
          <div className="flex items-center gap-4">
            <KoiSwimming size={128} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] text-ink">{decryptProgress.message}</p>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-ink/8">
                <div
                  className="h-full rounded-full bg-jade transition-[width] duration-500"
                  style={{ width: `${decryptProgress.percent}%` }}
                />
              </div>
              <p className="mt-1.5 text-[11px] text-ink-faint text-tabular">
                {decryptProgress.percent}% · {decryptProgress.index + 1}/{decryptProgress.total}
              </p>
            </div>
          </div>
        ) : decrypted ? (
          <div className="flex items-center gap-4">
            <SealStampAnimated label="已解密" size={62} />
            <div className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-ink-soft">
              <p>
                可浏览 <b className="text-ink text-tabular">{conversationTotal || conversations.length}</b> 个会话，
                <b className="text-ink text-tabular">{decryptedStores}</b> 个子库已就绪。
              </p>
              <p className="mt-1 text-[11.5px] text-ink-faint">
                解密反映的是「最后一次执行」那一刻的数据库状态；想看到刚发的消息，重新解密一次即可。
              </p>
              {decryptReport?.walGuardTriggered ? (
                <p className="mt-1 flex items-center gap-1.5 text-[11.5px] text-gold">
                  <IconShield size={12} />
                  已拒绝一次过期 WAL 合并（防护生效）
                </p>
              ) : null}
            </div>
            <Button tone="outline" size="sm" icon={IconChats} onClick={() => setPage('chats')}>
              去读会话
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-3 text-center">
            <InkFlow width={150} />
            <p className="max-w-md text-[12.5px] leading-relaxed text-ink-soft">
              解密会逐库处理并自动择优，全程本地。产物体积约为原始库的 1 倍。
            </p>
          </div>
        )}
      </Card>
    </div>
  )
}
