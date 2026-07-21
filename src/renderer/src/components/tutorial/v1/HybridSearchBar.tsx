/**
 * HybridSearchBar — 混合检索搜索框（Sprint 7 任务 F）
 *
 * 设计要点：
 * - 输入框 + 搜索图标 + 占位符（"搜索教程... (支持中英文语义检索)"）
 * - 模式切换：关键词模式 / 语义模式（SegmentedControl 风格）
 * - 输入框聚焦时 border 变蓝（无 glow，遵循项目硬约束）
 * - 防抖由父组件 useHybridSearch Hook 负责（300ms）
 * - ESC 清空搜索 / Enter 立即搜索
 *
 * 颜色规范：
 * - 全部使用 var(--trae-*) CSS 变量
 * - 暗色模式默认（背景 #1a1b1d，输入框 #222427）
 * - 聚焦边框 var(--trae-bg-brand) (#387BFF)
 *
 * 字体规范：
 * - 输入框用 JetBrains Mono（与 KnowledgePage 搜索框一致）
 * - 占位符用 var(--trae-text-tertiary) 灰色
 *
 * 间距规范：
 * - 输入框高度 40px（与 KnowledgePage 一致）
 * - 内边距 12px
 * - 模式切换与输入框间距 8px
 *
 * 交互：
 * - 输入时实时回调 onChange（父组件防抖）
 * - 点击模式切换回调 onModeChange
 * - 清空按钮（X 图标）仅在有输入时显示
 */
import { Search, X } from 'lucide-react'
import type { SearchMode } from './hybrid-search-types'

export interface HybridSearchBarProps {
  /** 当前搜索查询字符串 */
  query: string
  /** 当前搜索模式 */
  mode: SearchMode
  /** 是否正在搜索（loading 状态） */
  loading?: boolean
  /** 是否禁用语义模式（如模型未加载且用户选择跳过下载） */
  semanticDisabled?: boolean
  /** 禁用语义模式时的提示文字（如 "需先下载模型"） */
  semanticDisabledHint?: string
  /** 占位符文字（默认 "搜索教程... (支持中英文语义检索)"） */
  placeholder?: string
  /** 查询变更回调（父组件负责防抖） */
  onQueryChange: (query: string) => void
  /** 模式变更回调 */
  onModeChange: (mode: SearchMode) => void
}

/**
 * HybridSearchBar — 混合检索搜索框
 *
 * 不维护内部状态，所有状态由父组件管理（受控组件）。
 * 这样设计便于父组件做防抖、缓存、状态同步等逻辑。
 */
export function HybridSearchBar({
  query,
  mode,
  loading = false,
  semanticDisabled = false,
  semanticDisabledHint,
  placeholder = '搜索教程... (支持中英文语义检索)',
  onQueryChange,
  onModeChange,
}: HybridSearchBarProps) {
  /** 处理输入变更 */
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onQueryChange(e.target.value)
  }

  /** 处理键盘事件：ESC 清空 / Enter 立即搜索（通过 onChange 触发） */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' && query) {
      e.preventDefault()
      onQueryChange('')
    }
  }

  /** 清空搜索 */
  const handleClear = () => {
    onQueryChange('')
  }

  /** 切换到关键词模式 */
  const handleSelectKeyword = () => {
    onModeChange('keyword')
  }

  /** 切换到语义模式（如禁用则不响应） */
  const handleSelectSemantic = () => {
    if (!semanticDisabled) {
      onModeChange('semantic')
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {/* ===== 输入框 + 模式切换（同一行，响应式） ===== */}
      <div className="flex flex-wrap items-center gap-2">
        {/* 搜索输入框 */}
        <div
          className="flex h-10 min-w-0 flex-1 items-center gap-2 border px-3 transition-colors"
          style={{
            background: 'var(--trae-bg-base-secondary)',
            borderColor: 'var(--trae-border-neutral-l1)',
            borderRadius: 'var(--trae-radius-6)',
          }}
        >
          <Search
            className="h-4 w-4 shrink-0"
            style={{
              color: loading
                ? 'var(--trae-icon-brand)'
                : 'var(--trae-icon-secondary)',
            }}
          />
          <input
            type="text"
            value={query}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[var(--trae-text-tertiary)] focus:outline-none"
            style={{
              fontFamily: 'var(--trae-font-family-mono)',
              fontSize: 'var(--trae-body-md-font-size)',
              lineHeight: 'var(--trae-body-md-line-height)',
              color: 'var(--trae-text-default)',
              border: 'none',
            }}
            onFocus={(e) => {
              // 聚焦时 border 变蓝（无 glow，遵循项目硬约束）
              e.currentTarget.parentElement!.style.borderColor =
                'var(--trae-bg-brand)'
            }}
            onBlur={(e) => {
              e.currentTarget.parentElement!.style.borderColor =
                'var(--trae-border-neutral-l1)'
            }}
            aria-label="搜索教程"
          />
          {/* 清空按钮（仅有输入时显示） */}
          {query && (
            <button
              type="button"
              onClick={handleClear}
              aria-label="清空搜索"
              className="shrink-0 cursor-pointer rounded-full p-0.5 transition-colors"
              style={{
                color: 'var(--trae-text-tertiary)',
                background: 'transparent',
                border: 'none',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--trae-text-secondary)'
                e.currentTarget.style.background = 'var(--trae-bg-overlay-l2)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--trae-text-tertiary)'
                e.currentTarget.style.background = 'transparent'
              }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* 模式切换（SegmentedControl 风格） */}
        <div
          className="flex shrink-0 items-center gap-0.5 border p-0.5"
          style={{
            background: 'var(--trae-bg-base-tertiary)',
            borderColor: 'var(--trae-border-neutral-l1)',
            borderRadius: 'var(--trae-radius-6)',
          }}
          role="radiogroup"
          aria-label="搜索模式"
        >
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'keyword'}
            onClick={handleSelectKeyword}
            className="cursor-pointer whitespace-nowrap rounded-[var(--trae-radius-4)] px-3 py-1.5 transition-colors"
            style={{
              background:
                mode === 'keyword'
                  ? 'var(--trae-bg-overlay-l2)'
                  : 'transparent',
              color:
                mode === 'keyword'
                  ? 'var(--trae-text-default)'
                  : 'var(--trae-text-secondary)',
              fontSize: 'var(--trae-body-sm-font-size)',
              fontWeight:
                mode === 'keyword'
                  ? 'var(--trae-font-weight-medium)'
                  : 'var(--trae-font-weight-default)',
              border: 'none',
            }}
          >
            关键词
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'semantic'}
            onClick={handleSelectSemantic}
            disabled={semanticDisabled}
            title={
              semanticDisabled
                ? (semanticDisabledHint ?? '语义检索不可用')
                : '使用 BGE-small-zh-v1.5 语义检索（首次需下载模型）'
            }
            className="cursor-pointer whitespace-nowrap rounded-[var(--trae-radius-4)] px-3 py-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              background:
                mode === 'semantic'
                  ? 'var(--trae-bg-overlay-l2)'
                  : 'transparent',
              color:
                mode === 'semantic'
                  ? 'var(--trae-text-default)'
                  : 'var(--trae-text-secondary)',
              fontSize: 'var(--trae-body-sm-font-size)',
              fontWeight:
                mode === 'semantic'
                  ? 'var(--trae-font-weight-medium)'
                  : 'var(--trae-font-weight-default)',
              border: 'none',
            }}
          >
            语义
          </button>
        </div>
      </div>

      {/* ===== 语义模式禁用提示（仅当 semanticDisabled 且用户尝试启用时显示） ===== */}
      {semanticDisabled && semanticDisabledHint && (
        <div
          className="flex items-center gap-1.5 px-1"
          style={{
            color: 'var(--trae-text-tertiary)',
            fontSize: 'var(--trae-body-xs-font-size)',
          }}
        >
          <span>⚠</span>
          <span>{semanticDisabledHint}</span>
        </div>
      )}
    </div>
  )
}
