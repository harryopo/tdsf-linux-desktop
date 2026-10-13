/**
 * AboutSettings — 关于（版本与更新 / 运行环境 / 功能就绪度 / 资源）
 * 路由：/settings/about
 *
 * 与其它设置子页同一套卡片语言（SettingsCard + SettingsRow），不做居中营销版式：
 * 原来那版把 logo、标题、三个 badge、按钮、9 行键值表竖成一条 560px 居中长栏，
 * 版本号在 Hero 和表格里各写一遍，还挂着不存在的官网与占位问卷链接。
 *
 * 检查更新走真实 IPC（app:check-update / app:download-update）：
 * 主进程 GET GitHub Releases 比对 semver；"下载更新"= 打开 Release 页，不引 electron-updater。
 * 常量与探测函数见 about-settings.constants.ts。
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Download, ExternalLink, ListChecks, MonitorPlay, RefreshCw, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import {
  APP_VERSION,
  LINK_URLS,
  LINK_CARDS,
  NOT_AVAILABLE,
  detectRuntimeEnv,
  detectOsName,
} from './about-settings.constants'
import type { AppUpdateInfo, AppInfo } from '../types/electron'
import {
  CAPABILITIES,
  CAPABILITY_STATUS_LABELS,
  capabilityCounts,
  type CapabilityStatus,
} from '@shared/capabilities'
import { Button, Chip, Spinner } from '@/ui'
import { SettingsPageHeader } from '@/components/settings/SettingsPageHeader'
import { settingsHeader } from './settings-sections'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import './Settings.css'

/** 就绪度状态 → Chip 色调（待开发用描边，避免看起来和"降级"一样严重） */
const CHIP_TONE: Record<CapabilityStatus, 'success' | 'warning' | 'outline'> = {
  live: 'success',
  degraded: 'warning',
  pending: 'outline',
}

/**
 * 实测三行的骨架：状态与原因都由主进程现场给出，页面只写"取不到数时说什么"。
 * 顺序即展示顺序，别在页面里再判一次"该不该显示"——那会把实测又变回承诺。
 */
const ENGINE_HEALTH_ROWS = [
  { key: 'sidecar', label: 'Python 分析引擎', fallback: '还没取到实测结果' },
  { key: 'ast', label: '命令 AST 解析', fallback: '还没取到实测结果' },
  { key: 'templates', label: '日志模板挖掘（Drain3）', fallback: '还没取到实测结果' },
] as const

/** 路径与版本这类值：等宽、超长截断，不许撑破行 */function Value({ children }: { children: ReactNode }) {
  return <span className="max-w-[420px] truncate font-mono text-caption text-ink-dim">{children}</span>
}

export function AboutSettings() {
  const [isChecking, setIsChecking] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [appInfoLoading, setAppInfoLoading] = useState(false)
  const [appInfoError, setAppInfoError] = useState<string | null>(null)

  /** 功能就绪度汇总：数字来自共享表，页面不自己数 */
  const counts = useMemo(() => capabilityCounts(), [])

  useEffect(() => {
    let cancelled = false
    setAppInfoLoading(true)
    setAppInfoError(null)
    if (typeof window === 'undefined' || !window.electronAPI?.appGetInfo) {
      setAppInfoLoading(false)
      setAppInfoError(NOT_AVAILABLE)
      return
    }
    window.electronAPI
      .appGetInfo()
      .then((info) => {
        if (cancelled) return
        if (info) setAppInfo(info)
        else setAppInfoError(NOT_AVAILABLE)
      })
      .catch((err: unknown) => {
        if (!cancelled) setAppInfoError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setAppInfoLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const version = appInfo?.version ?? `v${APP_VERSION}`
  const buildTime = appInfo?.buildTime
    ? new Date(appInfo.buildTime).toLocaleString('zh-CN', { hour12: false })
    : NOT_AVAILABLE
  const buildBadge = appInfo?.buildBadge ?? '—'

  /** 检查结果说人话：有没有新版、何时发布、失败原因是什么 */
  const updateSummary = updateError
    ? `检查失败：${updateError}`
    : updateInfo
      ? `发现新版本 ${updateInfo.latestVersion}（${updateInfo.publishedAt.slice(0, 10)} 发布）`
      : '尚未检查。更新来源是 GitHub Releases 上标记为 stable 的版本。'

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
      if (result.hasUpdate) setUpdateInfo(result)
      else if ('error' in result) setUpdateError(result.error)
      else toast.success(`已是最新版本 ${version}`)
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsChecking(false)
    }
  }

  /** "下载更新"打开 Release 页，由用户手动下载安装包 */
  const handleDownloadUpdate = async () => {
    if (typeof window === 'undefined' || !window.electronAPI?.appDownloadUpdate) {
      toast.error('当前环境不支持打开下载页')
      return
    }
    const ok = await window.electronAPI.appDownloadUpdate(updateInfo?.releaseUrl ?? LINK_URLS.releases)
    if (!ok) toast.error('打开下载页面失败，请稍后重试')
  }

  const openLink = (url: string) => window.open(url, '_blank', 'noopener,noreferrer')

  return (
    <div className="set-subpage">
      <SettingsPageHeader {...settingsHeader('/settings/about')} />
      <div className="set-subpage__body">
        <SettingsCard icon={RefreshCw} title="版本与更新" hideTag noHeadBorder>
          <SettingsRow label="当前版本" desc="随安装包分发" control={<Value>{version} · {buildBadge}</Value>} />
          <SettingsRow
            label="构建时间"
            desc={appInfoError ?? '由主进程在启动时提供'}
            control={<Value>{buildTime}</Value>}
          />
          <SettingsRow label="更新通道" desc="只比对 stable 标签的 Release" control={<Chip tone="neutral">Stable</Chip>} />
          <SettingsRow
            label="检查结果"
            desc={updateSummary}
            control={
              <div className="flex items-center gap-2">
                {updateInfo ? (
                  <Button variant="solid" size="md" onClick={handleDownloadUpdate}>
                    <Download className="size-3.5" />
                    下载 {updateInfo.latestVersion}
                  </Button>
                ) : null}
                <Button variant="outline" size="md" disabled={isChecking} onClick={handleCheckUpdate}>
                  {isChecking ? '检查中…' : '检查更新'}
                </Button>
                <Button variant="ghost" size="md" onClick={() => openLink(LINK_URLS.changelog)}>
                  更新日志
                </Button>
              </div>
            }
          />
          {updateInfo?.releaseNotes ? (
            <p className="mt-1 max-h-36 overflow-y-auto whitespace-pre-wrap rounded-(--ui-radius-control) bg-sunken p-3 text-caption leading-relaxed text-ink-dim">
              {updateInfo.releaseNotes}
            </p>
          ) : null}
        </SettingsCard>

        <SettingsCard icon={MonitorPlay} title="运行环境" hideTag noHeadBorder>
          {appInfoLoading ? (
            <div className="py-3">
              <Spinner label="读取应用信息…" />
            </div>
          ) : (
            <>
              <SettingsRow label="运行时" desc="Electron 与内核版本" control={<Value>{detectRuntimeEnv()}</Value>} />
              <SettingsRow label="操作系统" desc="当前系统平台" control={<Value>{detectOsName()}</Value>} />
              <SettingsRow label="数据目录" desc="配置、知识库与本地数据库存放处" control={<Value>{appInfo?.dataPath ?? NOT_AVAILABLE}</Value>} />
              <SettingsRow label="日志目录" desc="排查问题先看这里" control={<Value>{appInfo?.logPath ?? NOT_AVAILABLE}</Value>} />
              <SettingsRow label="程序路径" desc="安装包所在目录" isLast control={<Value>{appInfo?.installPath ?? NOT_AVAILABLE}</Value>} />
            </>
          )}
        </SettingsCard>

        <SettingsCard icon={ListChecks} title="功能就绪度" hideTag noHeadBorder>
          <p className="pb-1 text-caption text-ink-mute">
            {counts.live} 项已接通 · {counts.degraded} 项降级运行 · {counts.pending} 项待开发
          </p>
          {CAPABILITIES.map((cap, i) => (
            <SettingsRow
              key={cap.id}
              label={cap.label}
              desc={cap.note}
              isLast={i === CAPABILITIES.length - 1}
              control={<Chip tone={CHIP_TONE[cap.status]}>{CAPABILITY_STATUS_LABELS[cap.status]}</Chip>}
            />
          ))}
        </SettingsCard>

        {/*
          * 上面那张表是承诺，这一张是实测：Python 分析引擎、AST 命令解析、Drain3 模板挖掘
          * 三项最容易在装好的包里悄悄退回简化路径（缺文件、缺依赖、桥没启动），
          * 而界面上什么都不会说。状态由主进程现场量出来（app:get-info）。
          */}
        <SettingsCard icon={MonitorPlay} title="本机分析引擎（实测）" hideTag noHeadBorder>
          <p className="pb-1 text-caption text-ink-mute">
            {appInfo
              ? appInfo.packaged
                ? '来自安装包：缺组件时相关功能会走内置简化路径'
                : '开发环境：可以自行搭建缺失的分析环境'
              : '正在向主进程取数'}
          </p>
          {ENGINE_HEALTH_ROWS.map((row, i) => {
            const fact = appInfo?.engineHealth[row.key]
            return (
              <SettingsRow
                key={row.key}
                label={row.label}
                desc={fact ? fact.reason : row.fallback}
                isLast={i === ENGINE_HEALTH_ROWS.length - 1}
                control={
                  !fact ? (
                    <Chip tone="outline">未测到</Chip>
                  ) : fact.ok ? (
                    <Chip tone="success">已启用</Chip>
                  ) : (
                    <Chip tone="warning">简化路径</Chip>
                  )
                }
              />
            )
          })}
        </SettingsCard>

        <SettingsCard icon={Sparkles} title="资源" hideTag noHeadBorder>
          {LINK_CARDS.map((card, i) => (
            <SettingsRow
              key={card.id}
              label={card.title}
              desc={card.desc}
              isLast={i === LINK_CARDS.length - 1}
              control={
                <Button variant="ghost" size="md" onClick={() => openLink(card.url)}>
                  <ExternalLink className="size-3.5" />
                  打开
                </Button>
              }
            />
          ))}
        </SettingsCard>

        <p className="px-1 pb-2 text-caption text-ink-mute">
          Copyright © 2026 TDSF Team
        </p>
      </div>
    </div>
  )
}
