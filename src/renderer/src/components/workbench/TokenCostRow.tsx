import type { FC } from 'react'
import { BarChart, RotateCcw } from 'lucide-react'
import type { CostStats, TokenStats } from '@shared/agent-types'
import { formatCost } from './panels/utils'

/** Token 统计行 + 成本行 props */
export interface TokenCostRowProps {
  tokenStats: TokenStats
  costStats: CostStats
  sessionCost: number
  onResetSessionCost: () => void
}

/** Token 预算上限（用于进度条分母，可按需调整） */
const TOKEN_BUDGET_CAP = 100_000

/**
 * AIPanel 底部 Token / 成本统计行
 *
 * - 上半行：今日 token 计数 + 预算条 + 累计 token
 * - 下半行：本次会话/今日/本月 USD 成本三档展示 + 重置按钮
 */
const TokenCostRow: FC<TokenCostRowProps> = ({ tokenStats, costStats, sessionCost, onResetSessionCost }) => {
  return (
    <>
      {/* Token 统计行（今日真实 token，预算条保留设计示意） */}
      <div className="ai-token-row">
        <BarChart className="size-2.5 text-[var(--trae-text-tertiary)]" />
        <span className="whitespace-nowrap">
          今日{' '}
          <span className="text-[var(--trae-text-secondary)]">
            {tokenStats.today.toLocaleString()}
          </span>{' '}
          tokens
        </span>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--trae-bg-overlay-l3)]">
          <div
            className="h-full bg-[var(--trae-bg-brand)] transition-all"
            style={{
              width: `${Math.min(100, Math.round((tokenStats.today / Math.max(TOKEN_BUDGET_CAP, 1)) * 100))}%`,
            }}
          />
        </div>
        <span className="whitespace-nowrap">
          累计 {tokenStats.total.toLocaleString()}
        </span>
      </div>

      {/*
        * v0.9.3 §11 改进点 26 P2-F：成本累计展示
        *
        * 方案书要求："本次会话累计成本：¥X.XX / 今日累计：¥X.XX / 本月累计：¥X.XX"
        * 本实现使用 USD（与主进程 CostStats 单位一致），展示三档：
        *   本次会话 $X.XX · 今日 $X.XX · 本月 $X.XX
        * 并提供"重置会话"按钮（RotateCcw 图标），让用户主动重置 sessionCostBaseline。
        * 设计原则：
        *   - 单行紧凑布局，与上方 token-row 视觉对齐
        *   - 三档均显示 USD，金额 < 0.01 时显示 "<$0.01" 避免显示 $0.00 失真
        *   - hover 行整体高亮（CSS .ai-cost-row:hover）
        *   - ResetConfirmationTooltip 在按钮 hover 时提示"重置本次会话成本统计"
        */}
      <div className="ai-cost-row" title="Token 成本透明化（v0.9.3 §11 改进点 26）">
        <span className="ai-cost-icon" aria-hidden>
          $
        </span>
        <span className="ai-cost-segment ai-cost-session" title="自本次会话启动以来的累计成本">
          <span className="ai-cost-label">本次会话</span>
          <span className="ai-cost-value">
            ${formatCost(sessionCost)}
          </span>
        </span>
        <span className="ai-cost-divider" aria-hidden>·</span>
        <span className="ai-cost-segment" title="今日累计成本（UTC+8 当日 00:00 起）">
          <span className="ai-cost-label">今日</span>
          <span className="ai-cost-value">
            ${formatCost(costStats.todayCost)}
          </span>
        </span>
        <span className="ai-cost-divider" aria-hidden>·</span>
        <span className="ai-cost-segment" title="本月累计成本（UTC+8 当月 1 日 00:00 起）">
          <span className="ai-cost-label">本月</span>
          <span className="ai-cost-value">
            ${formatCost(costStats.monthCost)}
          </span>
        </span>
        <button
          type="button"
          className="ai-cost-reset-btn"
          onClick={onResetSessionCost}
          title="重置本次会话成本统计（本次会话从 0 重新累计）"
          aria-label="重置本次会话成本"
        >
          <RotateCcw className="size-2.5" />
        </button>
      </div>
    </>
  )
}

export default TokenCostRow
