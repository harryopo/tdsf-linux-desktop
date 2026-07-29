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
  onSourceChange,
  counts,
}: {
  activeId: string
  onSelect: (id: string) => void
  /** 点击日志源时额外触发的回调（传入完整 source 对象，供父组件重拉日志） */
  onSourceChange?: (source: LogSourceItem) => void
  /** v2.6：真实计数（id → 文案），传入时覆盖 LOG_SOURCES 的设计稿硬编码计数 */
  counts?: Record<string, string>
}) {
  // 主类日志源（5 项）
  const mainSources = LOG_SOURCES.filter((s) => s.group === 'main')
  // 服务器系统日志路径（4 项）
  const systemSources = LOG_SOURCES.filter((s) => s.group === 'system')

  return (
    <nav className="log-sidebar flex shrink-0 flex-col">
      {mainSources.map((src) => (
        <LogSourceRow
          key={src.id}
          source={counts && counts[src.id] !== undefined ? { ...src, count: counts[src.id] } : src}
          active={src.id === activeId}
          onSelect={onSelect}
          onSourceChange={onSourceChange}
        />
      ))}

      {/* 分隔线 */}
      <div className="log-source-divider" />

      {/* Section label */}
      <div className="log-source-section-label">服务器系统日志</div>

      {systemSources.map((src) => (
        <LogSourceRow
          key={src.id}
          source={counts && counts[src.id] !== undefined ? { ...src, count: counts[src.id] } : src}
          active={src.id === activeId}
          onSelect={onSelect}
          onSourceChange={onSourceChange}
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
  onSourceChange,
  mono,
}: {
  source: LogSourceItem
  active: boolean
  onSelect: (id: string) => void
  onSourceChange?: (source: LogSourceItem) => void
  mono?: boolean
}) {
  const Icon = source.icon
  const isAlertCount = !!source.alert

  const handleClick = () => {
    onSelect(source.id)
    onSourceChange?.(source)
  }

  return (
    <div
      onClick={handleClick}
      className={`log-source-row flex items-center transition-colors ${active ? 'is-active' : ''}`}
    >
      <Icon
        size={14}
        className="log-source-icon"
        style={{
          color: active
            ? 'var(--trae-icon-brand)'
            : 'var(--trae-icon-secondary)',
        }}
      />
      <span className={`log-source-label ${mono ? 'log-source-label-mono' : ''}`}>
        {source.label}
      </span>
      <span
        className={`log-source-count ${active ? 'is-active' : ''} ${isAlertCount ? 'is-alert' : ''}`}
      >
        {source.count}
      </span>
    </div>
  )
}
