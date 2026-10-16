/**
 * AlertDrawer — 告警详情抽屉（DEC-3 决策）
 *
 * 设计稿：spec §B SubTask 2.4.6
 *
 * 决策依据（DEC-3）：monitor 页告警列表点击后弹出右侧抽屉展示详情，
 * 不新建 alert-detail.html，避免死链、避免增加页面数量。
 *
 * 内容：级别标记 + 标题、详情字段（时间/服务器/来源）、影响评估、处置建议，
 * 底部「标记已处理」走 alert:ack IPC（主进程不可用时禁用并说明为什么）。
 *
 * 抽屉本体是 ui 层的 Sheet（radix Dialog 包的一层），焦点陷阱 / Esc / aria-modal
 * 都由 radix 提供。2026-10-07 从 antd Drawer 换过来，顺带去掉那叠内联色值：
 * 抽屉底色原先写死深色变量，切浅色主题时会带出一块黑底。
 *
 * Spec: build-runnable-tdsf-from-design · Task 2.4 · SubTask 2.4.6
 */
import { useState, type ReactNode } from 'react'
import { Button, Chip, Sheet, SheetContent, StatusDot, Tooltip, type ChipProps } from '@/ui'
import type { AlertRecord, RiskLevel } from './monitor-model'
import { useMonitorStore } from '../../stores/monitor-store'

/** 风险级别 -> 中文标签 + Chip 色调（与风险控制页的级别说法保持一致） */
const RISK_VIEW: Record<RiskLevel, { label: string; tone: ChipProps['tone'] }> = {
  critical: { label: '严重', tone: 'error' },
  high: { label: '高', tone: 'warning' },
  medium: { label: '中', tone: 'accent' },
  low: { label: '低', tone: 'neutral' },
}

/** 告警状态 -> 状态点：进行中是旋转环，让色盲用户也分得清「在跑」和「跑完」 */
const STATUS_VIEW: Record<AlertRecord['status'], 'error' | 'pending' | 'success'> = {
  未处理: 'error',
  处理中: 'pending',
  已处理: 'success',
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <span className="w-14 shrink-0 text-caption text-ink-mute">{label}</span>
      <span className="min-w-0 flex-1 break-all text-md text-ink">{value}</span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-line px-4 py-3">
      <h3 className="text-caption font-medium text-ink-mute">{title}</h3>
      <div className="mt-1.5 text-md leading-relaxed text-ink-dim">{children}</div>
    </section>
  )
}

export interface AlertDrawerProps {
  /** 是否打开 */
  open: boolean
  /** 告警记录（null 时不渲染抽屉） */
  alert: AlertRecord | null
  /** 关闭回调 */
  onClose: () => void
}

export function AlertDrawer({ open, alert, onClose }: AlertDrawerProps) {
  // M3 Task 2：标记已处理状态（alert:ack IPC 调用中 / 错误信息）
  const [acking, setAcking] = useState(false)
  const [ackError, setAckError] = useState<string | null>(null)

  if (!alert) return null

  const risk = RISK_VIEW[alert.level]

  /**
   * 告警身份直接用 record.id（`会话|种类`，由算出这条告警的那一处生成）
   *
   * 以前这里自己拼 `time|server|desc` 还注释成"稳定 alertId"——time 每秒都在变、
   * desc 里带着百分比，于是每条新数据都是一个新键：主进程那张确认表只进不出，
   * 而刚刚标记过"已处理"的那条，下一拍就因为对不上号而重新变成未处理。
   */
  const alertId = alert.id

  /** 旧版 preload 未暴露 alertAck 时：按钮禁用，并把「为什么不能点」说给用户看 */
  const ackAvailable =
    typeof window !== 'undefined' &&
    typeof window.electronAPI?.alertAck === 'function'

  /**
   * 标记已处理：先让主进程记一笔（alert:ack），成功了才改本地状态。
   *
   * 顺序不能反——写没成却让列表亮成"已处理"，等于又一次把界面当账本。
   * 改完本地状态后，告警列表那一行下一拍算出来就是"已处理"（AlertTable 读同一份 store）。
   */
  const handleAck = async () => {
    setAcking(true)
    setAckError(null)
    try {
      const ok = await window.electronAPI.alertAck(alertId)
      if (!ok) {
        setAckError('确认失败：告警 ID 无效')
        return
      }
      useMonitorStore.getState().ackAlert(alertId)
      onClose()
    } catch (err) {
      setAckError(err instanceof Error ? err.message : '确认告警失败')
    } finally {
      setAcking(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        title={alert.desc}
        badge={
          <>
            <Chip tone={risk.tone}>{risk.label}</Chip>
            <span className="inline-flex items-center gap-1.5 text-caption text-ink-dim">
              <StatusDot status={STATUS_VIEW[alert.status]} />
              {alert.status}
            </span>
          </>
        }
        footer={
          <>
            {ackError ? (
              <span className="mr-auto text-caption text-(--status-error-text)" role="alert">
                {ackError}
              </span>
            ) : null}
            <Tooltip content={ackAvailable ? '' : '主进程 IPC 不可用'}>
              {/* 禁用按钮不派发 hover，提示得挂在包一层的 span 上才看得到 */}
              <span>
                <Button variant="solid" disabled={!ackAvailable || acking} onClick={handleAck}>
                  {acking ? '处理中…' : '标记已处理'}
                </Button>
              </span>
            </Tooltip>
            <Button variant="outline" onClick={onClose}>
              关闭
            </Button>
          </>
        }
      >
        <div className="px-4 py-3">
          <DetailRow
            label="时间"
            value={<span className="font-mono tabular-nums">{alert.time}</span>}
          />
          <DetailRow label="服务器" value={<span className="font-mono">{alert.server}</span>} />
          {alert.source ? (
            <DetailRow
              label="来源"
              value={<span className="font-mono text-caption">{alert.source}</span>}
            />
          ) : null}
        </div>

        {alert.impact ? <Section title="影响评估">{alert.impact}</Section> : null}

        {alert.suggestions?.length ? (
          <Section title="处置建议">
            <ol className="flex flex-col gap-2.5">
              {alert.suggestions.map((suggestion, idx) => (
                <li key={idx} className="flex items-start gap-2.5">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-hover text-caption font-medium text-ink-dim">
                    {idx + 1}
                  </span>
                  <span className="min-w-0 flex-1">{suggestion}</span>
                </li>
              ))}
            </ol>
          </Section>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
