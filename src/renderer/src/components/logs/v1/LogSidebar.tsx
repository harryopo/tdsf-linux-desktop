/**
 * LogSidebar — 日志源侧边栏（LogsPage 子组件）
 *
 * 设计稿参考：logs.html 左侧 180px nav
 * 结构：
 *   1. 5 个主类日志源（系统/应用/安全/AI决策/告警），active 项有左侧品牌色边框
 *   2. 分隔线
 *   3. Section label：服务器系统日志
 *   4. 4 个服务器系统日志路径（/var/log/messages 等），等宽字体
 *
 * JS 交互：useState 控制 active 日志源（由父组件传入 activeId + onSelect）
 */
import { type LogSourceItem, LOG_SOURCES } from './logs-data'

/** LogSidebar — 日志源侧边栏 */
export function LogSidebar({
  activeId,
  onSelect,
}: {
  activeId: string
  onSelect: (id: string) => void
}) {
  // 主类日志源（5 项）
  const mainSources = LOG_SOURCES.filter((s) => s.group === 'main')
  // 服务器系统日志路径（4 项）
  const systemSources = LOG_SOURCES.filter((s) => s.group === 'system')

  return (
    <nav
      className="flex shrink-0 flex-col"
      style={{
        width: 180,
        gap: 4,
        padding: 8,
        background: 'var(--trae-bg-base-secondary)',
        border: '1px solid var(--trae-border-neutral-l1)',
        borderRadius: 'var(--trae-radius-8)',
      }}
    >
      {mainSources.map((src) => (
        <LogSourceRow
          key={src.id}
          source={src}
          active={src.id === activeId}
          onSelect={onSelect}
        />
      ))}

      {/* 分隔线 */}
      <div
        style={{
          height: 1,
          margin: '8px 4px',
          background: 'var(--trae-border-neutral-l2)',
        }}
      />

      {/* Section label */}
      <div
        style={{
          padding: '6px 8px 2px',
          fontSize: 9,
          fontWeight: 600,
          color: 'var(--trae-text-tertiary)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        服务器系统日志
      </div>

      {systemSources.map((src) => (
        <LogSourceRow
          key={src.id}
          source={src}
          active={src.id === activeId}
          onSelect={onSelect}
          mono
        />
      ))}
    </nav>
  )
}

/** 单个日志源条目 */
function LogSourceRow({
  source,
  active,
  onSelect,
  mono,
}: {
  source: LogSourceItem
  active: boolean
  onSelect: (id: string) => void
  mono?: boolean
}) {
  const Icon = source.icon
  const countColor = source.alert
    ? 'var(--trae-status-alert-default)'
    : active
      ? 'var(--trae-text-brand)'
      : 'var(--trae-text-tertiary)'

  return (
    <div
      onClick={() => onSelect(source.id)}
      className="flex cursor-pointer items-center transition-colors"
      style={{
        height: 32,
        padding: '0 8px 0 6px',
        gap: 8,
        borderLeft: active
          ? '2px solid var(--trae-border-brand)'
          : '2px solid transparent',
        borderRadius: 'var(--trae-radius-4)',
        background: active ? 'var(--trae-bg-overlay-l2)' : 'transparent',
        color: active ? 'var(--trae-text-default)' : 'var(--trae-text-secondary)',
      }}
    >
      <Icon
        size={14}
        className="shrink-0"
        style={{
          color: active
            ? 'var(--trae-icon-brand)'
            : 'var(--trae-icon-secondary)',
        }}
      />
      <span
        className="flex-1 truncate"
        style={{
          fontSize: 'var(--trae-body-sm-font-size)',
          fontWeight: active ? 'var(--trae-font-weight-medium)' : 'var(--trae-font-weight-default)',
          fontFamily: mono ? 'var(--trae-font-family-mono)' : undefined,
        }}
      >
        {source.label}
      </span>
      <span
        className="inline-flex shrink-0 items-center justify-center"
        style={{
          minWidth: 20,
          height: 16,
          padding: '0 4px',
          fontSize: 10,
          color: countColor,
          background: active
            ? 'var(--trae-bg-brand-popup)'
            : 'var(--trae-bg-overlay-l3)',
          borderRadius: 'var(--trae-radius-full)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {source.count}
      </span>
    </div>
  )
}
