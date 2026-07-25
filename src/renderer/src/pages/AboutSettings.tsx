/**
 * AboutSettings — 关于（居中布局，嵌套在 SettingsLayout 内）
 * 路由：/settings/about | 设计稿：settings-about.html
 *
 * spec DEC-4 要求 9 个设置子页面统一左导航，本组件嵌套在 SettingsLayout 内：
 * 删除独立 ab-topbar，保留 Hero + Divider + SysInfo + Links grid + Footer。
 * 视觉：var(--trae-*) token；无障碍：button type + aria-label。
 * 常量 / 类型 / 探测函数：见 about-settings.constants.ts
 *
 * v2.2 P1 修复 #24：检查更新功能接入真实 IPC（app:check-update / app:download-update）
 * 简化方案：HTTP GET GitHub Releases API + shell.openExternal，不引入 electron-updater。
 */
import { Fragment, useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { RefreshCw, ArrowRight, Loader2, FileText, Download, ArrowLeft } from 'lucide-react'
import {
  APP_VERSION, APP_BUILD_BADGE, APP_BUILD_TIME, APP_INSTALL_PATH,
  LINK_URLS, LINK_CARDS, FOOTER_LINKS,
  detectRuntimeEnv, detectOsName,
  type SysInfoItem, type LinkCard, type FooterLink,
} from './about-settings.constants'
import type { AppUpdateInfo, AppInfo } from '../types/electron'
import './Settings.css'

interface BadgeConfig {
  label: string
  variant: 'brand' | 'neutral'
}

const BADGE_CLASS: Record<BadgeConfig['variant'], string> = {
  brand: 'set-ab-badge set-ab-badge--brand',
  neutral: 'set-ab-badge set-ab-badge--neutral',
}

export function AboutSettings() {
  const navigate = useNavigate()
  const [feedback, setFeedback] = useState<string | null>(null)
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [isChecking, setIsChecking] = useState(false)
  const checkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // v2.2 P1 修复 #24：检查更新真实 IPC 返回结果
  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [isDownloading, setIsDownloading] = useState(false)
  // T.8：真实应用信息（从主进程 app:get-info 加载）
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [appInfoLoading, setAppInfoLoading] = useState(false)
  const [appInfoError, setAppInfoError] = useState<string | null>(null)

  const displayVersion = appInfo?.version ?? APP_VERSION
  const displayBuildTime = appInfo?.buildTime
    ? new Date(appInfo.buildTime).toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : APP_BUILD_TIME
  const displayBuildBadge = appInfo?.buildBadge ?? APP_BUILD_BADGE
  const displayInstallPath = appInfo?.installPath ?? APP_INSTALL_PATH

  /** Hero Badge 配置（3 个：版本 + stable + 构建标识），优先用 app:get-info 真实值 */
  const heroBadges = useMemo<BadgeConfig[]>(() => {
    return [
      { label: displayVersion, variant: 'brand' },
      { label: 'stable', variant: 'neutral' },
      { label: displayBuildBadge, variant: 'neutral' },
    ]
  }, [displayVersion, displayBuildBadge])

  const sysInfo = useMemo<SysInfoItem[]>(() => {
    return [
      { key: '版本', value: `${displayVersion} (stable)` },
      { key: '构建时间', value: displayBuildTime },
      { key: '更新通道', value: 'Stable' },
      { key: '运行环境', value: detectRuntimeEnv() },
      { key: '操作系统', value: detectOsName() },
      { key: '安装路径', value: displayInstallPath },
      { key: '官网', value: 'tdsf.dev', isLink: true },
      { key: '项目仓库', value: 'github.com/harryopo/tdsf-linux-desktop', isLink: true },
    ]
  }, [displayVersion, displayBuildTime, displayInstallPath])

  useEffect(() => {
    // T.8：挂载时加载真实应用信息（非 Electron 环境安全降级）
    setAppInfoLoading(true)
    setAppInfoError(null)
    if (typeof window === 'undefined' || !window.electronAPI?.appGetInfo) {
      setAppInfoLoading(false)
      return () => {
        if (feedbackTimerRef.current != null) clearTimeout(feedbackTimerRef.current)
        if (checkingTimerRef.current != null) clearTimeout(checkingTimerRef.current)
      }
    }
    window.electronAPI
      .appGetInfo()
      .then((info) => {
        setAppInfo(info)
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err)
        setAppInfoError(message)
        // IPC 失败时使用本地常量兜底，不阻塞页面
      })
      .finally(() => {
        setAppInfoLoading(false)
      })

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
   * 检查更新：调用主进程 app:check-update IPC
   *
   * v2.2 P1 修复 #24：真实实现（替代原 WIP 本地反馈）。
   *
   * 主进程 HTTP GET GitHub Releases API（10 秒超时），比对 semver 版本号：
   * - 有更新：setUpdateInfo(info) 显示新版本号 + 更新日志 + 立即下载按钮
   * - 无更新：showFeedback 提示已是最新版本
   * - 失败：setUpdateError(error) 显示错误信息（已脱敏）
   *
   * 简化方案：不引入 electron-updater（A7 质量优先 + A8 避免重复造轮子），
   * "下载更新"通过 shell.openExternal 打开浏览器到 Release 页面。
   */
  const handleCheckUpdate = async () => {
    if (isChecking) return
    setIsChecking(true)
    setUpdateInfo(null)
    setUpdateError(null)
    try {
      if (typeof window === 'undefined' || !window.electronAPI?.appCheckUpdate) {
        throw new Error('当前环境不支持检查更新')
      }
      const result = await window.electronAPI.appCheckUpdate()
      if (result.hasUpdate) {
        // 有新版本：保存更新信息，UI 展示新版本号 + 立即下载按钮
        setUpdateInfo(result)
      } else if ('error' in result) {
        // 检查失败（已脱敏）：显示错误信息
        setUpdateError(result.error)
        showFeedback(`检查更新失败：${result.error}`)
      } else {
        // 无新版本
        showFeedback(`当前已是最新版本 (v${APP_VERSION})`)
      }
    } catch (err) {
      // IPC 调用本身失败（极端情况：主进程未注册 / preload 未暴露）
      const errorMsg = err instanceof Error ? err.message : String(err)
      setUpdateError(errorMsg)
      showFeedback(`检查更新失败：${errorMsg}`)
    } finally {
      setIsChecking(false)
    }
  }

  /**
   * 立即下载：调用主进程 app:download-update IPC
   *
   * 主进程 shell.openExternal 打开浏览器到 Release 页面，
   * 让用户手动下载 .exe/.dmg/.AppImage 安装包。
   */
  const handleDownloadUpdate = async () => {
    if (isDownloading) return
    setIsDownloading(true)
    try {
      if (typeof window === 'undefined' || !window.electronAPI?.appDownloadUpdate) {
        showFeedback('当前环境不支持下载更新')
        setIsDownloading(false)
        return
      }
      const releaseUrl = updateInfo?.releaseUrl
      const ok = await window.electronAPI.appDownloadUpdate(releaseUrl)
      if (!ok) {
        showFeedback('打开下载页面失败，请稍后重试')
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      showFeedback(`打开下载页面失败：${errorMsg}`)
    } finally {
      setIsDownloading(false)
    }
  }

  const handleViewChangelog = () => {
    window.open(LINK_URLS.changelog, '_blank', 'noopener,noreferrer')
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
      {/* ===== Top back bar ===== */}
      <div className="set-ab-backbar">
        <button
          type="button"
          data-dom-id="back-settings"
          aria-label="返回设置"
          onClick={() => navigate('/settings')}
          className="set-backbtn btn-press"
        >
          <ArrowLeft className="di-14" />
          返回设置
        </button>
      </div>

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
          {heroBadges.map((badge) => (
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

        {/* v2.2 P1 修复 #24：检查更新结果展示（有新版本时显示版本号 + 更新日志 + 立即下载按钮） */}
        {updateInfo && (
          <div
            role="status"
            aria-live="polite"
            style={{
              marginTop: 'var(--trae-spacing-md, 12px)',
              padding: 'var(--trae-spacing-md, 12px) var(--trae-spacing-lg, 16px)',
              borderRadius: 'var(--trae-radius-md, 8px)',
              border: '1px solid var(--trae-border-brand, var(--trae-border-default))',
              background: 'var(--trae-bg-brand-subtle, var(--trae-bg-elevated))',
              fontSize: 'var(--trae-body-sm-font-size)',
              color: 'var(--trae-text-primary)',
              textAlign: 'left',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--trae-spacing-sm, 8px)', marginBottom: 'var(--trae-spacing-xs, 4px)' }}>
              <span className={BADGE_CLASS.brand} style={{ flexShrink: 0 }}>
                {updateInfo.latestVersion}
              </span>
              <span style={{ color: 'var(--trae-text-secondary)', fontSize: 'var(--trae-body-xs-font-size)' }}>
                发布于 {new Date(updateInfo.publishedAt).toLocaleDateString('zh-CN')}
              </span>
            </div>
            <div
              style={{
                color: 'var(--trae-text-secondary)',
                fontSize: 'var(--trae-body-xs-font-size)',
                maxHeight: '120px',
                overflowY: 'auto',
                whiteSpace: 'pre-wrap',
                marginBottom: 'var(--trae-spacing-sm, 8px)',
              }}
            >
              {updateInfo.releaseNotes}
            </div>
            <button
              type="button"
              onClick={handleDownloadUpdate}
              disabled={isDownloading}
              aria-label="立即下载"
              className="set-btn-primary btn-press"
              style={isDownloading ? { opacity: 0.7, cursor: 'not-allowed' } : undefined}
            >
              {isDownloading ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
              {isDownloading ? '打开中...' : '立即下载'}
            </button>
          </div>
        )}

        {/* 检查更新失败时显示错误信息（已脱敏） */}
        {updateError && !updateInfo && (
          <div
            role="alert"
            style={{
              marginTop: 'var(--trae-spacing-md, 12px)',
              padding: 'var(--trae-spacing-sm, 8px) var(--trae-spacing-md, 12px)',
              borderRadius: 'var(--trae-radius-md, 8px)',
              border: '1px solid var(--trae-status-error-default)',
              background: 'var(--trae-status-error-subtle, var(--trae-bg-elevated))',
              fontSize: 'var(--trae-body-xs-font-size)',
              color: 'var(--trae-status-error-default)',
              textAlign: 'left',
            }}
          >
            {updateError}
          </div>
        )}
      </div>

      {/* ===== Divider ===== */}
      <div className="set-ab-divider" />

      {/* ===== System info ===== */}
      <div className="set-ab-sysinfo">
        {(appInfoLoading || appInfoError) && (
          <div className="set-ab-sysinfo__row">
            <span className="set-ab-sysinfo__key">应用信息</span>
            <span className="set-ab-sysinfo__val" style={{ color: 'var(--trae-text-tertiary)' }}>
              {appInfoLoading && (
                <>
                  <Loader2 className="mr-1 inline size-3 animate-spin" />
                  正在从主进程加载真实应用信息…
                </>
              )}
              {!appInfoLoading && appInfoError && (
                <>加载真实应用信息失败（{appInfoError}），当前显示兜底值</>
              )}
            </span>
          </div>
        )}
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
