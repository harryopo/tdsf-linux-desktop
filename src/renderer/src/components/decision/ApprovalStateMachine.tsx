/**
 * ApprovalStateMachine — 9 态审批状态机（证据溯源链 + 四层风险控制）
 *
 * 设计稿：decision-detail.html 区域4（7 步光路时间线）+ 区域5（L1-L4 阶段门流水线）
 *
 * 9 态定义（项目自定义状态机模型）：
 *   Step 1 数据采集 → Step 2 异常分析 → Step 3 推理归因 → Step 4 交叉校验
 *   → Step 5 人工确认（HITL 闸门）→ Step 6 执行变更 → Step 7 效果验证
 *   + L1 预拦截 / L2 沙箱预演 / L3 人工审批 / L4 审计回放（横跨前 7 步的 4 道门）
 *
 * 视觉状态：
 *   - completed: 实心蓝圆 + check 图标 + 实线连接
 *   - in-progress: 蓝色脉冲圆 + 虚线连接
 *   - pending: 空心虚线圆 + 灰色虚线连接
 */
import { useState } from 'react'
import {
  Check, User, ChevronRight, ShieldCheck, FlaskConical, Eye,
} from 'lucide-react'

/** 步骤状态 */
type StepStatus = 'completed' | 'in-progress' | 'pending'

/** 单个步骤定义 */
export interface TimelineStep {
  num: number
  /** 英文步骤标识（spec §B 7 步 HITL 标准命名） */
  stepKey: 'collect' | 'analyze' | 'reason' | 'check' | 'confirm' | 'execute' | 'verify'
  title: string
  desc: string
  weight: number
  status: StepStatus
  /** 步骤时间戳（可选，ISO 字符串截取前 19 位 yyyy-mm-dd HH:MM:SS） */
  timestamp?: string
}

/** 4 道门定义 */
export interface RiskGate {
  level: 'L1' | 'L2' | 'L3' | 'L4'
  name: string
  desc: string
  status: StepStatus
}

interface ApprovalStateMachineProps {
  /** 7 步时间线数据 */
  steps: TimelineStep[]
  /** 4 道风险门数据 */
  gates: RiskGate[]
}

/** Gate 图标映射 */
const GATE_ICONS: Record<RiskGate['level'], typeof ShieldCheck> = {
  L1: ShieldCheck,
  L2: FlaskConical,
  L3: User,
  L4: Eye,
}

/** Gate 状态色映射 */
function getGateStyle(status: StepStatus): {
  border: string
  labelColor: string
  iconColor: string
  iconBg: string
  tag: string
  tagClass: string
} {
  switch (status) {
    case 'completed':
      return {
        border: 'border-[var(--trae-border-neutral-l1)]',
        labelColor: 'text-[var(--trae-text-tertiary)]',
        iconColor: 'text-[var(--trae-status-success-default)]',
        iconBg: '',
        tag: '已启用',
        tagClass: 'bg-[rgba(51,193,146,0.12)] text-[var(--trae-status-success-default)] border-[var(--trae-status-success-default)]',
      }
    case 'in-progress':
      return {
        border: 'border-[var(--trae-border-brand)]',
        labelColor: 'text-[var(--trae-text-brand)]',
        iconColor: '',
        iconBg: 'bg-[var(--trae-bg-brand)]',
        tag: '待审批',
        tagClass: 'bg-[rgba(210,157,0,0.12)] text-[var(--trae-status-alert-default)] border-[var(--trae-status-alert-default)]',
      }
    case 'pending':
      return {
        border: 'border-dashed border-[var(--trae-border-neutral-l2)]',
        labelColor: 'text-[var(--trae-text-tertiary)]',
        iconColor: 'text-[var(--trae-text-tertiary)]',
        iconBg: '',
        tag: '待触发',
        tagClass: 'bg-[var(--trae-bg-overlay-l1)] text-[var(--trae-text-tertiary)] border-[var(--trae-border-neutral-l1)]',
      }
  }
}

/**
 * ApprovalStateMachine 组件
 */
export function ApprovalStateMachine({ steps, gates }: ApprovalStateMachineProps) {
  const [expanded, setExpanded] = useState(true)

  return (
    <div className="flex flex-col gap-6">
      {/* ===== 7 步光路时间线 ===== */}
      <div className="rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] p-6">
        <input type="checkbox" id="evidence-expand" checked={expanded} readOnly hidden />

        {/* 标题栏 */}
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[16px] font-semibold text-[var(--trae-text-default)]">证据溯源链</span>
            <span className="inline-flex h-5 items-center rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-overlay-l1)] px-2 text-[10px] text-[var(--trae-text-secondary)]">
              7 步 · HITL
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-5 items-center rounded-[var(--trae-radius-4)] border border-[var(--trae-border-brand)] bg-[var(--trae-bg-brand-popup)] px-2 text-[10px] font-medium text-[var(--trae-text-brand)]">
              进行中
            </span>
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="inline-flex h-6 items-center gap-1.5 rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-overlay-l2)] px-2.5 text-[10px] font-medium text-[var(--trae-text-secondary)] transition-colors hover:bg-[var(--trae-bg-overlay-l3)] hover:text-[var(--trae-text-default)]"
              aria-label={expanded ? '收起' : '展开'}
            >
              {expanded ? '收起' : '展开'}
              <ChevronRight className={`h-3 w-3 transition-transform ${expanded ? '-rotate-90' : 'rotate-90'}`} />
            </button>
          </div>
        </div>

        {/* 7 步时间线 */}
        {expanded && (
          <div className="flex flex-col">
            {steps.map((step, idx) => {
              const isLast = idx === steps.length - 1
              return (
                <div key={step.num} className="flex gap-3">
                  {/* 左侧节点 + 连接线 */}
                  <div className="flex flex-col items-center shrink-0">
                    {step.status === 'completed' && (
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--trae-bg-brand)]">
                        <Check className="h-3.5 w-3.5 text-[var(--trae-text-onbrand)]" />
                      </div>
                    )}
                    {step.status === 'in-progress' && (
                      <div className="relative h-7 w-7">
                        <span
                          className="absolute inset-0 rounded-full bg-[var(--trae-bg-brand)] opacity-40"
                          style={{ animation: 'pulse-ring 2s cubic-bezier(.4,0,.6,1) infinite' }}
                        />
                        <span className="absolute inset-0 flex items-center justify-center rounded-full border-2 border-[var(--trae-bg-base-secondary)] bg-[var(--trae-bg-brand)]">
                          <User className="h-3.5 w-3.5 text-[var(--trae-text-onbrand)]" />
                        </span>
                      </div>
                    )}
                    {step.status === 'pending' && (
                      <div className="h-7 w-7 rounded-full border border-dashed border-[var(--trae-border-neutral-l2)] bg-transparent" />
                    )}
                    {/* 连接线 */}
                    {!isLast && (
                      <div
                        className={`w-0.5 flex-1 min-h-[32px] ${
                          step.status === 'completed'
                            ? 'bg-[var(--trae-bg-brand)]'
                            : step.status === 'in-progress'
                            ? 'border-l-2 border-dashed border-[var(--trae-border-neutral-l2)]'
                            : 'border-l-2 border-dashed border-[var(--trae-border-neutral-l2)]'
                        }`}
                      />
                    )}
                  </div>

                  {/* 右侧步骤卡片 */}
                  <div
                    className={`step-card mb-2 flex-1 rounded-[var(--trae-radius-6)] p-3 transition-colors hover:bg-[var(--trae-bg-overlay-l2)] ${
                      step.status === 'in-progress'
                        ? 'border border-[var(--trae-border-brand)] bg-[var(--trae-bg-base-tertiary)]'
                        : step.status === 'pending'
                        ? 'border border-dashed border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-base-tertiary)]'
                        : 'border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-tertiary)]'
                    } ${isLast ? 'mb-0' : ''}`}
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[12px] font-semibold ${
                            step.status === 'in-progress'
                              ? 'text-[var(--trae-text-brand)]'
                              : step.status === 'pending'
                              ? 'text-[var(--trae-text-tertiary)]'
                              : 'text-[var(--trae-text-default)]'
                          }`}
                        >
                          Step {step.num} · {step.title}
                        </span>
                        <span className="font-mono text-[10px] tracking-[0.04em] text-[var(--trae-text-tertiary)]">
                          {step.stepKey}
                        </span>
                        <span
                          className={`inline-flex h-5 items-center rounded-[var(--trae-radius-4)] border px-2 text-[10px] font-medium ${
                            step.status === 'completed'
                              ? 'border-[var(--trae-status-success-default)] bg-[rgba(51,193,146,0.12)] text-[var(--trae-status-success-default)]'
                              : step.status === 'in-progress'
                              ? 'border-[var(--trae-border-brand)] bg-[var(--trae-bg-brand-popup)] text-[var(--trae-text-brand)]'
                              : 'border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-overlay-l1)] text-[var(--trae-text-tertiary)]'
                          }`}
                        >
                          {step.status === 'completed' ? '已完成' : step.status === 'in-progress' ? '进行中' : '待决定'}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        {step.timestamp && (
                          <span className="font-mono text-[10px] tabular-nums text-[var(--trae-text-tertiary)]">
                            {step.timestamp}
                          </span>
                        )}
                        <span
                          className={`font-mono text-[10px] tabular-nums ${
                            step.status === 'pending' ? 'text-[var(--trae-text-tertiary)]' : 'text-[var(--trae-text-brand)]'
                          }`}
                        >
                          权重 {step.weight.toFixed(2)}
                        </span>
                      </div>
                    </div>
                    <p
                      className={`text-[12px] leading-[1.6] ${
                        step.status === 'pending' ? 'text-[var(--trae-text-tertiary)]' : 'text-[var(--trae-text-secondary)]'
                      }`}
                    >
                      {step.desc}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ===== 四层风险控制（阶段门流水线）===== */}
      <div className="rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] p-6">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[16px] font-semibold text-[var(--trae-text-default)]">四层风险控制</span>
            <span className="inline-flex h-5 items-center rounded-[var(--trae-radius-4)] border border-[var(--trae-status-success-default)] bg-[rgba(51,193,146,0.12)] px-2 text-[10px] font-medium text-[var(--trae-status-success-default)]">
              全部启用
            </span>
          </div>
          <span className="text-[10px] text-[var(--trae-text-tertiary)]">阶段门流水线 · 层层把关</span>
        </div>

        {/* 横向流水线 L1 → L2 → L3 → L4 */}
        <div className="flex flex-wrap items-stretch gap-2">
          {gates.map((gate, idx) => {
            const Icon = GATE_ICONS[gate.level]
            const style = getGateStyle(gate.status)
            return (
              <div key={gate.level} className="flex items-stretch gap-2">
                <div
                  className={`gate-card flex flex-1 min-w-[140px] flex-col items-center gap-2 rounded-[var(--trae-radius-8)] ${style.border} bg-[var(--trae-bg-base-tertiary)] p-4 transition-colors hover:bg-[var(--trae-bg-overlay-l2)]`}
                >
                  <span className={`font-mono text-[10px] font-semibold tracking-[0.08em] ${style.labelColor}`}>
                    {gate.level}
                  </span>
                  {gate.status === 'in-progress' ? (
                    <div className="relative h-6 w-6">
                      <span
                        className="absolute inset-0 rounded-full bg-[var(--trae-bg-brand)] opacity-40"
                        style={{ animation: 'pulse-ring 2s cubic-bezier(.4,0,.6,1) infinite' }}
                      />
                      <Icon className="absolute inset-0 m-auto h-6 w-6 text-[var(--trae-bg-brand)]" />
                    </div>
                  ) : (
                    <Icon className={`h-6 w-6 ${style.iconColor}`} />
                  )}
                  <span className="text-center text-[12px] font-medium text-[var(--trae-text-default)]">{gate.name}</span>
                  <span className="text-center text-[10px] text-[var(--trae-text-tertiary)]">{gate.desc}</span>
                  <span
                    className={`inline-flex h-5 items-center rounded-[var(--trae-radius-4)] border px-2 text-[10px] font-medium ${style.tagClass}`}
                  >
                    {style.tag}
                  </span>
                </div>
                {/* 箭头 */}
                {idx < gates.length - 1 && (
                  <div className="flex items-center shrink-0">
                    <ChevronRight className="h-4 w-4 text-[var(--trae-text-tertiary)]" />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* 内联 keyframes（pulse-ring 动画） */}
      <style>{`
        @keyframes pulse-ring {
          0%, 100% { box-shadow: 0 0 0 0 var(--trae-bg-brand-popup); }
          50% { box-shadow: 0 0 0 6px transparent; }
        }
      `}</style>
    </div>
  )
}
