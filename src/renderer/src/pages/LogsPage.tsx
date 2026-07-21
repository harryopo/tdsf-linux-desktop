/**
 * LogsPage — 系统日志页（v1.0 设计稿复刻）
 *
 * 路由：/logs
 * 设计稿：tdsf-linux-redesign/pages/logs.html
 *
 * 结构（app-shell 全屏 flex-col）：
 *   1. Header (48px)：file-text 图标 + 标题"系统日志" + 副标题 + AI 决策数据源 tag + 返回工作台按钮
 *   2. Toolbar：搜索框 + Level filter (5 个 tab) + AI 日志分析 + 自动滚动 switch + 刷新/导出图标按钮
 *   3. 两栏布局：
 *      - 左 180px LogSidebar：9 个日志源（5 主类 + 4 服务器系统日志路径）
 *      - 右 LogViewer：浮动统计卡 + 日志列表 + 闪烁光标
 *   4. Status bar (24px)：系统日志总数 + 最新时间 + 实时流 + 导出 CSV
 *
 * 数据源：通过 IPC 调用 window.electronAPI.logRead / logStats 获取真实日志
 *
 * JS 交互：
 *   - useNavigate 跳转（返回工作台）
 *   - 搜索关键词 + Level filter + 日志源切换 + 自动滚动（4 个 useState）
 *   - useEffect 调用 IPC 获取日志（按级别 + 关键词 + 分类过滤）
 *   - useEffect 调用 IPC 获取日志统计
 *
 * 设计 token：全部使用 `--trae-*` 前缀（项目约定）
 * 组件：TRAE Button + Lucide 图标 + Tailwind 类名
 * 子组件：LogSidebar / LogToolbar / LogViewer
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  FileText,
  ArrowLeft,
  Sparkles,
  Clock,
  RefreshCw,
  Download,
  AlertTriangle,
  Loader2,
} from 'lucide-react'
import { Button } from '@/components/trae/Button'
import { LogSidebar } from '@/components/logs/v1/LogSidebar'
import { LogToolbar } from '@/components/logs/v1/LogToolbar'
import { LogViewer } from '@/components/logs/v1/LogViewer'
import { type LogLevel, DEFAULT_LOG_SOURCE_ID } from '@/components/logs/v1/logs-data'
import type { LogEntry, LogStats } from '@shared/models'

/** 日志查看器所需的条目格式（与 LogViewer 子组件兼容） */
interface ViewerLogEntry {
  id: number
  timestamp: string
  level: LogLevel
  source: string
  message: string
}

/** 将 IPC 返回的 LogEntry 映射为 LogViewer 所需格式 */
function toViewerEntry(entry: LogEntry, index: number): ViewerLogEntry {
  // 从 ISO 时间戳中提取 HH:MM:SS.mmm 格式
  const d = new Date(entry.ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  const timestamp = `${hh}:${mm}:${ss}.${ms}`

  // 将 FATAL 映射为 ERROR 以兼容 viewer 的 4 级别体系
  const level: LogLevel = entry.level === 'FATAL' ? 'ERROR' : entry.level

  return {
    id: index,
    timestamp,
    level,
    source: entry.category,
    message: entry.message,
  }
}

/** 格式化时间戳为可读字符串 */
function formatTs(ts: string | null): string {
  if (!ts) return '--'
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

/** LogsPage — 系统日志页 */
export function LogsPage() {
  const navigate = useNavigate()

  // ===== UI 状态 =====
  const [activeSource, setActiveSource] = useState(DEFAULT_LOG_SOURCE_ID)
  const [activeLevel, setActiveLevel] = useState<LogLevel | 'ALL'>('ALL')
  const [keyword, setKeyword] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)

  // ===== 数据状态 =====
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [stats, setStats] = useState<LogStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 用于取消过期请求
  const fetchIdRef = useRef(0)

  // ===== 检测 electronAPI 是否可用 =====
  const hasElectronAPI = typeof window !== 'undefined' && !!window.electronAPI

  // ===== 加载日志 =====
  const fetchLogs = useCallback(async () => {
    if (!window.electronAPI) return

    const currentFetchId = ++fetchIdRef.current
    setLoading(true)
    setError(null)

    try {
      const filter: {
        level?: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL'
        category?: string
        keyword?: string
        limit?: number
      } = { limit: 200 }

      if (activeLevel !== 'ALL') {
        filter.level = activeLevel
      }
      if (keyword.trim()) {
        filter.keyword = keyword.trim()
      }
      // 日志源侧边栏选中项映射为 category 过滤
      if (activeSource && activeSource !== 'system') {
        filter.category = activeSource
      }

      const result = await window.electronAPI.logRead(filter)

      // 防止过期请求覆盖新数据
      if (currentFetchId !== fetchIdRef.current) return

      setLogs(result)
    } catch (err: unknown) {
      if (currentFetchId !== fetchIdRef.current) return
      const msg = err instanceof Error ? err.message : '日志加载失败'
      setError(msg)
    } finally {
      if (currentFetchId === fetchIdRef.current) {
        setLoading(false)
      }
    }
  }, [activeLevel, keyword, activeSource])

  // ===== 加载统计 =====
  const fetchStats = useCallback(async () => {
    if (!window.electronAPI) return
    try {
      const result = await window.electronAPI.logStats()
      setStats(result)
    } catch {
      // 统计加载失败不阻塞主流程
    }
  }, [])

  // 首次加载 + 过滤条件变化时重新拉取日志
  useEffect(() => {
    if (!hasElectronAPI) {
      setLoading(false)
      return
    }
    void fetchLogs()
  }, [fetchLogs, hasElectronAPI])

  // 首次加载统计
  useEffect(() => {
    if (!hasElectronAPI) return
    void fetchStats()
  }, [fetchStats, hasElectronAPI])

  // ===== 映射为 viewer 格式 =====
  const viewerEntries: ViewerLogEntry[] = useMemo(
    () => logs.map(toViewerEntry),
    [logs],
  )

  // ===== 事件处理 =====

  /** 返回工作台 */
  const handleBack = () => {
    navigate('/workbench')
  }

  /** 刷新日志 */
  const handleRefresh = () => {
    void fetchLogs()
    void fetchStats()
  }

  /** AI 日志分析（基于当前过滤结果给出统计反馈） */
  const handleAiAnalyze = () => {
    const total = logs.length
    if (total === 0) {
      window.alert('当前过滤条件下没有日志可分析')
      return
    }
    const errorCount = logs.filter((l) => l.level === 'ERROR' || l.level === 'FATAL').length
    const warnCount = logs.filter((l) => l.level === 'WARN').length
    const infoCount = logs.filter((l) => l.level === 'INFO').length
    const debugCount = logs.filter((l) => l.level === 'DEBUG').length
    let conclusion: string
    if (errorCount > 0) {
      conclusion = `⚠ 发现严重错误 ${errorCount} 条，建议优先排查 ERROR 级别日志`
    } else if (warnCount > 0) {
      conclusion = `⚠ 存在告警信息 ${warnCount} 条，建议关注 WARN 级别日志`
    } else {
      conclusion = '✓ 日志状态正常，未发现异常'
    }
    window.alert(
      `AI 日志分析完成（共 ${total} 条日志）\n\n` +
        `级别分布：\n` +
        `• INFO  ${infoCount}\n` +
        `• WARN  ${warnCount}\n` +
        `• ERROR ${errorCount}\n` +
        `• DEBUG ${debugCount}\n\n` +
        `${conclusion}\n\n` +
        `完整 AI 诊断报告将在 v1.1 版本接入 AI Agent 后提供。`,
    )
  }

  /** 导出日志（按当前过滤结果给出导出预览） */
  const handleExport = () => {
    const total = logs.length
    if (total === 0) {
      window.alert('当前过滤条件下没有日志可导出')
      return
    }
    window.alert(
      `导出日志（共 ${total} 条）\n\n` +
        `v1.1 版本将支持：\n` +
        '• CSV 格式导出\n' +
        '• 时间范围筛选\n' +
        '• 自定义字段选择\n\n' +
        '当前为占位交互，敬请期待。',
    )
  }

  // ===== Guard: electronAPI 不可用 =====
  if (!hasElectronAPI) {
    return (
      <main
        className="flex h-full w-full flex-col items-center justify-center"
        style={{
          background: 'var(--trae-bg-base-default)',
          color: 'var(--trae-text-default)',
          gap: 16,
        }}
      >
        <AlertTriangle
          size={40}
          style={{ color: 'var(--trae-status-alert-default)' }}
        />
        <p style={{ fontSize: 14, color: 'var(--trae-text-secondary)' }}>
          日志服务不可用（electronAPI 未注入）
        </p>
        <Button variant="outline" size="default" onClick={handleBack}>
          <ArrowLeft size={16} />
          返回工作台
        </Button>
      </main>
    )
  }

  // ===== 统计摘要数据 =====
  const totalCount = stats?.total ?? 0
  const latestTs = stats?.newestTs ?? null

  return (
    <main
      className="flex h-full w-full flex-col overflow-hidden"
      data-viewport-mode="app-shell"
      style={{
        background: 'var(--trae-bg-base-default)',
        color: 'var(--trae-text-default)',
      }}
    >
      {/* ===== 1. Header (48px) ===== */}
      <header
        className="flex shrink-0 items-center justify-between"
        style={{
          padding: '0 16px',
          borderBottom: '1px solid var(--trae-border-neutral-l1)',
          background: 'var(--trae-bg-base-default)',
          height: 48,
        }}
      >
        <div className="flex min-w-0 items-center" style={{ gap: 12 }}>
          <FileText
            size={20}
            className="shrink-0"
            style={{ color: 'var(--trae-icon-brand)' }}
          />
          <h1
            className="m-0 truncate"
            style={{
              fontFamily: 'var(--trae-font-family-heading)',
              fontWeight: 'var(--trae-font-weight-strong)',
              color: 'var(--trae-text-default)',
              letterSpacing: '-0.01em',
              lineHeight: '28px',
              fontSize: 18,
            }}
          >
            系统日志
          </h1>
          <span
            className="truncate"
            style={{
              fontSize: 'var(--trae-body-xs-font-size)',
              lineHeight: 1,
              color: 'var(--trae-text-tertiary)',
              whiteSpace: 'nowrap',
            }}
          >
            实时日志流与历史检索
          </span>
          <span
            className="inline-flex items-center"
            style={{
              gap: 4,
              height: 18,
              padding: '0 8px',
              fontSize: 9,
              fontWeight: 500,
              color: 'var(--trae-text-brand)',
              background: 'var(--trae-bg-brand-popup)',
              border: '1px solid var(--trae-border-brand)',
              borderRadius: 3,
            }}
          >
            <Sparkles
              size={10}
              style={{ color: 'var(--trae-icon-brand)' }}
            />
            AI 决策数据源
          </span>
        </div>

        <Button
          variant="outline"
          size="default"
          data-dom-id="back-workbench"
          onClick={handleBack}
          className="shrink-0"
        >
          <ArrowLeft size={16} />
          返回工作台
        </Button>
      </header>

      {/* ===== 2. Toolbar ===== */}
      <LogToolbar
        keyword={keyword}
        onKeywordChange={setKeyword}
        activeLevel={activeLevel}
        onLevelChange={setActiveLevel}
        autoScroll={autoScroll}
        onAutoScrollChange={setAutoScroll}
        onAiAnalyze={handleAiAnalyze}
        onRefresh={handleRefresh}
        onExport={handleExport}
      />

      {/* ===== 3. 两栏布局 ===== */}
      <div
        className="flex min-h-0 flex-1"
        style={{ gap: 12, padding: 12 }}
      >
        {/* 左：日志源侧边栏 (180px) */}
        <LogSidebar activeId={activeSource} onSelect={setActiveSource} />

        {/* 右：终端式日志查看器 */}
        <div className="relative flex min-w-0 flex-1 flex-col">
          {/* 加载状态覆盖层 */}
          {loading && (
            <div
              className="absolute inset-0 z-20 flex items-center justify-center"
              style={{
                background: 'rgba(15, 16, 17, 0.7)',
                borderRadius: 'var(--trae-radius-8)',
              }}
            >
              <div className="flex items-center" style={{ gap: 8 }}>
                <Loader2
                  size={18}
                  className="animate-spin"
                  style={{ color: 'var(--trae-status-primary-default)' }}
                />
                <span
                  style={{
                    fontSize: 'var(--trae-body-sm-font-size)',
                    color: 'var(--trae-text-secondary)',
                  }}
                >
                  加载日志中...
                </span>
              </div>
            </div>
          )}

          {/* 错误状态 */}
          {error && !loading ? (
            <div
              className="flex flex-1 flex-col items-center justify-center"
              style={{
                background: '#0F1011',
                border: '1px solid var(--trae-border-neutral-l1)',
                borderRadius: 'var(--trae-radius-8)',
                gap: 12,
              }}
            >
              <AlertTriangle
                size={32}
                style={{ color: 'var(--trae-status-error-default)' }}
              />
              <span
                style={{
                  fontSize: 'var(--trae-body-sm-font-size)',
                  color: 'var(--trae-text-secondary)',
                }}
              >
                {error}
              </span>
              <Button variant="outline" size="default" onClick={handleRefresh}>
                <RefreshCw size={14} />
                重试
              </Button>
            </div>
          ) : (
            <LogViewer entries={viewerEntries} />
          )}
        </div>
      </div>

      {/* ===== 4. Status bar (24px) ===== */}
      <footer
        className="flex shrink-0 items-center justify-between"
        style={{
          height: 24,
          padding: '0 16px',
          background: 'var(--trae-bg-base-secondary)',
          borderTop: '1px solid var(--trae-border-neutral-l1)',
          fontFamily: 'var(--trae-font-family-mono)',
          fontSize: 11,
          color: 'var(--trae-text-secondary)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {/* 左：日志总数 + 级别统计 */}
        <div className="flex min-w-0 items-center" style={{ gap: 6 }}>
          <FileText
            size={12}
            className="shrink-0"
            style={{ color: 'var(--trae-icon-tertiary)' }}
          />
          <span className="truncate" style={{ whiteSpace: 'nowrap' }}>
            系统日志 · {totalCount.toLocaleString()} 条
          </span>
          {stats && (
            <span style={{ whiteSpace: 'nowrap', opacity: 0.7 }}>
              {Object.entries(stats.byLevel)
                .filter(([, count]) => count > 0)
                .map(([level, count]) => `${level} ${count}`)
                .join(' / ')}
            </span>
          )}
        </div>

        {/* 中：最新时间 + 实时流 */}
        <div className="flex shrink-0 items-center" style={{ gap: 6 }}>
          <Clock
            size={12}
            className="shrink-0"
            style={{ color: 'var(--trae-icon-tertiary)' }}
          />
          <span style={{ whiteSpace: 'nowrap' }}>
            最新: {formatTs(latestTs)}
          </span>
          <RefreshCw
            size={12}
            className="shrink-0 animate-pulse"
            style={{ color: 'var(--trae-status-primary-default)' }}
          />
          <span
            style={{
              whiteSpace: 'nowrap',
              color: 'var(--trae-status-primary-default)',
            }}
          >
            实时流
          </span>
        </div>

        {/* 右：导出 CSV */}
        <button
          type="button"
          onClick={handleExport}
          className="flex shrink-0 cursor-pointer items-center transition-colors hover:text-[var(--trae-text-brand)]"
          style={{ gap: 6, background: 'transparent', border: 'none', padding: 0 }}
        >
          <Download
            size={12}
            className="shrink-0"
            style={{ color: 'currentColor' }}
          />
          <span style={{ whiteSpace: 'nowrap' }}>导出CSV</span>
        </button>
      </footer>

      {/* 动效：btn-press + reduced-motion 降级 */}
      <style>{`
        .btn-press { transition: transform 80ms ease-out; }
        .btn-press:active { transform: scale(0.92); }
        @media (prefers-reduced-motion: reduce) {
          * {
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.01ms !important;
          }
        }
      `}</style>
    </main>
  )
}
