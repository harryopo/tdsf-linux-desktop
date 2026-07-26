/**
 * BudgetSection — 预算与告警 Section（M5 Task 6 拆分）
 *
 * 从 ModelSettings.tsx 抽取，负责月度预算设置 + 告警阈值 + 邮件通知 + 告警历史。
 *
 * v2.3.3 修复：
 * - "已用 $0.68 / 剩余 $1.32" 改为真实 usedAmount 计算
 * - 进度条 width 根据 usedAmount/monthlyBudget 动态计算
 * - 无数据时（usedAmount=0）显示 $0.00，避免硬编码误导用户
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
  /** 已用金额（美元，来自 tokenCostStats IPC） */
  usedAmount: number
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
    usedAmount,
  } = props

  // 已用 / 剩余 = 真实数据（无数据时 usedAmount=0，进度条 0%）
  const safeBudget = monthlyBudget > 0 ? monthlyBudget : 1
  const usedRatio = Math.min(100, Math.max(0, (usedAmount / safeBudget) * 100))
  const remainingAmount = Math.max(0, monthlyBudget - usedAmount)
  const usedDisplay = `$${usedAmount.toFixed(2)}`
  const remainingDisplay = `$${remainingAmount.toFixed(2)}`

  return (
    <SettingsCard
      icon={AlertCircle}
      title="预算与告警"
      tag="budget"
      className="p-5"
      hideTag
      noHeadBorder
      headMb="lg"
      iconColor="var(--trae-status-alert-default)"
    >
      {/* v2.3.4 折叠：默认收起整个预算与告警配置（普通用户不需要），
          只在用户主动展开时显示。点 summary 即可展开/收起。 */}
      <details
        className="set-budget-details"
        style={{ marginTop: 4 }}
      >
        <summary
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            padding: '8px 0',
            color: 'var(--trae-text-secondary)',
            fontSize: 13,
            listStyle: 'none',
            userSelect: 'none',
          }}
        >
          <span>预算与告警设置（月度预算 / 告警阈值 / 通知）</span>
          <span
            className="set-budget-summary-meta"
            style={{ fontSize: 12, color: 'var(--trae-text-tertiary)' }}
          >
            ${usedAmount.toFixed(2)} / ${monthlyBudget.toFixed(2)}
          </span>
        </summary>

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
                style={{ width: `${usedRatio}%` }}
              />
            </div>
            <span className="set-budget-meta">
              已用{' '}
              <span className="set-budget-meta__used">{usedDisplay}</span> · 剩余{' '}
              <span className="set-budget-meta__remaining">
                {remainingDisplay}
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
      </details>
    </SettingsCard>
  )
}
