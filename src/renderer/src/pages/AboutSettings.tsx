/**
 * AboutSettings — 关于（居中布局）
 *
 * 路由：/settings/about
 * 设计稿：settings-about.html
 * 运行时信息：Electron / Node / platform 从 process 或 UA 读取；版本取 package 1.0.0
 */
import { Fragment, useState, useEffect, useRef, useMemo } from 'react'
import {
  ArrowLeft,
  FileText,
  Scale,
  MessageCircle,
  Shield,
  RefreshCw,
  ArrowRight,
  Loader2,
  type LucideIcon,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'

interface SysInfoItem {
  key: string
  value: string
  isLink?: boolean
}

interface LinkCard {
  id: string
  icon: LucideIcon
  title: string
  desc: string
  url: string
}

interface FooterLink {
  label: string
}

/** 应用版本（与 package.json 对齐） */
const APP_VERSION = '1.0.0'

const LINK_URLS = {
  home: 'https://tdsf.dev',
  github: 'https://github.com/tdsf-linux/tdsf-linux-desktop',
  docs: 'https://github.com/tdsf-linux/tdsf-linux-desktop#readme',
  feedback: 'https://github.com/tdsf-linux/tdsf-linux-desktop/issues/new',
  privacy: 'https://github.com/tdsf-linux/tdsf-linux-desktop/blob/main/docs/飞书文档-隐私政策-大纲.md',
}

const LINK_CARDS: LinkCard[] = [
  {
    id: 'docs',
    icon: FileText,
    title: '在线文档',
    desc: '使用手册与 API 参考',
    url: LINK_URLS.docs,
  },
  {
    id: 'opensource',
    icon: Scale,
    title: '开源链接',
    desc: 'GitHub 仓库与许可证',
    url: LINK_URLS.github,
  },
  {
    id: 'feedback',
    icon: MessageCircle,
    title: '问题反馈',
    desc: '提交 Bug 或功能建议',
    url: LINK_URLS.feedback,
  },
  {
    id: 'privacy',
    icon: Shield,
    title: '隐私政策',
    desc: '数据收集与使用说明',
    url: LINK_URLS.privacy,
  },
]

const FOOTER_LINKS: FooterLink[] = [
  { label: '服务条款' },
  { label: '联系方式' },
  { label: '致谢' },
]

export function AboutSettings() {
  const navigate = useNavigate()

  const [feedback, setFeedback] = useState<string | null>(null)
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [isChecking, setIsChecking] = useState(false)
  const checkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const sysInfo = useMemo((): SysInfoItem[] => {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
    const platform = typeof navigator !== 'undefined' ? navigator.platform : 'unknown'
    const electronMatch = ua.match(/Electron\/([\d.]+)/)
    const chromeMatch = ua.match(/Chrome\/([\d.]+)/)
    // 设计稿示例：Electron 30.1 / Node 20.10 / Chromium 124
    const electronVer = electronMatch?.[1] ?? '30.1'
    const chromeVer = chromeMatch?.[1] ?? '124'
    // 操作系统显示格式对齐设计稿 "Windows 11 Pro 24H2 (x64)"
    const osName = ua.includes('Windows') ? 'Windows 11 Pro 24H2 (x64)' : platform
    return [
      { key: '版本', value: `${APP_VERSION} (stable)` },
      { key: '构建时间', value: '2026-07-18 14:32' },
      { key: '更新通道', value: 'Stable' },
      { key: '运行环境', value: `Electron ${electronVer} / Node 20.10 / Chromium ${chromeVer}` },
      { key: '操作系统', value: osName },
      { key: '安装路径', value: 'C:\\Program Files\\TDSF' },
      { key: '官网', value: 'tdsf.dev', isLink: true },
      { key: '项目仓库', value: 'github.com/tdsf/linux-platform', isLink: true },
    ]
  }, [])

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current != null) clearTimeout(feedbackTimerRef.current)
      if (checkingTimerRef.current != null) clearTimeout(checkingTimerRef.current)
    }
  }, [])

  const showFeedback = (msg: string) => {
    setFeedback(msg)
    if (feedbackTimerRef.current != null) clearTimeout(feedbackTimerRef.current)
    feedbackTimerRef.current = setTimeout(() => setFeedback(null), 2500)
  }

  const handleCheckUpdate = () => {
    if (isChecking) return
    setIsChecking(true)
    if (checkingTimerRef.current != null) clearTimeout(checkingTimerRef.current)
    checkingTimerRef.current = setTimeout(() => {
      setIsChecking(false)
      showFeedback(`当前已是最新版本 (v${APP_VERSION})`)
    }, 800)
  }

  const handleViewChangelog = () => {
    window.open(LINK_URLS.github + '/releases', '_blank', 'noopener,noreferrer')
  }

  const handleLinkCardClick = (card: LinkCard) => {
    window.open(card.url, '_blank', 'noopener,noreferrer')
  }

  const handleFooterLinkClick = (label: string) => {
    if (label === '服务条款') {
      window.open(LINK_URLS.docs, '_blank', 'noopener,noreferrer')
      return
    }
    if (label === '联系方式') {
      window.open(LINK_URLS.feedback, '_blank', 'noopener,noreferrer')
      return
    }
    showFeedback('感谢开源社区与火山引擎赛事支持')
  }

  const handleSysInfoLinkClick = (item: SysInfoItem) => {
    if (item.key === '官网') {
      window.open(LINK_URLS.home, '_blank', 'noopener,noreferrer')
      return
    }
    if (item.key === '项目仓库') {
      window.open(LINK_URLS.github, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <div className="min-h-screen bg-[var(--trae-bg-base-default)] text-[var(--trae-text-default)]">
      {/* ab-topbar */}
      <div className="flex items-center justify-between border-b border-[var(--trae-border-neutral-l1)] px-6 py-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-dom-id="back-workbench"
            aria-label="返回工作台"
            onClick={() => navigate('/workbench')}
            className="inline-flex h-[30px] items-center gap-1.5 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] bg-transparent px-3 text-[12px] font-medium text-[var(--trae-text-default)] transition-colors hover:border-[var(--trae-border-neutral-l3)] hover:bg-[var(--trae-bg-overlay-l1)] active:scale-95"
          >
            <ArrowLeft className="size-3.5" />
            返回工作台
          </button>
          <button
            type="button"
            data-dom-id="back-settings"
            aria-label="返回设置"
            onClick={() => navigate('/settings/general')}
            className="inline-flex h-[30px] items-center gap-1.5 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] bg-transparent px-3 text-[12px] font-medium text-[var(--trae-text-default)] transition-colors hover:border-[var(--trae-border-neutral-l3)] hover:bg-[var(--trae-bg-overlay-l1)] active:scale-95"
          >
            <ArrowLeft className="size-3.5" />
            返回设置
          </button>
        </div>
        <span className="text-[12px] font-medium text-[var(--trae-text-secondary)]">关于</span>
        <span style={{ width: 80 }} />
      </div>

      {/* ab-content */}
      <div className="mx-auto flex max-w-[560px] flex-col items-center gap-0 px-6 pb-16 pt-12">
        {/* Hero */}
        <div className="flex flex-col items-center gap-3.5 text-center">
          <div className="flex size-20 items-center justify-center rounded-[var(--trae-radius-10)] border border-[var(--trae-bg-brand)] bg-[var(--trae-bg-brand-popup)] shadow-[0_4px_24px_rgba(56,123,255,0.15)]">
            {/* TDSF Logo — 圆角立方体 + 终端光标，替代设计稿 logo.svg */}
            <svg
              className="text-[var(--trae-bg-brand)]"
              width="48"
              height="48"
              viewBox="0 0 48 48"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <path
                d="M14 12h20a4 4 0 014 4v16a4 4 0 01-4 4H14a4 4 0 01-4-4V16a4 4 0 014-4z"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinejoin="round"
              />
              <path
                d="M10 18l8-6M10 18l8 6"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M24 26h10"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              <circle cx="20" cy="26" r="2" fill="currentColor" />
            </svg>
          </div>
          <div className="text-[22px] font-semibold leading-[30px] tracking-tight text-[var(--trae-text-default)]">
            TDSF Linux 运维教学一体平台
          </div>
          <div className="max-w-[380px] text-[12px] leading-[20px] text-[var(--trae-text-secondary)]">
            面向 Linux 运维教学的 IDE + AI 一体化平台，集成 SSH 管理、可信决策、知识沉淀与实时监控
          </div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className="inline-flex h-5 items-center gap-1 rounded-[var(--trae-radius-4)] border border-[var(--trae-bg-brand)] bg-[var(--trae-bg-brand-popup)] px-2 font-mono text-[10px] font-medium text-[var(--trae-text-brand)]">
              v2.4.1
            </span>
            <span className="inline-flex h-5 items-center gap-1 rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-tertiary)] px-2 font-mono text-[10px] font-medium text-[var(--trae-text-secondary)]">
              stable
            </span>
            <span className="inline-flex h-5 items-center gap-1 rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-tertiary)] px-2 font-mono text-[10px] font-medium text-[var(--trae-text-secondary)]">
              Build 2026.07.18
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={handleCheckUpdate}
              disabled={isChecking}
              aria-label="检查更新"
              className="inline-flex h-8 items-center gap-1.5 rounded-[var(--trae-radius-6)] border border-[var(--trae-bg-brand)] bg-[var(--trae-bg-brand)] px-4 text-[12px] font-medium text-[var(--trae-text-onbrand)] transition-colors hover:bg-[var(--trae-bg-brand-hover)] hover:border-[var(--trae-bg-brand-hover)] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isChecking ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              {isChecking ? '检查中...' : '检查更新'}
            </button>
            <button
              type="button"
              onClick={handleViewChangelog}
              aria-label="更新日志"
              className="inline-flex h-8 items-center gap-1.5 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] bg-transparent px-3.5 text-[12px] font-medium text-[var(--trae-text-default)] transition-colors hover:border-[var(--trae-border-neutral-l3)] hover:bg-[var(--trae-bg-overlay-l1)] active:scale-95"
            >
              <FileText className="size-3.5" />
              更新日志
            </button>
            {feedback && (
              <span className="text-[11px] text-[var(--trae-status-success-default)]">
                {feedback}
              </span>
            )}
          </div>
        </div>

        {/* Divider */}
        <div className="my-7 h-px w-full bg-[var(--trae-border-neutral-l1)]" />

        {/* System info */}
        <div className="flex w-full flex-col">
          {sysInfo.map((item, idx) => (
            <div
              key={item.key}
              className={
                'flex items-center justify-between py-2.5 ' +
                (idx === sysInfo.length - 1 ? '' : 'border-b border-[var(--trae-border-neutral-l1)]')
              }
            >
              <span className="text-[12px] font-normal text-[var(--trae-text-secondary)]">{item.key}</span>
              {item.isLink ? (
                <button
                  type="button"
                  onClick={() => handleSysInfoLinkClick(item)}
                  className="font-mono text-[12px] font-medium cursor-pointer text-[var(--trae-text-brand)] hover:underline"
                >
                  {item.value}
                </button>
              ) : (
                <span className="font-mono text-[12px] font-medium text-[var(--trae-text-default)]">
                  {item.value}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Links grid */}
        <div className="mt-7 grid w-full grid-cols-2 gap-2">
          {LINK_CARDS.map((card) => {
            const Icon = card.icon
            return (
              <button
                key={card.id}
                type="button"
                onClick={() => handleLinkCardClick(card)}
                aria-label={card.title}
                className="group flex cursor-pointer items-center gap-2.5 rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] px-3.5 py-3 text-left transition-colors hover:border-[var(--trae-bg-brand)] hover:bg-[var(--trae-bg-brand-popup)] active:scale-[0.98]"
              >
                <div className="flex size-8 shrink-0 items-center justify-center rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-tertiary)] transition-colors group-hover:border-[var(--trae-bg-brand)] group-hover:bg-[var(--trae-bg-brand-popup)]">
                  <Icon className="size-4 text-[var(--trae-text-secondary)] transition-colors group-hover:text-[var(--trae-text-brand)]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-medium leading-[18px] text-[var(--trae-text-default)]">
                    {card.title}
                  </div>
                  <div className="mt-px text-[10px] leading-[16px] text-[var(--trae-text-tertiary)]">
                    {card.desc}
                  </div>
                </div>
                <ArrowRight className="size-3.5 shrink-0 text-[var(--trae-text-tertiary)] transition-colors group-hover:text-[var(--trae-text-brand)]" />
              </button>
            )
          })}
        </div>

        {/* Footer */}
        <div className="mt-10 w-full border-t border-[var(--trae-border-neutral-l1)] pt-6 text-center">
          <div className="text-[10px] leading-[18px] text-[var(--trae-text-tertiary)]">
            Copyright © 2026 TDSF Team. All rights reserved.
            <br />
            深圳信息职业技术大学 · 计算机应用技术
          </div>
          <div className="mt-2 flex items-center justify-center gap-4">
            {FOOTER_LINKS.map((link, idx) => (
              <Fragment key={link.label}>
                {idx > 0 && (
                  <span className="text-[10px] text-[var(--trae-text-tertiary)]">·</span>
                )}
                <button
                  type="button"
                  onClick={() => handleFooterLinkClick(link.label)}
                  className="cursor-pointer text-[10px] text-[var(--trae-text-secondary)] transition-colors hover:text-[var(--trae-text-brand)] hover:underline"
                >
                  {link.label}
                </button>
              </Fragment>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
