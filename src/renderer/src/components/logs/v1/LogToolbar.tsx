/**
 * LogToolbar — 日志工具栏（LogsPage 子组件）
 *
 * 设计稿参考：logs.html 第 2 节 Toolbar
 * 结构（左→右）：
 *   1. 搜索框（300px，左 32px 内边距容纳搜索图标，等宽字体）
 *   2. Level filter：5 个 radio tabs（全部/INFO/WARN/ERROR/DEBUG），active 项品牌色边框
 *   3. 右侧 cluster（ml-auto）：
 *      - AI 日志分析按钮（品牌色软背景 + sparkles 图标）
 *      - 自动滚动 switch（32x18 椭圆 + 14x14 圆点）
 *      - 刷新图标按钮（28x28）
 *      - 导出图标按钮（28x28）
 *
 * JS 交互：
 *   - 搜索关键词（useState 由父组件控制）
 *   - Level filter（useState 由父组件控制）
 *   - 自动滚动 switch（useState 由父组件控制）
 *   - AI 日志分析 / 刷新 / 导出 按钮（onClick 回调）
 */
import { Search, Sparkles, RefreshCw, Download } from 'lucide-react'
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
  onAiAnalyze,
  onRefresh,
  onExport,
}: {
  keyword: string
  onKeywordChange: (v: string) => void
  activeLevel: LogLevel | 'ALL'
  onLevelChange: (level: LogLevel | 'ALL') => void
  autoScroll: boolean
  onAutoScrollChange: (v: boolean) => void
  onAiAnalyze: () => void
  onRefresh: () => void
  onExport: () => void
}) {
  return (
    <div
      className="flex shrink-0 items-center"
      style={{
        gap: 12,
        padding: '8px 16px',
        background: 'var(--trae-bg-base-secondary)',
        borderBottom: '1px solid var(--trae-border-neutral-l1)',
      }}
    >
      {/* 1. 搜索框 */}
      <div className="relative shrink-0" style={{ width: 300 }}>
        <Search
          size={14}
          className="pointer-events-none absolute"
          style={{
            left: 10,
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--trae-icon-tertiary)',
          }}
        />
        <input
          type="text"
          placeholder="过滤日志..."
          value={keyword}
          onChange={(e) => onKeywordChange(e.target.value)}
          className="block w-full"
          style={{
            height: 32,
            padding: '0 12px 0 32px',
            fontFamily: 'var(--trae-font-family-mono)',
            fontSize: 'var(--trae-body-sm-font-size)',
            color: 'var(--trae-text-default)',
            background: 'var(--trae-bg-base-default)',
            border: '1px solid var(--trae-border-neutral-l2)',
            borderRadius: 'var(--trae-radius-6)',
            outline: 'none',
          }}
        />
      </div>

      {/* 2. Level filter（5 个 tab — 设计稿：扁平线框标签） */}
      <div className="flex shrink-0 items-center" style={{ gap: 4 }}>
        {LEVEL_FILTERS.map((f) => {
          const active = activeLevel === f.id
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => onLevelChange(f.id)}
              className="btn-press inline-flex items-center justify-center transition-colors"
              style={{
                height: 26,
                padding: '0 10px',
                fontSize: 'var(--trae-body-xs-font-size)',
                fontWeight: 'var(--trae-font-weight-default)',
                color: active
                  ? 'var(--trae-text-brand)'
                  : 'var(--trae-text-secondary)',
                background: 'transparent',
                border: '1px solid var(--trae-border-neutral-l2)',
                borderRadius: 'var(--trae-radius-4)',
                cursor: 'pointer',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {f.label}
            </button>
          )
        })}
      </div>

      {/* 3. 右侧 cluster */}
      <div
        className="ml-auto flex shrink-0 items-center"
        style={{ gap: 12 }}
      >
        {/* AI 日志分析按钮 */}
        <button
          type="button"
          onClick={onAiAnalyze}
          className="btn-press inline-flex items-center transition-colors"
          style={{
            height: 28,
            padding: '0 12px',
            gap: 6,
            fontSize: 'var(--trae-body-xs-font-size)',
            fontWeight: 'var(--trae-font-weight-medium)',
            color: 'var(--trae-text-brand)',
            background: 'var(--trae-bg-brand-popup)',
            border: '1px solid var(--trae-border-brand)',
            borderRadius: 'var(--trae-radius-4)',
            cursor: 'pointer',
          }}
        >
          <Sparkles size={14} style={{ color: 'var(--trae-icon-brand)' }} />
          <span>AI 日志分析</span>
        </button>

        {/* 自动滚动 switch */}
        <label
          className="flex cursor-pointer select-none items-center"
          style={{ gap: 8 }}
        >
          <span
            className="relative inline-block"
            style={{
              width: 32,
              height: 18,
              background: autoScroll
                ? 'var(--trae-bg-brand)'
                : 'var(--trae-bg-overlay-l3)',
              borderRadius: 'var(--trae-radius-full)',
              transition: 'background 160ms cubic-bezier(.2,.8,.2,1)',
            }}
          >
            <span
              className="absolute block"
              style={{
                top: 2,
                left: autoScroll ? 'auto' : 2,
                right: autoScroll ? 2 : 'auto',
                width: 14,
                height: 14,
                background: '#FFFFFF',
                borderRadius: '50%',
                transition: 'transform 160ms cubic-bezier(.2,.8,.2,1)',
                boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
              }}
            />
          </span>
          <span
            style={{
              fontSize: 'var(--trae-body-sm-font-size)',
              color: 'var(--trae-text-secondary)',
              whiteSpace: 'nowrap',
            }}
          >
            自动滚动
          </span>
        </label>

        {/* 刷新按钮 */}
        <button
          type="button"
          onClick={onRefresh}
          aria-label="刷新"
          className="btn-press inline-flex items-center justify-center transition-colors"
          style={{
            width: 28,
            height: 28,
            color: 'var(--trae-text-secondary)',
            background: 'transparent',
            border: '1px solid var(--trae-border-neutral-l2)',
            borderRadius: 'var(--trae-radius-6)',
            cursor: 'pointer',
          }}
        >
          <RefreshCw size={14} />
        </button>

        {/* 导出按钮 */}
        <button
          type="button"
          onClick={onExport}
          aria-label="导出日志"
          className="btn-press inline-flex items-center justify-center transition-colors"
          style={{
            width: 28,
            height: 28,
            color: 'var(--trae-text-secondary)',
            background: 'transparent',
            border: '1px solid var(--trae-border-neutral-l2)',
            borderRadius: 'var(--trae-radius-6)',
            cursor: 'pointer',
          }}
        >
          <Download size={14} />
        </button>
      </div>
    </div>
  )
}
