/**
 * AboutSettings 常量 / 类型 / 工具函数
 *
 * 只放"真实存在的东西"：链接全部指向仓库里确有的文件，取不到的值显示"未获取到"，
 * 不再放设计稿示例值占位（以前这里写着 2026-07-18 构建、C:\Program Files\TDSF、
 * 一个 PLACEHOLDER 问卷地址和一个不存在的官网域名，界面上看起来都是真的）。
 */
import { FileText, Scale, MessageCircle, Tag, type LucideIcon } from 'lucide-react'
import type { DbTableGrowth } from '@shared/db-types'
import { GITHUB_REPO_URL } from '@shared/repo-identity'

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

/**
 * 仓库地址取自单源 `@shared/repo-identity`。
 *
 * 以前这里和 `src/main/ipc/app-update.ts` 各写一份仓库名，两份还写得不一样
 * （一份 harryopo、一份 tdsf-linux），于是"检查更新"去问了一个不存在的仓库。
 */
const REPO = GITHUB_REPO_URL

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

/**
 * #94 只增表体积台账的显示口径。
 *
 * 关键约定：rows=null（读不到）绝不能显示成 "0 条"。
 * 空表是真·0 条，读失败是故障，两者在界面上必须长得不一样。
 */
export interface GrowthRowView {
  /** 右侧的值：条数 / "读不到" */
  value: string
  /** 下方说明：保留策略 + 最早一条 + 失败原因 */
  desc: string
  /** 读数是否可信（false 时右侧打警告色） */
  ok: boolean
}

/** 字节 → 人类可读；null = 内存库或 stat 失败 */
export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return '未知'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i += 1
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[i]}`
}

/** 时间戳 → 本地短日期；null 返回空串（调用方决定要不要拼这句） */
export function formatDay(ts: number | null): string {
  if (ts === null || !Number.isFinite(ts)) return ''
  return new Date(ts).toLocaleDateString('zh-CN')
}

/** 一张表的读数 → 界面两行文案 */
export function describeGrowthRow(t: DbTableGrowth): GrowthRowView {
  const keep = t.retentionDays === null ? '不会自动清理' : `保留 ${t.retentionDays} 天`
  if (t.rows === null) {
    return { value: '读不到', desc: `${keep} · 读取失败：${t.error ?? '未知原因'}`, ok: false }
  }
  const first = formatDay(t.oldestAt)
  return {
    value: `${t.rows} 条`,
    desc: first ? `${keep} · 最早一条 ${first}` : `${keep} · 目前是空的`,
    ok: true,
  }
}
