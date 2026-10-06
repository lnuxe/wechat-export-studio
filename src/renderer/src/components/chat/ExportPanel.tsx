import { useState } from 'react'
import type { ExportFormat } from '@shared/types'
import { MiniBars, SealStampAnimated } from '../art/animated'
import { IconCheck, IconClose, IconDownload } from '../art/icons'
import { Button, Field, InlineNote, Switch, TextInput } from '../ui/primitives'
import { cx, humanBytes } from '../../lib/format'
import { useStudio } from '../../store/studio'

const FORMATS: { value: ExportFormat; label: string; hint: string }[] = [
  { value: 'txt', label: 'chat.txt', hint: '给泡菜鱼分析用' },
  { value: 'html', label: '网页', hint: '单文件可搜索' },
  { value: 'md', label: 'Markdown', hint: '带日期小标题' },
  { value: 'json', label: 'JSON', hint: '结构化数据' },
  { value: 'csv', label: 'CSV', hint: 'Excel 可打开' }
]

/**
 * 导出抽屉。
 *
 * 设计取舍：导出是一条低频但需要「确认感」的操作，
 * 所以做成从右侧滑出的面板，而不是常驻表单——主界面留给读消息。
 * 预检结果（条数 + 预计体积）必须在点导出之前就可见。
 */
export function ExportPanel({ onClose }: { onClose: () => void }): React.JSX.Element {
  const selected = useStudio((s) => s.selected)
  const stats = useStudio((s) => s.stats)
  const options = useStudio((s) => s.exportRequest)
  const plan = useStudio((s) => s.exportPlan)
  const planExport = useStudio((s) => s.planExport)
  const runExport = useStudio((s) => s.runExport)
  const busy = useStudio((s) => s.busy)
  const [fileDraft, setFileDraft] = useState('')

  const formats = options.formats

  return (
    <aside
      data-export-panel
      className="surface flex w-[318px] shrink-0 flex-col overflow-hidden"
      style={{ animation: 'wes-slide-in .28s cubic-bezier(.22,1,.36,1) both' }}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-line/70 px-4 py-3">
        <span className="grid size-7 place-items-center rounded-lg bg-jade-wash text-jade">
          <IconDownload size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-semibold text-ink">导出</p>
          <p className="truncate text-[11px] text-ink-faint">{selected?.displayName ?? '未选择会话'}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="grid size-7 place-items-center rounded-lg text-ink-faint transition-colors hover:bg-ink/5 hover:text-ink"
          aria-label="收起导出面板"
        >
          <IconClose size={15} />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3.5">
        {stats ? (
          <div className="rounded-xl border border-line/70 bg-paper-2/60 p-3">
            <div className="flex items-baseline justify-between">
              <span className="text-[11.5px] text-ink-soft">这段关系的客观面</span>
              <SealStampAnimated label={stats.mine >= stats.theirs ? '主动' : '被动'} size={34} tone={stats.mine >= stats.theirs ? 'jade' : 'gold'} />
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center">
              <Metric label="我" value={stats.mine} tone="jade" />
              <Metric label="对方" value={stats.theirs} tone="gold" />
              <Metric label="跨度" value={`${stats.spanDays}天`} />
            </div>
            <div className="mt-2">
              <MiniBars
                data={stats.perDay.slice(-30).map((day) => ({ label: day.date, value: day.count }))}
                height={34}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-ink-faint">
              中位回复 {stats.medianReplySeconds !== null ? `${Math.round(stats.medianReplySeconds / 60)} 分钟` : '—'} · 平均 {stats.avgChars} 字
            </p>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-1.5">
          {FORMATS.map((format) => {
            const active = formats.includes(format.value)
            return (
              <button
                key={format.value}
                type="button"
                title={format.hint}
                onClick={() =>
                  void planExport({
                    formats: active ? formats.filter((item) => item !== format.value) : [...formats, format.value]
                  })
                }
                className={cx(
                  'rounded-xl border px-2.5 py-1.5 text-[11.5px] transition-colors',
                  active ? 'border-jade/35 bg-jade-wash text-jade' : 'border-line text-ink-soft hover:text-ink'
                )}
              >
                {active ? '✓ ' : ''}
                {format.label}
              </button>
            )
          })}
        </div>

        <Field label="文件名" hint="留空则用会话名">
          <TextInput
            className="h-9 text-[12.5px]"
            value={fileDraft}
            placeholder={selected?.displayName ?? ''}
            onChange={(event) => setFileDraft(event.target.value)}
            onBlur={() => void planExport({ fileName: fileDraft.trim() || undefined })}
          />
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="起始">
            <TextInput
              type="date"
              className="h-9 text-[12px]"
              onChange={(event) =>
                void planExport({
                  from: event.target.value
                    ? Math.floor(new Date(`${event.target.value}T00:00:00`).getTime() / 1000)
                    : undefined
                })
              }
            />
          </Field>
          <Field label="结束">
            <TextInput
              type="date"
              className="h-9 text-[12px]"
              onChange={(event) =>
                void planExport({
                  to: event.target.value
                    ? Math.floor(new Date(`${event.target.value}T23:59:59`).getTime() / 1000)
                    : undefined
                })
              }
            />
          </Field>
        </div>

        <div className="flex flex-col">
          <Switch checked={options.includeStats ?? true} onChange={(next) => void planExport({ includeStats: next })} label="附带统计" />
          <Switch checked={options.includeSystem ?? true} onChange={(next) => void planExport({ includeSystem: next })} label="包含系统消息" />
          <Switch
            checked={options.includeAnalysisPrompt ?? false}
            onChange={(next) => void planExport({ includeAnalysisPrompt: next })}
            label="生成泡菜鱼提示词"
          />
        </div>

        {plan ? (
          <div className="rounded-xl border border-line/70 bg-paper-2/60 p-3 text-[11.5px]">
            <p className="text-ink">
              将导出 <b className="text-tabular">{plan.estimatedMessages}</b> 条
            </p>
            <ul className="mt-1 flex flex-col gap-0.5">
              {plan.outputs.map((output) => (
                <li key={output.format} className="flex items-center justify-between gap-2">
                  <span className="truncate text-ink-soft">{output.format.toUpperCase()}</span>
                  <span className="shrink-0 text-ink-faint text-tabular">≈{humanBytes(output.bytes ?? 0)}</span>
                </li>
              ))}
            </ul>
            {plan.warnings.length ? (
              <ul className="mt-1.5 flex flex-col gap-0.5">
                {plan.warnings.map((warning) => (
                  <li key={warning} className="text-gold">
                    · {warning}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-line/70 px-4 py-3">
        <Button
          tone="primary"
          icon={busy === 'export' ? undefined : IconDownload}
          loading={busy === 'export'}
          disabled={!selected || formats.length === 0}
          className="w-full"
          onClick={() => void runExport()}
        >
          开始导出
        </Button>
        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-faint">
          <IconCheck size={12} className="mt-0.5 shrink-0 text-jade" />
          产物写入工作目录的 exports/，导出中心可以逐个打开。
        </p>
      </div>
    </aside>
  )
}

function Metric({ label, value, tone }: { label: string; value: number | string; tone?: 'jade' | 'gold' }): React.JSX.Element {
  return (
    <div>
      <p className={cx('text-[16px] font-semibold text-tabular', tone === 'jade' ? 'text-jade' : tone === 'gold' ? 'text-gold' : 'text-ink')}>
        {value}
      </p>
      <p className="text-[10.5px] text-ink-faint">{label}</p>
    </div>
  )
}

export { InlineNote }
