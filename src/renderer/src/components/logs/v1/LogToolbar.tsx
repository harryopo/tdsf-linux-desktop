/**
 * LogToolbar — 日志工具栏（LogsPage 子组件）
 *
 * 设计稿参考：logs.html 第 2 节 Toolbar
 * 结构（左→右）：
 *   1. 搜索框（300px，左 32px 内边距容纳搜索图标，等宽字体）
 *   2. Level filter：5 个 radio tabs（全部/INFO/WARN/ERROR/DEBUG），active 项品牌色边框
 *   3. 右侧 cluster（ml-auto）：
 *      - AI 日志分析按钮（Sparkles 图标 + 文字，v1.0 P0 接入 llmAnalyze）
 *      - 自动滚动 switch（32x18 椭圆 + 14x14 圆点）
 *      - 刷新图标按钮（28x28）
 *      - 导出图标按钮（28x28）
 *
 * JS 交互：
 *   - 搜索关键词（useState 由父组件控制）
 *   - Level filter（useState 由父组件控制）
 *   - 自动滚动 switch（useState 由父组件控制）
 *   - AI 分析 / 刷新 / 导出 按钮（onClick 回调）
 */
import { Sparkles, Search, RefreshCw, Download } from 'lucide-react'
import {
  type LogLevel,
  LEVEL_FILTERS,
} from './logs-data'

/** LogToolbar — 日志工具栏 */
export function LogToolbar({
  keyword,
  onKeywordChange,
  activeLevel,
  onLevelChange,
  autoScroll,
  onAutoScrollChange,
  onAnalyze,
  analyzing,
  onRefresh,
  onExport,
}: {
  keyword: string
  onKeywordChange: (v: string) => void
  activeLevel: LogLevel | 'ALL'
  onLevelChange: (level: LogLevel | 'ALL') => void
  autoScroll: boolean
  onAutoScrollChange: (v: boolean) => void
  /** AI 分析回调（v1.0 P0 接入 llmAnalyze IPC） */
  onAnalyze: () => void
  /** AI 分析进行中（禁用按钮 + 切换文案） */
  analyzing: boolean
  onRefresh: () => void
  onExport: () => void
}) {
  return (
    <div className="log-toolbar flex shrink-0 items-center">
      {/* 1. 搜索框 */}
      <div className="log-search shrink-0">
        <Search size={14} className="log-search-icon" />
        <input
          type="text"
          placeholder="过滤日志..."
          value={keyword}
          onChange={(e) => onKeywordChange(e.target.value)}
          className="log-search-input block w-full"
        />
      </div>

      {/* 2. Level filter（5 个 tab — 设计稿：扁平线框标签） */}
      <div className="log-level-filter flex shrink-0 items-center">
        {LEVEL_FILTERS.map((f) => {
          const active = activeLevel === f.id
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => onLevelChange(f.id)}
              className={`log-btn-press log-level-btn inline-flex items-center justify-center transition-colors ${active ? 'active' : ''}`}
            >
              {f.label}
            </button>
          )
        })}
      </div>

      {/* 3. 右侧 cluster */}
      <div className="log-right-cluster flex shrink-0 items-center">
        {/* AI 日志分析按钮（v1.0 P0 接入 llmAnalyze IPC） */}
        <button
          type="button"
          onClick={onAnalyze}
          disabled={analyzing}
          aria-label={analyzing ? 'AI 分析中' : 'AI 分析当前日志'}
          className="log-btn-press log-analyze-btn inline-flex items-center justify-center transition-colors"
        >
          <Sparkles size={13} style={{ color: 'var(--trae-icon-brand)' }} />
          <span>{analyzing ? '分析中…' : 'AI 分析'}</span>
        </button>

        {/* 自动滚动 switch */}
        <label
          className="log-autoscroll-label flex cursor-pointer select-none items-center"
          onClick={() => onAutoScrollChange(!autoScroll)}
        >
          <span className={`log-switch ${autoScroll ? 'is-on' : ''}`}>
            <span
              className={`log-switch-thumb ${autoScroll ? 'is-on' : 'is-off'}`}
            />
          </span>
          <span className="log-autoscroll-text">自动滚动</span>
        </label>

        {/* 刷新按钮 */}
        <button
          type="button"
          onClick={onRefresh}
          aria-label="刷新"
          className="log-btn-press log-icon-btn inline-flex items-center justify-center transition-colors"
        >
          <RefreshCw size={14} />
        </button>

        {/* 导出按钮 */}
        <button
          type="button"
          onClick={onExport}
          aria-label="导出日志"
          className="log-btn-press log-icon-btn inline-flex items-center justify-center transition-colors"
        >
          <Download size={14} />
        </button>
      </div>
    </div>
  )
}
