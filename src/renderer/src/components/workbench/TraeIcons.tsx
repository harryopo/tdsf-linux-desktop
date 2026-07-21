/**
 * TraeIcons — 设计稿 dl_builtin_trae 自定义图标（内联 SVG）
 *
 * 设计稿源文件位于：tdsf-linux-redesign/assets/icons/dl_builtin_trae/
 * 为避免引入 vite-plugin-svgr 依赖，将关键图标直接内联为 React 组件。
 * 所有图标 viewBox="0 0 24 24"，尺寸由调用方通过 className 控制。
 */
import type { FC, SVGProps } from 'react'

interface IconProps extends SVGProps<SVGSVGElement> {
  className?: string
}

const baseStroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'butt' as const,
  strokeLinejoin: 'miter' as const,
}

/** home.svg */
export const TraeHomeIcon: FC<IconProps> = ({ className, ...rest }) => (
  <svg className={className} viewBox="0 0 24 24" {...rest}>
    <polygon points="3 11 12 3 21 11 21 21 14 21 14 14 10 14 10 21 3 21 3 11" {...baseStroke} />
  </svg>
)

/** scroll-text.svg */
export const TraeScrollTextIcon: FC<IconProps> = ({ className, ...rest }) => (
  <svg className={className} viewBox="0 0 24 24" {...rest}>
    <path d="M5 4h11a3 3 0 0 1 3 3v10H8v3a1 1 0 0 1-1 1 3 3 0 0 1-3-3V7a3 3 0 0 1 1-3z" {...baseStroke} />
    <line x1="9" y1="9" x2="15" y2="9" {...baseStroke} />
    <line x1="9" y1="13" x2="15" y2="13" {...baseStroke} />
  </svg>
)

/** shield.svg */
export const TraeShieldIcon: FC<IconProps> = ({ className, ...rest }) => (
  <svg className={className} viewBox="0 0 24 24" {...rest}>
    <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" {...baseStroke} />
  </svg>
)

/** dashboard.svg */
export const TraeDashboardIcon: FC<IconProps> = ({ className, ...rest }) => (
  <svg className={className} viewBox="0 0 24 24" {...rest}>
    <rect x="3" y="3" width="7" height="9" {...baseStroke} />
    <rect x="14" y="3" width="7" height="5" {...baseStroke} />
    <rect x="14" y="12" width="7" height="9" {...baseStroke} />
    <rect x="3" y="16" width="7" height="5" {...baseStroke} />
  </svg>
)

/** layers.svg */
export const TraeLayersIcon: FC<IconProps> = ({ className, ...rest }) => (
  <svg className={className} viewBox="0 0 24 24" {...rest}>
    <polygon points="12 3 22 8 12 13 2 8 12 3" {...baseStroke} />
    <polyline points="2 13 12 18 22 13" {...baseStroke} />
  </svg>
)

/** clock.svg */
export const TraeClockIcon: FC<IconProps> = ({ className, ...rest }) => (
  <svg className={className} viewBox="0 0 24 24" {...rest}>
    <circle cx="12" cy="12" r="9" {...baseStroke} />
    <polyline points="12 7 12 12 16 14" {...baseStroke} />
  </svg>
)

/** file-text.svg */
export const TraeFileTextIcon: FC<IconProps> = ({ className, ...rest }) => (
  <svg className={className} viewBox="0 0 24 24" {...rest}>
    <path d="M14 3H6v18h12V8z" {...baseStroke} />
    <polyline points="14 3 14 8 18 8" {...baseStroke} />
    <line x1="9" y1="13" x2="15" y2="13" {...baseStroke} />
    <line x1="9" y1="17" x2="15" y2="17" {...baseStroke} />
  </svg>
)

/** settings.svg */
export const TraeSettingsIcon: FC<IconProps> = ({ className, ...rest }) => (
  <svg className={className} viewBox="0 0 24 24" {...rest}>
    <circle cx="12" cy="12" r="3" {...baseStroke} />
    <path
      d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"
      {...baseStroke}
    />
  </svg>
)

/** layout.svg */
export const TraeLayoutIcon: FC<IconProps> = ({ className, ...rest }) => (
  <svg className={className} viewBox="0 0 24 24" {...rest}>
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" {...baseStroke} />
    <line x1="3" y1="9" x2="21" y2="9" {...baseStroke} />
    <line x1="9" y1="21" x2="9" y2="9" {...baseStroke} />
  </svg>
)

/** terminal.svg */
export const TraeTerminalIcon: FC<IconProps> = ({ className, ...rest }) => (
  <svg className={className} viewBox="0 0 24 24" {...rest}>
    <polyline points="4 17 10 11 4 5" {...baseStroke} />
    <line x1="12" y1="19" x2="20" y2="19" {...baseStroke} />
  </svg>
)

/** sparkles.svg */
export const TraeSparklesIcon: FC<IconProps> = ({ className, ...rest }) => (
  <svg className={className} viewBox="0 0 24 24" {...rest}>
    <path d="m12 3-1.5 6.5L4 11l6.5 1.5L12 19l1.5-6.5L20 11l-6.5-1.5z" {...baseStroke} />
  </svg>
)

/** server.svg（双矩形 + 圆点） */
export const TraeServerIcon: FC<IconProps> = ({ className, ...rest }) => (
  <svg className={className} viewBox="0 0 24 24" {...rest}>
    <rect x="2" y="2" width="20" height="8" rx="2" ry="2" {...baseStroke} />
    <rect x="2" y="14" width="20" height="8" rx="2" ry="2" {...baseStroke} />
    <line x1="6" y1="6" x2="6.01" y2="6" {...baseStroke} />
    <line x1="6" y1="18" x2="6.01" y2="18" {...baseStroke} />
  </svg>
)
