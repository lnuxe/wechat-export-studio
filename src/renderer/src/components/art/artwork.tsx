/**
 * 静态美术底纹（动效资源见 animated.tsx）。
 *
 * 只留两件真正被界面用到的东西：
 *  - PaperGrain：整屏纸纹，给「手作」的质感打底；
 *  - ScaleMotif：鱼鳞暗纹，用在侧栏角落做点缀。
 * 之前那版还有空鱼缸插画、印章、进度环等，已被 animated.tsx 里的动效版本取代，
 * 这里删掉以免同一个视觉出现两套实现。
 */

/** 纸纹底：极淡颗粒 + 斜向纤维，铺在应用背景上（不拦截点击） */
export function PaperGrain({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      className={className}
      aria-hidden
      width="100%"
      height="100%"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    >
      <defs>
        <pattern id="grain-dots" width="6" height="6" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.5" fill="#3a2f26" opacity="0.05" />
          <circle cx="4" cy="3.5" r="0.4" fill="#3a2f26" opacity="0.04" />
        </pattern>
        <pattern id="grain-fiber" width="120" height="120" patternUnits="userSpaceOnUse" patternTransform="rotate(24)">
          <path d="M0 30 Q 30 12 60 30 T 120 30" stroke="#7a6a58" strokeWidth="0.4" fill="none" opacity="0.05" />
          <path d="M0 78 Q 30 96 60 78 T 120 78" stroke="#7a6a58" strokeWidth="0.35" fill="none" opacity="0.045" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#grain-dots)" />
      <rect width="100%" height="100%" fill="url(#grain-fiber)" />
    </svg>
  )
}

/** 鱼鳞暗纹：侧栏/卡片角落的半透明装饰 */
export function ScaleMotif({ className, opacity = 0.5 }: { className?: string; opacity?: number }): React.JSX.Element {
  return (
    <svg className={className} width="200" height="120" viewBox="0 0 220 120" aria-hidden style={{ opacity }}>
      <defs>
        <pattern id="scales" width="26" height="18" patternUnits="userSpaceOnUse">
          <path d="M0 18A13 13 0 0 1 26 18" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.5" />
          <path d="M-13 9A13 13 0 0 1 13 9" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.25" />
        </pattern>
      </defs>
      <rect width="220" height="120" fill="url(#scales)" />
    </svg>
  )
}
