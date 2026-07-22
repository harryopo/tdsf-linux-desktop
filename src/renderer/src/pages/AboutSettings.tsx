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
import './Settings.css'

interface BadgeConfig {
  label: string
  variant: 'brand' | 'neutral'
}

const BADGE_CLASS: Record<BadgeConfig['variant'], string> = {
  brand: 'set-ab-badge set-ab-badge--brand',
  neutral: 'set-ab-badge set-ab-badge--neutral',
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
   *
   * WIP: 当前未接入 electron-updater 真实检查逻辑（CLAUDE.md A4 诚实标注 · A7 质量优先）。
   *
   * 真实实现路径（预计 v1.0 P0 完成）：
   * 1. main 进程引入 electron-updater + autoUpdater
   * 2. 新增 IPC 通道 app:check-update / app:download-update / app:install-update
   * 3. 配置发布源（GitHub Releases / 私有 update-server）
   * 4. 渲染层订阅更新事件（checking/update-available/download-progress/installed）
   * 5. 完成后替换此处为 window.electronAPI.appCheckUpdate() 真实调用
   *
   * 当前仅基于本地 APP_VERSION 提供 UI 状态反馈，避免引入 mock 数据（A4 禁止 mock 伪装完成）。
   */
  const handleCheckUpdate = () => {
    if (isChecking) return
    setIsChecking(true)
    if (checkingTimerRef.current != null) clearTimeout(checkingTimerRef.current)
    checkingTimerRef.current = setTimeout(() => {
      setIsChecking(false)
      // WIP: 真实实现后将替换为 IPC 返回的更新状态
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
    <div className="set-ab-page">
      {/* ===== Hero ===== */}
      <div className="set-ab-hero">
        {/* Logo */}
        <div className="set-ab-hero__logo">
          {/* TDSF Logo — 圆角立方体 + 终端光标，替代设计稿 logo.svg */}
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={{ color: 'var(--trae-bg-brand)' }}>
            <path d="M14 12h20a4 4 0 014 4v16a4 4 0 01-4 4H14a4 4 0 01-4-4V16a4 4 0 014-4z" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
            <path d="M10 18l8-6M10 18l8 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M24 26h10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            <circle cx="20" cy="26" r="2" fill="currentColor" />
          </svg>
        </div>

        {/* 名称 */}
        <div className="set-ab-hero__name">
          TDSF Linux 运维教学一体平台
        </div>

        {/* 描述 */}
        <div className="set-ab-hero__desc">
          面向 Linux 运维教学的 IDE + AI 一体化平台，集成 SSH 管理、可信决策、知识沉淀与实时监控
        </div>

        {/* Badges：3 个（版本 + stable + 构建标识） */}
        <div className="set-ab-hero__badges">
          {HERO_BADGES.map((badge) => (
            <span
              key={badge.label}
              className={BADGE_CLASS[badge.variant]}
            >
              {badge.label}
            </span>
          ))}
        </div>

        {/* 操作按钮 */}
        <div className="set-ab-hero__actions">
          <button
            type="button"
            onClick={handleCheckUpdate}
            disabled={isChecking}
            aria-label="检查更新"
            className="set-btn-primary btn-press"
            style={isChecking ? { opacity: 0.7, cursor: 'not-allowed' } : undefined}
          >
            {isChecking ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            {isChecking ? '检查中...' : '检查更新'}
          </button>
          <button
            type="button"
            onClick={handleViewChangelog}
            aria-label="更新日志"
            className="set-btn-secondary btn-press"
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
      <div className="set-ab-divider" />

      {/* ===== System info ===== */}
      <div className="set-ab-sysinfo">
        {sysInfo.map((item) => (
          <div key={item.key} className="set-ab-sysinfo__row">
            <span className="set-ab-sysinfo__key">
              {item.key}
            </span>
            {item.isLink ? (
              <button
                type="button"
                onClick={() => handleSysInfoLinkClick(item)}
                className="set-ab-sysinfo__val set-ab-sysinfo__val--link"
              >
                {item.value}
              </button>
            ) : (
              <span className="set-ab-sysinfo__val">
                {item.value}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* ===== Links grid ===== */}
      <div className="set-ab-links">
        {LINK_CARDS.map((card) => {
          const Icon = card.icon
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => handleLinkCardClick(card)}
              aria-label={card.title}
              className="set-ab-link-card btn-press"
            >
              <div className="set-ab-link-card__icon">
                <Icon className="size-4" />
              </div>
              <div className="set-ab-link-card__body">
                <div className="set-ab-link-card__title">
                  {card.title}
                </div>
                <div className="set-ab-link-card__desc">
                  {card.desc}
                </div>
              </div>
              <ArrowRight className="size-3.5 set-ab-link-card__arrow" />
            </button>
          )
        })}
      </div>

      {/* ===== Footer ===== */}
      <div className="set-ab-footer">
        <div className="set-ab-footer__text">
          Copyright © 2026 TDSF Team. All rights reserved.
          <br />
          深圳信息职业技术大学 · 计算机应用技术
        </div>
        <div className="set-ab-footer__links">
          {FOOTER_LINKS.map((link, idx) => (
            <Fragment key={link.label}>
              {idx > 0 && (
                <span style={{ color: 'var(--trae-text-tertiary)', fontSize: 'var(--trae-body-xs-font-size)' }}>·</span>
              )}
              <button
                type="button"
                onClick={() => handleFooterLinkClick(link)}
                className="set-ab-footer__link"
              >
                {link.label}
              </button>
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  )
}
