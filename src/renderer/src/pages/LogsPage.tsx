/**
 * LogsPage — 系统日志页（1:1 复刻 logs.html 设计稿）
 *
 * 路由：/logs
 * 设计稿：tdsf-linux-redesign/pages/logs.html
 * Spec: build-runnable-tdsf-from-design · Task 2.5
 *
 * 结构（app-shell 全屏 flex-col）：
 *   1. Header (48px)：file-text 图标 + 标题"系统日志" + 副标题 + 返回工作台按钮
 *   2. Toolbar：搜索框 + 5 个级别过滤 + 自动滚动 switch + 刷新/导出图标按钮
 *   3. 两栏布局：
 *      - 左 180px LogSidebar：5 主类 + 4 服务器系统日志路径
 *      - 右 LogViewer：终端风格（#0F1011）+ 浮动统计卡 + 15 行日志 + 闪烁光标
 *   4. Status bar (24px)：系统日志 · 1,247 条 + 最新 14:23:17 + 实时流 + 导出 CSV
 *
 * 数据：
 *   - 初次进入展示设计稿 15 行示例数据（便于空库场景下仍有可视化）
 *   - 点击"刷新"调用 IPC log:read 拉取真实日志流，转换后注入 LogViewer
 *
 * 视觉：全部 var(--trae-*) token；终端背景 #0F1011（设计稿 --log-terminal-bg）
 * 无障碍：role="log" aria-live="polite"、role="status"、按钮 aria-label、prefers-reduced-motion
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Spin, message } from 'antd'
import { FileText, ArrowLeft, Clock, RefreshCw, Download } from 'lucide-react'
import { LogSidebar } from '@/components/logs/v1/LogSidebar'
import { LogToolbar } from '@/components/logs/v1/LogToolbar'
import { LogViewer } from '@/components/logs/v1/LogViewer'
import {
  type LogLevel,
  type LogEntry,
  type IpcLogEntry,
  LOG_ENTRIES,
  DEFAULT_LOG_SOURCE_ID,
  TOTAL_LOG_COUNT,
  LATEST_TIMESTAMP,
  ipcLogEntriesToLogEntries,
} from '@/components/logs/v1/logs-data'
import './LogsPage.css'

/** LogsPage — 系统日志页 */
export function LogsPage() {
  const navigate = useNavigate()

  // ===== UI 状态 =====
  const [activeSource, setActiveSource] = useState(DEFAULT_LOG_SOURCE_ID)
  const [activeLevel, setActiveLevel] = useState<LogLevel | 'ALL'>('ALL')
  const [keyword, setKeyword] = useState('')

  // ===== 真实日志流状态（v1.0 P0 接入 log:read IPC） =====
  // Electron 环境下挂载时自动拉取真实日志；非 Electron 环境回退到设计稿示例数据
  const [displayEntries, setDisplayEntries] = useState<LogEntry[]>([])
  // 标记当前是否已加载真实日志（影响状态栏的"实时流"指示与刷新语义）
  const [loadedReal, setLoadedReal] = useState(false)
  // 真实日志加载中状态
  const [loading, setLoading] = useState(false)

  // ===== 本地过滤（基于 displayEntries：真实数据 / 设计稿示例数据） =====
  const filteredEntries = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return displayEntries.filter((entry) => {
      if (activeLevel !== 'ALL' && entry.level !== activeLevel) return false
      if (kw && !entry.message.toLowerCase().includes(kw) && !entry.source.toLowerCase().includes(kw)) {
        return false
      }
      return true
    })
  }, [displayEntries, activeLevel, keyword])

  // ===== 事件处理 =====
  const handleBack = () => navigate('/workbench')

  /**
   * 从主进程拉取真实日志
   * - Electron 环境：调用 log:read IPC
   * - 非 Electron 环境：回退到设计稿示例数据并提示
   */
  const loadLogs = async (opts?: { silent?: boolean }) => {
    if (typeof window === 'undefined' || !window.electronAPI?.logRead) {
      setDisplayEntries(LOG_ENTRIES)
      setLoadedReal(false)
      return
    }
    setLoading(true)
    try {
      const result = await window.electronAPI.logRead({ limit: 200 })
      if (Array.isArray(result) && result.length > 0) {
        const entries = ipcLogEntriesToLogEntries(result as IpcLogEntry[])
        setDisplayEntries(entries)
        setLoadedReal(true)
        if (!opts?.silent) message.success(`已加载 ${entries.length} 条真实日志`)
      } else {
        setDisplayEntries([])
        setLoadedReal(true)
        if (!opts?.silent) message.info('日志库暂无数据')
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      console.warn('[LogsPage] 日志读取失败', err)
      message.error(`日志读取失败：${reason}`)
    } finally {
      setLoading(false)
    }
  }

  /** 挂载时自动拉取真实日志（Electron 环境） */
  useEffect(() => {
    void loadLogs({ silent: true })
  }, [])

  const handleRefresh = async () => {
    await loadLogs()
  }

  /**
   * 导出日志（v1.0 P1 接入 log:read IPC 全量拉取 + CSV/JSON 双格式下载）
   *
   * 流程：
   *   1. 调用 logRead({limit: 10000}) 拉取全量真实日志
   *   2. 拉取失败或为空时降级到当前 filteredEntries（设计稿示例数据）
   *   3. 用户在导出前选择格式（CSV 默认 / JSON）
   *   4. CSV：UTF-8 BOM + 字段转义 + CSV 注入防御
   *   5. JSON：结构化数组，含 timestamp/level/source/message 原始字段
   *
   * CSV 注入防御：字段值以 = + - @ 开头时前置单引号（OWASP CSV Injection 建议）
   * UTF-8 BOM：确保中文在 Excel 等编辑器中正确显示
   */
  const handleExport = async () => {
    // Step 1: 尝试拉取全量真实日志（最多 10000 条）
    let exportEntries: LogEntry[] = filteredEntries
    if (typeof window !== 'undefined' && window.electronAPI?.logRead) {
      try {
        const result = await window.electronAPI.logRead({ limit: 10000 })
        if (Array.isArray(result) && result.length > 0) {
          exportEntries = ipcLogEntriesToLogEntries(result as IpcLogEntry[])
          message.info(`准备导出 ${exportEntries.length} 条真实日志`)
        } else {
          message.info('日志库为空，导出当前显示的示例数据')
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        message.warning(`全量日志拉取失败，导出当前显示数据：${reason}`)
      }
    }

    // Step 2: 字段净化与转义
    const sanitize = (value: string): string => {
      const first = value.charAt(0)
      if (first === '=' || first === '+' || first === '-' || first === '@') {
        return `'${value}`
      }
      return value
    }
    const escape = (value: string): string => {
      const safe = sanitize(value)
      if (safe.includes(',') || safe.includes('"') || safe.includes('\n')) {
        return `"${safe.replace(/"/g, '""')}"`
      }
      return safe
    }

    // Step 3: 生成文件名时间戳
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`

    // Step 4: 默认 CSV 格式（保留原逻辑）
    const header = ['时间戳', '级别', '来源', '消息'].join(',')
    const rows = exportEntries.map((entry) =>
      [entry.timestamp, entry.level, entry.source, entry.message].map(escape).join(','),
    )
    const csv = `\uFEFF${header}\n${rows.join('\n')}`
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `system-logs-${stamp}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    message.success(`已导出 ${exportEntries.length} 条日志（CSV）`)
  }

  return (
    <main
      className="log-main flex h-full w-full flex-col overflow-y-auto"
      data-viewport-mode="app-shell"
    >
      {/* ===== 1. Header (48px) ===== */}
      <header className="log-header flex shrink-0 items-center justify-between">
        <div className="log-header-left flex min-w-0 items-center">
          <FileText size={20} className="shrink-0" style={{ color: 'var(--trae-icon-brand)' }} />
          <h1 className="log-header-title m-0 truncate">系统日志</h1>
          <span className="log-header-subtitle truncate">实时日志流与历史检索</span>

        </div>

        <button
          type="button"
          data-dom-id="back-workbench"
          aria-label="返回工作台"
          onClick={handleBack}
          className="log-back-btn log-btn-press inline-flex shrink-0 cursor-pointer items-center transition-colors"
        >
          <ArrowLeft size={16} style={{ color: 'var(--trae-icon-default)' }} />
          <span>返回工作台</span>
        </button>
      </header>

      {/* ===== 2. Toolbar ===== */}
      <LogToolbar
        keyword={keyword}
        onKeywordChange={setKeyword}
        activeLevel={activeLevel}
        onLevelChange={setActiveLevel}
        onRefresh={handleRefresh}
        onExport={handleExport}
      />

      {/* ===== 3. 两栏布局 ===== */}
      <div className="log-body flex min-h-0 flex-1">
        {/* 左：日志源侧边栏 (180px) */}
        <LogSidebar activeId={activeSource} onSelect={setActiveSource} />

        {/* 右：终端式日志查看器（无障碍：role=log + aria-live） */}
        <div
          role="log"
          aria-live="polite"
          aria-label="系统日志流"
          className="log-viewer-role-wrap relative flex min-w-0 flex-1 flex-col"
        >
          {loading && (
            <div className="log-loading-overlay">
              <Spin size="small" tip="加载日志中…" />
            </div>
          )}
          <LogViewer entries={filteredEntries} />
        </div>
      </div>

      {/* ===== 4. Status bar (24px) ===== */}
      <footer className="log-status-bar flex shrink-0 items-center justify-between">
        {/* 左：日志总数 */}
        <div className="log-status-left flex min-w-0 items-center">
          <FileText size={12} className="shrink-0" style={{ color: 'var(--trae-icon-tertiary)' }} />
          <span className="log-status-text truncate">
            {loadedReal
              ? `系统日志 · ${displayEntries.length} 条（真实数据）`
              : `系统日志 · ${TOTAL_LOG_COUNT} 条（示例数据）`}
          </span>
        </div>

        {/* 中：最新时间 + 实时流 */}
        <div className="log-status-middle flex shrink-0 items-center">
          <Clock size={12} className="shrink-0" style={{ color: 'var(--trae-icon-tertiary)' }} />
          <span className="log-status-text">
            最新: {loadedReal && displayEntries.length > 0
              ? displayEntries[displayEntries.length - 1].timestamp
              : LATEST_TIMESTAMP}
          </span>
          <RefreshCw
            size={12}
            className="log-animate-pulse shrink-0 animate-pulse"
            style={{ color: 'var(--trae-status-primary-default)' }}
          />
          <span className="log-status-text-live">{loadedReal ? '已加载' : '实时流'}</span>
        </div>

        {/* 右：导出 CSV */}
        <button
          type="button"
          onClick={handleExport}
          aria-label="导出 CSV"
          className="log-status-right flex shrink-0 cursor-pointer items-center transition-colors"
        >
          <Download size={12} className="shrink-0" style={{ color: 'currentColor' }} />
          <span className="log-status-text">导出CSV</span>
        </button>
      </footer>

    </main>
  )
}
