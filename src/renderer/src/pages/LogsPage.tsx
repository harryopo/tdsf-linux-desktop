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
 * 数据：严格使用设计稿 logs.html 中的 15 行示例数据 + 5 个分类计数 + 4 个文件路径计数 + 1247 总数
 * 视觉：全部 var(--trae-*) token；终端背景 #0F1011（设计稿 --log-terminal-bg）
 * 无障碍：role="log" aria-live="polite"、role="status"、按钮 aria-label、prefers-reduced-motion
 */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, ArrowLeft, Sparkles, Clock, RefreshCw, Download } from 'lucide-react'
import { LogSidebar } from '@/components/logs/v1/LogSidebar'
import { LogToolbar } from '@/components/logs/v1/LogToolbar'
import { LogViewer } from '@/components/logs/v1/LogViewer'
import {
  type LogLevel,
  LOG_ENTRIES,
  DEFAULT_LOG_SOURCE_ID,
  TOTAL_LOG_COUNT,
  LATEST_TIMESTAMP,
} from '@/components/logs/v1/logs-data'

/** LogsPage — 系统日志页 */
export function LogsPage() {
  const navigate = useNavigate()

  // ===== UI 状态 =====
  const [activeSource, setActiveSource] = useState(DEFAULT_LOG_SOURCE_ID)
  const [activeLevel, setActiveLevel] = useState<LogLevel | 'ALL'>('ALL')
  const [keyword, setKeyword] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)

  // ===== 本地过滤（基于设计稿 15 行示例数据） =====
  const filteredEntries = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return LOG_ENTRIES.filter((entry) => {
      if (activeLevel !== 'ALL' && entry.level !== activeLevel) return false
      if (kw && !entry.message.toLowerCase().includes(kw) && !entry.source.toLowerCase().includes(kw)) {
        return false
      }
      return true
    })
  }, [activeLevel, keyword])

  // ===== 事件处理 =====
  const handleBack = () => navigate('/workbench')

  const handleRefresh = () => {
    // 设计稿为静态展示数据，刷新为占位交互（保留按钮可点击）
    if (typeof window !== 'undefined' && window.electronAPI?.logRead) {
      void window.electronAPI.logRead({ limit: 200 }).catch(() => {})
    }
  }

  const handleExport = () => {
    // CSV 注入防御：字段值以 = + - @ 开头时前置单引号（OWASP CSV Injection 建议）
    const sanitize = (value: string): string => {
      const first = value.charAt(0)
      if (first === '=' || first === '+' || first === '-' || first === '@') {
        return `'${value}`
      }
      return value
    }
    // CSV 字段转义：含逗号 / 引号 / 换行时用双引号包裹，内部引号双写
    const escape = (value: string): string => {
      const safe = sanitize(value)
      if (safe.includes(',') || safe.includes('"') || safe.includes('\n')) {
        return `"${safe.replace(/"/g, '""')}"`
      }
      return safe
    }
    const header = ['时间戳', '级别', '来源', '消息'].join(',')
    const rows = filteredEntries.map((entry) =>
      [entry.timestamp, entry.level, entry.source, entry.message].map(escape).join(','),
    )
    // UTF-8 BOM 确保中文在 Excel 等编辑器中正确显示
    const csv = `\uFEFF${header}\n${rows.join('\n')}`
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    const link = document.createElement('a')
    link.href = url
    link.download = `system-logs-${stamp}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

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
          padding: '0 var(--trae-spacer-16)',
          borderBottom: '1px solid var(--trae-border-neutral-l1)',
          background: 'var(--trae-bg-base-default)',
          height: 48,
        }}
      >
        <div className="flex min-w-0 items-center" style={{ gap: 12 }}>
          <FileText size={20} className="shrink-0" style={{ color: 'var(--trae-icon-brand)' }} />
          <h1
            className="m-0 truncate"
            style={{
              fontFamily: 'var(--trae-font-family-heading)',
              fontWeight: 'var(--trae-font-weight-strong)',
              color: 'var(--trae-text-default)',
              letterSpacing: '-0.01em',
              lineHeight: '28px',
              fontSize: 18,
              width: 111,
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
              fontWeight: 'var(--trae-font-weight-medium)',
              color: 'var(--trae-text-brand)',
              background: 'var(--trae-bg-brand-popup)',
              border: '1px solid var(--trae-border-brand)',
              borderRadius: 3,
            }}
          >
            <Sparkles size={10} style={{ color: 'var(--trae-icon-brand)' }} />
            AI 决策数据源
          </span>
        </div>

        <button
          type="button"
          data-dom-id="back-workbench"
          aria-label="返回工作台"
          onClick={handleBack}
          className="inline-flex shrink-0 cursor-pointer items-center transition-colors"
          style={{
            gap: 6,
            height: 32,
            padding: '0 12px',
            fontSize: 'var(--trae-body-sm-font-size)',
            fontWeight: 'var(--trae-font-weight-medium)',
            color: 'var(--trae-text-default)',
            background: 'var(--trae-bg-overlay-l2)',
            border: '1px solid var(--trae-border-neutral-l2)',
            borderRadius: 'var(--trae-radius-6)',
          }}
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
        onRefresh={handleRefresh}
        onExport={handleExport}
      />

      {/* ===== 3. 两栏布局 ===== */}
      <div className="flex min-h-0 flex-1" style={{ gap: 12, padding: 12 }}>
        {/* 左：日志源侧边栏 (180px) */}
        <LogSidebar activeId={activeSource} onSelect={setActiveSource} />

        {/* 右：终端式日志查看器（无障碍：role=log + aria-live） */}
        <div
          role="log"
          aria-live="polite"
          aria-label="系统日志流"
          className="relative flex min-w-0 flex-1 flex-col"
        >
          <LogViewer entries={filteredEntries} />
        </div>
      </div>

      {/* ===== 4. Status bar (24px) ===== */}
      <footer
        className="flex shrink-0 items-center justify-between"
        style={{
          height: 24,
          padding: '0 var(--trae-spacer-16)',
          background: 'var(--trae-bg-base-secondary)',
          borderTop: '1px solid var(--trae-border-neutral-l1)',
          fontFamily: 'var(--trae-font-family-mono)',
          fontSize: 11,
          color: 'var(--trae-text-secondary)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {/* 左：日志总数 */}
        <div className="flex min-w-0 items-center" style={{ gap: 6 }}>
          <FileText size={12} className="shrink-0" style={{ color: 'var(--trae-icon-tertiary)' }} />
          <span className="truncate" style={{ whiteSpace: 'nowrap' }}>
            系统日志 · {TOTAL_LOG_COUNT} 条
          </span>
        </div>

        {/* 中：最新时间 + 实时流 */}
        <div className="flex shrink-0 items-center" style={{ gap: 6 }}>
          <Clock size={12} className="shrink-0" style={{ color: 'var(--trae-icon-tertiary)' }} />
          <span style={{ whiteSpace: 'nowrap' }}>最新: {LATEST_TIMESTAMP}</span>
          <RefreshCw
            size={12}
            className="shrink-0 animate-pulse"
            style={{ color: 'var(--trae-status-primary-default)' }}
          />
          <span style={{ whiteSpace: 'nowrap', color: 'var(--trae-status-primary-default)' }}>
            实时流
          </span>
        </div>

        {/* 右：导出 CSV */}
        <button
          type="button"
          onClick={handleExport}
          aria-label="导出 CSV"
          className="flex shrink-0 cursor-pointer items-center transition-colors"
          style={{ gap: 6, background: 'transparent', border: 'none', padding: 0, color: 'inherit' }}
        >
          <Download size={12} className="shrink-0" style={{ color: 'currentColor' }} />
          <span style={{ whiteSpace: 'nowrap' }}>导出CSV</span>
        </button>
      </footer>

      {/* 动效降级：prefers-reduced-motion 禁用闪烁光标 */}
      <style>{`
        @media (prefers-reduced-motion: reduce) {
          .animate-pulse { animation: none !important; }
        }
      `}</style>
    </main>
  )
}
