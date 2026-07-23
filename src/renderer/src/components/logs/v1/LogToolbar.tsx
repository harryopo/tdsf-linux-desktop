/**
 * LogToolbar — 日志工具栏（LogsPage 子组件）
 *
 * 设计稿参考：logs.html 第 2 节 Toolbar
 * 结构（左→右）：
 *   1. 搜索框（300px，左 32px 内边距容纳搜索图标，等宽字体）
 *   2. Level filter：5 个 radio tabs（全部/INFO/WARN/ERROR/DEBUG），active 项品牌色边框
 *   3. 右侧 cluster（ml-auto）：
 *      - 自动滚动 switch（32x18 椭圆 + 14x14 圆点）
 *      - 刷新图标按钮（28x28）
 *      - 导出图标按钮（28x28）
 *
 * JS 交互：
 *   - 搜索关键词（useState 由父组件控制）
 *   - Level filter（useState 由父组件控制）
 *   - 自动滚动 switch（useState 由父组件控制）
 *   - 刷新 / 导出 按钮（onClick 回调）
 */
import { Search, RefreshCw, Download, Sparkles } from 'lucide-react'
import { Switch, Tooltip } from 'antd'
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
  onRefresh,
  onExport,
  autoScroll = true,
  onAutoScrollChange,
  onAiAnalysis,
  aiAnalysisDisabled = false,
  aiAnalysisTooltip,
}: {
  keyword: string
  onKeywordChange: (v: string) => void
  activeLevel: LogLevel | 'ALL'
  onLevelChange: (level: LogLevel | 'ALL') => void
  onRefresh: () => void
  onExport: () => void
  /** 自动滚动开关（受控） */
  autoScroll?: boolean
  /** 自动滚动状态变更回调 */
  onAutoScrollChange?: (checked: boolean) => void
  /** AI 日志分析按钮点击回调（设计稿：Toolbar 右侧 cluster 首项） */
  onAiAnalysis?: () => void
  /** AI 日志分析按钮是否禁用（日志条数 < 5 时禁用） */
  aiAnalysisDisabled?: boolean
  /** AI 日志分析按钮 Tooltip 文案 */
  aiAnalysisTooltip?: string
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
        {/* AI 日志分析按钮（设计稿：品牌色描边 + sparkles 图标，置于自动滚动之前） */}
        {onAiAnalysis && (
          <Tooltip title={aiAnalysisTooltip ?? '调用 sidecar:pipeline 执行 Drain3 模板聚类 + AI 根因分析'}>
            <button
              type="button"
              onClick={onAiAnalysis}
              disabled={aiAnalysisDisabled}
              className="log-btn-press log-ai-btn inline-flex items-center justify-center transition-colors"
            >
              <Sparkles size={14} style={{ color: 'var(--trae-icon-brand)' }} />
              <span>AI 日志分析</span>
            </button>
          </Tooltip>
        )}

        {/* 自动滚动 switch（设计稿 32x18 椭圆，复用 .log-autoscroll-label 间距） */}
        <div className="log-autoscroll-label flex items-center">
          <span className="log-autoscroll-text">自动滚动</span>
          <Switch
            size="small"
            checked={autoScroll}
            onChange={onAutoScrollChange}
            aria-label="自动滚动"
          />
        </div>

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
