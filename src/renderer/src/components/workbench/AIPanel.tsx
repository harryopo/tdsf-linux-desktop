/**
 * AIPanel — 560px 右侧 AI 助手面板
 *
 * // @ai-session: ai-claude-20260720-wire
 * // @ai-task: Sprint-wire-AIPanel-to-agent-chat
 *
 * WIP: 单文件 1596 行待拆分至 < 500 行（CLAUDE.md B1 开发阶段豁免 · reviewer agent P0 修复）
 * 预计 Task 4.7 拆分：Composer / MessageList / TokenBudget / ToolPanel 独立组件
 *
 * 设计稿：tdsf-linux-redesign/pages/workbench-ai.html 第 2514-3296 行
 *
 * 结构：40px 标题栏（AI运维助手 + Token曲线 + 收起） + 消息滚动区
 *       + Composer chips + Composer 输入框 + Token 预算行
 *
 * Wire-1（2026-07-20）：
 * - 发送/停止 → useAgentChat → agent:chat 主路径（docs/AGENT_MAIN_PATH.md）
 * - 有真实对话时渲染 useAgentStore 消息；空列表默认真实空态（可手动打开设计稿示例）
 * - 工具面板按钮仍多为 mock（Wire-2+ 再接 HITL / 终端）
 *
 * 数据：
 * - 实时：useAgentChat / useAgentStore
 * - 可选示例：mock-data.ts MOCK_CHAT_MESSAGES（showDemo）
 * - chips：快捷运维提示词；token 预算条接 tokenStats
 */
import { useState, useRef, useEffect, type FC } from 'react'
import { useNavigate } from 'react-router-dom'
import { message } from 'antd'
import {
  Sparkles, ChevronDown, ChevronUp, CheckCircle2, Circle,
  Loader2, PanelRightClose, AtSign, Hash, Image as ImageIcon, ArrowUp, Square,
  Cpu, Clock, BarChart, Play, Shield, RotateCcw, Terminal,
  Globe, Layers, ScrollText, Zap,
  Pause, X, AlertTriangle, Copy, Wrench, Workflow,
} from 'lucide-react'
import { cn } from '@/components/trae/utils'
import {
  MOCK_CHAT_MESSAGES, MOCK_COMPOSER_CHIPS,
  type ChatMessage, type AIToolPanel, type ChatBlock,
} from './mock-data'
import { useAgentChat } from './useAgentChat'
import { useLoopEngineering } from './useLoopEngineering'
import { LoopWorkflowPanel } from './LoopWorkflowPanel'
import { useServerStore } from '@/stores/server-store'
import type { AgentMessage } from '@/stores/agent-store'
import type { PaorApprovalRequest } from '@/types/electron'
import './AIPanel.css'

/** 工具面板徽章变体颜色 */
const BADGE_COLOR: Record<string, string> = {
  brand: 'var(--trae-text-brand)',
  success: 'var(--trae-status-success-default)',
  warning: 'var(--trae-status-alert-default)',
  error: 'var(--trae-status-error-default)',
  neutral: 'var(--trae-text-secondary)',
  violet: 'var(--trae-accent-violet)',
}

/** 工具面板图标 + 颜色（按 type） */
const PANEL_ICON: Record<string, { Icon: typeof Sparkles; color: string }> = {
  thought: { Icon: Sparkles, color: 'var(--trae-text-brand)' },
  skill: { Icon: Wrench, color: 'var(--trae-status-success-default)' },
  knowledge: { Icon: Layers, color: 'var(--trae-text-brand)' },
  web: { Icon: Globe, color: 'var(--trae-text-brand)' },
  methodology: { Icon: ScrollText, color: 'var(--trae-text-brand)' },
  command: { Icon: Terminal, color: 'var(--trae-text-brand)' },
  metric: { Icon: BarChart, color: 'var(--trae-text-brand)' },
  evidence: { Icon: Shield, color: 'var(--trae-text-brand)' },
  progress: { Icon: Zap, color: 'var(--trae-text-brand)' },
  rollback: { Icon: RotateCcw, color: 'var(--trae-status-error-default)' },
  pause: { Icon: Pause, color: 'var(--trae-status-alert-default)' },
  'summary-card': { Icon: Zap, color: 'var(--trae-text-brand)' },
  summary: { Icon: CheckCircle2, color: 'var(--trae-status-success-default)' },
}

/** 迷你进度条 */
const MiniBar: FC<{ percent: number; color?: string }> = ({ percent, color = 'var(--trae-bg-brand)' }) => (
  <div className="mini-bar-track">
    <div className="mini-bar-fill" style={{ width: `${percent}%`, background: color }} />
  </div>
)

/**
 * 格式化 USD 成本展示（v0.9.3 §11 改进点 26 P2-F 辅助函数）
 *
 * - 0 → "$0.00"
 * - (0, 0.01) → "<$0.01"（避免显示 $0.00 失真，让用户知道有消耗）
 * - [0.01, 1) → 保留 3 位小数（如 $0.023）
 * - [1, 100) → 保留 2 位小数（如 $1.50 / $12.34）
 * - [100, ∞) → 保留 2 位小数 + 千位分隔符（如 $1,234.56）
 */
function formatCost(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return '0.00'
  if (usd < 0.01) return '<0.01'
  if (usd < 1) return usd.toFixed(3)
  if (usd < 100) return usd.toFixed(2)
  return usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** 单条工具面板（可折叠，grid-rows 动画） */
const ToolPanel: FC<{ panel: AIToolPanel; onAction?: (action: string, payload?: string) => void }> = ({ panel, onAction }) => {
  const [open, setOpen] = useState<boolean>(panel.defaultOpen ?? false)
  const { Icon, color: iconColor } = PANEL_ICON[panel.type] ?? { Icon: Sparkles, color: 'var(--trae-bg-brand)' }
  const badgeColor = panel.badgeVariant ? BADGE_COLOR[panel.badgeVariant] : undefined

  // 命令/进度/回滚/暂停/汇总卡片 为不可折叠核心面板
  const isCorePanel = ['command', 'progress', 'rollback', 'pause', 'summary-card'].includes(panel.type)

  return (
    <div className={cn(
      'my-3',
      panel.type === 'summary-card' && 'ai-summary-card',
    )}>
      <button
        type="button"
        onClick={() => !isCorePanel && setOpen((v) => !v)}
        disabled={isCorePanel}
        className={cn(
          'ai-tool-row',
          isCorePanel && 'cursor-default',
        )}
      >
        <Icon className={cn(panel.type === 'skill' && 'ai-tool-check')} style={{ color: iconColor }} />
        {panel.type === 'skill' && panel.skillMeta ? (
          <span>
            <span className="text-[var(--trae-text-default)]">调用Skill: </span>
            <span className="font-medium text-[var(--trae-text-brand)]">{panel.skillMeta.name}</span>
          </span>
        ) : (
          <span className="font-medium text-[var(--trae-text-default)]">{panel.title}</span>
        )}
        {panel.badge && panel.type !== 'summary-card' && (
          <span
            className={cn(
              'ai-badge',
              panel.type === 'knowledge'
                ? 'ai-badge-brand'
                : panel.type === 'thought'
                  ? 'shimmer-text ai-badge-default'
                  : 'ai-badge-default',
            )}
            style={panel.type !== 'knowledge' && panel.type !== 'thought' && badgeColor ? { color: badgeColor } : undefined}
          >
            {panel.badge}
          </span>
        )}
        {panel.badge && panel.type === 'summary-card' && (
          <span className="ai-summary-stat">· {panel.badge}</span>
        )}
        {typeof panel.duration === 'number' && (
          <span className="ai-step-duration">
            {panel.duration.toFixed(1)}s
          </span>
        )}
        {!isCorePanel && (
          <ChevronDown
            className={cn(
              'ai-chev',
              open && 'ai-chev-open',
            )}
          />
        )}
      </button>

      <div
        className={cn(
          'ai-tool-body',
          (open || isCorePanel) && 'ai-tool-body-open',
        )}
      >
        <div className={cn(!isCorePanel && 'ai-tool-inner')}>
          {/* Skill 面板完整详情（按设计稿：info row + 输入参数 + 执行步骤 + 输出结果） */}
          {panel.type === 'skill' && panel.skillMeta && (
            <div className="ai-skill-steps">
              {/* Skill info row */}
              <div className="ai-skill-step">
                <span className="font-medium text-[var(--trae-text-default)]">{panel.skillMeta.name}</span>
                <span className="ai-badge ai-badge-default">
                  {panel.skillMeta.version}
                </span>
                <span className="ai-badge ai-badge-default">
                  {panel.skillMeta.scope}
                </span>
              </div>
              {/* 输入参数 */}
              <div className="font-medium text-[var(--trae-text-tertiary)]">输入参数</div>
              <div className="ai-code-block">
                {panel.skillMeta.input}
              </div>
              {/* 执行步骤 */}
              <div className="font-medium text-[var(--trae-text-tertiary)]">执行步骤</div>
              <div className="ai-skill-steps">
                {panel.steps?.map((step, i) => (
                  <div key={i} className="ai-skill-step">
                    <CheckCircle2 className="text-[var(--trae-status-success-default)]" />
                    <span className="flex-1 text-[var(--trae-text-secondary)]">{step.label}</span>
                    {typeof step.duration === 'number' && (
                      <span className="ai-step-duration">{step.duration.toFixed(1)}s</span>
                    )}
                  </div>
                ))}
              </div>
              {/* 输出结果 */}
              <div className="font-medium text-[var(--trae-text-tertiary)]">输出结果</div>
              <div className="ai-code-block">
                {panel.skillMeta.output}
              </div>
            </div>
          )}

          {/* 步骤列表（thought 等，支持 label + description 分离渲染） */}
          {panel.steps && panel.type !== 'progress' && panel.type !== 'skill' && (
            <div className="ai-step-list">
              {panel.steps.map((step, i) => (
                <div key={i} className="ai-step-item">
                  {step.status === 'success' ? (
                    <CheckCircle2 className="text-[var(--trae-status-success-default)]" />
                  ) : step.status === 'active' ? (
                    <Loader2 className="animate-spin text-[var(--trae-bg-brand)]" />
                  ) : (
                    <Circle className="text-[var(--trae-text-tertiary)]" />
                  )}
                  <span className={cn(
                    'flex-1',
                    step.status === 'success' ? 'text-[var(--trae-text-secondary)]'
                      : step.status === 'active' ? 'text-[var(--trae-text-default)]'
                        : 'text-[var(--trae-text-tertiary)]',
                  )}>
                    {step.description ? (
                      <>
                        <span className="font-medium text-[var(--trae-text-default)]">{step.label}</span>
                        {' '}
                        <span className="text-[var(--trae-text-tertiary)]">{step.description}</span>
                      </>
                    ) : (
                      step.label
                    )}
                  </span>
                  {typeof step.duration === 'number' && (
                    <span className="ai-step-duration">
                      {step.duration.toFixed(1)}s
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* 命令面板 + 在终端运行/执行/沙箱预演/回滚 按钮 */}
          {panel.command && (
            <div className="flex flex-col gap-1.5">
              <div className="ai-cmd-panel">
                {/* Terminal block header bar（Claude Code style） */}
                <div className="ai-cmd-header">
                  <Terminal className="text-[var(--trae-bg-brand)]" />
                  <span className="ai-cmd-host">prod-web-01</span>
                  <div className="flex-1" />
                  <button
                    type="button"
                    onClick={() => onAction?.('copyCommand', panel.command?.cmd)}
                    className="ai-composer-icon-btn btn-press"
                    title="复制"
                  >
                    <Copy />
                  </button>
                  <button
                    type="button"
                    onClick={() => onAction?.('runInTerminal', panel.command?.cmd)}
                    className="ai-btn-run btn-press"
                    title="在终端运行"
                  >
                    <Play />
                    在终端运行
                  </button>
                </div>
                <div className="ai-cmd-block">
                  <span className="text-[var(--trae-brand-3)]">{panel.command.prompt}</span>{' '}
                  <span>{panel.command.cmd}</span>
                </div>
                {panel.command.translation && (
                  <div className="ai-cmd-translation"># {panel.command.translation}</div>
                )}
                {panel.command.output && (
                  <div className="ai-cmd-output">
                    {panel.command.output.map((line, i) => {
                      const cmdSuccess = panel.command?.success ?? false
                      return (
                        <div
                          key={i}
                          className={cn(
                            i === 0 && cmdSuccess && 'text-[var(--trae-status-success-default)]',
                            i === 0 && !cmdSuccess && 'text-[var(--trae-status-error-default)]',
                            (i !== 0 || !cmdSuccess) && 'text-[var(--trae-code-text)]',
                          )}
                        >
                          {line}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
              {/* 执行状态 */}
              <div className="ai-exec-status">
                <CheckCircle2 className="text-[var(--trae-status-success-default)]" />
                <span className="font-medium text-[var(--trae-status-success-default)]">执行成功</span>
                <span className="text-[var(--trae-text-tertiary)]">·</span>
                <span className="tabular-nums text-[var(--trae-text-tertiary)]">1.2s</span>
              </div>
              {/* 执行 / 沙箱预演 / 回滚 按钮组 */}
              <div className="ai-action-group">
                <button
                  type="button"
                  onClick={() => onAction?.('execute', panel.command?.cmd)}
                  className="ai-action-btn ai-action-btn-primary btn-press"
                >
                  <Zap />
                  执行
                </button>
                <button
                  type="button"
                  onClick={() => onAction?.('sandbox', panel.command?.cmd)}
                  className="ai-action-btn ai-action-btn-secondary btn-press"
                >
                  <Shield />
                  沙箱预演
                </button>
                <button
                  type="button"
                  onClick={() => onAction?.('rollback', panel.command?.cmd)}
                  className="ai-action-btn ai-action-btn-ghost btn-press"
                >
                  <RotateCcw />
                  回滚
                </button>
              </div>
            </div>
          )}

          {/* 指标对比表 */}
          {panel.metrics && (
            <div className="py-1 text-[12px] tabular-nums">
              <div className="ai-metric-grid text-[var(--trae-text-tertiary)]">
                <span className="font-medium">指标</span>
                <span className="text-right">前</span>
                <span className="text-right">后</span>
                <span className="text-right">变化</span>
              </div>
              {panel.metrics.map((m, i) => (
                <div key={i} className="ai-metric-grid">
                  <span className="font-medium text-[var(--trae-text-default)]">{m.label}</span>
                  <span className="text-right" style={{ color: m.beforeColor ?? 'var(--trae-status-error-default)' }}>{m.before}</span>
                  <span className="text-right text-[var(--trae-text-default)]">{m.after}</span>
                  <span
                    className="text-right font-medium"
                    style={{ color: m.deltaColor ?? 'var(--trae-status-success-default)' }}
                  >
                    {m.delta}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* 知识库结果 */}
          {panel.kbResults && (
            <div className="ai-kb-list py-1 text-[12px]">
              <div className="ai-cmd-translation">
                查询: &quot;nginx worker_connections 上限 P99延迟&quot;
              </div>
              {panel.kbResults.map((kb, i) => (
                <div
                  key={i}
                  className="ai-kb-item"
                >
                  <div className="ai-kb-header">
                    <span className="ai-kb-id">{kb.id}</span>
                    <span className="ai-kb-title">{kb.title}</span>
                    {kb.cited && (
                      <span className="ai-badge ai-badge-success">
                        已引用
                      </span>
                    )}
                  </div>
                  <div className="ai-kb-bar">
                    <MiniBar percent={kb.percent} color={kb.color} />
                    <span className="ai-kb-percent" style={{ color: kb.color }}>{kb.percent}%</span>
                  </div>
                  {kb.desc && <div className="ai-kb-desc">{kb.desc}</div>}
                </div>
              ))}
            </div>
          )}

          {/* 联网搜索结果 */}
          {panel.webResults && (
            <div className="ai-web-list py-1 text-[12px]">
              {panel.webResults.map((web, i) => (
                <div key={i} className="ai-web-item">
                  <span className="ai-web-title">{web.title}</span>
                  <span className="ai-web-source">{web.source}</span>
                  <span
                    className={cn(
                      'ai-badge',
                      web.highMatch ? 'ai-badge-brand' : 'ai-badge-default',
                    )}
                  >
                    {web.percent}%
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* SRE 黄金信号 2x2 网格 */}
          {panel.signals && (
            <div className="ai-signal-grid py-1">
              {panel.signals.map((signal, i) => (
                <div
                  key={i}
                  className="ai-signal-item"
                >
                  <span className="ai-signal-dot" style={{ background: signal.statusColor }} />
                  <span className="ai-signal-label">{signal.label}</span>
                  <span className="ai-signal-value" style={{ color: signal.statusColor }}>
                    {signal.value}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* 证据来源 */}
          {panel.evidences && (
            <div className="ai-evidence-list py-1">
              {panel.evidences.map((ev, i) => (
                <div key={i}>
                  <div className="ai-evidence-header">
                    <span className="ai-evidence-label">{ev.label}</span>
                    <span className="ai-evidence-percent">{ev.percent}%</span>
                  </div>
                  <MiniBar percent={ev.percent} color={ev.color} />
                </div>
              ))}
            </div>
          )}

          {/* 汇总卡片 7 步完成列表 */}
          {panel.summaryItems && (
            <div className="ai-summary-grid py-1 text-[12px]">
              {panel.summaryItems.map((item, i) => (
                <div key={i} className="ai-summary-item">
                  <CheckCircle2 className="text-[var(--trae-status-success-default)]" />
                  {item}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** 执行进度面板（非折叠） */
const ProgressPanel: FC<{ panel: AIToolPanel; onAction?: (action: string, payload?: string) => void }> = ({ panel, onAction }) => {
  return (
    <div className="ai-progress-panel my-4">
      <div className="ai-progress-header">
        <Zap className="size-3.5 text-[var(--trae-bg-brand)]" />
        <span className="ai-progress-title">{panel.title}</span>
        {panel.badge && (
          <span className="ai-progress-badge">
            <span className="ai-progress-pulse" />
            {panel.badge}
          </span>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => onAction?.('pauseExec')}
          className="btn-press inline-flex h-7 items-center gap-1 rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l2)] px-2.5 text-[12px] text-[var(--trae-text-secondary)] transition-colors hover:bg-[var(--trae-bg-overlay-l2)]"
        >
          <Pause className="size-3" />
          暂停
        </button>
        <button
          type="button"
          onClick={() => onAction?.('rollbackExec')}
          className="btn-press inline-flex h-7 items-center gap-1 rounded-[var(--trae-radius-4)] border border-[var(--trae-status-error-default)] px-2.5 text-[12px] text-[var(--trae-status-error-default)] transition-colors hover:bg-[var(--trae-status-error-surface-l1)]"
        >
          <RotateCcw className="size-3" />
          回滚
        </button>
      </div>
      <div className="ai-progress-steps">
        {panel.steps?.map((step, i) => (
          <div key={i} className="ai-progress-step">
            {step.status === 'success' ? (
              <>
                <CheckCircle2 className="text-[var(--trae-status-success-default)]" />
                <span className="flex-1 text-[var(--trae-text-secondary)]">{step.label}</span>
                {typeof step.duration === 'number' && (
                  <span className="ai-step-duration">{step.duration.toFixed(1)}s</span>
                )}
              </>
            ) : step.status === 'active' ? (
              <>
                <span className="ai-progress-pulse-step" />
                <span className="flex-1 text-[var(--trae-text-brand)]">{step.label}</span>
                {step.hint && <span className="text-[12px] text-[var(--trae-text-brand)]">{step.hint}</span>}
              </>
            ) : (
              <>
                <span className="ai-progress-pending" />
                <span className="flex-1 text-[var(--trae-text-tertiary)]">{step.label}</span>
                {step.hint && <span className="text-[12px] text-[var(--trae-text-tertiary)]">{step.hint}</span>}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/** 回滚面板 */
const RollbackPanel: FC<{ panel: AIToolPanel }> = ({ panel }) => {
  const rb = panel.rollback
  if (!rb) return null
  return (
    <div className="ai-rollback-panel my-4">
      <div className="ai-progress-header">
        <RotateCcw className="size-3.5 text-[var(--trae-status-error-default)]" />
        <span className="ai-progress-title">{panel.title}</span>
        {panel.badge && (
          <span className="ai-badge ai-badge-error">
            {panel.badge}
          </span>
        )}
        {rb.time && <span className="ml-auto ai-step-duration">{rb.time}</span>}
      </div>
      <div className="ai-cmd-block mb-2">
        <span className="text-[var(--trae-brand-3)]">root@prod-web-01:~#</span> {rb.cmd}
      </div>
      <div className="mb-2 text-[12px] text-[var(--trae-text-tertiary)]">回滚原因：{rb.reason}</div>
      <div className="ai-exec-status">
        <CheckCircle2 className="text-[var(--trae-status-success-default)]" />
        <span className="font-medium text-[var(--trae-status-success-default)]">{rb.status}</span>
        <span className="text-[var(--trae-text-tertiary)]">·</span>
        <span className="text-[var(--trae-text-tertiary)]">nginx已恢复</span>
      </div>
    </div>
  )
}

/** 暂停面板 */
const PausePanel: FC<{ panel: AIToolPanel; onAction?: (action: string, payload?: string) => void }> = ({ panel, onAction }) => {
  const pause = panel.pause
  if (!pause) return null
  return (
    <div className="ai-pause-panel my-4">
      <div className="ai-progress-header">
        <Pause className="size-3.5 text-[var(--trae-status-alert-default)]" />
        <span className="ai-progress-title">{panel.title}</span>
        {panel.badge && (
          <span className="ai-badge ai-badge-alert">
            {panel.badge}
          </span>
        )}
        <span className="ml-auto ai-step-duration">{pause.pausedFor}</span>
      </div>
      <div className="mb-2 text-[12px] leading-[1.5] text-[var(--trae-text-tertiary)]">{pause.description}</div>
      <div className="ai-action-group">
        <button
          type="button"
          onClick={() => onAction?.('resumeExec')}
          className="ai-action-btn ai-action-btn-primary btn-press"
        >
          <Play />
          继续执行
        </button>
        <button
          type="button"
          onClick={() => onAction?.('terminateTask')}
          className="ai-action-btn ai-action-btn-ghost btn-press"
          style={{ borderColor: 'var(--trae-status-error-default)', color: 'var(--trae-status-error-default)' }}
        >
          <X />
          终止任务
        </button>
      </div>
    </div>
  )
}

/** AI 富文本内容块渲染（表格 / 洞察 / 操作按钮） */
const BlockRenderer: FC<{ blocks: ChatBlock[]; onNavigate?: (path: string) => void }> = ({ blocks, onNavigate }) => {
  return (
    <div className="ai-msg-with-avatar">
      {/* AI 头像 */}
      <div className="ai-avatar">
        <Sparkles />
      </div>
      {/* 内容卡片 */}
      <div className="ai-card-wrap">
        <div className="ai-card">
          {blocks.map((block, i) => {
            if (block.type === 'paragraph') {
              return (
                <p key={i} className="mb-2.5 text-[12px] leading-[1.6] text-[var(--trae-text-default)]">
                  {block.text}
                </p>
              )
            }
            if (block.type === 'table') {
              return (
                <div key={i} className="ai-table">
                  {/* 表头 */}
                  <div className="ai-table-header">
                    {block.headers.map((h, idx) => (
                      <span
                        key={idx}
                        className={cn(
                          'shrink-0',
                          idx === 0 ? 'flex-1' : 'text-right',
                          idx === 1 && 'w-[70px]',
                          idx === 2 && 'w-[70px]',
                          idx === 3 && 'w-[50px]',
                        )}
                      >
                        {h}
                      </span>
                    ))}
                  </div>
                  {/* 数据行 */}
                  {block.rows.map((row, rIdx) => (
                    <div
                      key={rIdx}
                      className="ai-table-row"
                    >
                      {row.cells.map((cell, cIdx) => (
                        <span
                          key={cIdx}
                          className={cn(
                            'shrink-0',
                            cIdx === 0 ? 'flex-1' : 'text-right',
                            cIdx === 1 && 'w-[70px]',
                            cIdx === 2 && 'w-[70px]',
                            cIdx === 3 && 'w-[50px]',
                          )}
                          style={{ color: row.cellColors?.[cIdx] }}
                        >
                          {cell}
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              )
            }
            if (block.type === 'insight') {
              return (
                <div
                  key={i}
                  className="ai-insight"
                >
                  <div className="ai-insight-header">
                    <AlertTriangle className="size-3.5 text-[var(--trae-icon-brand)]" />
                    <span className="ai-insight-title">{block.title}</span>
                  </div>
                  <p className="ai-insight-text">{block.text}</p>
                </div>
              )
            }
            if (block.type === 'actions') {
              return (
                <div key={i} className="ai-chips">
                  {block.buttons.map((btn, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => onNavigate?.(btn.navigate)}
                      className={cn(
                        'ai-chip btn-press',
                        btn.primary && 'ai-chip-primary',
                      )}
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>
              )
            }
            return null
          })}
        </div>
      </div>
    </div>
  )
}

/** 单条消息渲染 */
const MessageRow: FC<{ message: ChatMessage; onAction?: (action: string, payload?: string) => void; onNavigate?: (path: string) => void }> = ({ message, onAction, onNavigate }) => {
  if (message.role === 'user') {
    return (
      <div className="ai-msg ai-msg-user">
        <div className="ai-msg-user-inner">
          <div className="ai-msg-user-bubble">
            {message.text}
          </div>
          {message.time && (
            <span className="ai-msg-time">{message.time}</span>
          )}
        </div>
      </div>
    )
  }
  return (
    <div className="ai-msg ai-msg-multi">
      {message.blocks && message.blocks.length > 0 && (
        <BlockRenderer blocks={message.blocks} onNavigate={onNavigate} />
      )}
      {message.panels?.map((panel, i) => {
        if (panel.type === 'progress') return <ProgressPanel key={i} panel={panel} onAction={onAction} />
        if (panel.type === 'rollback') return <RollbackPanel key={i} panel={panel} />
        if (panel.type === 'pause') return <PausePanel key={i} panel={panel} onAction={onAction} />
        return <ToolPanel key={i} panel={panel} onAction={onAction} />
      })}
      {message.summary && message.summaryVariant === 'checked' && (
        <div className="ai-summary-item py-1">
          <CheckCircle2 className="text-[var(--trae-status-success-default)]" />
          <div className="flex-1">
            <div className="text-[11px] leading-[1.6] text-[var(--trae-text-default)]">{message.summary}</div>
          </div>
        </div>
      )}
      {message.summary && message.summaryVariant !== 'checked' && (
        <div className="py-1">
          <div className="text-[11px] leading-[1.6] text-[var(--trae-text-default)]">{message.summary}</div>
          {/* 操作 chips：查看监控 / 记录决策 / 更新知识库（仅 msg-2 summary 显示，设计稿无图标） */}
          {message.id === 'msg-2' && (
            <div className="ai-chips">
              <button
                type="button"
                onClick={() => onNavigate?.('/monitor')}
                className="ai-chip btn-press"
              >
                查看监控
              </button>
              <button
                type="button"
                onClick={() => onNavigate?.('/history')}
                className="ai-chip btn-press"
              >
                记录决策
              </button>
              <button
                type="button"
                onClick={() => onNavigate?.('/knowledge')}
                className="ai-chip btn-press"
              >
                更新知识库
              </button>
            </div>
          )}
        </div>
      )}
      {typeof message.tokens === 'number' && (
        <div className="ai-token-row ai-token-pop">
          <Clock className="size-2.5" />
          <span>
            {message.summaryVariant === 'checked' ? (
              <>
                <span>本次会话累计</span>
                <span>{' · '}</span>
                <span>总计 <span className="font-medium text-[var(--trae-text-default)]">{message.tokens.toLocaleString()}</span> tokens</span>
              </>
            ) : (
              <>
                {'总计 '}
                <span className="text-[var(--trae-text-secondary)]">{message.tokens.toLocaleString()}</span> tokens
                {typeof message.duration === 'number' && message.duration > 0 && (
                  <>{' · 耗时 '}<span className="text-[var(--trae-text-secondary)]">{message.duration.toFixed(1)}s</span></>
                )}
              </>
            )}
          </span>
        </div>
      )}
    </div>
  )
}

/**
 * 实时 Agent 消息行（useAgentStore / Supervisor 主路径）
 * 设计稿富文本面板仍由 mock MessageRow 承担；实时路径先做可靠的文本气泡 + 流式光标。
 */
const LiveMessageRow: FC<{ message: AgentMessage }> = ({ message }) => {
  if (message.role === 'user') {
    const time = new Date(message.timestamp).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    })
    return (
      <div className="ai-msg ai-msg-user">
        <div className="ai-msg-user-inner">
          <div className="ai-msg-user-bubble whitespace-pre-wrap">
            {message.content}
          </div>
          <span className="ai-msg-time">{time}</span>
        </div>
      </div>
    )
  }

  // assistant / system
  return (
    <div className="ai-msg ai-msg-multi">
      <div className="ai-msg-with-avatar">
        <div className="ai-avatar">
          {message.isStreaming ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Sparkles />
          )}
        </div>
        <div className="ai-card-wrap">
          <div
            className="ai-card whitespace-pre-wrap"
            style={message.isError ? {
              borderColor: 'var(--trae-status-error-surface-l2)',
              background: 'var(--trae-status-error-surface-l1)',
              color: 'var(--trae-status-error-default)',
            } : undefined}
          >
            {message.content || (message.isStreaming ? '思考中…' : '')}
            {message.isStreaming && (
              <span className="ml-1 inline-block h-3.5 w-1.5 animate-pulse bg-[var(--trae-bg-brand)] align-middle" />
            )}
          </div>
        </div>
      </div>
      {(message.usage || message.model) && !message.isStreaming && (
        <div className="ai-token-row ai-token-pop" style={{ paddingLeft: 32 }}>
          <Clock className="size-3" />
          <span>
            {message.model ? `${message.model} · ` : ''}
            {message.usage
              ? `${message.usage.totalTokens.toLocaleString()} tokens`
              : ''}
          </span>
        </div>
      )}
    </div>
  )
}

/**
 * PAOR 审批卡片（v0.9.5）
 *
 * PAOR 循环遇到 HIGH/CRITICAL 风险命令时渲染，
 * 展示命令内容 + 风险等级，用户点击"批准/拒绝"后回调。
 */
const PaorApprovalCard: FC<{
  request: PaorApprovalRequest
  onApprove: (callId: string, approved: boolean) => void
}> = ({ request, onApprove }) => {
  const [responded, setResponded] = useState(false)
  const riskColor =
    request.riskLevel === 'CRITICAL'
      ? 'var(--trae-status-error-default)'
      : 'var(--trae-status-alert-default)'
  const riskBg =
    request.riskLevel === 'CRITICAL'
      ? 'var(--trae-status-error-surface-l1)'
      : 'var(--trae-bg-overlay-l1)'

  return (
    <div
      className="flex flex-col gap-2 rounded-[var(--trae-radius-6)] border px-3 py-2.5"
      style={{
        borderColor: riskColor,
        background: riskBg,
      }}
    >
      {/* 标题行 */}
      <div className="flex items-center gap-1.5">
        <Shield className="size-3.5 shrink-0" style={{ color: riskColor }} />
        <span className="text-[11px] font-semibold" style={{ color: riskColor }}>
          PAOR 审批 — {request.riskLevel} 风险
        </span>
      </div>
      {/* 命令 */}
      <div className="rounded-[var(--trae-radius-4)] bg-[var(--trae-terminal-block-bg)] px-2 py-1.5 font-mono text-[11px] leading-[1.5] text-[var(--trae-text-default)]">
        {request.command}
      </div>
      {/* 风险描述 */}
      {request.riskDescription && (
        <div className="text-[11px] leading-[1.4] text-[var(--trae-text-tertiary)]">
          {request.riskDescription}
        </div>
      )}
      {/* 操作按钮 */}
      {!responded ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex h-7 items-center rounded-[var(--trae-radius-6)] bg-[var(--trae-bg-brand)] px-3 text-[11px] font-medium text-[var(--trae-text-onbrand)] hover:bg-[var(--trae-bg-brand-hover)]"
            onClick={() => {
              setResponded(true)
              void onApprove(request.callId, true)
            }}
          >
            <CheckCircle2 className="mr-1 size-3" />
            批准执行
          </button>
          <button
            type="button"
            className="inline-flex h-7 items-center rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] px-3 text-[11px] font-medium text-[var(--trae-text-secondary)] hover:bg-[var(--trae-bg-overlay-l2)]"
            onClick={() => {
              setResponded(true)
              void onApprove(request.callId, false)
            }}
          >
            <X className="mr-1 size-3" />
            拒绝
          </button>
          <span className="text-[11px] text-[var(--trae-text-tertiary)]">60 秒未响应自动拒绝</span>
        </div>
      ) : (
        <div className="text-[11px] text-[var(--trae-text-tertiary)]">已响应，等待 PAOR 循环继续…</div>
      )}
    </div>
  )
}

/** AIPanel props */
export interface AIPanelProps {
  /** 收起 AI 面板回调 */
  onClose?: () => void
}

/** AIPanel 560px AI 助手面板 */
const AIPanel: FC<AIPanelProps> = ({ onClose }) => {
  const navigate = useNavigate()
  const [input, setInput] = useState('')
  const [activeChip, setActiveChip] = useState<string | null>(null)
  const [showTranslation, setShowTranslation] = useState(true)
  const [showDemo, setShowDemo] = useState(true)
  const [ctxTooltipVisible, setCtxTooltipVisible] = useState(false)
  /** 演示模式：true=走循环工程 7 步 HITL；false=普通 agent:chat */
  const [demoMode, setDemoMode] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const {
    messages: liveMessages,
    isStreaming,
    lastError,
    currentCorrelationId,
    providers,
    selectedProviderId,
    setSelectedProviderId,
    tokenStats,
    // v0.9.3 §11 改进点 26 P2-F：成本统计 + 会话累计 + 重置
    costStats,
    sessionCost,
    resetSessionCost,
    send,
    cancel,
    clear,
  } = useAgentChat()

  /** 循环工程子 Agent —— 演示模式专用 */
  const loop = useLoopEngineering()

  /** 当前活跃 SSH 会话 ID（演示模式启动循环工程时使用） */
  const activeSessionId = useServerStore((s) => s.activeSessionId)

  /** v0.9.5 PAOR 审批请求队列（高危命令等待用户批准/拒绝） */
  const [paorApprovals, setPaorApprovals] = useState<PaorApprovalRequest[]>([])

  /** 监听主进程推送的 PAOR 审批请求 */
  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onPaorApprovalRequest) return
    return api.onPaorApprovalRequest((request: PaorApprovalRequest) => {
      setPaorApprovals((prev) => [...prev, request])
    })
  }, [])

  /** 处理 PAOR 审批响应（批准/拒绝） */
  const handlePaorApprove = async (callId: string, approved: boolean) => {
    const api = window.electronAPI
    if (!api?.paorApprove) return
    await api.paorApprove(callId, approved)
    setPaorApprovals((prev) => prev.filter((r) => r.callId !== callId))
  }

  /** Token 预算上限（用于进度条分母，可按需调整） */
  const TOKEN_BUDGET_CAP = 100_000
  /** 上下文窗口用量（从今日 token 估算，模型窗口按 200K 计） */
  const ctxUsedPct = Math.min(100, Math.round((tokenStats.today / 200_000) * 100))
  const ctxUsedTokens = tokenStats.today >= 1000 ? `${(tokenStats.today / 1000).toFixed(1)}K` : String(tokenStats.today)
  const ctxTotalTokens = '200K'

  const [providerMenuOpen, setProviderMenuOpen] = useState(false)
  const providerMenuRef = useRef<HTMLDivElement>(null)

  const hasLiveConversation = liveMessages.length > 0
  /** 演示模式下循环工程已启动（loop.phase !== 'idle'）则视为有"实时"内容 */
  const hasLoopRunning = loop.phase !== 'idle'
  const selectedProvider = providers.find((p) => p.id === selectedProviderId) ?? null
  const providerLabel = selectedProvider
    ? selectedProvider.name || selectedProvider.model || selectedProvider.id
    : providers.length === 0
      ? '未配置模型'
      : '选择模型'

  /** 点击外部关闭 Provider 菜单 */
  useEffect(() => {
    if (!providerMenuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (!providerMenuRef.current?.contains(e.target as Node)) {
        setProviderMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [providerMenuOpen])

  /** textarea auto-resize */
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [input])

  /** 实时消息滚动到底部 */
  useEffect(() => {
    if (!hasLiveConversation && !hasLoopRunning) return
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [liveMessages, hasLiveConversation, isStreaming, hasLoopRunning, loop.phase, loop.workflowState, loop.decisionCard, loop.finalCard])

  /** 处理工具面板操作（在终端运行/执行/沙箱预演/回滚/暂停/终止）
   *
   * Wire-2（2026-07-22）：真实 IPC 接线
   * - copyCommand: 复制命令到剪贴板
   * - runInTerminal / execute / rollback / rollbackExec: 调用 sshExec(activeSessionId, cmd)
   * - sandbox: 调用 sandboxCreate + sandboxExecute（沙箱预演）
   * - pauseExec / terminateTask: 调用 agentChatCancel(currentCorrelationId) 取消流
   * - resumeExec: 当前 IPC 不支持恢复，提示用户重新发送
   *
   * 非 Electron 环境降级为提示消息，UI 不崩溃。
   */
  const handleToolAction = async (action: string, payload?: string) => {
    // 1. 复制命令：直接写入剪贴板
    if (action === 'copyCommand') {
      if (payload) {
        try {
          await navigator.clipboard.writeText(payload)
          message.success('命令已复制到剪贴板')
        } catch {
          message.error('复制失败，请手动选择文本')
        }
      }
      return
    }

    // 2. 暂停 / 终止任务：取消当前 agent chat 流
    if (action === 'pauseExec' || action === 'terminateTask') {
      try {
        const api = window.electronAPI
        // 优先使用 agentChatCancel(correlationId) 取消当前对话流
        if (currentCorrelationId && api?.agentChatCancel) {
          await api.agentChatCancel(currentCorrelationId)
        } else if (activeSessionId && api?.agentCancel) {
          // fallback: agentCancel(sessionId) —— v0.8 旧接口，按 sessionId 取消
          await api.agentCancel(activeSessionId)
        } else {
          void cancel()
        }
        message.info(action === 'pauseExec' ? '已暂停当前任务' : '已终止当前任务')
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        message.error(`操作失败：${reason}`)
      }
      return
    }

    // 3. 恢复执行：当前 IPC 不支持恢复，提示用户重新发送
    if (action === 'resumeExec') {
      message.info('当前任务已暂停，请重新发送消息以恢复执行')
      return
    }

    // 4. 命令类操作（runInTerminal / execute / sandbox / rollback / rollbackExec）必须有 payload
    if (!payload) {
      message.warning('未找到可执行的命令')
      return
    }

    const api = window.electronAPI

    // 4.1 沙箱预演：sandboxCreate + sandboxExecute
    if (action === 'sandbox') {
      if (!api?.sandboxCreate || !api?.sandboxExecute) {
        message.warning('当前环境不支持沙箱执行（非 Electron 环境）')
        return
      }
      const hide = message.loading('准备沙箱环境...', 0)
      try {
        // 查找现有沙箱（复用 RUNNING 状态的沙箱）
        let sandboxId: string | null = null
        if (api.sandboxList) {
          const listResult = await api.sandboxList(10)
          if (listResult && 'items' in listResult && Array.isArray(listResult.items)) {
            const ready = listResult.items.find((s) => s.status === 'RUNNING')
            if (ready) sandboxId = ready.id
          }
        }
        if (!sandboxId) {
          const createResult = await api.sandboxCreate()
          if (!createResult || 'success' in createResult) {
            const err = createResult as { success: false; error: string } | null
            throw new Error(`沙箱创建失败：${err?.error || '未知错误'}`)
          }
          if (!createResult.id) throw new Error('沙箱创建返回无效 ID')
          sandboxId = createResult.id
        }

        // 执行命令
        const execResult = await api.sandboxExecute(sandboxId, payload)
        hide()
        if (!execResult || 'success' in execResult) {
          const err = execResult as { success: false; error: string } | null
          throw new Error(err?.error || '沙箱执行返回未知错误')
        }
        if (execResult.exitCode === 0) {
          message.success(`沙箱执行成功（耗时 ${execResult.durationMs ?? 0}ms）`)
        } else {
          message.warning(`沙箱执行完成（exit=${execResult.exitCode}）`)
        }
      } catch (err) {
        hide()
        const reason = err instanceof Error ? err.message : String(err)
        message.error(`沙箱执行失败：${reason}`)
      }
      return
    }

    // 4.2 SSH 命令执行：runInTerminal / execute / rollback / rollbackExec
    if (!activeSessionId) {
      message.warning('该功能需要连接 SSH 服务器后使用')
      return
    }
    if (!api?.sshExec) {
      message.warning('当前环境不支持 SSH 执行（非 Electron 环境）')
      return
    }

    const hide = message.loading(`正在执行命令：${payload}`, 0)
    try {
      const result = await api.sshExec(activeSessionId, payload)
      hide()
      if (result.exitCode === 0) {
        message.success(`命令执行成功（耗时 ${result.duration}ms）`)
      } else {
        message.warning(`命令执行完成（exit=${result.exitCode}）`)
      }
    } catch (err) {
      hide()
      const reason = err instanceof Error ? err.message : String(err)
      message.error(`命令执行失败：${reason}`)
    }
  }

  /** 处理消息中的导航操作（查看监控/记录决策/更新知识库） */
  const handleMessageNavigate = (path: string) => {
    navigate(path)
  }

  /** 处理发送/停止 — 主路径 agent:chat 或 演示模式 loop:start */
  const handleSendToggle = () => {
    // 演示模式：循环工程运行中 → 点击发送键表示取消
    if (demoMode && loop.isRunning) {
      void loop.cancel()
      return
    }
    // 普通模式：流式生成中 → 取消
    if (!demoMode && isStreaming) {
      void cancel()
      return
    }
    if (!input.trim()) return
    const text = input
    setInput('')
    // 一旦用户发真实消息，收起设计稿 demo（仍可手动再开）
    setShowDemo(false)

    if (demoMode) {
      // 演示模式：启动循环工程 7 步 HITL
      if (!activeSessionId) {
        loop.reset()
        message.warning('演示模式需要先连接 SSH。请用顶栏服务器菜单或「设置 → SSH」连接主机。')
        return
      }
      if (providers.length === 0) {
        message.warning('请先配置模型 Provider（设置 → 模型）')
        return
      }
      void loop.start(text, activeSessionId, {
        providerId: selectedProviderId ?? undefined,
        strength: 'standard',
      })
    } else {
      void send(text)
    }
  }

  /** 在输入框追加前缀 */
  const insertPrefix = (prefix: string) => {
    setInput((prev) => {
      const sep = prev.endsWith(' ') || prev === '' ? '' : ' '
      return `${prev}${sep}${prefix}`
    })
    textareaRef.current?.focus()
  }

  /** chip 快捷填入可直接发送的运维提示词 */
  const handleChipClick = (chip: string) => {
    setActiveChip((c) => (c === chip ? null : chip))
    const prompts: Record<string, string> = {
      诊断:
        '请诊断当前主机健康状态：磁盘(df -h)、内存(free -m)、负载(uptime)、关键服务(systemctl --failed)。只读命令，给出结论与建议。',
      部署: '请给出 Nginx 反向代理部署检查清单：配置语法、端口监听、上游健康、证书与 reload 风险点。',
      巡检:
        '请做一次只读巡检：磁盘使用率、inode、内存与 swap、失败的 systemd 单元、最近 journal 错误摘要。',
      回滚: '若最近一次配置变更导致服务异常，请给出安全的回滚步骤与验证命令（先读后写，写操作需人工确认）。',
      扩容: '请分析当前资源瓶颈（CPU/内存/磁盘/网络）并给出扩容建议与验证指标。',
    }
    setInput(prompts[chip] ?? `${chip}：`)
    textareaRef.current?.focus()
  }

  return (
    <div className="wb-aipanel flex w-[560px] shrink-0 flex-col border-l border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-default)]">
      {/* ===== 标题栏 40px ===== */}
      <div className="relative flex h-10 shrink-0 items-center justify-between gap-2 border-b border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] px-4">
        {/* Left: title + live badge */}
        <div className="flex min-w-0 items-center gap-2">
          <Sparkles className="size-3.5 text-[var(--trae-text-brand)]" />
          <span className="whitespace-nowrap text-[13px] font-semibold text-[var(--trae-text-default)]">AI运维助手</span>
          <span
            className={cn(
              'inline-flex h-5 items-center gap-1 rounded-full px-1.5 text-[11px] font-medium',
              demoMode
                ? 'bg-[var(--trae-bg-brand)] text-[var(--trae-text-onbrand)]'
                : isStreaming
                  ? 'bg-[var(--trae-bg-brand-popup)] text-[var(--trae-text-brand)]'
                  : hasLiveConversation
                    ? 'bg-[var(--trae-status-success-surface-l1)] text-[var(--trae-status-success-default)]'
                    : 'bg-[var(--trae-bg-overlay-l3)] text-[var(--trae-text-tertiary)]',
            )}
          >
            <span
              className={cn(
                'inline-block size-1 rounded-full',
                demoMode
                  ? 'ai-pulse-dot bg-[var(--trae-text-onbrand)]'
                  : isStreaming
                    ? 'ai-pulse-dot bg-[var(--trae-bg-brand)]'
                    : hasLiveConversation
                      ? 'bg-[var(--trae-status-success-default)]'
                      : 'bg-[var(--trae-text-tertiary)]',
              )}
            />
            {demoMode
              ? (loop.isRunning ? '循环工程运行中' : '演示就绪')
              : isStreaming
                ? '生成中'
                : hasLiveConversation
                  ? '已连接'
                  : '就绪'}
          </span>
        </div>

        {/* Right: clear / demo toggle / translate / collapse */}
        <div className="flex items-center gap-1">
          {hasLiveConversation && (
            <button
              type="button"
              title="清空对话"
              onClick={() => {
                clear()
                setShowDemo(true)
              }}
              className="btn-press flex size-7 items-center justify-center rounded-[var(--trae-radius-4)] text-[var(--trae-text-secondary)] transition-colors hover:bg-[var(--trae-bg-overlay-l2)] hover:text-[var(--trae-text-default)]"
            >
              <RotateCcw className="size-3.5" />
            </button>
          )}
          {!hasLiveConversation && (
            <button
              type="button"
              title={showDemo ? '隐藏设计稿示例' : '显示设计稿示例'}
              onClick={() => setShowDemo((v) => !v)}
              className="btn-press px-1.5 h-7 rounded-[var(--trae-radius-4)] text-[11px] text-[var(--trae-text-tertiary)] transition-colors hover:bg-[var(--trae-bg-overlay-l2)] hover:text-[var(--trae-text-default)]"
            >
              {showDemo ? '示例开' : '示例关'}
            </button>
          )}
          <button
            type="button"
            title={showTranslation ? '隐藏命令翻译注释' : '显示命令翻译注释'}
            onClick={() => setShowTranslation((v) => !v)}
            className="btn-press flex size-7 items-center justify-center rounded-[var(--trae-radius-4)] text-[var(--trae-text-secondary)] transition-colors hover:bg-[var(--trae-bg-overlay-l2)] hover:text-[var(--trae-text-default)]"
          >
            {showTranslation ? (
              <ChevronUp className="size-3.5" />
            ) : (
              <ChevronDown className="size-3.5" />
            )}
          </button>
          <button
            type="button"
            title="收起 AI 面板"
            onClick={onClose}
            className="btn-press flex size-7 items-center justify-center rounded-[var(--trae-radius-4)] text-[var(--trae-text-secondary)] transition-colors hover:bg-[var(--trae-bg-overlay-l2)] hover:text-[var(--trae-text-default)]"
          >
            <PanelRightClose className="size-4" />
          </button>
        </div>
      </div>

      {/* ===== 消息滚动区 ===== */}
      <div className="ai-messages flex flex-col gap-6">
        {providers.length === 0 && (
          <div className="flex items-start gap-2 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-overlay-l1)] px-3 py-2.5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--trae-status-alert-default)]" />
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-medium text-[var(--trae-text-default)]">
                尚未配置模型 Provider
              </div>
              <div className="mt-0.5 text-[11px] leading-4 text-[var(--trae-text-tertiary)]">
                Agent 主路径需要 API Key。配置后即可在此流式对话。
              </div>
              <button
                type="button"
                onClick={() => navigate('/settings/model')}
                className="mt-2 inline-flex h-8 items-center rounded-[var(--trae-radius-6)] bg-[var(--trae-bg-brand)] px-3 text-[12px] font-medium text-[var(--trae-text-onbrand)] hover:bg-[var(--trae-bg-brand-hover)]"
              >
                去配置模型
              </button>
            </div>
          </div>
        )}

        {demoMode ? (
          /* 演示模式：渲染循环工程工作流面板 */
          <>
            {/* 演示模式说明条 */}
            {!hasLoopRunning && (
              <div className="rounded-[var(--trae-radius-6)] border border-dashed border-[var(--trae-border-brand)] bg-[var(--trae-bg-brand-popup)] px-3 py-2.5 text-[11px] leading-[1.6] text-[var(--trae-text-secondary)]">
                <div className="mb-1 flex items-center gap-1.5">
                  <Workflow className="size-3.5 text-[var(--trae-text-brand)]" />
                  <span className="font-semibold text-[var(--trae-text-brand)]">演示模式已开启</span>
                </div>
                <div className="text-[var(--trae-text-tertiary)]">
                  输入运维问题（如「nginx 服务启动失败」），将触发完整 7 步 HITL 工作流：
                  <span className="text-[var(--trae-text-secondary)]"> 假设计 → 决策卡片 → 人工确认 → 执行 → 验证</span>。
                </div>
                {!activeSessionId && (
                  <div className="mt-1.5 flex items-center gap-1 text-[var(--trae-status-alert-default)]">
                    <AlertTriangle className="size-3" />
                    <span>请先在左侧服务器列表连接一台 SSH 主机。</span>
                  </div>
                )}
              </div>
            )}
            <LoopWorkflowPanel loop={loop} />
            {paorApprovals.map((req) => (
              <PaorApprovalCard key={req.callId} request={req} onApprove={handlePaorApprove} />
            ))}
            <div ref={messagesEndRef} />
          </>
        ) : hasLiveConversation ? (
          <>
            {liveMessages.map((msg) => (
              <LiveMessageRow key={msg.id} message={msg} />
            ))}
            {lastError && !isStreaming && (
              <div className="flex items-start gap-1.5 rounded-[var(--trae-radius-6)] border border-[var(--trae-status-error-surface-l2)] bg-[var(--trae-status-error-surface-l1)] px-2.5 py-2 text-[12px] text-[var(--trae-status-error-default)]">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>{lastError}</span>
              </div>
            )}
            {paorApprovals.map((req) => (
              <PaorApprovalCard key={req.callId} request={req} onApprove={handlePaorApprove} />
            ))}
            <div ref={messagesEndRef} />
          </>
        ) : showDemo ? (
          <>
            <div className="rounded-[var(--trae-radius-6)] border border-dashed border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-overlay-l1)] px-2.5 py-1.5 text-[11px] text-[var(--trae-text-tertiary)]">
              下方为设计稿示例（mock）。发送消息后走真实 agent:chat。
            </div>
            {MOCK_CHAT_MESSAGES.map((msg) => (
              <MessageRow
                key={msg.id}
                message={msg}
                onAction={handleToolAction}
                onNavigate={handleMessageNavigate}
              />
            ))}
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-10 text-center">
            <Sparkles className="size-7 text-[var(--trae-text-brand)] opacity-80" />
            <div className="text-[14px] font-medium text-[var(--trae-text-default)]">开始与运维 Agent 对话</div>
            <div className="max-w-[300px] text-[12px] leading-5 text-[var(--trae-text-tertiary)]">
              主路径：agent:chat → Supervisor
              {activeSessionId ? '（已连 SSH，可调用只读诊断工具）' : '（未连 SSH 时仅文本；连接后可只读摸机）'}
              。也可打开「演示模式」走 7 步 HITL。
            </div>
            {!activeSessionId && (
              <button
                type="button"
                onClick={() => navigate('/settings/ssh')}
                className="inline-flex h-8 items-center rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] px-3 text-[12px] text-[var(--trae-text-brand)] hover:bg-[var(--trae-bg-overlay-l2)]"
              >
                去连接 SSH
              </button>
            )}
            {providers.length === 0 && (
              <button
                type="button"
                onClick={() => navigate('/settings/model')}
                className="inline-flex h-8 items-center rounded-[var(--trae-radius-6)] bg-[var(--trae-bg-brand)] px-3 text-[12px] font-medium text-[var(--trae-text-onbrand)]"
              >
                去配置模型
              </button>
            )}
          </div>
        )}
      </div>

      {/* ===== Composer chips ===== */}
      <div className="ai-composer-chips">
        {/* 演示模式切换 chip —— 接入真实循环工程 7 步 HITL */}
        <button
          type="button"
          title={demoMode ? '退出演示模式（回到普通 agent:chat）' : '进入演示模式（接入循环工程 7 步 HITL：假设置→决策卡片→执行→验证）'}
          onClick={() => {
            if (loop.isRunning) {
              // 切换前先取消进行中的循环工程
              void loop.cancel()
            }
            setDemoMode((v) => !v)
          }}
          className={cn(
            'ai-composer-chip btn-press',
            demoMode && 'ai-chip-primary',
          )}
        >
          <Workflow className="size-3" />
          {demoMode ? '演示模式：开' : '演示模式'}
          {demoMode && !activeSessionId && (
            <span className="ml-0.5 inline-flex h-3.5 items-center rounded-full bg-[var(--trae-status-alert-surface-l1)] px-1 text-[11px] text-[var(--trae-status-alert-default)]">
              未连接
            </span>
          )}
        </button>

        <span className="ai-composer-divider" />

        {MOCK_COMPOSER_CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => handleChipClick(chip)}
            className={cn(
              'ai-composer-chip btn-press',
              activeChip === chip && 'ai-chip-primary',
            )}
          >
            {chip}
          </button>
        ))}
      </div>

      {/* ===== Composer 输入框 ===== */}
      <div className="ai-composer-outer">
        <div className="ai-composer">
          <div className="ai-composer-top">
            <span className="ai-agent-badge">
              <Cpu className="size-3" />
              Agent
              <span className="ai-agent-dot" />
            </span>
            <span
              className="ai-composer-placeholder"
              style={{ display: input ? 'none' : undefined }}
            >
              您正在与Agent聊天，输入 '/' 获取更多能力
            </span>
          </div>

          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSendToggle()
              }
            }}
            className="ai-composer-textarea"
            placeholder=""
            style={{ maxHeight: 120 }}
          />

          <div className="ai-composer-toolbar">
            <div className="ai-composer-tools-left">
              <button
                type="button"
                title="@提及"
                onClick={() => insertPrefix('@')}
                className="ai-composer-icon-btn btn-press"
              >
                <AtSign className="size-3.5" />
              </button>
              <button
                type="button"
                title="#引用资源"
                onClick={() => insertPrefix('#')}
                className="ai-composer-icon-btn btn-press"
              >
                <Hash className="size-3.5" />
              </button>
              <button
                type="button"
                title="图片"
                onClick={() => {
                  // WIP: 图片附件暂未上线（CLAUDE.md A4 诚实标注 · A7 质量优先）
                  //
                  // 真实实现路径（预计 v1.0 P1 完成）：
                  // 1. main 进程新增 fs:upload-image IPC 通道（支持本地图片读取 + base64 编码）
                  // 2. 渲染层打开文件选择器（antd Upload 或 input[type=file]）
                  // 3. 图片压缩（browser-image-compression，限制 4MB 内）
                  // 4. 转为 base64 注入消息上下文（vision-capable model）
                  // 5. Provider 支持检查（OpenAI Vision / Claude Vision / Ollama llava）
                  void message.warning('图片附件暂未上线（WIP · 预计 v1.0 P1 完成），请使用文本输入')
                }}
                className="ai-composer-icon-btn btn-press"
              >
                <ImageIcon className="size-3.5" />
              </button>
              <span className="ai-composer-divider" />

              {/* 上下文使用率徽章 */}
              <span
                className="relative inline-flex h-5 cursor-pointer items-center gap-1 rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-overlay-l2)] px-1.5"
                onMouseEnter={() => setCtxTooltipVisible(true)}
                onMouseLeave={() => setCtxTooltipVisible(false)}
              >
                <svg width="10" height="10" viewBox="0 0 36 36" className="shrink-0">
                  <circle cx="18" cy="18" r="15" fill="none" stroke="var(--trae-bg-overlay-l3)" strokeWidth="3" />
                  <circle
                    cx="18" cy="18" r="15" fill="none"
                    stroke="var(--trae-bg-brand)" strokeWidth="3"
                    strokeDasharray="94.2"
                    strokeDashoffset={94.2 * (1 - ctxUsedPct / 100)}
                    transform="rotate(-90 18 18)" strokeLinecap="round"
                  />
                </svg>
                <span className="text-[11px] font-medium tabular-nums text-[var(--trae-text-secondary)]">
                  {ctxUsedPct}%
                </span>

                {/* Hover tooltip */}
                {ctxTooltipVisible && (
                  <div className="absolute bottom-[calc(100%+6px)] left-1/2 z-50 min-w-[180px] -translate-x-1/2 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-base-tertiary)] p-2.5 shadow-xl">
                    <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--trae-text-tertiary)]">
                      上下文使用率
                    </div>
                    <div className="flex items-center gap-2">
                      <svg width="28" height="28" viewBox="0 0 36 36" className="shrink-0">
                        <circle cx="18" cy="18" r="15" fill="none" stroke="var(--trae-bg-overlay-l3)" strokeWidth="3" />
                        <circle
                          cx="18" cy="18" r="15" fill="none"
                          stroke="var(--trae-bg-brand)" strokeWidth="3"
                          strokeDasharray="94.2"
                          strokeDashoffset={94.2 * (1 - ctxUsedPct / 100)}
                          transform="rotate(-90 18 18)" strokeLinecap="round"
                        />
                        <text x="18" y="22" textAnchor="middle" fontSize="9" fill="var(--trae-text-default)" fontWeight="600">
                          {ctxUsedPct}%
                        </text>
                      </svg>
                      <div>
                        <div className="text-[11px] font-semibold text-[var(--trae-text-default)]">
                          {ctxUsedTokens} / {ctxTotalTokens}
                        </div>
                        <div className="text-[11px] text-[var(--trae-text-tertiary)]">tokens used</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        // WIP: 上下文压缩暂未上线（CLAUDE.md A4 诚实标注 · A7 质量优先）
                        //
                        // 真实实现路径（预计 v1.0 P1 完成）：
                        // 1. 实现对话历史摘要算法（rolling summary）
                        // 2. 当 ctxUsedPct > 80% 时自动触发压缩
                        // 3. 保留最近 N 轮 + 系统提示 + 工具调用结果
                        // 4. 早期对话用 LLM 生成摘要替换原始消息
                        // 5. 压缩后更新 ctxUsedTokens / ctxTotalTokens 状态
                        void message.warning('上下文压缩暂未上线（WIP · 预计 v1.0 P1 完成）')
                      }}
                      className="btn-press mt-2 h-6 w-full rounded-[var(--trae-radius-4)] border border-[var(--trae-border-brand)] bg-[var(--trae-bg-brand-popup)] text-[11px] font-medium text-[var(--trae-text-brand)] transition-colors hover:brightness-110"
                    >
                      压缩上下文
                    </button>
                  </div>
                )}
              </span>

              {/* Provider 选择（真列表） */}
              <div className="relative" ref={providerMenuRef}>
                <button
                  type="button"
                  title="切换模型"
                  onClick={() => setProviderMenuOpen((v) => !v)}
                  className="ai-model-btn btn-press"
                >
                  <span className="truncate">{providerLabel}</span>
                  <ChevronDown className="size-2.5 shrink-0" />
                </button>
                {providerMenuOpen && (
                  <div className="absolute bottom-[calc(100%+4px)] left-0 z-50 min-w-[180px] rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-base-tertiary)] py-1 shadow-xl">
                    {providers.length === 0 ? (
                      <div className="px-3 py-2 text-[11px] text-[var(--trae-text-tertiary)]">
                        暂无 Provider，请到设置 → 模型配置添加
                      </div>
                    ) : (
                      providers.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          className={cn(
                            'flex w-full flex-col items-start px-3 py-1.5 text-left transition-colors hover:bg-[var(--trae-bg-overlay-l2)]',
                            p.id === selectedProviderId && 'bg-[var(--trae-bg-overlay-l1)]',
                          )}
                          onClick={() => {
                            setSelectedProviderId(p.id)
                            setProviderMenuOpen(false)
                          }}
                        >
                          <span className="text-[11px] text-[var(--trae-text-default)]">
                            {p.name || p.id}
                          </span>
                          <span className="text-[11px] text-[var(--trae-text-tertiary)]">
                            {p.model}
                          </span>
                        </button>
                      ))
                    )}
                    <div className="my-1 border-t border-[var(--trae-border-neutral-l1)]" />
                    <button
                      type="button"
                      className="flex w-full px-3 py-1.5 text-left text-[11px] text-[var(--trae-text-brand)] hover:bg-[var(--trae-bg-overlay-l2)]"
                      onClick={() => {
                        setProviderMenuOpen(false)
                        navigate('/settings/model')
                      }}
                    >
                      打开模型设置…
                    </button>
                  </div>
                )}
              </div>
            </div>

            <button
              type="button"
              title={
                demoMode
                  ? (loop.isRunning ? '取消循环工程' : '启动循环工程')
                  : (isStreaming ? '停止生成' : '发送')
              }
              onClick={handleSendToggle}
              disabled={
                demoMode
                  ? (!loop.isRunning && !input.trim())
                  : (!isStreaming && !input.trim())
              }
              className="ai-send-btn btn-press wb-send-btn disabled:opacity-40"
            >
              {(demoMode && loop.isRunning) || (!demoMode && isStreaming) ? (
                <Square className="fill-[var(--trae-text-onbrand)] text-[var(--trae-text-onbrand)]" />
              ) : (
                <ArrowUp />
              )}
            </button>
          </div>
        </div>

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
            onClick={resetSessionCost}
            title="重置本次会话成本统计（本次会话从 0 重新累计）"
            aria-label="重置本次会话成本"
          >
            <RotateCcw className="size-2.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

export default AIPanel
