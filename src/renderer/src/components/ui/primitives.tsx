import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import { cx } from '../../lib/format'
import { IconAlert, IconCheck, IconInfo, IconSparkle, type IconProps } from '../art/icons'

/* ------------------------------------------------------------------ Button */

type ButtonTone = 'primary' | 'ghost' | 'outline' | 'danger' | 'gold'
type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ButtonTone
  size?: ButtonSize
  icon?: (props: IconProps) => React.JSX.Element
  loading?: boolean
}

const TONE: Record<ButtonTone, string> = {
  primary:
    'bg-jade text-paper-2 border-transparent hover:bg-jade-bright active:translate-y-px shadow-[0_10px_24px_-18px_rgba(47,107,95,.9)]',
  ghost: 'bg-transparent text-ink-soft border-transparent hover:bg-ink/5 hover:text-ink',
  outline: 'bg-paper-3/70 text-ink border-line hover:border-line-strong hover:bg-paper-3',
  danger: 'bg-clay text-paper-2 border-transparent hover:brightness-110',
  gold: 'bg-gold text-paper-2 border-transparent hover:brightness-110'
}

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[12.5px] gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-[13.5px] gap-2 rounded-xl',
  lg: 'h-12 px-6 text-[15px] gap-2.5 rounded-2xl'
}

export function Button({
  tone = 'outline',
  size = 'md',
  icon: Icon,
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps): React.JSX.Element {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center border font-medium transition-all duration-150',
        'disabled:opacity-45 disabled:pointer-events-none select-none',
        TONE[tone],
        SIZE[size],
        className
      )}
    >
      {loading ? (
        <span className="size-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
      ) : Icon ? (
        <Icon size={size === 'sm' ? 15 : 17} />
      ) : null}
      {children}
    </button>
  )
}

/* ------------------------------------------------------------------- Badge */

type BadgeTone = 'neutral' | 'jade' | 'gold' | 'clay' | 'ink'

const BADGE: Record<BadgeTone, string> = {
  neutral: 'bg-ink/5 text-ink-soft border-line',
  jade: 'bg-jade-wash text-jade border-jade/25',
  gold: 'bg-gold-wash text-gold border-gold/30',
  clay: 'bg-clay-wash text-clay border-clay/25',
  ink: 'bg-ink text-paper-2 border-transparent'
}

export function Badge({
  tone = 'neutral',
  children,
  className,
  icon: Icon
}: {
  tone?: BadgeTone
  children: ReactNode
  className?: string
  icon?: (props: IconProps) => React.JSX.Element
}): React.JSX.Element {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap',
        BADGE[tone],
        className
      )}
    >
      {Icon ? <Icon size={12} weight={2} /> : null}
      {children}
    </span>
  )
}

/* -------------------------------------------------------------------- Card */

export function Card({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
  icon: Icon
}: {
  title?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  icon?: (props: IconProps) => React.JSX.Element
}): React.JSX.Element {
  return (
    <section className={cx('surface flex flex-col overflow-hidden', className)}>
      {title ? (
        <header className="flex items-start gap-3 border-b border-line/70 px-5 py-3.5">
          {Icon ? (
            <span className="mt-0.5 grid size-8 place-items-center rounded-xl bg-jade-wash text-jade">
              <Icon size={17} />
            </span>
          ) : null}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[14.5px] font-semibold text-ink">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-[12px] text-ink-soft">{subtitle}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cx('flex-1 px-5 py-4', bodyClassName)}>{children}</div>
    </section>
  )
}

/* ------------------------------------------------------------------ Fields */

export function Field({
  label,
  hint,
  children,
  className
}: {
  label: ReactNode
  hint?: ReactNode
  children: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <label className={cx('flex flex-col gap-1.5', className)}>
      <span className="text-[12px] font-medium text-ink-soft">{label}</span>
      {children}
      {hint ? <span className="text-[11.5px] text-ink-faint">{hint}</span> : null}
    </label>
  )
}

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>): React.JSX.Element {
  return (
    <input
      {...rest}
      className={cx(
        'h-10 w-full rounded-xl border border-line bg-paper-3/80 px-3 text-[13.5px] text-ink',
        'placeholder:text-ink-faint transition-colors focus:border-jade/60 focus:bg-paper-3',
        className
      )}
    />
  )
}

export function Select({
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>): React.JSX.Element {
  return (
    <select
      {...rest}
      className={cx(
        'h-10 w-full cursor-pointer rounded-xl border border-line bg-paper-3/80 px-3 text-[13.5px] text-ink',
        'transition-colors focus:border-jade/60',
        className
      )}
    >
      {children}
    </select>
  )
}

export function Switch({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="group flex w-full items-center justify-between gap-4 rounded-xl px-1 py-1.5 text-left"
    >
      <span className="text-[13px] text-ink">{label}</span>
      <span
        className={cx(
          'relative h-6 w-11 shrink-0 rounded-full border transition-colors',
          checked ? 'border-transparent bg-jade' : 'border-line bg-ink/8'
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 size-5 rounded-full bg-paper-3 shadow transition-all',
            checked ? 'left-[22px]' : 'left-0.5'
          )}
        />
      </span>
    </button>
  )
}

/* -------------------------------------------------------------- 状态与提示 */

export function StatusDot({ tone }: { tone: 'ok' | 'warn' | 'error' | 'idle' }): React.JSX.Element {
  const color =
    tone === 'ok'
      ? 'bg-jade'
      : tone === 'warn'
        ? 'bg-gold'
        : tone === 'error'
          ? 'bg-clay'
          : 'bg-ink-faint'
  return (
    <span className="relative grid size-3 place-items-center">
      <span className={cx('size-2 rounded-full', color)} />
      {tone === 'ok' || tone === 'error' ? (
        <span className={cx('absolute size-3 rounded-full opacity-40 animate-breathe', color)} />
      ) : null}
    </span>
  )
}

export function InlineNote({
  tone = 'info',
  children
}: {
  tone?: 'info' | 'warn' | 'error' | 'success'
  children: ReactNode
}): React.JSX.Element {
  const map = {
    info: { cls: 'border-line bg-ink/3 text-ink-soft', Icon: IconInfo },
    warn: { cls: 'border-gold/30 bg-gold-wash text-gold', Icon: IconAlert },
    error: { cls: 'border-clay/30 bg-clay-wash text-clay', Icon: IconAlert },
    success: { cls: 'border-jade/25 bg-jade-wash text-jade', Icon: IconCheck }
  } as const
  const { cls, Icon } = map[tone]
  return (
    <div className={cx('flex items-start gap-2 rounded-xl border px-3 py-2 text-[12.5px] leading-relaxed', cls)}>
      <Icon size={15} weight={1.8} className="mt-0.5 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export function EmptyState({
  art,
  title,
  detail,
  action
}: {
  art?: ReactNode
  title: string
  detail?: ReactNode
  action?: ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center text-ink-soft">
      {art ? <div className="text-ink-faint">{art}</div> : <IconSparkle size={26} className="text-ink-faint" />}
      <div>
        <p className="text-[14px] font-medium text-ink">{title}</p>
        {detail ? <p className="mt-1 max-w-md text-[12.5px] leading-relaxed">{detail}</p> : null}
      </div>
      {action}
    </div>
  )
}

export function SectionTitle({
  eyebrow,
  title,
  detail,
  actions
}: {
  eyebrow?: string
  title: string
  detail?: ReactNode
  actions?: ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow ? (
          <p className="text-[11px] font-semibold tracking-[0.18em] text-jade uppercase">{eyebrow}</p>
        ) : null}
        <h1 className="mt-1 font-serif text-[24px] leading-tight font-semibold text-ink">{title}</h1>
        {detail ? <p className="mt-1.5 max-w-2xl text-[12.5px] text-ink-soft">{detail}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export function KpiTile({
  label,
  value,
  detail,
  tone = 'jade'
}: {
  label: string
  value: ReactNode
  detail?: ReactNode
  tone?: 'jade' | 'gold' | 'ink' | 'clay'
}): React.JSX.Element {
  const color =
    tone === 'jade' ? 'text-jade' : tone === 'gold' ? 'text-gold' : tone === 'clay' ? 'text-clay' : 'text-ink'
  return (
    <div className="surface-flat px-4 py-3">
      <p className="text-[11.5px] text-ink-soft">{label}</p>
      <p className={cx('mt-1 text-[21px] leading-none font-semibold text-tabular', color)}>{value}</p>
      {detail ? <p className="mt-1.5 text-[11.5px] text-ink-faint">{detail}</p> : null}
    </div>
  )
}

export function ProgressBar({ percent, tone = 'jade' }: { percent: number; tone?: 'jade' | 'gold' }): React.JSX.Element {
  const clamped = Math.max(0, Math.min(100, percent))
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink/8">
      <div
        className={cx('h-full rounded-full transition-[width] duration-500', tone === 'jade' ? 'bg-jade' : 'bg-gold')}
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}
