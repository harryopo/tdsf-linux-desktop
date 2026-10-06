/**
 * DecisionSettings — 决策控制（D-S 证据理论 + PCR5 冲突阈值核心页）
 *
 * 路由：/settings/decision
 *
 * 设计稿：settings-decision.html
 * - Card 1: 决策流程配置（3 个风险等级开关 + 决策超时秒数）
 * - Card 2: 证据源权重配置（6 源权重滑块 + 综合权重总和 summary + 权重影响测试）
 * - Card 3: 审批补充说明（草稿存本机）
 * - ActionBar: 保存 / 恢复默认
 *
 * 已删掉的假设置（全仓零消费者，遵循 DESIGN.md §10）：
 * - 最低置信度阈值 decision.confidenceThreshold：工作流是 HITL，每一步 confirm 都要人点头，
 *   没有"高于某值就自动执行"这条路径；把它接上去等于给用户一个能关掉审批的开关
 * - 文件修改大小限制 / 批量操作数量上限 / 操作回滚保留时长：没有对应的执行与回滚机制
 *
 * 决策超时 decision.decisionTimeout 本轮已真接上：
 * 主进程 agent-workflow.ts resolveConfirmTimeoutMs 读它，到点自动拒绝（fail-closed）。
 *
 * D-S 证据理论：6 个独立证据源（系统指标/历史决策/知识库/日志/人工经验/模型推理）
 * 各源权重通过滑块配置（0-100），综合权重总和反映证据强度。
 *
 * 设置项通过 usePersistentState 接入主进程 IPC（configGet/configSet）持久化，
 * electronAPI 不可用时退化为内存默认值，UI 正常渲染。
 */
import { type ReactNode, useState } from 'react'
import { GitBranch, Layers, Shield } from 'lucide-react'
import { Button } from 'antd'
import type { CredibilityEvidenceInput, ConfidenceAssessment } from '@shared/agent-types'
import { usePersistentState } from '@/hooks/usePersistentState'
import { SettingsPageHeader } from '@/components/settings/SettingsPageHeader'
import { settingsHeader } from './settings-sections'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { SettingsActionBar } from '@/components/settings/SettingsActionBar'
import { Switch } from '@/components/trae/Switch'
import { Input } from '@/components/trae/Input'
import { Slider } from '@/components/trae/Slider'
import './Settings.css'

/**
 * RiskBadge — 风险等级徽章（设计稿 set-risk-badge--* 自定义样式）
 */
type RiskTier = 'low' | 'mid' | 'high'

const RISK_BADGE_CLASS: Record<RiskTier, string> = {
  low: 'set-risk-badge set-risk-badge--low',
  mid: 'set-risk-badge set-risk-badge--mid',
  high: 'set-risk-badge set-risk-badge--high',
}

function RiskBadge({ tier, children }: { tier: RiskTier; children: ReactNode }) {
  return (
    <span className={RISK_BADGE_CLASS[tier]}>
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

/**
 * 测试评估用的模拟 6 源证据输入
 *
 * 用于在 DecisionSettings 页面验证当前 6 源权重对 credibilityAssess 决策可信度的影响。
 * 字段值取各 sourceId 的合法必填/可选字段（见 @shared/agent-types CredibilityEvidenceInput）。
 */
const TEST_ASSESS_INPUTS: CredibilityEvidenceInput[] = [
  { sourceId: 'log', fields: { drainMatch: 0.85, sourcePrior: 0.6 } },
  { sourceId: 'kb', fields: { hasResults: true, topScore: 0.8, avgScore: 0.6 } },
  { sourceId: 'ai-param', fields: { verbalizedConfidence: 0.7 } },
  { sourceId: 'human', fields: { hasAnnotations: true, positiveRate: 0.9, agreement: 0.8 } },
  { sourceId: 'history', fields: { hasCases: true, weightedSuccessRate: 0.75 } },
  { sourceId: 'best-practice', fields: { hasMatches: true, positiveRate: 0.8, negativeRate: 0.2 } },
]

export function DecisionSettings() {
  // Card 1: 决策流程配置
  const [tierStates, setTierStates] = usePersistentState<Record<string, boolean>>(
    'decision.tierStates',
    DEFAULT_TIER_STATES,
  )
  const [decisionTimeout, setDecisionTimeout] = usePersistentState('decision.decisionTimeout', 300)

  // Card 2: 证据源权重
  const [weights, setWeights] = usePersistentState<Record<string, number>>(
    'decision.weights',
    DEFAULT_WEIGHTS,
  )
  const totalWeight = EVIDENCE_SOURCES.reduce((sum, s) => sum + (weights[s.id] ?? 0), 0)

  // Card 3: 审批补充说明（草稿保存在本机，重启后还在）
  const [textAreas, setTextAreas] = usePersistentState<Record<string, string>>(
    'decision.textAreas',
    DEFAULT_TEXTAREAS,
  )

  // Card 2 测试评估：调用 credibilityAssess 验证当前 6 源权重对决策可信度的影响
  const [testResult, setTestResult] = useState<ConfidenceAssessment | null>(null)
  const [testError, setTestError] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)

  const handleTestAssess = async () => {
    setTesting(true)
    setTestResult(null)
    setTestError(null)
    try {
      const result = await window.electronAPI.credibilityAssess(TEST_ASSESS_INPUTS)
      setTestResult(result)
    } catch (err) {
      setTestError((err as Error)?.message ?? '评估失败')
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="set-subpage">
      <SettingsPageHeader {...settingsHeader('/settings/decision')} />

      <div className="set-subpage__body">
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
            label="决策超时秒数"
            desc="到点自动拒绝（不会自动放行）；可填 30–1800 秒，留空或越界按 300 秒"
            control={
              <Input
                type="number"
                value={decisionTimeout}
                onChange={(e) => setDecisionTimeout(Number(e.target.value))}
                className="set-num"
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
                'set-weight-row ' +
                (idx === EVIDENCE_SOURCES.length - 1 ? 'set-weight-row--last' : '')
              }
            >
              <span className="set-weight-row__label">
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
              <span className="set-weight-row__val">
                {weights[src.id] ?? 0}
              </span>
            </div>
          ))}
          <div className="set-weight-summary">
            <span className="set-weight-summary__label">
              综合权重总和 · 建议保持各源权重均衡
            </span>
            <span className="set-weight-summary__val">
              {totalWeight}
            </span>
          </div>
          <div style={{ marginTop: 16 }}>
            <Button
              type="primary"
              loading={testing}
              onClick={handleTestAssess}
            >
              测试当前权重对决策的影响
            </Button>
            {testResult && (
              <div style={{ marginTop: 12, padding: 12, background: 'var(--trae-bg-overlay-l2)', borderRadius: 6 }}>
                <div>综合可信度: {(testResult.confidence * 100).toFixed(1)}%</div>
                <div>融合规则: {testResult.ruleUsed}</div>
                <div>冲突程度: {(testResult.conflictLevel * 100).toFixed(1)}%</div>
                <div>信任区间: [{(testResult.belief * 100).toFixed(1)}%, {(testResult.plausibility * 100).toFixed(1)}%]</div>
                <div>参与源数: {testResult.sources.length}</div>
              </div>
            )}
            {testError && (
              <div style={{ marginTop: 12, padding: 12, background: 'var(--trae-bg-overlay-l2)', borderRadius: 6, color: 'var(--color-error)' }}>
                评估失败: {testError}
              </div>
            )}
          </div>
        </SettingsCard>

        {/* Card 3: 风险控制策略 */}
        <SettingsCard icon={Shield} title="审批补充说明" tag="decision.notes">
          {TEXTAREA_BLOCKS.map((blk, idx) => (
            <div
              key={blk.id}
              className={
                'set-block ' +
                (idx === TEXTAREA_BLOCKS.length - 1 ? 'set-block--last' : '')
              }
            >
              <div className="set-block__head">
                <div>
                  <div className="set-block__label">
                    {blk.label}
                  </div>
                  <div className="set-block__desc">
                    {blk.desc}
                  </div>
                </div>
                <span className="set-block__hint">
                  {blk.hint}
                </span>
              </div>
              <textarea
                value={textAreas[blk.id] ?? ''}
                onChange={(e) => setTextAreas((prev) => ({ ...prev, [blk.id]: e.target.value }))}
                spellCheck={false}
                className="set-textarea"
              />
            </div>
          ))}
        </SettingsCard>

        <SettingsActionBar
          onReset={() => {
            // P1-2 共性问题 A：恢复默认按钮重置所有 usePersistentState 字段
            setTierStates(DEFAULT_TIER_STATES)
            setDecisionTimeout(300)
            setWeights(DEFAULT_WEIGHTS)
            setTextAreas(DEFAULT_TEXTAREAS)
          }}
        />
      </div>
    </div>
  )
}
