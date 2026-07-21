/**
 * TRAE 图标系统 · CSS mask 渲染
 *
 * 设计稿源文件：tdsf-linux-redesign/assets/icons/dl_builtin_trae/*.svg (121 个)
 * 复制到：src/renderer/src/assets/icons/trae/*.svg
 *
 * 渲染方案：CSS mask + background-image
 *   - SVG 内部 stroke/fill 颜色不影响最终显示
 *   - 最终颜色由 `backgroundColor` 决定（默认 `currentColor`，跟随父节点 `color` 属性）
 *   - 主题切换时只需修改父节点 `color`，图标颜色自动跟随
 *
 * 使用方式：
 *   import { TraeIcon, HomeIcon } from '@/components/trae/icons'
 *   <TraeIcon name="home" size={16} />
 *   <HomeIcon size={20} color="var(--trae-text-primary)" />
 *
 * Spec: build-runnable-tdsf-from-design · Task 1.3
 */
import type { CSSProperties, FC } from 'react'

// 10 个常用图标的 SVG URL（Vite `?url` 后缀导入，类型由 `vite/client` 提供）
import homeUrl from '@/assets/icons/trae/home.svg?url'
import settingsUrl from '@/assets/icons/trae/settings.svg?url'
import shieldUrl from '@/assets/icons/trae/shield.svg?url'
import cpuUrl from '@/assets/icons/trae/cpu.svg?url'
import fileUrl from '@/assets/icons/trae/file.svg?url'
import folderUrl from '@/assets/icons/trae/folder.svg?url'
import terminalUrl from '@/assets/icons/trae/terminal.svg?url'
import playUrl from '@/assets/icons/trae/play.svg?url'
import sendUrl from '@/assets/icons/trae/send.svg?url'
import sparklesUrl from '@/assets/icons/trae/sparkles.svg?url'

/** 支持的图标名（由 iconMap 键推导） */
export type TraeIconName =
  | 'home'
  | 'settings'
  | 'shield'
  | 'cpu'
  | 'file'
  | 'folder'
  | 'terminal'
  | 'play'
  | 'send'
  | 'sparkles'

/** 图标名 → SVG URL 映射 */
const iconMap: Record<TraeIconName, string> = {
  home: homeUrl,
  settings: settingsUrl,
  shield: shieldUrl,
  cpu: cpuUrl,
  file: fileUrl,
  folder: folderUrl,
  terminal: terminalUrl,
  play: playUrl,
  send: sendUrl,
  sparkles: sparklesUrl,
}

export interface TraeIconProps {
  /** 图标名（来自 TraeIconName 联合类型） */
  name: TraeIconName
  /** 尺寸（px 或 CSS 长度字符串），默认 16 */
  size?: number | string
  /** 颜色（CSS 颜色值或 'currentColor'），默认 'currentColor' 跟随父节点 color */
  color?: string
  /** 自定义 className */
  className?: string
  /** 自定义内联样式（会与 mask 样式合并，调用方可覆盖） */
  style?: CSSProperties
  /** 无障碍标签（不传则不输出 aria-label） */
  'aria-label'?: string
}

/**
 * 通用 TRAE 图标组件
 *
 * 通过 CSS mask 渲染 SVG，颜色由 `backgroundColor` 控制。
 * 默认 `color='currentColor'`，图标颜色跟随父节点 `color` 属性，实现主题切换。
 */
export const TraeIcon: FC<TraeIconProps> = ({
  name,
  size = 16,
  color = 'currentColor',
  className,
  style,
  'aria-label': ariaLabel,
}) => {
  const url = iconMap[name]
  if (!url) return null

  const maskImage = `url(${url})`

  const mergedStyle: CSSProperties = {
    display: 'inline-block',
    width: size,
    height: size,
    backgroundColor: color,
    maskImage,
    WebkitMaskImage: maskImage,
    maskSize: 'contain',
    WebkitMaskSize: 'contain',
    maskRepeat: 'no-repeat',
    WebkitMaskRepeat: 'no-repeat',
    maskPosition: 'center',
    WebkitMaskPosition: 'center',
    ...style,
  }

  return (
    <span
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
      className={className}
      style={mergedStyle}
    />
  )
}

/**
 * 10 个常用图标快捷组件
 * 等价于 `<TraeIcon name="xxx" />`，调用方无需传 name
 */
type IconShortcutProps = Omit<TraeIconProps, 'name'>

export const HomeIcon: FC<IconShortcutProps> = (props) => <TraeIcon name="home" {...props} />
export const SettingsIcon: FC<IconShortcutProps> = (props) => (
  <TraeIcon name="settings" {...props} />
)
export const ShieldIcon: FC<IconShortcutProps> = (props) => <TraeIcon name="shield" {...props} />
export const CpuIcon: FC<IconShortcutProps> = (props) => <TraeIcon name="cpu" {...props} />
export const FileIcon: FC<IconShortcutProps> = (props) => <TraeIcon name="file" {...props} />
export const FolderIcon: FC<IconShortcutProps> = (props) => <TraeIcon name="folder" {...props} />
export const TerminalIcon: FC<IconShortcutProps> = (props) => (
  <TraeIcon name="terminal" {...props} />
)
export const PlayIcon: FC<IconShortcutProps> = (props) => <TraeIcon name="play" {...props} />
export const SendIcon: FC<IconShortcutProps> = (props) => <TraeIcon name="send" {...props} />
export const SparklesIcon: FC<IconShortcutProps> = (props) => (
  <TraeIcon name="sparkles" {...props} />
)

export default TraeIcon
