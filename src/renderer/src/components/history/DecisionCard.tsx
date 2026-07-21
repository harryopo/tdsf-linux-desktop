/**
 * DecisionCard — 决策时间线单卡片
 *
 * 设计稿：history.html 第 4 段 决策记录时间线
 *
 * 卡片结构：
 * - 标题 + 状态徽章 + 风险徽章
 * - 服务器 / 操作人 / 置信度 / 命令 4 列 meta
 * - 简要描述
 * - 底部：耗时 + 查看详情链接
 *
 * 状态色映射：成功=success / 失败=error / 已拦截=warning
 * 风险色映射：低风险=brand / 中风险=warning / 高风险=error
 *
 * 命令样式：高危命令(error surface + error text)，普通命令(default bg + code text)
 */
import { ArrowRight, Clock, Cpu, Sparkles, UserCircle } from 'lucide-react'
import type { DecisionStatus, DecisionRecord, RiskLevel, ActorType } from './mock-data'

/** 决策状态 → CSS 变量 */
function statusBadgeClass(status: DecisionStatus): string {
  switch (status) {
    case '成功':
      return 'bg-[var(--trae-status-success-surface-l1)] text-[var(--trae-status-success-default)]'
    case '失败':
      return 'bg-[var(--trae-status-error-surface-l1)] text-[var(--trae-status-error-default)]'
    case '已拦截':
      return 'bg-[var(--trae-status-warning-surface-l1)] text-[var(--trae-status-warning-default)]'
  }
}

/** 风险等级 → CSS 变量 */
function riskBadgeClass(risk: RiskLevel): string {
  switch (risk) {
    case '低风险':
      return 'bg-[var(--trae-status-primary-surface-l1)] text-[var(--trae-text-brand)]'
    case '中风险':
      return 'bg-[var(--trae-status-warning-surface-l1)] text-[var(--trae-status-warning-default)]'
    case '高风险':
      return 'bg-[var(--trae-status-error-surface-l1)] text-[var(--trae-status-error-default)]'
  }
}

/** 操作人 → 图标 */
function ActorIcon({ actor }: { actor: ActorType }) {
  const className = 'w-3 h-3 text-[var(--trae-text-tertiary)] shrink-0'
  return actor === 'ai-agent' ? <Sparkles className={className} /> : <UserCircle className={className} />
}

/**
 * DecisionCard 单卡片
 *
 * @param record - 决策记录数据
 * @param isLast - 是否为时间线最后一条（控制竖线是否渲染）
 * @param onViewDetail - 查看详情回调（接收 record.id）
 */
export function DecisionCard({
  record,
  isLast,
  onViewDetail,
}: {
  record: DecisionRecord
  isLast: boolean
  onViewDetail: (id: string) => void
}) {
  return (
    <div className="flex" style={{ gap: '16px' }}>
      {/* 左侧时间轴：时间 + 圆点 + 竖线 */}
      <div
        className="flex flex-col items-center shrink-0"
        style={{ width: '56px', paddingTop: '2px' }}
      >
        <span className="font-mono text-[10px] leading-none text-[var(--trae-text-tertiary)] whitespace-nowrap">
          {record.time}
        </span>
        <span
          className="mt-1.5 w-2.5 h-2.5 rounded-full border-2 border-[var(--trae-bg-base-default)] box-border shrink-0 z-[1]"
          style={{ background: record.dotColor }}
        />
        {!isLast && (
          <div
            className="mt-1 w-0.5 flex-1"
            style={{ background: 'var(--trae-border-neutral-l1)', minHeight: '24px' }}
          />
        )}
      </div>
      {/* 右侧卡片 */}
      <div className="flex-1 min-w-0 mb-4">
        <div className="p-4 bg-[var(--trae-bg-base-secondary)] border border-[var(--trae-border-neutral-l1)] rounded-[var(--trae-radius-8)] transition-colors duration-150 hover:border-[var(--trae-border-neutral-l2)]">
          {/* 第 1 行：标题 + 状态 + 风险 */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[16px] leading-[1.3] font-semibold text-[var(--trae-text-default)]">
              {record.title}
            </span>
            <span
              className={`inline-flex items-center px-1.5 h-5 whitespace-nowrap text-[10px] font-medium rounded-[var(--trae-radius-2)] ${statusBadgeClass(
                record.status,
              )}`}
            >
              {record.status}
            </span>
            <span
              className={`inline-flex items-center px-1.5 h-5 whitespace-nowrap text-[10px] font-medium rounded-[var(--trae-radius-2)] ${riskBadgeClass(
                record.risk,
              )}`}
            >
              {record.risk}
            </span>
          </div>
          {/* 第 2 行：服务器 / 操作人 / 置信度 / 命令 */}
          <div
            className="flex flex-wrap items-center mt-2"
            style={{ gap: '8px 16px' }}
          >
            {/* 服务器 */}
            <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--trae-text-secondary)]">
              <Cpu className="w-3 h-3 text-[var(--trae-text-tertiary)] shrink-0" />
              {record.server}
            </span>
            {/* 操作人 */}
            <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--trae-text-secondary)]">
              <ActorIcon actor={record.actor} />
              {record.actor}
            </span>
            {/* 置信度 */}
            <span className="text-[11px] text-[var(--trae-text-secondary)]">
              置信度{' '}
              <span
                className="font-mono font-medium"
                style={{ color: 'var(--trae-bg-brand)' }}
              >
                {record.confidence.toFixed(2)}
              </span>
            </span>
            {/* 命令 */}
            <code
              className={`font-mono text-[10px] leading-[14px] px-1.5 py-0.5 rounded-[var(--trae-radius-2)] border border-[var(--trae-border-neutral-l1)] whitespace-nowrap overflow-hidden text-ellipsis max-w-full ${
                record.isDanger
                  ? 'bg-[var(--trae-status-error-surface-l1)] text-[var(--trae-status-error-default)]'
                  : 'bg-[var(--trae-bg-base-default)] text-[var(--trae-code-text)]'
              }`}
            >
              {record.command}
            </code>
          </div>
          {/* 第 3 行：简要描述 */}
          <p className="mt-2 text-[10px] leading-[14px] text-[var(--trae-text-tertiary)]">
            {record.desc}
          </p>
          {/* 第 4 行：耗时 + 查看详情 */}
          <div
            className="flex items-center justify-between mt-3 pt-3 border-t border-[var(--trae-border-neutral-l1)] gap-3"
          >
            <span className="inline-flex items-center gap-1.5 text-[10px] text-[var(--trae-text-tertiary)]">
              <Clock className="w-3 h-3 shrink-0" />
              耗时{' '}
              <span className="font-mono text-[var(--trae-text-secondary)]">
                {record.durationSec}s
              </span>
            </span>
            <button
              type="button"
              onClick={() => onViewDetail(record.id)}
              className="inline-flex items-center shrink-0 gap-1 text-[10px] text-[var(--trae-text-brand)] cursor-pointer bg-transparent border-none p-0 hover:text-[var(--trae-text-brand-hover)] transition-colors duration-150"
            >
              查看详情
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
