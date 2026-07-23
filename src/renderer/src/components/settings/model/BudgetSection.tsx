/**
 * BudgetSection — 预算与告警 Section（M5 Task 6 拆分）
 *
 * 从 ModelSettings.tsx 抽取，负责月度预算设置 + 告警阈值 + 邮件通知 + 告警历史。
 *
 * 原 Section 7：预算与告警 SettingsCard。
 */
import { AlertCircle } from 'lucide-react'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { Slider } from '@/components/trae/Slider'
import { Switch } from '@/components/trae/Switch'
import type { BudgetAlert } from '@shared/models'

export interface BudgetSectionProps {
  /** 月度预算（美元） */
  monthlyBudget: number
  /** 修改月度预算回调 */
  onMonthlyBudgetChange: (value: number) => void
  /** 告警阈值（0-100 百分比） */
  alertThreshold: number
  /** 修改告警阈值回调 */
  onAlertThresholdChange: (value: number) => void
  /** 是否启用邮件通知 */
  emailNotify: boolean
  /** 切换邮件通知回调 */
  onEmailNotifyChange: (value: boolean) => void
  /** 告警历史列表（来自 budgetAlerts IPC） */
  budgetAlerts: BudgetAlert[]
}

export function BudgetSection(props: BudgetSectionProps) {
  const {
    monthlyBudget,
    onMonthlyBudgetChange,
    alertThreshold,
    onAlertThresholdChange,
    emailNotify,
    onEmailNotifyChange,
    budgetAlerts,
  } = props

  return (
    <SettingsCard icon={AlertCircle} title="预算与告警" tag="budget" className="p-5">
      {/* 月度预算设置 */}
      <div className="set-budget-row">
        <div className="set-budget-row__head">
          <span className="set-budget-row__label">
            月度预算
          </span>
          <div className="set-budget-input-wrap">
            <span className="set-budget-input-wrap__prefix">$</span>
            <input
              type="number"
              value={monthlyBudget}
              step={0.01}
              onChange={(e) => onMonthlyBudgetChange(Number(e.target.value))}
              aria-label="月度预算"
              className="set-budget-input"
            />
          </div>
        </div>
        <div className="set-budget-bar">
          <div className="set-budget-bar__track">
            <div
              className="set-budget-bar__fill"
              style={{ width: '34%' }}
            />
          </div>
          <span className="set-budget-meta">
            已用{' '}
            <span className="set-budget-meta__used">$0.68</span> · 剩余{' '}
            <span className="set-budget-meta__remaining">
              $1.32
            </span>
          </span>
        </div>
      </div>

      {/* 告警阈值设置 */}
      <div className="set-alert-row">
        <div className="set-alert-row__head">
          <span className="set-alert-row__label">
            告警阈值
          </span>
          <span className="set-alert-row__meta">
            当消耗达{' '}
            <span className="set-alert-row__meta-val">
              {alertThreshold}%
            </span>{' '}
            时告警
          </span>
        </div>
        <Slider
          value={[alertThreshold]}
          min={0}
          max={100}
          step={5}
          onValueChange={(arr) => onAlertThresholdChange(arr[0] ?? 0)}
          className="w-full"
        />
        <div className="set-alert-notify">
          <span className="set-alert-notify__label">邮件通知</span>
          <Switch checked={emailNotify} onCheckedChange={onEmailNotifyChange} />
        </div>
      </div>

      {/* 告警历史 */}
      <div className="set-alert-history">
        <span className="set-alert-history__head">
          告警历史
        </span>
        <div className="set-alert-history__list">
          {budgetAlerts.length === 0 ? (
            <div className="set-alert-history__empty">
              暂无告警历史
            </div>
          ) : (
            budgetAlerts.map((h, idx) => (
            <div
              key={`${h.text}-${idx}`}
              className="set-alert-history__item"
            >
              <div className="set-alert-history__item-info">
                <span
                  className={
                    'set-alert-history__dot ' +
                    (h.level === 'error'
                      ? 'set-alert-history__dot--error'
                      : 'set-alert-history__dot--alert')
                  }
                />
                <span className="set-alert-history__text">
                  {h.text}
                </span>
              </div>
              <span className="set-alert-history__time">
                {new Date(h.timestamp).toLocaleString('zh-CN', {
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
          ))
          )}
        </div>
      </div>
    </SettingsCard>
  )
}
