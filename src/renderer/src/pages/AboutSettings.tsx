/**
 * AboutSettings — 关于（居中布局，嵌套在 SettingsLayout 内）
 * 路由：/settings/about | 设计稿：settings-about.html
 *
 * spec DEC-4 要求 9 个设置子页面统一左导航，本组件嵌套在 SettingsLayout 内：
 * 删除独立 ab-topbar，保留 Hero + Divider + SysInfo + Links grid + Footer。
 * 视觉：var(--trae-*) token；无障碍：button type + aria-label。
 * 常量 / 类型 / 探测函数：见 about-settings.constants.ts
 */
import { Fragment, useState, useEffect, useRef, useMemo } from 'react'
import { RefreshCw, ArrowRight, Loader2, FileText } from 'lucide-react'
import {
  APP_VERSION, APP_BUILD_LABEL, APP_BUILD_BADGE, APP_BUILD_TIME, APP_INSTALL_PATH,
  LINK_URLS, LINK_CARDS, FOOTER_LINKS,
  detectRuntimeEnv, detectOsName,
  type SysInfoItem, type LinkCard, type FooterLink,
} from './about-settings.constants'

interface BadgeConfig {
  label: string
  variant: 'brand' | 'neutral'
}

/** Hero Badge 配置（3 个：版本 + stable + 构建标识） */
const HERO_BADGES: BadgeConfig[] = [
  { label: APP_BUILD_LABEL, variant: 'brand' },
  { label: 'stable', variant: 'neutral' },
  { label: APP_BUILD_BADGE, variant: 'neutral' },
]

export function AboutSettings() {
  const [feedback, setFeedback] = useState<string | null>(null)
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [isChecking, setIsChecking] = useState(false)
  const checkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const sysInfo = useMemo<SysInfoItem[]>(() => {
    return [
      { key: '版本', value: `${APP_VERSION} (stable)` },
      { key: '构建时间', value: APP_BUILD_TIME },
      { key: '更新通道', value: 'Stable' },
      { key: '运行环境', value: detectRuntimeEnv() },
      { key: '操作系统', value: detectOsName() },
      { key: '安装路径', value: APP_INSTALL_PATH },
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

  /**
   * 检查更新：本地 UI 反馈
   * 当前未接入 electron-updater 真实检查逻辑（需 IPC 通道 + 配置发布源），
   * 此处仅基于本地 APP_VERSION 提供 UI 状态反馈，避免引入 mock 数据。
   */
  const handleCheckUpdate = () => {
    if (isChecking) return
    setIsChecking(true)
    if (checkingTimerRef.current != null) clearTimeout(checkingTimerRef.current)
    checkingTimerRef.current = setTimeout(() => {
      setIsChecking(false)
      showFeedback(`当前已是最新版本 (v${APP_VERSION})`)
    }, 600)
  }

  const handleViewChangelog = () => {
    window.open(LINK_URLS.releases, '_blank', 'noopener,noreferrer')
  }

  const handleLinkCardClick = (card: LinkCard) => {
    window.open(card.url, '_blank', 'noopener,noreferrer')
  }

  const handleFooterLinkClick = (link: FooterLink) => {
    if (link.url) {
      window.open(link.url, '_blank', 'noopener,noreferrer')
      return
    }
    // 致谢：本地反馈，无外部链接
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
    <div className="flex flex-col items-center" style={{ maxWidth: 560, margin: '0 auto', padding: '32px 24px 64px', gap: 0 }}>
      {/* ===== Hero ===== */}
      <div className="flex flex-col items-center text-center" style={{ gap: 14 }}>
        {/* Logo */}
        <div
          className="flex items-center justify-center"
          style={{
            width: 80, height: 80,
            background: 'var(--trae-bg-brand-popup)',
            border: '1px solid var(--trae-bg-brand)',
            borderRadius: 'var(--trae-radius-10)',
            boxShadow: '0 4px 24px rgba(56, 123, 255, 0.15)',
          }}
        >
          {/* TDSF Logo — 圆角立方体 + 终端光标，替代设计稿 logo.svg */}
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={{ color: 'var(--trae-bg-brand)' }}>
            <path d="M14 12h20a4 4 0 014 4v16a4 4 0 01-4 4H14a4 4 0 01-4-4V16a4 4 0 014-4z" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
            <path d="M10 18l8-6M10 18l8 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M24 26h10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            <circle cx="20" cy="26" r="2" fill="currentColor" />
          </svg>
        </div>

        {/* 名称 */}
        <div
          style={{
            fontFamily: 'var(--trae-heading-md-font-family)',
            fontSize: 'var(--trae-heading-lg-font-size)',
            fontWeight: 'var(--trae-font-weight-strong)',
            lineHeight: 'var(--trae-heading-lg-line-height)',
            color: 'var(--trae-text-default)',
            letterSpacing: '-0.012em',
          }}
        >
          TDSF Linux 运维教学一体平台
        </div>

        {/* 描述 */}
        <div
          style={{
            maxWidth: 380,
            fontSize: 'var(--trae-body-sm-font-size)',
            lineHeight: 20,
            color: 'var(--trae-text-secondary)',
          }}
        >
          面向 Linux 运维教学的 IDE + AI 一体化平台，集成 SSH 管理、可信决策、知识沉淀与实时监控
        </div>

        {/* Badges：3 个（版本 + stable + 构建标识） */}
        <div className="flex items-center" style={{ gap: 6, marginTop: 2 }}>
          {HERO_BADGES.map((badge) => (
            <span
              key={badge.label}
              className="inline-flex items-center"
              style={{
                gap: 4, height: 20, padding: '0 8px',
                borderRadius: 'var(--trae-radius-4)',
                background: badge.variant === 'brand' ? 'var(--trae-bg-brand-popup)' : 'var(--trae-bg-base-tertiary)',
                border: badge.variant === 'brand' ? '1px solid var(--trae-bg-brand)' : '1px solid var(--trae-border-neutral-l1)',
                color: badge.variant === 'brand' ? 'var(--trae-text-brand)' : 'var(--trae-text-secondary)',
                fontFamily: 'var(--trae-font-family-mono)',
                fontSize: 'var(--trae-body-xs-font-size)',
                fontWeight: 'var(--trae-font-weight-medium)',
              }}
            >
              {badge.label}
            </span>
          ))}
        </div>

        {/* 操作按钮 */}
        <div className="flex flex-wrap items-center justify-center" style={{ gap: 8, marginTop: 6 }}>
          <button
            type="button"
            onClick={handleCheckUpdate}
            disabled={isChecking}
            aria-label="检查更新"
            className="btn-press inline-flex items-center"
            style={{
              gap: 6, height: 32, padding: '0 16px',
              background: 'var(--trae-bg-brand)',
              border: '1px solid var(--trae-bg-brand)',
              borderRadius: 'var(--trae-radius-6)',
              color: 'var(--trae-special-white)',
              fontSize: 'var(--trae-body-sm-font-size)',
              fontWeight: 'var(--trae-font-weight-medium)',
              fontFamily: 'var(--trae-font-family-default)',
              cursor: isChecking ? 'not-allowed' : 'pointer',
              opacity: isChecking ? 0.7 : 1,
            }}
          >
            {isChecking ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            {isChecking ? '检查中...' : '检查更新'}
          </button>
          <button
            type="button"
            onClick={handleViewChangelog}
            aria-label="更新日志"
            className="btn-press inline-flex items-center"
            style={{
              gap: 6, height: 32, padding: '0 14px',
              background: 'transparent',
              border: '1px solid var(--trae-border-neutral-l2)',
              borderRadius: 'var(--trae-radius-6)',
              color: 'var(--trae-text-default)',
              fontSize: 'var(--trae-body-sm-font-size)',
              fontWeight: 'var(--trae-font-weight-medium)',
              fontFamily: 'var(--trae-font-family-default)',
              cursor: 'pointer',
            }}
          >
            <FileText className="size-3.5" />
            更新日志
          </button>
          {feedback && (
            <span
              role="status"
              aria-live="polite"
              style={{ fontSize: 'var(--trae-body-xs-font-size)', color: 'var(--trae-status-success-default)' }}
            >
              {feedback}
            </span>
          )}
        </div>
      </div>

      {/* ===== Divider ===== */}
      <div style={{ width: '100%', height: 1, background: 'var(--trae-border-neutral-l1)', margin: '36px 0 28px' }} />

      {/* ===== System info ===== */}
      <div className="flex w-full flex-col">
        {sysInfo.map((item, idx) => (
          <div
            key={item.key}
            className="flex items-center justify-between"
            style={{
              padding: '10px 0',
              borderBottom: idx === sysInfo.length - 1 ? 'none' : '1px solid var(--trae-border-neutral-l1)',
            }}
          >
            <span
              style={{
                fontSize: 'var(--trae-body-sm-font-size)',
                color: 'var(--trae-text-secondary)',
                fontWeight: 'var(--trae-font-weight-default)',
              }}
            >
              {item.key}
            </span>
            {item.isLink ? (
              <button
                type="button"
                onClick={() => handleSysInfoLinkClick(item)}
                className="hover:underline"
                style={{
                  fontFamily: 'var(--trae-font-family-mono)',
                  fontSize: 'var(--trae-body-sm-font-size)',
                  fontWeight: 'var(--trae-font-weight-medium)',
                  color: 'var(--trae-text-brand)',
                  cursor: 'pointer', background: 'transparent', border: 'none', padding: 0,
                }}
              >
                {item.value}
              </button>
            ) : (
              <span
                style={{
                  fontFamily: 'var(--trae-font-family-mono)',
                  fontSize: 'var(--trae-body-sm-font-size)',
                  fontWeight: 'var(--trae-font-weight-medium)',
                  color: 'var(--trae-text-default)',
                }}
              >
                {item.value}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* ===== Links grid ===== */}
      <div className="grid w-full" style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginTop: 28 }}>
        {LINK_CARDS.map((card) => {
          const Icon = card.icon
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => handleLinkCardClick(card)}
              aria-label={card.title}
              className="btn-press group flex cursor-pointer items-center text-left"
              style={{
                gap: 10, padding: '12px 14px',
                background: 'var(--trae-bg-base-secondary)',
                border: '1px solid var(--trae-border-neutral-l1)',
                borderRadius: 'var(--trae-radius-8)',
                transition: 'border-color 150ms ease-out, background 150ms ease-out',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--trae-bg-brand)'
                e.currentTarget.style.background = 'var(--trae-bg-brand-popup)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--trae-border-neutral-l1)'
                e.currentTarget.style.background = 'var(--trae-bg-base-secondary)'
              }}
            >
              <div
                className="flex shrink-0 items-center justify-center"
                style={{
                  width: 32, height: 32,
                  background: 'var(--trae-bg-base-tertiary)',
                  border: '1px solid var(--trae-border-neutral-l1)',
                  borderRadius: 'var(--trae-radius-6)',
                  transition: 'background 150ms ease-out, border-color 150ms ease-out',
                }}
              >
                <Icon className="size-4" style={{ color: 'var(--trae-text-secondary)', transition: 'color 150ms ease-out' }} />
              </div>
              <div className="min-w-0 flex-1">
                <div
                  style={{
                    fontSize: 'var(--trae-body-sm-strong-font-size)',
                    fontWeight: 'var(--trae-font-weight-medium)',
                    color: 'var(--trae-text-default)',
                    lineHeight: '18px',
                  }}
                >
                  {card.title}
                </div>
                <div
                  style={{
                    fontSize: 'var(--trae-body-xs-font-size)',
                    color: 'var(--trae-text-tertiary)',
                    lineHeight: '16px',
                    marginTop: 1,
                  }}
                >
                  {card.desc}
                </div>
              </div>
              <ArrowRight className="size-3.5 shrink-0" style={{ color: 'var(--trae-text-tertiary)', transition: 'color 150ms ease-out' }} />
            </button>
          )
        })}
      </div>

      {/* ===== Footer ===== */}
      <div
        className="w-full text-center"
        style={{ marginTop: 40, paddingTop: 24, borderTop: '1px solid var(--trae-border-neutral-l1)' }}
      >
        <div style={{ fontSize: 'var(--trae-body-xs-font-size)', lineHeight: 18, color: 'var(--trae-text-tertiary)' }}>
          Copyright © 2026 TDSF Team. All rights reserved.
          <br />
          深圳信息职业技术大学 · 计算机应用技术
        </div>
        <div className="flex items-center justify-center" style={{ gap: 16, marginTop: 8 }}>
          {FOOTER_LINKS.map((link, idx) => (
            <Fragment key={link.label}>
              {idx > 0 && (
                <span style={{ color: 'var(--trae-text-tertiary)', fontSize: 'var(--trae-body-xs-font-size)' }}>·</span>
              )}
              <button
                type="button"
                onClick={() => handleFooterLinkClick(link)}
                className="cursor-pointer transition-colors hover:underline"
                style={{
                  fontSize: 'var(--trae-body-xs-font-size)',
                  color: 'var(--trae-text-secondary)',
                  background: 'transparent', border: 'none', padding: 0,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--trae-text-brand)' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--trae-text-secondary)' }}
              >
                {link.label}
              </button>
            </Fragment>
          ))}
        </div>
      </div>

      {/* ===== 按压动画 + 无障碍降级 ===== */}
      <style>{`
        .btn-press { transition: transform 80ms ease-out; }
        .btn-press:active { transform: scale(0.92); }
        @media (prefers-reduced-motion: reduce) {
          .btn-press:active { transform: none !important; }
          .animate-spin { animation: none !important; }
        }
      `}</style>
    </div>
  )
}
