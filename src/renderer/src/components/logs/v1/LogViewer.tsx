/**
 * LogViewer — 终端式日志查看器（LogsPage 子组件，含虚拟滚动）
 *
 * 设计稿参考：logs.html 第 3 节右栏 section
 * 结构：
 *   1. 浮动统计卡（absolute top-right）：INFO 11 / WARN 2 / ERROR 1 / DEBUG 1
 *   2. 日志行（虚拟滚动）：所有日志条目
 *      - 列宽：时间戳 92px + 分隔 14px + 级别 tag 52px + 分隔 14px + source 104px + 分隔 14px + message flex-1
 *      - WARN/ERROR 行有软背景色
 *      - DEBUG 级别 tag 有 1px 边框
 *   3. 闪烁光标行（实时流指示器）：8x16 品牌色块 + animate-pulse
 *
 * 虚拟滚动（M3 Task 4）：
 *   - 使用 @tanstack/react-virtual 的 useVirtualizer
 *   - 固定行高估算 28px（与设计稿终端行高一致）
 *   - overscan 10 行（平衡性能与流畅度）
 *   - measureElement 动态测量实际行高，避免行高估算偏差导致滚动错位
 *   - 仅 DOM 渲染优化，所有日志条目保留（不丢数据）
 *
 * JS 交互：父组件传入过滤后的日志列表（按 level + keyword 筛选）
 */
import { useRef, type RefObject } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Inbox } from 'lucide-react'
import { Empty } from '@/components/trae/Empty'
import {
  type LogEntry,
  type LevelStat,
  getLevelColor,
  getLevelSoftColor,
} from './logs-data'

/** 虚拟滚动固定行高估算（与设计稿终端行高一致，brief Step 4.4） */
const LOG_ROW_ESTIMATE_HEIGHT = 28
/** 虚拟滚动 overscan 行数（平衡性能与流畅度） */
const LOG_ROW_OVERSCAN = 10

/** LogViewer — 终端式日志查看器（含虚拟滚动） */
export function LogViewer({
  entries,
  levelStats,
  scrollRef,
}: {
  entries: LogEntry[]
  /** 浮动统计卡数据（来自 log:stats IPC，经 mapLogStats 映射） */
  levelStats?: LevelStat[]
  /** 滚动容器 ref（供父组件自动滚动到底部；同时作为虚拟滚动的滚动元素） */
  scrollRef?: RefObject<HTMLDivElement>
}) {
  // 虚拟滚动容器 ref：优先用父组件传入的 scrollRef（便于自动滚动联动），
  // 父组件未传时回退到内部 fallbackRef
  const fallbackRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef?.current ?? fallbackRef.current,
    estimateSize: () => LOG_ROW_ESTIMATE_HEIGHT,
    overscan: LOG_ROW_OVERSCAN,
  })

  return (
    <section className="log-viewer relative flex min-w-0 flex-1 flex-col">
      {/* 0. 浮动统计卡（absolute top-right，设计稿元素，数据来自 log:stats） */}
      {levelStats && levelStats.length > 0 && (
        <div className="log-stats-card flex items-center" role="status" aria-label="日志级别统计">
          {levelStats.map((s) => (
            <div key={s.level} className="log-stats-item flex items-center" style={{ color: s.color }}>
              <span>{s.level}</span>
              <span className="log-stats-count">{s.count}</span>
            </div>
          ))}
        </div>
      )}

      {/* 1. 日志行（虚拟滚动容器，复用父组件传入的 scrollRef 作为滚动元素） */}
      <div
        ref={scrollRef ?? fallbackRef}
        className="log-lines min-h-0 flex-1 overflow-y-auto"
      >
        {entries.length === 0 ? (
          <Empty
            icon={Inbox}
            title="无匹配日志"
            description="当前日志源为空或筛选条件未命中任何日志，请尝试切换日志源、调整级别过滤或清空搜索关键词。"
            className="log-empty"
          />
        ) : (
          // 虚拟滚动：外层 div 高度 = 所有行总高度，内层绝对定位每行
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const entry = entries[virtualItem.index]
              if (!entry) return null
              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  <LogRow entry={entry} />
                </div>
              )
            })}
          </div>
        )}

        {/* 3. 闪烁光标行（实时流指示器） */}
        <div className="log-row flex items-center">
          <span
            className="log-row-timestamp shrink-0"
            style={{ opacity: 0 }}
          >
            00:00:00.000
          </span>
          <span className="log-row-separator shrink-0" />
          <span className="shrink-0" style={{ width: 52 }} />
          <span className="log-row-separator shrink-0" />
          <span className="shrink-0" style={{ width: 104 }} />
          <span className="log-row-separator shrink-0" />
          <span className="log-cursor-block log-animate-pulse animate-pulse" />
        </div>
      </div>
    </section>
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
      className="log-row flex items-center"
      style={{ background: hasRowBg ? levelSoftColor : 'transparent' }}
    >
      {/* 时间戳 */}
      <span className="log-row-timestamp shrink-0">
        {entry.timestamp}
      </span>
      <Separator />
      {/* 级别 tag */}
      <span
        className={`log-level-tag shrink-0 ${hasLevelBorder ? 'is-debug' : ''}`}
        style={{
          color: levelColor,
          background: levelSoftColor,
        }}
      >
        {entry.level}
      </span>
      <Separator />
      {/* source */}
      <span className="log-row-source shrink-0">
        {entry.source}
      </span>
      <Separator />
      {/* message */}
      <span className="log-row-message truncate">
        {entry.message}
      </span>
    </div>
  )
}

/** 分隔符 | */
function Separator() {
  return <span className="log-row-separator shrink-0">|</span>
}
