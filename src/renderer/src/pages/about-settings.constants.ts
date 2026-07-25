/**
 * AboutSettings 常量 / 类型 / 工具函数
 *
 * 从 AboutSettings.tsx 抽取，保证主组件文件 ≤ 500 行（单文件硬约束）。
 *
 * 包含：
 * - APP_VERSION / APP_BUILD_LABEL / APP_BUILD_TIME / APP_INSTALL_PATH 常量
 * - LINK_URLS / LINK_CARDS / FOOTER_LINKS 静态数据
 * - SysInfoItem / LinkCard / FooterLink interface
 * - detectRuntimeEnv() / detectOsName() 运行时环境探测函数
 *
 * 数据来源说明：
 * - APP_VERSION：与 package.json version 对齐
 * - APP_BUILD_TIME / APP_INSTALL_PATH：暂用设计稿示例值占位，
 *   后续接入 Vite define 注入或 IPC 通道（app:get-build-info）后替换为真实值
 *   （设计稿示例数据豁免 mock 数据禁令）
 * - Electron / Chromium 版本：从 navigator.userAgent 解析（运行时真实值）
 * - 操作系统：从 navigator.userAgent 解析
 */
import {
  FileText,
  Scale,
  MessageCircle,
  Shield,
  ListChecks,
  type LucideIcon,
} from 'lucide-react'

// ============================================================================
// 类型定义
// ============================================================================

export interface SysInfoItem {
  key: string
  value: string
  isLink?: boolean
}

export interface LinkCard {
  id: string
  icon: LucideIcon
  title: string
  desc: string
  url: string
}

export interface FooterLink {
  label: string
  url?: string
}

// ============================================================================
// 应用版本 / 构建信息常量
// ============================================================================

/**
 * 飞书问卷链接（产品调研 + 用户反馈）
 *
 * 制作教程：docs/guides/feishu-survey-guide.md
 * 火山杯 2026 比赛期间收集用户反馈与产品改进建议。
 *
 * TODO: 用户提供 URL 后填入下方（确保以 https:// 开头）
 */
export const FEISHU_FEEDBACK_URL = 'https://www.feishu.cn/forms/PLACEHOLDER_REPLACE_ME'

/** 应用版本（与 package.json version 对齐） */
export const APP_VERSION = '1.0.0'

/** 应用构建标识（展示在 Hero 第 1 个 Badge） */
export const APP_BUILD_LABEL = `v${APP_VERSION}`

/**
 * 应用构建时间（展示在 Hero 第 3 个 Badge + SysInfo「构建时间」行）
 *
 * 暂用设计稿示例值占位（settings-about.html line 551: 2026-07-18 14:32），
 * 后续接入 Vite define 注入 `__BUILD_TIME__` 或 IPC 通道后替换为真实值。
 */
export const APP_BUILD_TIME = '2026-07-18 14:32'

/** 应用构建 Badge 标签（Hero 第 3 个 Badge，格式：Build YYYY.MM.DD） */
export const APP_BUILD_BADGE = 'Build 2026.07.18'

/**
 * 应用安装路径（展示在 SysInfo「安装路径」行）
 *
 * 暂用设计稿示例值占位（settings-about.html line 567: C:\Program Files\TDSF），
 * 后续接入 IPC 通道（如 app:get-install-path）后替换为真实值。
 */
export const APP_INSTALL_PATH = 'C:\\Program Files\\TDSF'

// ============================================================================
// 链接 URL / 链接卡片 / 页脚链接
// ============================================================================

export const LINK_URLS = {
  home: 'https://harryopo.github.io/tdsf-linux-desktop/',
  github: 'https://github.com/harryopo/tdsf-linux-desktop',
  docs: 'https://github.com/harryopo/tdsf-linux-desktop/blob/master/README.md',
  feedback: 'https://github.com/harryopo/tdsf-linux-desktop/issues/new/choose',
  changelog: 'https://github.com/harryopo/tdsf-linux-desktop/blob/master/CHANGELOG.md',
  releases: 'https://github.com/harryopo/tdsf-linux-desktop/releases',
  privacy:
    'https://github.com/harryopo/tdsf-linux-desktop/blob/master/LICENSE',
  contribute: 'https://github.com/harryopo/tdsf-linux-desktop/blob/master/CONTRIBUTING.md',
  survey: FEISHU_FEEDBACK_URL,
} as const

export const LINK_CARDS: LinkCard[] = [
  {
    id: 'docs',
    icon: FileText,
    title: '在线文档',
    desc: '使用手册 / API 参考 / 架构说明',
    url: LINK_URLS.docs,
  },
  {
    id: 'opensource',
    icon: Scale,
    title: '开源许可',
    desc: 'MIT License + 第三方依赖致谢',
    url: LINK_URLS.github,
  },
  {
    id: 'feedback',
    icon: MessageCircle,
    title: '问题反馈 (GitHub)',
    desc: '提交 Bug 报告或功能建议',
    url: LINK_URLS.feedback,
  },
  {
    id: 'survey',
    icon: ListChecks,
    title: '产品调研问卷',
    desc: '飞书问卷 · 2 分钟 · 助力产品迭代',
    url: LINK_URLS.survey,
  },
  {
    id: 'privacy',
    icon: Shield,
    title: '隐私政策',
    desc: '数据收集与使用说明（MIT 开源）',
    url: LINK_URLS.privacy,
  },
]

export const FOOTER_LINKS: FooterLink[] = [
  { label: '服务条款', url: LINK_URLS.docs },
  { label: '贡献指南', url: LINK_URLS.contribute },
  { label: '问题反馈', url: LINK_URLS.feedback },
  { label: '产品调研', url: LINK_URLS.survey },
  { label: '致谢' },
]

// ============================================================================
// 运行时环境探测函数
// ============================================================================

/** 解析 navigator.userAgent → 运行环境字符串 */
export function detectRuntimeEnv(): string {
  if (typeof navigator === 'undefined') return 'Electron / Chromium (unknown)'
  const ua = navigator.userAgent
  const electronMatch = ua.match(/Electron\/([\d.]+)/)
  const chromeMatch = ua.match(/Chrome\/([\d.]+)/)
  const electronVer = electronMatch?.[1] ?? 'unknown'
  const chromeVer = chromeMatch?.[1] ?? 'unknown'
  return `Electron ${electronVer} / Chromium ${chromeVer}`
}

/** 解析 navigator.userAgent → 操作系统名称 */
export function detectOsName(): string {
  if (typeof navigator === 'undefined') return 'unknown'
  const ua = navigator.userAgent
  const platform = navigator.platform || ''
  // Windows
  if (ua.includes('Windows NT 10.0')) return `Windows 10/11 (${platform || 'x64'})`
  if (ua.includes('Windows')) return `Windows (${platform || 'x64'})`
  // macOS
  if (ua.includes('Mac OS X')) {
    const macMatch = ua.match(/Mac OS X ([\d_]+)/)
    const macVer = macMatch?.[1]?.replace(/_/g, '.') ?? 'unknown'
    return `macOS ${macVer}`
  }
  // Linux
  if (ua.includes('Linux')) return `Linux (${platform || 'x64'})`
  return platform || 'unknown'
}
