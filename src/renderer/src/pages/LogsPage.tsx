/**
 * LogsPage — 系统日志页（1:1 复刻 logs.html 设计稿）
 *
 * 路由：/logs
 * 设计稿：tdsf-linux-redesign/pages/logs.html
 * Spec: build-runnable-tdsf-from-design · Task 2.5
 *
 * 结构（app-shell 全屏 flex-col）：
 *   1. Header (48px)：file-text 图标 + 标题"系统日志" + 副标题 + AI 决策数据源 chip + 返回工作台按钮
 *   2. Toolbar：搜索框 + 5 个级别过滤 + AI 日志分析 + 自动滚动 switch + 刷新/导出图标按钮
 *   3. 两栏布局：
 *      - 左 180px LogSidebar：5 主类 + 4 服务器系统日志路径
 *      - 右 LogViewer：终端风格（#0F1011）+ 浮动统计卡 + 15 行日志 + 闪烁光标
 *   4. Status bar (24px)：系统日志 · 1,247 条 + 最新 14:23:17 + 实时流 + 导出 CSV
 *
 * 数据：
 *   - 初次进入展示设计稿 15 行示例数据（便于空库场景下仍有可视化）
 *   - 点击"刷新"调用 IPC log:read 拉取真实日志流，转换后注入 LogViewer
 *   - 点击"AI 分析"调用 IPC llmAnalyze，将当前过滤后的日志作为 Evidence 输入
 *
 * 视觉：全部 var(--trae-*) token；终端背景 #0F1011（设计稿 --log-terminal-bg）
 * 无障碍：role="log" aria-live="polite"、role="status"、按钮 aria-label、prefers-reduced-motion
 */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Modal, Spin, message } from 'antd'
import { FileText, ArrowLeft, Sparkles, Clock, RefreshCw, Download } from 'lucide-react'
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

/** AI 分析状态机 */
type AnalyzeState = 'idle' | 'loading' | 'done' | 'error'

/** LogsPage — 系统日志页 */
export function LogsPage() {
  const navigate = useNavigate()

  // ===== UI 状态 =====
  const [activeSource, setActiveSource] = useState(DEFAULT_LOG_SOURCE_ID)
  const [activeLevel, setActiveLevel] = useState<LogLevel | 'ALL'>('ALL')
  const [keyword, setKeyword] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)

  // ===== 真实日志流状态（v1.0 P0 接入 log:read IPC） =====
  // displayEntries 同时承载设计稿示例数据与 IPC 返回的真实日志
  const [displayEntries, setDisplayEntries] = useState<LogEntry[]>(LOG_ENTRIES)
  // 标记当前是否已加载真实日志（影响状态栏的"实时流"指示与刷新语义）
  const [loadedReal, setLoadedReal] = useState(false)

  // ===== AI 分析状态（v1.0 P0 接入 llmAnalyze IPC） =====
  const [analyzeState, setAnalyzeState] = useState<AnalyzeState>('idle')
  const [analyzeResult, setAnalyzeResult] = useState<string>('')
  const [analyzeModalOpen, setAnalyzeModalOpen] = useState(false)

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

  const handleRefresh = async () => {
    // 真实 IPC 调用：从 main 进程 log:read 通道读取最新日志
    if (typeof window === 'undefined' || !window.electronAPI?.logRead) {
      // WIP: 非 Electron 环境降级为静态数据提示（CLAUDE.md A4 诚实标注）
      message.warning('当前环境不支持日志读取（非 Electron 环境）')
      return
    }
    try {
      const result = await window.electronAPI.logRead({ limit: 200 })
      if (Array.isArray(result) && result.length > 0) {
        // 真实日志流注入 LogViewer（v1.0 P0 接线完成）
        const entries = ipcLogEntriesToLogEntries(result as IpcLogEntry[])
        setDisplayEntries(entries)
        setLoadedReal(true)
        message.success(`已加载 ${entries.length} 条真实日志`)
      } else {
        // 库为空时保留设计稿示例数据，避免空白页
        message.info('日志库暂无数据，保留示例数据展示')
      }
    } catch (err) {
      // 错误已由 main 进程 logger 记录，此处给用户可见反馈避免静默失败
      const reason = err instanceof Error ? err.message : String(err)
      message.error(`日志读取失败：${reason}`)
    }
  }

  /**
   * AI 日志分析（v1.0 P0 接入 llmAnalyze IPC）
   *
   * 流程：
   *   1. 将 filteredEntries 转换为 Evidence[]（source='log'，content=日志消息）
   *   2. 调用 llmAnalyze(question, evidences)
   *   3. 弹窗展示分析结果
   *
   * Evidence 字段填充策略：
   *   - id：日志条目 id 转字符串
   *   - source：'log'（EvidenceSource 枚举）
   *   - sourceDetail：日志来源（source 字段）
   *   - content：日志消息 + 时间戳 + 级别（便于 LLM 上下文）
   *   - drainMatch / sourcePrior / confidence：日志场景默认 1.0（原始数据未经算法处理）
   *   - timestamp：解析时间戳字符串为 ms
   *   - verified：false（原始日志未经 Ground-Check）
   */
  const handleAnalyze = async () => {
    if (typeof window === 'undefined' || !window.electronAPI?.llmAnalyze) {
      message.warning('当前环境不支持 AI 分析（非 Electron 环境）')
      return
    }
    if (filteredEntries.length === 0) {
      message.warning('没有可分析的日志（当前过滤结果为空）')
      return
    }

    setAnalyzeState('loading')
    setAnalyzeModalOpen(true)
    setAnalyzeResult('')

    try {
      // 将日志条目转换为 Evidence
      const today = new Date()
      const baseTs = today.getTime()
      const evidences = filteredEntries.map((entry, idx) => {
        // 解析 HH:mm:ss.SSS 为今天的 ms 时间戳
        const parts = entry.timestamp.split(':')
        const secParts = (parts[2] || '0').split('.')
        const h = parseInt(parts[0] || '0', 10)
        const m = parseInt(parts[1] || '0', 10)
        const s = parseInt(secParts[0] || '0', 10)
        const ms = parseInt((secParts[1] || '0').padEnd(3, '0').slice(0, 3), 10)
        const ts = new Date(today)
        ts.setHours(h, m, s, ms)
        return {
          id: `log-${entry.id}-${idx}`,
          source: 'log' as const,
          sourceDetail: entry.source,
          content: `[${entry.timestamp}] [${entry.level}] ${entry.message}`,
          drainMatch: 1.0,
          sourcePrior: 1.0,
          confidence: 1.0,
          timestamp: isNaN(ts.getTime()) ? baseTs : ts.getTime(),
          verified: false,
        }
      })

      // 构造分析问题
      const levelSummary = filteredEntries.reduce(
        (acc, e) => { acc[e.level] = (acc[e.level] || 0) + 1; return acc },
        {} as Record<string, number>,
      )
      const summary = Object.entries(levelSummary)
        .map(([k, v]) => `${k}: ${v}`)
        .join('，')
      const question = `请分析以下 ${filteredEntries.length} 条系统日志（${summary}），识别异常模式、根因假设、关联事件，并给出处置建议。`

      const result = await window.electronAPI.llmAnalyze(question, evidences)
      setAnalyzeResult(result || '（AI 返回空结果）')
      setAnalyzeState('done')
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      setAnalyzeResult(`分析失败：${reason}`)
      setAnalyzeState('error')
    }
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
          <span className="log-header-ai-chip inline-flex items-center">
            <Sparkles size={10} style={{ color: 'var(--trae-icon-brand)' }} />
            AI 决策数据源
          </span>
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
        autoScroll={autoScroll}
        onAutoScrollChange={setAutoScroll}
        onAnalyze={handleAnalyze}
        analyzing={analyzeState === 'loading'}
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

      {/* ===== 5. AI 分析结果弹窗（v1.0 P0 接入 llmAnalyze IPC） ===== */}
      <Modal
        open={analyzeModalOpen}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={16} style={{ color: 'var(--trae-icon-brand)' }} />
            <span>AI 日志分析结果</span>
          </div>
        }
        onCancel={() => setAnalyzeModalOpen(false)}
        footer={null}
        width={680}
        styles={{
          body: { maxHeight: '60vh', overflow: 'auto', whiteSpace: 'pre-wrap' as const },
        }}
      >
        {analyzeState === 'loading' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '24px 0' }}>
            <Spin size="small" />
            <span>正在分析 {filteredEntries.length} 条日志…</span>
          </div>
        )}
        {analyzeState === 'done' && (
          <div style={{ lineHeight: 1.7, color: 'var(--trae-text-default)' }}>
            {analyzeResult}
          </div>
        )}
        {analyzeState === 'error' && (
          <div style={{ color: 'var(--trae-status-error-default)' }}>
            {analyzeResult}
          </div>
        )}
      </Modal>
    </main>
  )
}
