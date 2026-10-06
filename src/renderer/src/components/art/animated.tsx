import type { ReactNode, SVGProps } from 'react'

/**
 * 动效美术资源（全部内联 SVG + CSS 动画，零外部图片、零动画库）。
 *
 * 设计约束：
 *  - 只动「该动」的东西：呼吸、游动、气泡上浮、进度流转；
 *  - 幅度小、周期长（2–6s），避免 Dashboard 那种廉价的闪烁；
 *  - 每个动效都尊重 prefers-reduced-motion：关掉动画仍然是一张完整的静态插画。
 *  - 用 CSS 变量着色，主题切换时自动跟着变（不需要重绘）。
 */

/** 与 theme.css 里的 keyframes 对应；写在这里便于组件就近阅读 */
const STYLE_ID = 'wes-art-keyframes'

function useKeyframesOnce(): void {
  // 只在客户端注入一次；SSR/无 document 环境直接跳过
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
@keyframes wes-swim { 0%,100% { transform: translate3d(0,0,0) rotate(0deg) } 50% { transform: translate3d(6px,-4px,0) rotate(-2.5deg) } }
@keyframes wes-tail { 0%,100% { transform: rotate(0deg) } 50% { transform: rotate(9deg) } }
@keyframes wes-bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-7px) } }
@keyframes wes-rise { 0% { transform: translateY(6px) scale(.8); opacity: 0 } 25% { opacity: .85 } 100% { transform: translateY(-34px) scale(1.15); opacity: 0 } }
@keyframes wes-ripple { 0% { transform: scale(.6); opacity: .5 } 100% { transform: scale(1.9); opacity: 0 } }
@keyframes wes-blink { 0%,92%,100% { transform: scaleY(1) } 96% { transform: scaleY(.1) } }
@keyframes wes-dash { to { stroke-dashoffset: -240 } }
@keyframes wes-sheen { 0% { transform: translateX(-120%) } 100% { transform: translateX(220%) } }
@keyframes wes-float-slow { 0%,100% { transform: translateY(0) rotate(0deg) } 50% { transform: translateY(-12px) rotate(1.5deg) } }
@media (prefers-reduced-motion: reduce) {
  [data-wes-anim] { animation: none !important }
}
`
  document.head.appendChild(style)
}

/* ------------------------------------------------------------------ 水墨鱼 */

/** 空状态主视觉：一条会游的墨鱼 + 上浮的气泡 + 水面涟漪 */
export function KoiSwimming({ size = 220, className }: { size?: number; className?: string }): React.JSX.Element {
  useKeyframesOnce()
  return (
    <svg
      className={className}
      width={size}
      height={size * 0.72}
      viewBox="0 0 240 172"
      fill="none"
      role="img"
      aria-label="等待数据的水墨鱼"
    >
      <defs>
        <linearGradient id="koi-body" x1="40" y1="40" x2="190" y2="140" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--color-jade-bright)" />
          <stop offset="1" stopColor="var(--color-jade)" />
        </linearGradient>
        <linearGradient id="koi-fin" x1="30" y1="70" x2="90" y2="130" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--color-gold)" stopOpacity=".85" />
          <stop offset="1" stopColor="var(--color-gold)" stopOpacity=".35" />
        </linearGradient>
        <radialGradient id="koi-shadow" cx="0.5" cy="0.5" r="0.5">
          <stop stopColor="var(--color-ink)" stopOpacity=".16" />
          <stop offset="1" stopColor="var(--color-ink)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* 水底光晕 */}
      <ellipse cx="120" cy="150" rx="86" ry="14" fill="url(#koi-shadow)" />

      {/* 涟漪：两圈错峰扩散 */}
      <g data-wes-anim style={{ animation: 'wes-ripple 4.2s ease-out infinite' }} transform="translate(120 138)">
        <ellipse rx="46" ry="9" fill="none" stroke="var(--color-jade)" strokeOpacity=".28" strokeWidth="1.2" />
      </g>
      <g data-wes-anim style={{ animation: 'wes-ripple 4.2s ease-out 2.1s infinite' }} transform="translate(120 138)">
        <ellipse rx="46" ry="9" fill="none" stroke="var(--color-jade)" strokeOpacity=".22" strokeWidth="1.2" />
      </g>

      {/* 气泡：三颗不同相位 */}
      {[
        { x: 74, delay: '0s', r: 4 },
        { x: 92, delay: '1.6s', r: 2.6 },
        { x: 166, delay: '2.8s', r: 3.2 }
      ].map((bubble) => (
        <circle
          key={bubble.x}
          data-wes-anim
          cx={bubble.x}
          cy={118}
          r={bubble.r}
          fill="none"
          stroke="var(--color-jade)"
          strokeOpacity=".45"
          style={{ animation: `wes-rise 5.4s ease-in ${bubble.delay} infinite` }}
        />
      ))}

      <g data-wes-anim style={{ animation: 'wes-swim 6s ease-in-out infinite' }}>
        {/* 尾鳍 */}
        <g data-wes-anim style={{ animation: 'wes-tail 1.8s ease-in-out infinite', transformOrigin: '58px 92px' }}>
          <path
            d="M62 92c-16-12-30-16-42-14 4 12 14 22 28 27-14 3-24 10-30 20 14 4 30-2 44-13Z"
            fill="url(#koi-fin)"
          />
        </g>
        {/* 身体 */}
        <path
          d="M64 92c6-26 32-44 66-44 34 0 60 16 70 38-6 24-34 42-70 42-36 0-60-14-66-36Z"
          fill="url(#koi-body)"
        />
        {/* 背鳍 */}
        <path d="M110 50c8-10 22-16 38-15-6 8-14 14-24 17Z" fill="var(--color-jade)" opacity=".55" />
        {/* 腹鳍 */}
        <path d="M118 128c6 10 16 16 28 17-4-9-12-15-22-18Z" fill="var(--color-jade)" opacity=".4" />
        {/* 眼睛（偶尔眨眼） */}
        <g data-wes-anim style={{ animation: 'wes-blink 6.5s ease-in-out infinite', transformOrigin: '176px 84px' }}>
          <circle cx="176" cy="84" r="5.4" fill="var(--color-paper-2)" />
          <circle cx="177.4" cy="84" r="2.6" fill="var(--color-ink)" />
        </g>
        {/* 鳞片笔触 */}
        <path
          d="M104 82c8-8 18-8 26 0M114 100c8-8 18-8 26 0"
          stroke="var(--color-paper-2)"
          strokeOpacity=".5"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        {/* 腮线 */}
        <path d="M148 66c-5 8-5 18 0 26" stroke="var(--color-paper-2)" strokeOpacity=".45" strokeWidth="1.6" strokeLinecap="round" />
      </g>
    </svg>
  )
}

/* ------------------------------------------------------------------ 聊天气泡 */

/** 空会话视觉：两个互相靠近的气泡（呼吸 + 一点位移） */
export function WhisperBubbles({ size = 180, className }: { size?: number; className?: string }): React.JSX.Element {
  useKeyframesOnce()
  return (
    <svg className={className} width={size} height={size * 0.62} viewBox="0 0 180 112" fill="none" aria-hidden>
      <g data-wes-anim style={{ animation: 'wes-float-slow 5s ease-in-out infinite' }}>
        <path
          d="M8 34C8 20 20 10 36 10h34c16 0 28 10 28 24S86 58 70 58H42l-14 10 3-12C18 52 8 45 8 34Z"
          fill="var(--color-jade-wash)"
          stroke="var(--color-jade)"
          strokeOpacity=".35"
        />
        <circle cx="34" cy="34" r="2.6" fill="var(--color-jade)" opacity=".55" />
        <circle cx="46" cy="34" r="2.6" fill="var(--color-jade)" opacity=".45" />
        <circle cx="58" cy="34" r="2.6" fill="var(--color-jade)" opacity=".35" />
      </g>
      <g data-wes-anim style={{ animation: 'wes-float-slow 5s ease-in-out 1.2s infinite' }}>
        <path
          d="M172 78c0-14-12-24-28-24h-30c-16 0-28 10-28 24s12 24 28 24h28l15 10-3-12c11-3 18-11 18-22Z"
          fill="var(--color-gold-wash)"
          stroke="var(--color-gold)"
          strokeOpacity=".4"
        />
        <circle cx="116" cy="78" r="2.6" fill="var(--color-gold)" opacity=".55" />
        <circle cx="128" cy="78" r="2.6" fill="var(--color-gold)" opacity=".45" />
      </g>
    </svg>
  )
}

/* ------------------------------------------------------------------ 品牌标识 */

/** 标题栏品牌标：鱼 + 气泡，轻微上浮 */
export function KoiMarkAnimated({ size = 26 }: { size?: number }): React.JSX.Element {
  useKeyframesOnce()
  return (
    <span data-wes-anim style={{ display: 'inline-flex', animation: 'wes-bob 4.4s ease-in-out infinite' }}>
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
        <defs>
          <linearGradient id="mark-body" x1="4" y1="6" x2="28" y2="26" gradientUnits="userSpaceOnUse">
            <stop stopColor="var(--color-jade-bright)" />
            <stop offset="1" stopColor="var(--color-jade)" />
          </linearGradient>
        </defs>
        <path
          d="M27 9.2c0 6-5 11-11.4 11H12C7 20.2 3 16.7 3 12.8 3 9.3 5.7 7 9 7h10.8C24 7 27 7.6 27 9.2Z"
          fill="url(#mark-body)"
        />
        <path d="M4 16.4c-2.4-.4-2.7 3.1.5 4.5 1.5.6 2.4 1.7 2.4 3.3-1.7-.3-3.3-.9-4.5-1.9C.4 20.7 0 19.2 0 17.2c0-1 .5-1.3 1.3-1.2.8.1 1.9.3 2.7.4Z" fill="var(--color-gold)" />
        <circle cx="12" cy="13.4" r="1.6" fill="var(--color-paper-2)" />
        <circle cx="19.4" cy="13.4" r="1.6" fill="var(--color-paper-2)" />
      </svg>
    </span>
  )
}

/* ------------------------------------------------------------------ 状态动效 */

/** 「正在同步」指示：一条流动的墨线 */
export function InkFlow({ width = 120, className }: { width?: number; className?: string }): React.JSX.Element {
  useKeyframesOnce()
  return (
    <svg className={className} width={width} height="12" viewBox="0 0 120 12" fill="none" aria-hidden>
      <path
        d="M2 6c14-8 26 8 40 0s26 8 40 0 24 6 36 0"
        stroke="var(--color-jade)"
        strokeOpacity=".55"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeDasharray="46 194"
        data-wes-anim
        style={{ animation: 'wes-dash 2.4s linear infinite' }}
      />
    </svg>
  )
}

/** 数据卡片的流光遮罩（用于「正在读取」） */
export function SheenOverlay(): React.JSX.Element {
  useKeyframesOnce()
  return (
    <span
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        borderRadius: 'inherit',
        pointerEvents: 'none'
      }}
    >
      <span
        data-wes-anim
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          width: '38%',
          background:
            'linear-gradient(100deg, transparent, color-mix(in oklab, var(--color-jade) 16%, transparent), transparent)',
          animation: 'wes-sheen 1.7s ease-in-out infinite'
        }}
      />
    </span>
  )
}

/** 印章（静态，但带一点手绘抖动描边） */
export function SealStampAnimated({
  label,
  tone = 'jade',
  size = 58
}: {
  label: string
  tone?: 'jade' | 'gold' | 'ink'
  size?: number
}): React.JSX.Element {
  const color =
    tone === 'jade' ? 'var(--color-jade)' : tone === 'gold' ? 'var(--color-gold)' : 'var(--color-ink-soft)'
  return (
    <svg width={size} height={size} viewBox="0 0 62 62" aria-hidden>
      <rect x="3" y="3" width="56" height="56" rx="10" fill="none" stroke={color} strokeWidth="2.4" opacity=".85" />
      <rect x="7.5" y="7.5" width="47" height="47" rx="7" fill="none" stroke={color} strokeWidth="0.9" opacity=".45" />
      <text
        x="31"
        y="37"
        textAnchor="middle"
        fontSize="19"
        fontWeight="700"
        fill={color}
        style={{ fontFamily: 'var(--font-serif)', letterSpacing: 1 }}
      >
        {label}
      </text>
    </svg>
  )
}

/** 迷你柱状图：会话统计用（无动画，纯数据表达） */
export function MiniBars({
  data,
  height = 44,
  accent = 'var(--color-jade)'
}: {
  data: { label: string; value: number; tone?: string }[]
  height?: number
  accent?: string
}): React.JSX.Element {
  const max = Math.max(1, ...data.map((item) => item.value))
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height }}>
      {data.map((item, index) => (
        <span
          key={`${item.label}-${index}`}
          title={`${item.label} · ${item.value}`}
          style={{
            flex: 1,
            minWidth: 2,
            height: `${Math.max(6, (item.value / max) * 100)}%`,
            borderRadius: 2,
            background: item.tone ?? accent,
            opacity: item.value === 0 ? 0.25 : 1
          }}
        />
      ))}
    </div>
  )
}

export type ArtNode = ReactNode

export function ArtGallery(): React.JSX.Element {
  useKeyframesOnce()
  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
      <KoiSwimming size={200} />
      <WhisperBubbles size={180} />
      <InkFlow width={160} />
    </div>
  )
}

export type { SVGProps }
