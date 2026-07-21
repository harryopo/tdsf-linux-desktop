/**
 * DecisionSettings — 决策控制（D-S 证据理论 + PCR5 冲突阈值核心页）
 *
 * 路由：/settings/decision
 *
 * 设计稿：settings-decision.html
 * - Card 1: 决策流程配置（3 个风险等级开关 + 置信度阈值 + 决策超时）
 * - Card 2: 证据源权重配置（6 源权重滑块 + 综合权重总和 summary）
 * - Card 3: 风险控制策略（命令黑名单 + 敏感目录 + 文件大小/批量数/回滚时长）
 * - Card 4: 审批通知（前置通知 + 短信 + 接收人 + 多选渠道 + Webhook URL）
 * - ActionBar: 保存 / 恢复默认
 *
 * D-S 证据理论：6 个独立证据源（系统指标/历史决策/知识库/日志/人工经验/模型推理）
 * 各源权重通过滑块配置（0-100），综合权重总和反映证据强度。
 *
 * 设置项通过 usePersistentState 接入主进程 IPC（configGet/configSet）持久化，
 * electronAPI 不可用时退化为内存默认值，UI 正常渲染。
 */
import { type ReactNode } from 'react'
import { GitBranch, Layers, Shield, Bell, type LucideIcon } from 'lucide-react'
import { usePersistentState } from '@/hooks/usePersistentState'
import { SettingsPageHeader } from '@/components/settings/SettingsPageHeader'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { SettingsSlider } from '@/components/settings/SettingsSlider'
import { SettingsActionBar } from '@/components/settings/SettingsActionBar'
import { Switch } from '@/components/trae/Switch'
import { Input } from '@/components/trae/Input'
import { Slider } from '@/components/trae/Slider'
import { Checkbox } from '@/components/trae/Checkbox'

/**
 * RiskBadge — 风险等级徽章（设计稿 ds-risk-badge 自定义样式）
 *
 * 与通用 Badge 不同，使用深色底+彩色边框+等宽字体：
 * - low: bg #1F3324 / border #2F5A3C / color status-success-default
 * - mid: bg #332A1F / border #5C4A2A / color status-alert-default
 * - high: bg #331F1F / border #5C2A2A / color status-error-default
 */
type RiskTier = 'low' | 'mid' | 'high'

const RISK_BADGE_STYLE: Record<RiskTier, { bg: string; border: string; color: string }> = {
  low: {
    bg: '#1F3324',
    border: '#2F5A3C',
    color: 'var(--trae-status-success-default)',
  },
  mid: {
    bg: '#332A1F',
    border: '#5C4A2A',
    color: 'var(--trae-status-alert-default)',
  },
  high: {
    bg: '#331F1F',
    border: '#5C2A2A',
    color: 'var(--trae-status-error-default)',
  },
}

function RiskBadge({ tier, children }: { tier: RiskTier; children: ReactNode }) {
  const s = RISK_BADGE_STYLE[tier]
  return (
    <span
      className="inline-flex items-center gap-1 rounded-[var(--trae-radius-4)] px-2 py-0.5 font-mono text-[10px] font-medium leading-tight"
      style={{ background: s.bg, border: `1px solid ${s.border}`, color: s.color }}
    >
      {children}
    </span>
  )
}

interface RiskTierOption {
  key: string
  label: string
  desc: string
  tier: RiskTier
  badgeText: string
  defaultValue: boolean
}

interface EvidenceSource {
  id: string
  label: string
  defaultValue: number
}

interface TextAreaBlock {
  id: string
  label: string
  hint: string
  desc: string
  defaultValue: string
}

interface NotifyChannel {
  id: string
  label: string
  defaultValue: boolean
}

const RISK_TIERS: RiskTierOption[] = [
  {
    key: 'auto-low',
    label: '自动执行低风险命令',
    desc: '风险等级低于 30 的命令自动执行，无需人工干预',
    tier: 'low',
    badgeText: '风险 < 30',
    defaultValue: false,
  },
  {
    key: 'confirm-mid',
    label: '中风险需确认',
    desc: '风险等级 30-70 的命令需人工确认后方可执行',
    tier: 'mid',
    badgeText: '风险 30-70',
    defaultValue: true,
  },
  {
    key: 'dual-high',
    label: '高风险需双审',
    desc: '风险等级高于 70 的命令需双人审批后方可执行',
    tier: 'high',
    badgeText: '风险 > 70',
    defaultValue: true,
  },
]

const EVIDENCE_SOURCES: EvidenceSource[] = [
  { id: 'system-metrics', label: '系统指标采集', defaultValue: 70 },
  { id: 'history-match', label: '历史决策匹配', defaultValue: 60 },
  { id: 'knowledge-base', label: '知识库检索', defaultValue: 80 },
  { id: 'log-analysis', label: '日志分析', defaultValue: 50 },
  { id: 'human-experience', label: '人工经验', defaultValue: 90 },
  { id: 'model-inference', label: '模型推理', defaultValue: 40 },
]

const TEXTAREA_BLOCKS: TextAreaBlock[] = [
  {
    id: 'blacklist',
    label: '命令黑名单',
    hint: '每行一条命令',
    desc: '命中黑名单的命令一律拒绝执行，无论风险等级',
    defaultValue: 'rm -rf /\nshutdown\nreboot\ninit 0',
  },
  {
    id: 'sensitive-dirs',
    label: '敏感目录保护',
    hint: '每行一个路径',
    desc: '以下目录禁止写入或删除操作',
    defaultValue: '/etc\n/boot\n/sys\n/proc',
  },
]

const NOTIFY_CHANNELS: NotifyChannel[] = [
  { id: 'in-app', label: '站内信', defaultValue: true },
  { id: 'email', label: '邮件', defaultValue: true },
  { id: 'sms', label: '短信', defaultValue: false },
  { id: 'webhook', label: 'Webhook', defaultValue: true },
]

/** 各 record 类型设置项的默认值（与原 lazy useState 初始化保持一致） */
const DEFAULT_TIER_STATES: Record<string, boolean> = Object.fromEntries(
  RISK_TIERS.map((t) => [t.key, t.defaultValue]),
)
const DEFAULT_WEIGHTS: Record<string, number> = Object.fromEntries(
  EVIDENCE_SOURCES.map((s) => [s.id, s.defaultValue]),
)
const DEFAULT_TEXTAREAS: Record<string, string> = Object.fromEntries(
  TEXTAREA_BLOCKS.map((b) => [b.id, b.defaultValue]),
)
const DEFAULT_CHANNELS: Record<string, boolean> = Object.fromEntries(
  NOTIFY_CHANNELS.map((c) => [c.id, c.defaultValue]),
)

export function DecisionSettings() {
  // Card 1: 决策流程配置
  const [tierStates, setTierStates] = usePersistentState<Record<string, boolean>>(
    'decision.tierStates',
    DEFAULT_TIER_STATES,
  )
  const [confidenceThreshold, setConfidenceThreshold] = usePersistentState('decision.confidenceThreshold', 60)
  const [decisionTimeout, setDecisionTimeout] = usePersistentState('decision.decisionTimeout', 120)

  // Card 2: 证据源权重
  const [weights, setWeights] = usePersistentState<Record<string, number>>(
    'decision.weights',
    DEFAULT_WEIGHTS,
  )
  const totalWeight = EVIDENCE_SOURCES.reduce((sum, s) => sum + (weights[s.id] ?? 0), 0)

  // Card 3: 风险控制策略
  const [textAreas, setTextAreas] = usePersistentState<Record<string, string>>(
    'decision.textAreas',
    DEFAULT_TEXTAREAS,
  )
  const [fileSizeLimit, setFileSizeLimit] = usePersistentState('decision.fileSizeLimit', 100)
  const [batchLimit, setBatchLimit] = usePersistentState('decision.batchLimit', 50)
  const [rollbackRetention, setRollbackRetention] = usePersistentState('decision.rollbackRetention', 24)

  // Card 4: 审批通知
  const [preExecNotify, setPreExecNotify] = usePersistentState('decision.preExecNotify', true)
  const [smsNotify, setSmsNotify] = usePersistentState('decision.smsNotify', false)
  const [receiver, setReceiver] = usePersistentState('decision.receiver', 'admin@tdsf.dev')
  const [channels, setChannels] = usePersistentState<Record<string, boolean>>(
    'decision.channels',
    DEFAULT_CHANNELS,
  )
  const [webhookUrl, setWebhookUrl] = usePersistentState('decision.webhookUrl', 'https://hooks.tdsf.dev/alerts')

  return (
    <div>
      <SettingsPageHeader
        icon={GitBranch as LucideIcon}
        title="决策控制"
        desc="AI 运维决策流程与审批策略"
      />

      <div className="flex flex-col gap-4 p-6">
        {/* Card 1: 决策流程配置 */}
        <SettingsCard icon={GitBranch} title="决策流程配置" tag="decision.flow">
          {RISK_TIERS.map((t) => (
            <SettingsRow
              key={t.key}
              label={
                <span className="inline-flex items-center gap-2">
                  {t.label}
                  <RiskBadge tier={t.tier}>{t.badgeText}</RiskBadge>
                </span>
              }
              desc={t.desc}
              control={
                <Switch
                  checked={tierStates[t.key] ?? false}
                  onCheckedChange={(v) => setTierStates((prev) => ({ ...prev, [t.key]: v }))}
                />
              }
            />
          ))}
          <SettingsRow
            label="最低置信度阈值"
            desc="低于此值的 AI 决策不执行，避免误操作"
            control={
              <SettingsSlider
                value={confidenceThreshold}
                min={0}
                max={100}
                step={5}
                onValueChange={setConfidenceThreshold}
              />
            }
          />
          <SettingsRow
            label="决策超时秒数"
            desc="超时未确认的决策将自动拒绝"
            control={
              <Input
                type="number"
                value={decisionTimeout}
                onChange={(e) => setDecisionTimeout(Number(e.target.value))}
                className="h-[30px] w-[88px] justify-center text-center font-mono"
              />
            }
            isLast
          />
        </SettingsCard>

        {/* Card 2: 证据源权重配置 */}
        <SettingsCard icon={Layers} title="证据源权重配置" tag="evidence.weights">
          {EVIDENCE_SOURCES.map((src, idx) => (
            <div
              key={src.id}
              className={
                'flex items-center gap-3.5 py-2.5 ' +
                (idx === EVIDENCE_SOURCES.length - 1
                  ? 'pb-0.5'
                  : 'border-b border-[var(--trae-border-neutral-l1)]')
              }
            >
              <span className="w-[160px] shrink-0 text-[12px] font-medium text-[var(--trae-text-default)]">
                {src.label}
              </span>
              <Slider
                value={[weights[src.id] ?? 0]}
                min={0}
                max={100}
                step={1}
                onValueChange={(arr) =>
                  setWeights((prev) => ({ ...prev, [src.id]: arr[0] ?? 0 }))
                }
                className="flex-1"
              />
              <span className="shrink-0 text-right font-mono text-[13px] font-medium tabular-nums text-[var(--trae-bg-brand)]" style={{ minWidth: 34 }}>
                {weights[src.id] ?? 0}
              </span>
            </div>
          ))}
          <div className="mt-3 flex items-center justify-between gap-3 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-overlay-l1)] px-3 py-2.5">
            <span className="text-[10px] text-[var(--trae-text-secondary)]">
              综合权重总和 · 建议保持各源权重均衡
            </span>
            <span className="font-mono text-[13px] font-semibold tabular-nums text-[var(--trae-bg-brand)]">
              {totalWeight}
            </span>
          </div>
        </SettingsCard>

        {/* Card 3: 风险控制策略 */}
        <SettingsCard icon={Shield} title="风险控制策略" tag="risk.policy">
          {TEXTAREA_BLOCKS.map((blk, idx) => (
            <div
              key={blk.id}
              className={
                'py-3 ' +
                (idx === TEXTAREA_BLOCKS.length - 1 ? 'pb-0.5' : 'border-b border-[var(--trae-border-neutral-l1)]')
              }
            >
              <div className="mb-2 flex items-center justify-between gap-4">
                <div className="text-[12px] font-medium leading-[18px] text-[var(--trae-text-default)]">
                  {blk.label}
                </div>
                <span className="shrink-0 font-mono text-[10px] text-[var(--trae-text-tertiary)]">
                  {blk.hint}
                </span>
              </div>
              <div className="mt-0.5 text-[10px] leading-[14px] text-[var(--trae-text-secondary)]">
                {blk.desc}
              </div>
              <textarea
                value={textAreas[blk.id] ?? ''}
                onChange={(e) => setTextAreas((prev) => ({ ...prev, [blk.id]: e.target.value }))}
                spellCheck={false}
                className="mt-2 block min-h-[96px] w-full resize-y rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-base-tertiary)] px-3 py-2.5 font-mono text-[13px] font-normal leading-[20px] text-[var(--trae-text-default)] transition-colors focus:border-[var(--trae-bg-brand)] focus:outline-none"
              />
            </div>
          ))}
          <SettingsRow
            label="文件修改大小限制"
            desc="单次操作允许修改的文件大小上限（MB）"
            control={
              <Input
                type="number"
                value={fileSizeLimit}
                onChange={(e) => setFileSizeLimit(Number(e.target.value))}
                className="h-[30px] w-[88px] justify-center text-center font-mono"
              />
            }
          />
          <SettingsRow
            label="批量操作数量上限"
            desc="单次批量操作涉及的文件/对象数量上限"
            control={
              <Input
                type="number"
                value={batchLimit}
                onChange={(e) => setBatchLimit(Number(e.target.value))}
                className="h-[30px] w-[88px] justify-center text-center font-mono"
              />
            }
          />
          <SettingsRow
            label="操作回滚保留时长"
            desc="操作回滚快照的保留时长（小时）"
            control={
              <Input
                type="number"
                value={rollbackRetention}
                onChange={(e) => setRollbackRetention(Number(e.target.value))}
                className="h-[30px] w-[88px] justify-center text-center font-mono"
              />
            }
            isLast
          />
        </SettingsCard>

        {/* Card 4: 审批通知 */}
        <SettingsCard icon={Bell} title="审批通知" tag="approval.notify">
          <SettingsRow
            label="命令执行前通知"
            desc="命令执行前向接收人发送审批通知"
            control={<Switch checked={preExecNotify} onCheckedChange={setPreExecNotify} />}
          />
          <SettingsRow
            label="高风险操作短信通知"
            desc="高风险操作除常规通知外追加短信提醒"
            control={<Switch checked={smsNotify} onCheckedChange={setSmsNotify} />}
          />
          <SettingsRow
            label="通知接收人"
            desc="审批通知的默认接收人邮箱"
            control={
              <Input
                value={receiver}
                onChange={(e) => setReceiver(e.target.value)}
                className="h-[30px] w-[240px] font-mono"
              />
            }
          />
          <div className="py-3 border-b border-[var(--trae-border-neutral-l1)]">
            <div className="mb-2 flex items-center justify-between gap-4">
              <div className="text-[12px] font-medium leading-[18px] text-[var(--trae-text-default)]">
                通知方式
              </div>
              <span className="shrink-0 font-mono text-[10px] text-[var(--trae-text-tertiary)]">可多选</span>
            </div>
            <div className="mt-0.5 text-[10px] leading-[14px] text-[var(--trae-text-secondary)]">
              选择审批通知的发送渠道
            </div>
            <div className="mt-2.5 flex flex-wrap gap-3.5">
              {NOTIFY_CHANNELS.map((c) => (
                <label
                  key={c.id}
                  className="inline-flex cursor-pointer items-center gap-2 text-[12px] text-[var(--trae-text-default)]"
                >
                  <Checkbox
                    checked={channels[c.id] ?? false}
                    onCheckedChange={(v) => setChannels((prev) => ({ ...prev, [c.id]: v === true }))}
                  />
                  {c.label}
                </label>
              ))}
            </div>
          </div>
          <div className="py-3 pb-0.5">
            <div className="mb-2 flex items-center justify-between gap-4">
              <div className="text-[12px] font-medium leading-[18px] text-[var(--trae-text-default)]">
                Webhook URL
              </div>
              <span className="shrink-0 font-mono text-[10px] text-[var(--trae-text-tertiary)]">POST JSON</span>
            </div>
            <div className="mt-0.5 text-[10px] leading-[14px] text-[var(--trae-text-secondary)]">
              审批通知将以此 URL 作为 Webhook 推送目标
            </div>
            <Input
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              spellCheck={false}
              className="mt-2 h-[30px] w-full font-mono"
            />
          </div>
        </SettingsCard>

        <SettingsActionBar />
      </div>
    </div>
  )
}
