/**
 * AlertDrawer — 告警详情抽屉（DEC-3 决策）
 *
 * 设计稿：spec §B SubTask 2.4.6
 *
 * 决策依据（DEC-3）：monitor 页告警列表点击后弹出右侧 Drawer 展示详情，
 * 不新建 alert-detail.html，避免死链、避免增加页面数量。
 *
 * 内容：
 * - 顶部：告警级别 Tag + 标题 + 关闭按钮
 * - 详情字段：时间 / 来源 / 服务器 / 状态
 * - 影响评估（一段文字）
 * - 处置建议（3 步编号列表）
 *
 * 安全：
 * - role="dialog" + aria-modal="true"（AntD Drawer 内部 RcDrawer 默认提供）
 * - ESC 关闭（AntD Drawer 自带）
 * - 焦点管理（AntD Drawer 自动 focus）
 *
 * Spec: build-runnable-tdsf-from-design · Task 2.4 · SubTask 2.4.6
 */
import { Drawer, Tag } from 'antd'
import type { AlertRecord, RiskLevel } from './mock-data'

/** 风险级别 → Tag 颜色 + 中文标签 */
function riskTagProps(level: RiskLevel): { color: string; bg: string; label: string } {
  switch (level) {
    case 'critical':
      return {
        color: 'var(--trae-status-error-default)',
        bg: 'var(--trae-status-error-surface-l1)',
        label: 'critical',
      }
    case 'high':
      return {
        color: 'var(--trae-status-warning-default)',
        bg: 'var(--trae-status-warning-surface-l1)',
        label: 'high',
      }
    case 'medium':
      return {
        color: 'var(--trae-status-alert-default)',
        bg: 'var(--trae-status-alert-surface-l1)',
        label: 'medium',
      }
    case 'low':
      return {
        color: 'var(--trae-accent-cyan)',
        bg: 'rgba(4, 203, 229, 0.16)',
        label: 'low',
      }
  }
}

/** 状态 → 颜色 */
function statusColor(status: AlertRecord['status']): string {
  switch (status) {
    case '未处理':
      return 'var(--trae-status-error-default)'
    case '处理中':
      return 'var(--trae-status-warning-default)'
    case '已处理':
      return 'var(--trae-status-success-default)'
  }
}

/** 详情字段行 */
function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 py-1.5">
      <span className="text-[11px] text-[var(--trae-text-tertiary)] min-w-[60px] shrink-0">{label}</span>
      <span className="text-[12px] text-[var(--trae-text-default)] flex-1 min-w-0 break-words">{value}</span>
    </div>
  )
}

export interface AlertDrawerProps {
  /** 是否打开 */
  open: boolean
  /** 告警记录（null 时关闭） */
  alert: AlertRecord | null
  /** 关闭回调 */
  onClose: () => void
}

/**
 * 告警详情抽屉
 *
 * - 从右侧滑入，宽度 420px
 * - 显示告警级别、标题、详情字段、影响范围、处置建议
 */
export function AlertDrawer({ open, alert, onClose }: AlertDrawerProps) {
  if (!alert) {
    return (
      <Drawer
        open={false}
        onClose={onClose}
        width={420}
        placement="right"
        title={null}
        styles={{
          header: { display: 'none' },
          body: { padding: 0 },
        }}
      >
        <div />
      </Drawer>
    )
  }

  const risk = riskTagProps(alert.level)

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={420}
      placement="right"
      title={null}
      closable={false}
      styles={{
        header: { display: 'none' },
        body: { padding: 0, background: 'var(--trae-bg-base-secondary)' },
        mask: { background: 'rgba(0, 0, 0, 0.4)' },
        content: {
          background: 'var(--trae-bg-base-secondary)',
          borderLeft: '1px solid var(--trae-border-neutral-l1)',
        },
      }}
    >
      <div className="flex flex-col h-full">
        {/* 顶部：级别 Tag + 标题 + 关闭按钮 */}
        <div
          className="flex items-start justify-between gap-3 p-4 border-b"
          style={{ borderColor: 'var(--trae-border-neutral-l1)' }}
        >
          <div className="flex flex-col gap-2 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Tag
                color={risk.bg}
                style={{
                  color: risk.color,
                  background: risk.bg,
                  border: 'none',
                  fontSize: 10,
                  padding: '1px 6px',
                  lineHeight: '16px',
                  margin: 0,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                {risk.label}
              </Tag>
              <span
                className="text-[10px] whitespace-nowrap"
                style={{ color: statusColor(alert.status) }}
              >
                ● {alert.status}
              </span>
            </div>
            <h2 className="text-[15px] font-semibold text-[var(--trae-text-default)] leading-[22px] break-words">
              {alert.desc}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="shrink-0 w-7 h-7 inline-flex items-center justify-center rounded-[var(--trae-radius-4)] cursor-pointer hover:bg-[var(--trae-bg-overlay-l2)] transition-colors duration-150"
            style={{ color: 'var(--trae-text-tertiary)' }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path
                d="M2 2L12 12M12 2L2 12"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* 详情字段 */}
        <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--trae-border-neutral-l1)' }}>
          <DetailRow label="时间" value={<span className="font-mono tabular-nums" style={{ fontFamily: 'var(--trae-font-family-mono)' }}>{alert.time}</span>} />
          <DetailRow label="服务器" value={alert.server} />
          {alert.source && <DetailRow label="来源" value={<span className="font-mono" style={{ fontFamily: 'var(--trae-font-family-mono)', fontSize: 11 }}>{alert.source}</span>} />}
        </div>

        {/* 影响评估 */}
        {alert.impact && (
          <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--trae-border-neutral-l1)' }}>
            <h3 className="text-[11px] font-semibold text-[var(--trae-text-secondary)] tracking-[0.04em] uppercase mb-2">
              影响评估
            </h3>
            <p className="text-[12px] leading-[18px] text-[var(--trae-text-default)]">
              {alert.impact}
            </p>
          </div>
        )}

        {/* 处置建议 */}
        {alert.suggestions && alert.suggestions.length > 0 && (
          <div className="px-4 py-3 flex-1 overflow-y-auto">
            <h3 className="text-[11px] font-semibold text-[var(--trae-text-secondary)] tracking-[0.04em] uppercase mb-2">
              处置建议
            </h3>
            <ol className="flex flex-col gap-2.5">
              {alert.suggestions.map((suggestion, idx) => (
                <li key={idx} className="flex items-start gap-2.5">
                  <span
                    className="shrink-0 w-5 h-5 inline-flex items-center justify-center rounded-full text-[10px] font-semibold"
                    style={{
                      background: 'var(--trae-bg-brand)',
                      color: 'var(--trae-text-onbrand)',
                      fontFamily: 'var(--trae-font-family-mono)',
                    }}
                  >
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] leading-[18px] text-[var(--trae-text-default)] break-words">
                      {suggestion}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* 底部操作栏 */}
        <div
          className="flex items-center justify-end gap-2 p-3 border-t"
          style={{ borderColor: 'var(--trae-border-neutral-l1)' }}
        >
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center h-[28px] px-3 text-[11px] font-medium text-[var(--trae-text-default)] bg-[var(--trae-bg-overlay-l2)] border border-[var(--trae-border-neutral-l2)] rounded-[var(--trae-radius-6)] cursor-pointer hover:bg-[var(--trae-bg-overlay-l3)] transition-colors duration-150"
          >
            关闭
          </button>
        </div>
      </div>
    </Drawer>
  )
}
