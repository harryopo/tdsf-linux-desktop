/**
 * AboutSettings 常量 / 类型 / 工具函数
 *
 * 只放"真实存在的东西"：链接全部指向仓库里确有的文件，取不到的值显示"未获取到"，
 * 不再放设计稿示例值占位（以前这里写着 2026-07-18 构建、C:\Program Files\TDSF、
 * 一个 PLACEHOLDER 问卷地址和一个不存在的官网域名，界面上看起来都是真的）。
 */
import { FileText, Scale, MessageCircle, Tag, type LucideIcon } from 'lucide-react'

export interface InfoRow {
  key: string
  value: string
  /** 值是外链时按链接渲染 */
  isLink?: boolean
  /** 值用等宽字体（路径、版本号） */
  mono?: boolean
}

export interface LinkCard {
  id: string
  icon: LucideIcon
  title: string
  desc: string
  url: string
}

/** 应用版本兜底（与 package.json version 对齐；真实值来自 IPC app:get-info） */
export const APP_VERSION = '1.0.0'

/** IPC 不可用时的显示值：说清为什么没有，而不是编一个 */
export const NOT_AVAILABLE = '未获取到（非 Electron 运行环境）'

const REPO = 'https://github.com/harryopo/tdsf-linux-desktop'

export const LINK_URLS = {
  github: REPO,
  docs: `${REPO}/blob/master/README.md`,
  feedback: `${REPO}/issues/new/choose`,
  changelog: `${REPO}/blob/master/CHANGELOG.md`,
  releases: `${REPO}/releases`,
  contribute: `${REPO}/blob/master/CONTRIBUTING.md`,
  license: `${REPO}/blob/master/LICENSE`,
} as const

/** 资源入口：每一条都对应仓库里真实存在的文件 */
export const LINK_CARDS: LinkCard[] = [
  { id: 'docs', icon: FileText, title: '使用文档', desc: 'README · 安装与功能说明', url: LINK_URLS.docs },
  { id: 'releases', icon: Tag, title: '发布记录', desc: 'Releases · 各版本更新内容', url: LINK_URLS.releases },
  { id: 'feedback', icon: MessageCircle, title: '问题反馈', desc: '提交 Bug 报告或功能建议', url: LINK_URLS.feedback },
  { id: 'license', icon: Scale, title: '开源许可', desc: 'MIT License · 可自由使用与修改', url: LINK_URLS.license },
]

/** 解析 navigator.userAgent → 运行环境字符串（Electron / Chromium 真实版本） */
export function detectRuntimeEnv(): string {
  if (typeof navigator === 'undefined') return NOT_AVAILABLE
  const ua = navigator.userAgent
  const electronVer = ua.match(/Electron\/([\d.]+)/)?.[1] ?? 'unknown'
  const chromeVer = ua.match(/Chrome\/([\d.]+)/)?.[1] ?? 'unknown'
  const nodeVer = ua.match(/node\/([\d.]+)/i)?.[1]
  return `Electron ${electronVer} / Chromium ${chromeVer}${nodeVer ? ` / Node ${nodeVer}` : ''}`
}

/** 解析 navigator.userAgent → 操作系统（Windows 上 navigator.platform 恒为 Win32，写出来只会误导） */
export function detectOsName(): string {
  if (typeof navigator === 'undefined') return NOT_AVAILABLE
  const ua = navigator.userAgent
  if (ua.includes('Windows NT 10.0')) return 'Windows 10 / 11'
  if (ua.includes('Windows NT')) return `Windows (${ua.match(/Windows NT ([\d.]+)/)?.[1] ?? 'unknown'})`
  if (ua.includes('Windows')) return 'Windows'
  if (ua.includes('Mac OS X')) {
    return `macOS ${ua.match(/Mac OS X ([\d_]+)/)?.[1]?.replace(/_/g, '.') ?? 'unknown'}`
  }
  if (ua.includes('Linux')) return `Linux (${navigator.platform || 'unknown'})`
  return navigator.platform || 'unknown'
}
