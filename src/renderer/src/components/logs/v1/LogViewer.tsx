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
import { type RefObject } from 'react'
import { Inbox } from 'lucide-react'
import { Empty } from '@/components/trae/Empty'
import {
  type LogEntry,
  type LevelStat,
  getLevelColor,
  getLevelSoftColor,
} from './logs-data'

/** LogViewer — 终端式日志查看器 */
export function LogViewer({
  entries,
  levelStats,
  scrollRef,
}: {
  entries: LogEntry[]
  /** 浮动统计卡数据（来自 log:stats IPC，经 mapLogStats 映射） */
  levelStats?: LevelStat[]
  /** 滚动容器 ref（供父组件自动滚动到底部） */
  scrollRef?: RefObject<HTMLDivElement>
}) {
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

      {/* 1. 日志行（可滚动） */}
      <div ref={scrollRef} className="log-lines min-h-0 flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <Empty
            icon={Inbox}
            title="无匹配日志"
            description="当前日志源为空或筛选条件未命中任何日志，请尝试切换日志源、调整级别过滤或清空搜索关键词。"
            className="log-empty"
          />
        ) : (
          entries.map((entry) => (
            <LogRow key={entry.id} entry={entry} />
          ))
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
