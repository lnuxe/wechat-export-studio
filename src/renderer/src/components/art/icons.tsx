import type { SVGProps } from 'react'

/**
 * 原创图标集。
 *
 * 为什么不用现成图标库了事：这套图标是「导出工作台」的视觉语言的一部分——
 * 统一 24 格网格、1.6 描边、圆角端点，笔画里带一点手写抖动（泡菜鱼的手作感），
 * 与界面里的纸纹/印章贴图是同一套笔触。全部内联 SVG，不额外发请求。
 */

export interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number
  /** 线宽倍率，密集列表里可以调小 */
  weight?: number
}

function base({ size = 20, weight = 1.6, ...rest }: IconProps): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: weight,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    focusable: false,
    ...rest
  }
}

/** 品牌标识：一条鱼 + 对话气泡的融合体（泡菜鱼 × 微信导出） */
export function KoiMark({ size = 28, ...rest }: IconProps): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden {...rest}>
      <defs>
        <linearGradient id="koi-body" x1="4" y1="6" x2="28" y2="26" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3f8f7f" />
          <stop offset="1" stopColor="#1f4f47" />
        </linearGradient>
        <linearGradient id="koi-tail" x1="2" y1="14" x2="10" y2="22" gradientUnits="userSpaceOnUse">
          <stop stopColor="#d9a45b" />
          <stop offset="1" stopColor="#b5762c" />
        </linearGradient>
      </defs>
      <path
        d="M30 6.5c0 6.6-5.6 12-12.5 12H13C7.5 18.5 3 14.6 3 10.2 3 6.5 6 4 9.6 4h11.9C26.3 4 30 4.6 30 6.5Z"
        fill="url(#koi-body)"
        transform="translate(-1.5 3.5) scale(0.92)"
      />
      <path d="M4 16.5c-2.6-.4-2.9 3.4.6 4.9 1.6.7 2.6 1.9 2.6 3.6-1.9-.3-3.6-1-4.9-2.1C.4 21.2 0 19 0 17.4c0-1.1.6-1.4 1.4-1.3.9.1 1.9.3 2.6.4Z" fill="url(#koi-tail)" />
      <circle cx="13.2" cy="11.6" r="1.7" fill="#f6f1e7" />
      <circle cx="21.2" cy="11.6" r="1.7" fill="#f6f1e7" />
      <path d="M20 22c3 0 5.6-1 5.6-1s-.6 2.9-2.6 4.3c-1.5 1-3.4 1.2-5 .5" stroke="#3f8f7f" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity=".7" />
    </svg>
  )
}

export const IconPipeline = (props: IconProps): React.JSX.Element => (
  <svg {...base(props)}>
    <path d="M4 6.5h9.5a3 3 0 0 1 3 3v0a3 3 0 0 0 3 3H20" />
    <circle cx="4" cy="6.5" r="2.1" />
    <circle cx="20" cy="12.5" r="2.1" />
    <path d="M4 17.5h6.5a3 3 0 0 0 3-3v0" />
    <circle cx="4" cy="17.5" r="2.1" />
    <path d="M15.5 17.5H20" />
    <circle cx="20" cy="17.5" r="2.1" />
  </svg>
)

export const IconChats = (props: IconProps): React.JSX.Element => (
  <svg {...base(props)}>
    <path d="M20.5 12.2c0 3.7-3.4 6.7-7.6 6.7-.9 0-1.8-.1-2.6-.4L6 20.4l1-2.9a6.3 6.3 0 0 1-2.5-4.9c0-3.7 3.4-6.7 7.6-6.7s8.4 2.9 8.4 6.3Z" />
    <path d="M9.4 12h.01M12.9 12h.01M16.4 12h.01" strokeWidth={2.4} />
  </svg>
)

export const IconArchive = (props: IconProps): React.JSX.Element => (
  <svg {...base(props)}>
    <path d="M3.5 7.5h17v11a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-11Z" />
    <path d="M2.8 4.5h18.4v3H2.8z" />
    <path d="M10 12h4" />
  </svg>
)

export const IconKey = (props: IconProps): React.JSX.Element => (
  <svg {...base(props)}>
    <circle cx="8.5" cy="8.5" r="4" />
    <path d="M11.4 11.4 20 20" />
    <path d="M17 17l-1.6 1.6M19.2 14.8 17.6 16.4" />
  </svg>
)

export const IconDatabase = (props: IconProps): React.JSX.Element => (
  <svg {...base(props)}>
    <ellipse cx="12" cy="6" rx="7.5" ry="3" />
    <path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6" />
    <path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3" />
  </svg>
)

export const IconScan = (props: IconProps): React.JSX.Element => (
  <svg {...base(props)}>
    <path d="M4 8V6.5A2.5 2.5 0 0 1 6.5 4H8M16 4h1.5A2.5 2.5 0 0 1 20 6.5V8M20 16v1.5a2.5 2.5 0 0 1-2.5 2.5H16M8 20H6.5A2.5 2.5 0 0 1 4 17.5V16" />
    <path d="M4 12h16" />
  </svg>
)

export const IconShield = (props: IconProps): React.JSX.Element => (
  <svg {...base(props)}>
    <path d="M12 3.5 5 6v5.2c0 4.2 2.9 7.6 7 9.3 4.1-1.7 7-5.1 7-9.3V6l-7-2.5Z" />
    <path d="M9 12.2l2.1 2.1L15.2 10" />
  </svg>
)

export const IconDownload = (props: IconProps): React.JSX.Element => (
  <svg {...base(props)}>
    <path d="M12 4v11" />
    <path d="M7.5 10.5 12 15l4.5-4.5" />
    <path d="M5 19.5h14" />
  </svg>
)

export const IconSparkle = (props: IconProps): React.JSX.Element => (
  <svg {...base(props)}>
    <path d="M12 3.5l1.9 4.9 4.9 1.9-4.9 1.9L12 17.1l-1.9-4.9L5.2 10.3l4.9-1.9L12 3.5Z" />
    <path d="M18.5 16.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2Z" />
  </svg>
)

export const IconAlert = (props: IconProps): React.JSX.Element => (
  <svg {...base(props)}>
    <path d="M12 4.8 3.8 19h16.4L12 4.8Z" />
    <path d="M12 10v4M12 17h.01" strokeWidth={2.2} />
  </svg>
)

export const IconInfo = (props: IconProps): React.JSX.Element => (
  <svg {...base(props)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5.5M12 7.8h.01" strokeWidth={2.2} />
  </svg>
)

export const IconCheck = (props: IconProps): React.JSX.Element => (
  <svg {...base(props)}>
    <path d="M5 12.8 9.6 17.4 19 7.6" />
  </svg>
)

export const IconClock = (props: IconProps): React.JSX.Element => (
  <svg {...base(props)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.6V12l3 2" />
  </svg>
)

export const IconSearch = (props: IconProps): React.JSX.Element => (
  <svg {...base(props)}>
    <circle cx="11" cy="11" r="6.4" />
    <path d="M15.8 15.8 20 20" />
  </svg>
)

export const IconFolder = (props: IconProps): React.JSX.Element => (
  <svg {...base(props)}>
    <path d="M3.6 7.2A2 2 0 0 1 5.6 5.5h3.1l1.8 2.2h7.9a2 2 0 0 1 2 2v7.6a2 2 0 0 1-2 2H5.6a2 2 0 0 1-2-2V7.2Z" />
  </svg>
)

export const IconRefresh = (props: IconProps): React.JSX.Element => (
  <svg {...base(props)}>
    <path d="M20 12a8 8 0 1 1-2.6-5.9" />
    <path d="M20.4 4.5v4h-4" />
  </svg>
)

export const IconSettings = (props: IconProps): React.JSX.Element => (
  <svg {...base(props)}>
    <circle cx="12" cy="12" r="3.1" />
    <path d="M19.4 14.4a7.8 7.8 0 0 0 0-4.8l1.5-1.2-1.9-3.3-1.8.7a7.7 7.7 0 0 0-4.1-2.4L12.8 1.5h-3.8l-.3 1.9a7.7 7.7 0 0 0-4.1 2.4l-1.8-.7L.9 8.4l1.5 1.2a7.8 7.8 0 0 0 0 4.8L.9 15.6l1.9 3.3 1.8-.7a7.7 7.7 0 0 0 4.1 2.4l.3 1.9h3.8l.3-1.9a7.7 7.7 0 0 0 4.1-2.4l1.8.7 1.9-3.3-1.5-1.2Z" />
  </svg>
)

export const IconUsers = (props: IconProps): React.JSX.Element => (
  <svg {...base(props)}>
    <circle cx="9.5" cy="8.5" r="3.2" />
    <path d="M3.6 19.4c0-3 2.6-5.2 5.9-5.2s5.9 2.2 5.9 5.2" />
    <path d="M16.4 6.2a3 3 0 0 1 0 5.9M17.6 19.4c0-2.2-.7-3.9-2-5" />
  </svg>
)

export const IconChart = (props: IconProps): React.JSX.Element => (
  <svg {...base(props)}>
    <path d="M4 20h16" />
    <path d="M7 20V11M12 20V5.5M17 20v-6" />
  </svg>
)

export const IconBolt = (props: IconProps): React.JSX.Element => (
  <svg {...base(props)}>
    <path d="M13.4 3 6 13.2h4.6L9.9 21 18 10.6h-4.8L13.4 3Z" />
  </svg>
)

export const IconStop = (props: IconProps): React.JSX.Element => (
  <svg {...base(props)}>
    <rect x="6.8" y="6.8" width="10.4" height="10.4" rx="2.4" />
  </svg>
)

export const IconTerminal = (props: IconProps): React.JSX.Element => (
  <svg {...base(props)}>
    <rect x="3.2" y="4.6" width="17.6" height="14.8" rx="2.2" />
    <path d="M7.4 10l2.6 2.4-2.6 2.4M12.6 15h4" />
  </svg>
)

export const IconLink = (props: IconProps): React.JSX.Element => (
  <svg {...base(props)}>
    <path d="M10.4 13.6a3.6 3.6 0 0 0 5.1 0l3-3a3.6 3.6 0 1 0-5.1-5.1l-1.2 1.2" />
    <path d="M13.6 10.4a3.6 3.6 0 0 0-5.1 0l-3 3a3.6 3.6 0 1 0 5.1 5.1l1.2-1.2" />
  </svg>
)

export const IconFilter = (props: IconProps): React.JSX.Element => (
  <svg {...base(props)}>
    <path d="M4 6.2h16M7 12h10M10 17.8h4" />
  </svg>
)

export const IconTrash = (props: IconProps): React.JSX.Element => (
  <svg {...base(props)}>
    <path d="M5 7h14M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7" />
    <path d="M6.5 7l.8 11.4A1.8 1.8 0 0 0 9.1 20h5.8a1.8 1.8 0 0 0 1.8-1.6L17.5 7" />
  </svg>
)

export const IconChevron = (props: IconProps): React.JSX.Element => (
  <svg {...base(props)}>
    <path d="M9 6l6 6-6 6" />
  </svg>
)

/** 回到最新：向下箭头 + 底线（聊天软件的通用语义） */
export const IconArrowDown = (props: IconProps): React.JSX.Element => (
  <svg {...base(props)}>
    <path d="M12 5v12" />
    <path d="M7.2 12.4 12 17.2l4.8-4.8" />
    <path d="M5.5 20h13" opacity="0.5" />
  </svg>
)

export const IconClose = (props: IconProps): React.JSX.Element => (
  <svg {...base(props)}>
    <path d="M6.6 6.6l10.8 10.8M17.4 6.6 6.6 17.4" />
  </svg>
)

/** 实时刷新：脉冲波 */
export const IconLive = (props: IconProps): React.JSX.Element => (
  <svg {...base(props)}>
    <circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
    <path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 16.2a6 6 0 0 0 0-8.4" opacity="0.85" />
    <path d="M5 5a10 10 0 0 0 0 14M19 19a10 10 0 0 0 0-14" opacity="0.45" />
  </svg>
)

/** 暂停 */
export const IconPause = (props: IconProps): React.JSX.Element => (
  <svg {...base(props)}>
    <path d="M9.5 5.5v13M14.5 5.5v13" strokeWidth={2} />
  </svg>
)

/** 主题/皮肤 */
export const IconPalette = (props: IconProps): React.JSX.Element => (
  <svg {...base(props)}>
    <path d="M12 3.6c-4.8 0-8.6 3.5-8.6 7.9 0 3.4 2.6 5.6 5.4 5.6 1.6 0 2.4-.8 2.4-1.9 0-2.5 1.2-3.3 3.1-3.3h1.9c2.7 0 4.4-1.5 4.4-3.7 0-2.6-3.5-4.6-8.6-4.6Z" />
    <circle cx="8.4" cy="10.2" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="12" cy="8" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="15.6" cy="10" r="1.1" fill="currentColor" stroke="none" />
  </svg>
)

/** 连接（数据接入） */
export const IconLink2 = (props: IconProps): React.JSX.Element => (
  <svg {...base(props)}>
    <path d="M10.5 6.5h-1A4.5 4.5 0 0 0 5 11v0a4.5 4.5 0 0 0 4.5 4.5h1" />
    <path d="M13.5 6.5h1A4.5 4.5 0 0 1 19 11v0a4.5 4.5 0 0 1-4.5 4.5h-1" />
    <path d="M9 11h6" />
  </svg>
)

export const ICON_BY_SCOPE: Record<string, (props: IconProps) => React.JSX.Element> = {
  app: IconInfo,
  workspace: IconFolder,
  wechat: IconChats,
  key: IconKey,
  decrypt: IconDatabase,
  store: IconArchive,
  conversation: IconUsers,
  export: IconDownload
}
