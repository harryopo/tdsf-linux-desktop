/**
 * LogsPage — 系统日志页（1:1 复刻 logs.html 设计稿）
 *
 * 路由：/logs
 * 设计稿：tdsf-linux-redesign/pages/logs.html
 * Spec: build-runnable-tdsf-from-design · Task 2.5
 *
 * 结构（app-shell 全屏 flex-col）：
 *   1. Header (48px)：file-text 图标 + 标题"系统日志" + 副标题 + AI 决策数据源 chip
 *   2. Toolbar：搜索框(300px) + 5 个级别过滤 + AI 日志分析按钮 + 自动滚动 switch + 刷新/导出图标按钮
 *   3. 两栏布局：
 *      - 左 180px LogSidebar：5 主类(系统/应用/安全/AI决策/告警) + 4 服务器系统日志路径
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
import { useEffect, useMemo, useRef, useState } from 'react'
import { Spin, message } from 'antd'
import { FileText, Sparkles, Clock, RefreshCw, Download } from 'lucide-react'
import { LogSidebar } from '@/components/logs/v1/LogSidebar'
import { LogToolbar } from '@/components/logs/v1/LogToolbar'
import { LogViewer } from '@/components/logs/v1/LogViewer'
import { AiLogAnalysisPanel } from '@/components/logs/AiLogAnalysisPanel'
import {
  type LogLevel,
  type LogEntry,
  type IpcLogEntry,
  type LevelStat,
  type LogSourceItem,
  LOG_ENTRIES,
  DEFAULT_LOG_SOURCE_ID,
  TOTAL_LOG_COUNT,
  LATEST_TIMESTAMP,
  ipcLogEntriesToLogEntries,
  mapLogStats,
} from '@/components/logs/v1/logs-data'
import './LogsPage.css'
// v2.6：服务器 /var/log 真实读取需要活跃 SSH 会话
import { useServerStore } from '@/stores/server-store'

/**
 * 主类日志源→真实过滤规则（v2.6 去假）
 *
 * 此前侧栏主类点击把设计稿虚构的 category id 传给 log:read，与主进程真实
 * category（IPC/TUTORIAL/SSH 等）不匹配，切换后必然空结果。
 * 现改为对已加载的真实日志做本地分类过滤，分类计数也由此实时统计。
 */
const MAIN_SOURCE_FILTERS: Record<string, (e: LogEntry) => boolean> = {
  system: () => true,
  app: (e) => !/SSH|RISK|AGENT|LLM|PAOR|CREDIBILITY|SECURITY/i.test(e.source),
  security: (e) => /SSH|RISK|SECURITY|AUTH/i.test(e.source),
  'ai-decision': (e) => /AGENT|LLM|PAOR|CREDIBILITY|SKILL|PROVIDER/i.test(e.source),
  alert: (e) => e.level === 'WARN' || e.level === 'ERROR',
}

/** 远程日志行→LogEntry（级别启发式识别；无统一时间格式，时间列留空） */
function remoteLineToLogEntry(line: string, idx: number, sourceLabel: string): LogEntry {
  const level: LogLevel = /error|fail|denied|critical|panic/i.test(line)
    ? 'ERROR'
    : /warn/i.test(line)
      ? 'WARN'
      : 'INFO'
  return {
    id: idx + 1,
    timestamp: '—',
    level,
    source: sourceLabel.split('/').pop() ?? sourceLabel,
    message: line,
  }
}

/**
 * 从 IPC 日志数组中计算最新时间戳的 ISO 字符串（供实时轮询 logRead since 增量拉取用）。
 *
 * @param entries IPC 返回的日志条目（ts 为 ISO 字符串或 ms 时间戳）
 * @returns 最新一条日志的 ISO 字符串；数组为空或无效时返回空串
 */
function computeMaxTsIso(entries: Array<{ ts: string | number }>): string {
  let maxMs = 0
  for (const e of entries) {
    const ms = typeof e.ts === 'number' ? e.ts : new Date(e.ts).getTime()
    if (Number.isFinite(ms) && ms > maxMs) maxMs = ms
  }
  return maxMs > 0 ? new Date(maxMs).toISOString() : ''
}

/** LogsPage — 系统日志页 */
export function LogsPage() {
  // ===== UI 状态 =====
  const [activeSource, setActiveSource] = useState(DEFAULT_LOG_SOURCE_ID)
  const [activeLevel, setActiveLevel] = useState<LogLevel | 'ALL'>('ALL')
  const [keyword, setKeyword] = useState('')

  // ===== 真实日志流状态（v1.0 P0 接入 log:read IPC） =====
  // v2.3.4 修复：初始空数组而非 LOG_ENTRIES。原实现在非 Electron 环境回退 LOG_ENTRIES，
  //   Electron 环境 logRead 返回空时也保留 LOG_ENTRIES，导致"系统日志全是死代码"。
  // 新策略：
  //   - Electron 环境：空数组起步，等待 logRead 返回真实数据；空时显示 Empty 状态
  //   - 非 Electron 环境：明确标注"演示数据"回退到 LOG_ENTRIES
  const [displayEntries, setDisplayEntries] = useState<LogEntry[]>([])
  // 标记当前是否已加载真实日志（影响状态栏的"实时流"指示与刷新语义）
  const [loadedReal, setLoadedReal] = useState(false)
  // 真实日志加载中状态
  const [loading, setLoading] = useState(false)
  // 非 Electron 环境标记（仅用于“演示数据”提示）
  // v2.3.7 修复：eslint no-unused-vars 触发——state 暂时没在 UI 中读取，标记为 _
  const [_isDemoFallback, setIsDemoFallback] = useState(false)
  
  // ===== v2.6：远程 /var/log 真实读取状态 =====
  const activeSessionId = useServerStore((s) => s.activeSessionId)
  /** 远程文件内容（activeSource 为 system 组时展示） */
  const [remoteEntries, setRemoteEntries] = useState<LogEntry[]>([])
  /** 远程文件真实行数（wc -l），未读取前侧栏显示 — */
  const [remoteCounts, setRemoteCounts] = useState<Record<string, string>>({})
  /** 当前是否处于远程文件模式（决定 filteredEntries 数据源） */
  const remoteMode = !(activeSource in MAIN_SOURCE_FILTERS)

  // ===== 实时流 + log:stats（M3 Task 3） =====
  // 最新一条日志的 ISO 时间戳，用于实时轮询 logRead({since}) 增量拉取
  const lastTsRef = useRef<string>('')
  // 自动滚动开关（用 ref 同步给 setInterval 闭包，避免陈旧 state）
  const autoScrollRef = useRef<boolean>(true)
  // LogViewer 滚动容器 ref（供自动滚动到底部）
  const viewerRef = useRef<HTMLDivElement>(null)
  // 自动滚动受控 state（与 LogToolbar Switch 联动）
  const [autoScroll, setAutoScroll] = useState(true)
  // 日志级别统计（浮动卡，来自 log:stats IPC，经 mapLogStats 映射）
  const [levelStats, setLevelStats] = useState<LevelStat[]>([])

  // ===== AI 日志分析（M3 Task 4） =====
  // AiLogAnalysisPanel Drawer 开关；按钮在 Header 右侧（与"返回工作台"并排）
  const [aiPanelOpen, setAiPanelOpen] = useState(false)

  // ===== 本地过滤（v2.6：主类=真实分类过滤；/var/log=远程内容；叠加级别/关键词） =====
  const filteredEntries = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    const base = remoteMode
      ? remoteEntries
      : displayEntries.filter(MAIN_SOURCE_FILTERS[activeSource] ?? (() => true))
    return base.filter((entry) => {
      if (activeLevel !== 'ALL' && entry.level !== activeLevel) return false
      if (kw && !entry.message.toLowerCase().includes(kw) && !entry.source.toLowerCase().includes(kw)) {
        return false
      }
      return true
    })
  }, [displayEntries, remoteEntries, remoteMode, activeSource, activeLevel, keyword])

  // ===== v2.6：侧栏计数真实化（主类=已加载日志实时统计；/var/log=wc -l 结果或 —） =====
  const sourceCounts = useMemo(() => {
    const counts: Record<string, string> = {}
    for (const [sid, pred] of Object.entries(MAIN_SOURCE_FILTERS)) {
      counts[sid] = String(displayEntries.filter(pred).length)
    }
    for (const sid of ['messages', 'syslog', 'auth', 'nginx-error']) {
      counts[sid] = remoteCounts[sid] ?? '—'
    }
    return counts
  }, [displayEntries, remoteCounts])

  // ===== 事件处理 =====
  /**
   * 从主进程拉取真实日志
   * - Electron 环境：调用 log:read IPC；空时显示 Empty 而非 LOG_ENTRIES
   * - 非 Electron 环境（如 web 端预览）：标注"示例数据"回退到 LOG_ENTRIES
   */
  const loadLogs = async (opts?: { silent?: boolean }) => {
    if (typeof window === 'undefined' || !window.electronAPI?.logRead) {
      // 非 Electron 环境：仅示例数据回退
      setDisplayEntries(LOG_ENTRIES)
      setLoadedReal(false)
      setIsDemoFallback(true)
      return
    }
    // 进入 Electron 环境，使用真实数据
    setIsDemoFallback(false)
    setLoading(true)
    try {
      const result = await window.electronAPI.logRead({ limit: 200 })
      if (Array.isArray(result) && result.length > 0) {
        const entries = ipcLogEntriesToLogEntries(result as IpcLogEntry[])
        setDisplayEntries(entries)
        setLoadedReal(true)
        // 更新 lastTsRef（供实时轮询 since 增量拉取）
        lastTsRef.current = computeMaxTsIso(result)
        if (!opts?.silent) message.success(`已加载 ${entries.length} 条真实日志`)
      } else {
        // v2.3.4 修复：logRead 返回空时不再回退 LOG_ENTRIES，直接展示 Empty 状态
        setDisplayEntries([])
        setLoadedReal(true)
        lastTsRef.current = ''
        if (!opts?.silent) message.info('日志库暂无数据，主进程未产生日志')
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

  // ===== 实时日志流（5s 轮询，M3 Task 3） =====
  // 用轮询而非 push，避免新增 IPC 通道；since 增量拉取 + id|timestamp 去重 + 2000 条截断
  useEffect(() => {
    if (typeof window === 'undefined' || !window.electronAPI?.logRead) return
    const interval = setInterval(async () => {
      try {
        const filter: { since?: string; limit: number } = { limit: 200 }
        if (lastTsRef.current) filter.since = lastTsRef.current
        const result = await window.electronAPI.logRead(filter)
        if (!Array.isArray(result) || result.length === 0) return
        const newEntries = ipcLogEntriesToLogEntries(result as IpcLogEntry[])
        // 更新 lastTsRef（供下一轮 since）
        lastTsRef.current = computeMaxTsIso(result)
        setDisplayEntries((prev) => {
          // 去重：相同 id|timestamp 视为同一日志
          const existingKeys = new Set(prev.map((e) => `${e.id}|${e.timestamp}`))
          const filtered = newEntries.filter((e) => !existingKeys.has(`${e.id}|${e.timestamp}`))
          if (filtered.length === 0) return prev
          const merged = [...prev, ...filtered]
          // 限制最多 2000 条，超出截断头部
          return merged.length > 2000 ? merged.slice(-2000) : merged
        })
        // 自动滚动到底部（用 ref 同步，避免闭包陈旧）
        if (autoScrollRef.current) {
          requestAnimationFrame(() => {
            const el = viewerRef.current
            if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
          })
        }
      } catch (err) {
        console.error('[LogsPage] 实时轮询失败', err)
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  // ===== log:stats 动态统计（10s 轮询，M3 Task 3） =====
  useEffect(() => {
    if (typeof window === 'undefined' || !window.electronAPI?.logStats) return
    const fetchStats = async () => {
      try {
        const stats = await window.electronAPI.logStats()
        setLevelStats(mapLogStats(stats))
      } catch (err) {
        console.error('[LogsPage] logStats 失败', err)
      }
    }
    void fetchStats()
    const interval = setInterval(fetchStats, 10000)
    return () => clearInterval(interval)
  }, [])

  // ===== 源切换（v2.6 去假） =====
  // 主类：不再把设计稿虚构的 category 传给 IPC（必然空结果），本地分类过滤即时生效；
  // /var/log/*：经活跃 SSH 会话真实读取服务器文件（tail -n 200 + wc -l）。
  const handleSourceChange = async (source: LogSourceItem) => {
    if (source.group === 'main') {
      // 本地过滤，无需重拉；若尚未加载过真实日志则拉一次
      if (!loadedReal) await loadLogs({ silent: true })
      return
    }
    // 远程文件模式
    const api = window.electronAPI
    if (!activeSessionId || !api?.sshExec) {
      setRemoteEntries([])
      message.warning('读取服务器日志需要先连接 SSH（顶栏服务器菜单或「设置 → SSH」）')
      return
    }
    setLoading(true)
    try {
      const path = source.label // 固定白名单路径（logs-data LOG_SOURCES），无注入风险
      const [tailRes, wcRes] = await Promise.all([
        api.sshExec(activeSessionId, `tail -n 200 ${path} 2>/dev/null`),
        api.sshExec(activeSessionId, `wc -l < ${path} 2>/dev/null`),
      ])
      const lineCount = parseInt(wcRes.stdout.trim(), 10)
      setRemoteCounts((prev) => ({
        ...prev,
        [source.id]: Number.isFinite(lineCount) ? String(lineCount) : '0',
      }))
      const lines = tailRes.stdout.split('\n').filter((l) => l.trim().length > 0)
      if (lines.length === 0) {
        setRemoteEntries([])
        message.info(`${path} 在服务器上不存在或为空`)
      } else {
        setRemoteEntries(lines.map((l, i) => remoteLineToLogEntry(l, i, source.label)))
        message.success(`已读取 ${path} 最近 ${lines.length} 行（真实服务器文件）`)
      }
    } catch (err) {
      console.error('[LogsPage] 远程日志读取失败', err)
      setRemoteEntries([])
      message.error(`读取失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  // ===== 自动滚动开关（与 LogToolbar Switch 联动） =====
  const handleAutoScrollChange = (checked: boolean) => {
    setAutoScroll(checked)
    // 同步给 ref，供 setInterval 闭包读取（避免陈旧 state）
    autoScrollRef.current = checked
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
      {/* ===== 1. Header (48px) — 设计稿 1:1：图标 + 标题 + 副标题 + AI 决策数据源 chip ===== */}
      <header className="log-header flex shrink-0 items-center justify-between">
        <div className="log-header-left flex min-w-0 items-center">
          <FileText size={20} className="shrink-0" style={{ color: 'var(--trae-icon-brand)' }} />
          <h1 className="log-header-title m-0 truncate">系统日志</h1>
          <span className="log-header-subtitle truncate">实时日志流与历史检索</span>
          {/* AI 决策数据源 chip（设计稿：sparkles 图标 + 品牌色描边） */}
          <span className="log-header-ai-chip inline-flex items-center">
            <Sparkles size={10} style={{ color: 'var(--trae-icon-brand)' }} />
            <span>AI 决策数据源</span>
          </span>
        </div>
      </header>

      {/* ===== 2. Toolbar — AI 日志分析按钮按设计稿移入此处 ===== */}
      <LogToolbar
        keyword={keyword}
        onKeywordChange={setKeyword}
        activeLevel={activeLevel}
        onLevelChange={setActiveLevel}
        onRefresh={handleRefresh}
        onExport={handleExport}
        autoScroll={autoScroll}
        onAutoScrollChange={handleAutoScrollChange}
        onAiAnalysis={() => setAiPanelOpen(true)}
        aiAnalysisDisabled={filteredEntries.length < 5}
        aiAnalysisTooltip={
          filteredEntries.length === 0
            ? '当前无日志，无法分析'
            : filteredEntries.length < 5
              ? '日志数量不足，至少需要 5 条'
              : '调用 sidecar:pipeline 执行 Drain3 模板聚类 + AI 根因分析'
        }
      />

      {/* ===== 3. 两栏布局 ===== */}
      <div className="log-body flex min-h-0 flex-1">
        {/* 左：日志源侧边栏 (180px) */}
        <LogSidebar
          activeId={activeSource}
          onSelect={setActiveSource}
          onSourceChange={handleSourceChange}
          counts={loadedReal ? sourceCounts : undefined}
        />

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
          <LogViewer
            entries={filteredEntries}
            levelStats={levelStats}
            scrollRef={viewerRef}
          />
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

      {/* ===== 5. AI 日志分析 Drawer（M3 Task 4，对接 sidecar:pipeline） ===== */}
      <AiLogAnalysisPanel
        open={aiPanelOpen}
        logs={filteredEntries}
        onClose={() => setAiPanelOpen(false)}
      />

    </main>
  )
}
