import { useState, type FC } from 'react'
import {
  Sparkles, ChevronDown, CheckCircle2, Circle,
  Loader2, Play, Shield, RotateCcw, Terminal,
  Globe, Layers, ScrollText, BarChart, Zap,
  Pause, Copy, Wrench,
} from 'lucide-react'
import { cn } from '@/components/trae/utils'
import type { AIToolPanel } from '../mock-data'
import MiniBar from './MiniBar'

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

export default ToolPanel
