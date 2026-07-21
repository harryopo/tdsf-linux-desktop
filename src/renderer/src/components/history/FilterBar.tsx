/**
 * FilterBar — 筛选栏
 *
 * 设计稿：history.html 第 3 段 筛选栏
 *
 * 结构：
 * - 左侧 3 个 select 下拉（时间范围 / 服务器 / 状态）
 * - 右侧搜索框
 *
 * JS 交互：所有 input 都是受控的（onChange 回调到父组件）
 */
import { ChevronDown, Clock, Cpu, Filter, Search } from 'lucide-react'
import {
  serverOptions,
  statusOptions,
  timeRangeOptions,
} from './mock-data'

/** 筛选状态聚合类型 */
export interface FilterState {
  timeRange: string
  server: string
  status: string
  keyword: string
}

/** 受控 select 下拉 */
function FilterSelect({
  icon,
  value,
  options,
  onChange,
  ariaLabel,
}: {
  icon: React.ReactNode
  value: string
  options: readonly string[]
  onChange: (value: string) => void
  ariaLabel: string
}) {
  return (
    <label
      className="relative inline-flex items-center h-7 bg-[var(--trae-bg-base-tertiary)] border border-[var(--trae-border-neutral-l1)] rounded-[var(--trae-radius-4)] cursor-pointer"
      style={{ padding: '0 8px 0 12px', gap: '6px' }}
    >
      {icon}
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none bg-transparent border-none outline-none text-[11px] leading-none text-[var(--trae-text-default)] cursor-pointer"
        style={{ paddingRight: '16px' }}
      >
        {options.map((option) => (
          <option
            key={option}
            value={option}
            className="bg-[var(--trae-bg-base-secondary)] text-[var(--trae-text-default)]"
          >
            {option}
          </option>
        ))}
      </select>
      <ChevronDown
        className="absolute pointer-events-none text-[var(--trae-text-tertiary)]"
        style={{ right: '8px', width: '12px', height: '12px' }}
      />
    </label>
  )
}

/**
 * FilterBar 主组件
 *
 * @param value - 当前筛选状态
 * @param onChange - 任一字段变更回调
 */
export function FilterBar({
  value,
  onChange,
}: {
  value: FilterState
  onChange: (next: FilterState) => void
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-3 p-3 bg-[var(--trae-bg-base-secondary)] border border-[var(--trae-border-neutral-l1)] rounded-[var(--trae-radius-8)]"
    >
      {/* 左侧 3 个下拉 */}
      <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
        <FilterSelect
          ariaLabel="时间范围"
          icon={<Clock className="w-3 h-3 text-[var(--trae-text-tertiary)]" />}
          value={value.timeRange}
          options={timeRangeOptions}
          onChange={(v) => onChange({ ...value, timeRange: v })}
        />
        <FilterSelect
          ariaLabel="服务器"
          icon={<Cpu className="w-3 h-3 text-[var(--trae-text-tertiary)]" />}
          value={value.server}
          options={serverOptions}
          onChange={(v) => onChange({ ...value, server: v })}
        />
        <FilterSelect
          ariaLabel="状态"
          icon={<Filter className="w-3 h-3 text-[var(--trae-text-tertiary)]" />}
          value={value.status}
          options={statusOptions}
          onChange={(v) => onChange({ ...value, status: v })}
        />
      </div>
      {/* 右侧搜索框 */}
      <div
        className="inline-flex items-center shrink-0 h-7 min-w-[220px] px-3 bg-[var(--trae-bg-base-tertiary)] border border-[var(--trae-border-neutral-l1)] rounded-[var(--trae-radius-4)] gap-1.5"
        style={{ flex: '0 1 280px' }}
      >
        <Search className="w-3 h-3 text-[var(--trae-text-tertiary)] shrink-0" />
        <input
          type="text"
          placeholder="搜索决策..."
          value={value.keyword}
          onChange={(e) => onChange({ ...value, keyword: e.target.value })}
          className="flex-1 min-w-0 bg-transparent border-none outline-none text-[11px] leading-none text-[var(--trae-text-default)]"
        />
      </div>
    </div>
  )
}
