/**
 * DecisionSettings — 决策控制（D-S 证据理论 + PCR5 冲突阈值核心页）
 *
 * 路由：/settings/decision
 *
 * 设计稿：settings-decision.html
 * - Card 1: 决策超时（唯一一条真接上的流程设置）
 * - Card 2: 证据源权重配置（6 源权重滑块 + 综合权重总和 summary + 权重影响测试）
 * - ActionBar: 恢复默认
 *
 * 已删掉的假设置（全仓零消费者，遵循 DESIGN.md §10）：
 * - 最低置信度阈值 decision.confidenceThreshold：工作流是 HITL，每一步 confirm 都要人点头，
 *   没有"高于某值就自动执行"这条路径；把它接上去等于给用户一个能关掉审批的开关
 * - 文件修改大小限制 / 批量操作数量上限 / 操作回滚保留时长：没有对应的执行与回滚机制
 * - 三档"风险层级"开关（decision.tierStates）：写着"风险<30自动执行 / 30-70需确认 /
 *   >70需双审"，但全仓只有这一页读它自己存的值——真实档位由风险引擎与审批流决定，
 *   关不关这三个开关都一样（用户 2026-10-16："假的UI都检查一下"）
 * - 「命令黑名单」「敏感目录保护」两个文本框（decision.textAreas）：写着"命中一律拒绝执行，
 *   无论风险等级"，而命令闸读的是编译进来的规则表（src/main/core/risk-engine.ts 与
 *   command-rules.json），从来不看这里。真要支持用户自定义黑名单，得连着命令闸一起做，
 *   不是先放个框让用户以为写了就生效
 *
 * 决策超时 decision.decisionTimeout 是真接上的：主进程启动时把这个键交给审批等待器
 * （core/security/approval-request.ts 的 setApprovalTimeoutSource），到点自动拒绝（fail-closed），
 * 区间与默认值取自 @shared/approval-types 那三份常量——本页不再自己抄一套数字。
 * 2026-10-29 #281 之前它读的是已整删的入站工作流内核，那条链没人走。
 *
 * D-S 证据理论：6 个独立证据源（系统指标/历史决策/知识库/日志/人工经验/模型推理）
 * 各源权重通过滑块配置（0-100），综合权重总和反映证据强度。
 *
 * 设置项通过 usePersistentState 接入主进程 IPC（configGet/configSet）持久化，
 * electronAPI 不可用时退化为内存默认值，UI 正常渲染。
 */
import { useState } from 'react'
import { GitBranch, Layers, Loader2 } from 'lucide-react'
import { Button } from '@/ui'
import type { CredibilityEvidenceInput, ConfidenceAssessment } from '@shared/agent-types'
import {
  APPROVAL_TIMEOUT_DEFAULT_SEC,
  APPROVAL_TIMEOUT_MAX_SEC,
  APPROVAL_TIMEOUT_MIN_SEC,
} from '@shared/approval-types'
import { usePersistentState } from '@/hooks/usePersistentState'
import { SettingsPageHeader } from '@/components/settings/SettingsPageHeader'
import { settingsHeader } from './settings-sections'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { SettingsActionBar } from '@/components/settings/SettingsActionBar'
import { Input } from '@/components/trae/Input'
import { Slider } from '@/components/trae/Slider'
import './Settings.css'

interface EvidenceSource {
  id: string
  label: string
  defaultValue: number
}

const EVIDENCE_SOURCES: EvidenceSource[] = [
  { id: 'system-metrics', label: '系统指标采集', defaultValue: 70 },
  { id: 'history-match', label: '历史决策匹配', defaultValue: 60 },
  { id: 'knowledge-base', label: '知识库检索', defaultValue: 80 },
  { id: 'log-analysis', label: '日志分析', defaultValue: 50 },
  { id: 'human-experience', label: '人工经验', defaultValue: 90 },
  { id: 'model-inference', label: '模型推理', defaultValue: 40 },
]

/** 证据源权重默认值 */
const DEFAULT_WEIGHTS: Record<string, number> = Object.fromEntries(
  EVIDENCE_SOURCES.map((s) => [s.id, s.defaultValue]),
)

/**
 * 测试评估用的模拟证据输入（覆盖全部 7 个融合源位）
 *
 * 用于在 DecisionSettings 页面验证当前权重对 credibilityAssess 决策可信度的影响。
 * 字段值取各 sourceId 的合法必填/可选字段（见 @shared/agent-types CredibilityEvidenceInput）。
 */
const TEST_ASSESS_INPUTS: CredibilityEvidenceInput[] = [
  { sourceId: 'log', fields: { drainMatch: 0.85, sourcePrior: 0.6 } },
  { sourceId: 'observation', fields: { hasObservations: true, successRate: 0.9 } },
  { sourceId: 'knowledge', fields: { hasResults: true, topScore: 0.8, avgScore: 0.6 } },
  { sourceId: 'ai-param', fields: { verbalizedConfidence: 0.7 } },
  { sourceId: 'human', fields: { hasAnnotations: true, positiveRate: 0.9, agreement: 0.8 } },
  { sourceId: 'history', fields: { hasCases: true, weightedSuccessRate: 0.75 } },
  { sourceId: 'best-practice', fields: { hasMatches: true, positiveRate: 0.8, negativeRate: 0.2 } },
]

export function DecisionSettings() {
  // Card 1: 决策超时（本页唯一一条真接上的流程设置——主进程审批等待器读它）
  const [decisionTimeout, setDecisionTimeout] = usePersistentState(
    'decision.decisionTimeout',
    APPROVAL_TIMEOUT_DEFAULT_SEC,
  )

  // Card 2: 证据源权重
  const [weights, setWeights] = usePersistentState<Record<string, number>>(
    'decision.weights',
    DEFAULT_WEIGHTS,
  )
  const totalWeight = EVIDENCE_SOURCES.reduce((sum, s) => sum + (weights[s.id] ?? 0), 0)

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
        {/* Card 1: 决策超时
            这里原来还有三档开关（自动执行低风险 / 中风险需确认 / 高风险需双审），
            写着"风险<30自动执行"这类规则，但全仓只有这一页读它自己存的那份值——
            真实的档位由风险引擎与审批流决定，三个开关关掉也不会有任何行为变化。
            撤掉的理由与口径见文件头（DESIGN.md §10：不许留承诺了却没实现的控件）。 */}
        <SettingsCard icon={GitBranch} title="决策超时" tag="decision.timeout">
          <SettingsRow
            label="决策超时秒数"
            desc={`到点自动拒绝（不会自动放行）；可填 ${APPROVAL_TIMEOUT_MIN_SEC}–${APPROVAL_TIMEOUT_MAX_SEC} 秒，留空或越界按 ${APPROVAL_TIMEOUT_DEFAULT_SEC} 秒`}
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
          <div className="mt-4">
            <Button variant="solid" size="lg" disabled={testing} onClick={handleTestAssess}>
              {testing ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : null}
              测试当前权重对决策的影响
            </Button>
            {testResult && (
              <div className="mt-3 rounded-(--ui-radius-control) bg-sunken p-3">
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

        {/*
          Card 3「审批补充说明」（命令黑名单 / 敏感目录保护两个文本框）已撤：
          它写着"命中黑名单的命令一律拒绝执行，无论风险等级"，而命令闸读的是
          编译进来的规则表（src/main/core/risk-engine.ts + command-rules.json），
          从来不看这里存的草稿。要支持用户自定义黑名单得连着命令闸一起做，
          不是先放个框让人以为写了就生效。
        */}

        <SettingsActionBar
          onReset={() => {
            // 恢复默认只重置这一页真有的两个键（撤掉假控件后不再有别的持久字段）
            setDecisionTimeout(300)
            setWeights(DEFAULT_WEIGHTS)
          }}
        />
      </div>
    </div>
  )
}
