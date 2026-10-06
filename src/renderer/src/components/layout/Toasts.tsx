import { IconAlert, IconCheck, IconInfo } from '../art/icons'
import { cx } from '../../lib/format'
import { useStudio } from '../../store/studio'

const TONE = {
  info: { cls: 'border-line bg-paper-3', icon: 'text-ink-soft', Icon: IconInfo },
  success: { cls: 'border-jade/30 bg-jade-wash', icon: 'text-jade', Icon: IconCheck },
  warn: { cls: 'border-gold/35 bg-gold-wash', icon: 'text-gold', Icon: IconAlert },
  error: { cls: 'border-clay/35 bg-clay-wash', icon: 'text-clay', Icon: IconAlert }
} as const

export function Toasts(): React.JSX.Element {
  const toasts = useStudio((s) => s.toasts)
  const dismiss = useStudio((s) => s.dismissToast)

  return (
    <div className="pointer-events-none fixed right-5 bottom-5 z-50 flex w-[336px] flex-col gap-2">
      {toasts.map((toast) => {
        const { cls, icon, Icon } = TONE[toast.tone]
        return (
          <button
            key={toast.id}
            type="button"
            onClick={() => dismiss(toast.id)}
            className={cx(
              'pointer-events-auto animate-rise rounded-2xl border px-4 py-3 text-left shadow-[0_24px_48px_-32px_rgba(38,33,28,.7)] backdrop-blur',
              cls
            )}
          >
            <div className="flex items-start gap-2.5">
              <Icon size={17} className={cx('mt-0.5 shrink-0', icon)} />
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-ink">{toast.title}</p>
                {toast.detail ? (
                  <p className="mt-0.5 text-[12px] leading-relaxed text-ink-soft">{toast.detail}</p>
                ) : null}
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
