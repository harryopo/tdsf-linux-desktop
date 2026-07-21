/**
 * LogViewer — 终端式日志查看器（LogsPage 子组件）
 *
 * 设计稿参考：logs.html 第 3 节右栏 section
 * 结构：
 *   1. 浮动统计卡（absolute top-right）：INFO 11 / WARN 2 / ERROR 1 / DEBUG 1
 *   2. 日志行（可滚动）：15 条
 *      - 列宽：时间戳 92px + 分隔 14px + 级别 tag 52px + 分隔 14px + source 104px + 分隔 14px + message flex-1
 *      - WARN/ERROR 行有软背景色
 *      - DEBUG 级别 tag 有 1px 边框
 *   3. 闪烁光标行（实时流指示器）：8x16 品牌色块 + animate-pulse
 *
 * JS 交互：父组件传入过滤后的日志列表（按 level + keyword 筛选）
 */
import {
  type LogEntry,
  LEVEL_STATS,
  LOG_TERMINAL_BG,
  getLevelColor,
  getLevelSoftColor,
} from './logs-data'

/** LogViewer — 终端式日志查看器 */
export function LogViewer({ entries }: { entries: LogEntry[] }) {
  return (
    <section
      className="relative flex min-w-0 flex-1 flex-col"
      style={{
        background: LOG_TERMINAL_BG,
        border: '1px solid var(--trae-border-neutral-l1)',
        borderRadius: 'var(--trae-radius-8)',
        overflow: 'hidden',
      }}
    >
      {/* 1. 浮动统计卡（absolute top-right） */}
      <FloatingStatsCard />

      {/* 2. 日志行（可滚动） */}
      <div
        className="min-h-0 flex-1 overflow-y-auto"
        style={{
          padding: '16px 16px 24px',
          fontFamily: 'var(--trae-font-family-mono)',
          fontSize: 'var(--trae-code-terminal-font-size)',
          lineHeight: 1.8,
          scrollbarWidth: 'thin',
        }}
      >
        {entries.length === 0 ? (
          <div
            style={{
              color: 'var(--trae-text-tertiary)',
              fontSize: 'var(--trae-body-sm-font-size)',
              fontFamily: 'var(--trae-font-family-default)',
              padding: 16,
            }}
          >
            无匹配日志
          </div>
        ) : (
          entries.map((entry) => (
            <LogRow key={entry.id} entry={entry} />
          ))
        )}

        {/* 3. 闪烁光标行（实时流指示器） */}
        <div
          className="flex items-center"
          style={{
            padding: '1px 8px',
            borderRadius: 'var(--trae-radius-2)',
          }}
        >
          <span
            className="shrink-0"
            style={{
              width: 92,
              color: 'var(--trae-text-tertiary)',
              fontVariantNumeric: 'tabular-nums',
              opacity: 0,
            }}
          >
            00:00:00.000
          </span>
          <span className="shrink-0" style={{ width: 14 }} />
          <span className="shrink-0" style={{ width: 52 }} />
          <span className="shrink-0" style={{ width: 14 }} />
          <span className="shrink-0" style={{ width: 104 }} />
          <span className="shrink-0" style={{ width: 14 }} />
          <span
            className="animate-pulse inline-block"
            style={{
              width: 8,
              height: 16,
              background: 'var(--trae-status-primary-default)',
              borderRadius: 1,
              marginTop: 2,
            }}
          />
        </div>
      </div>
    </section>
  )
}

/** 浮动统计卡（4 项级别统计） */
function FloatingStatsCard() {
  return (
    <div
      className="absolute z-10 flex items-center"
      style={{
        top: 10,
        right: 10,
        gap: 12,
        padding: '4px 12px',
        background: 'rgba(34, 36, 39, 0.85)',
        border: '1px solid var(--trae-border-neutral-l2)',
        borderRadius: 'var(--trae-radius-6)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        fontFamily: 'var(--trae-font-family-mono)',
        fontSize: 10,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {LEVEL_STATS.map((stat) => (
        <span
          key={stat.level}
          style={{ color: getLevelColor(stat.level) }}
        >
          {stat.level}{' '}
          <span
            style={{
              color: 'var(--trae-text-default)',
              fontWeight: 'var(--trae-font-weight-medium)',
            }}
          >
            {stat.count}
          </span>
        </span>
      ))}
    </div>
  )
}

/** 单条日志行 */
function LogRow({ entry }: { entry: LogEntry }) {
  const levelColor = getLevelColor(entry.level)
  const levelSoftColor = getLevelSoftColor(entry.level)
  // WARN / ERROR 行有软背景色
  const hasRowBg = entry.level === 'WARN' || entry.level === 'ERROR'
  // DEBUG 级别 tag 有 1px 边框
  const hasLevelBorder = entry.level === 'DEBUG'

  return (
    <div
      className="flex items-center"
      style={{
        padding: '1px 8px',
        borderRadius: 'var(--trae-radius-2)',
        background: hasRowBg ? levelSoftColor : 'transparent',
      }}
    >
      {/* 时间戳 */}
      <span
        className="shrink-0"
        style={{
          width: 92,
          color: 'var(--trae-text-tertiary)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {entry.timestamp}
      </span>
      <Separator />
      {/* 级别 tag */}
      <span
        className="inline-flex shrink-0 items-center justify-center"
        style={{
          width: 52,
          height: 16,
          fontSize: 10,
          fontWeight: 'var(--trae-font-weight-medium)',
          color: levelColor,
          background: levelSoftColor,
          border: hasLevelBorder
            ? '1px solid var(--trae-border-neutral-l1)'
            : 'none',
          borderRadius: 'var(--trae-radius-2)',
        }}
      >
        {entry.level}
      </span>
      <Separator />
      {/* source */}
      <span
        className="shrink-0 truncate"
        style={{
          width: 104,
          color: 'var(--trae-text-brand)',
        }}
      >
        {entry.source}
      </span>
      <Separator />
      {/* message */}
      <span
        className="min-w-0 flex-1 truncate"
        style={{ color: 'var(--trae-text-default)' }}
      >
        {entry.message}
      </span>
    </div>
  )
}

/** 分隔符 | */
function Separator() {
  return (
    <span
      className="shrink-0"
      style={{
        width: 14,
        color: 'var(--trae-text-tertiary)',
        opacity: 0.4,
      }}
    >
      |
    </span>
  )
}
