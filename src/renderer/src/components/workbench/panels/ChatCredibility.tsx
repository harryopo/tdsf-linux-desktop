/**
 * ChatCredibility — 聊天消息内的可信度分析折叠块（v2.5）
 *
 * 背景：6 源 D-S/PCR5 可信度评估（credibility:assess IPC）与 ConfidenceBreakdown
 * 组件早已存在，但主对话链路从未接线，用户看不到任何可信度分析。
 *
 * 职责：
 * - assistant 消息完成且带真实工具执行轨迹（toolEvents）时挂载
 * - 把 toolEvents → Evidence[]（chat-decision.ts）→ buildCredibilityInputs 6 源输入
 * - 调 credibilityAssess IPC 获取 Bel/Pl/confidence/conflictLevel
 * - 折叠行展示综合可信度徽章，展开渲染完整 ConfidenceBreakdown
 * - 评估结果经 onAssessed 回传（AIPanel 落库决策时复用同一 confidence）
 *
 * 降级：非 Electron / IPC 失败 → 整块不渲染（不显示假数据）
 */
import { useEffect, useMemo, useRef, useState, type FC } from 'react'
import { ChevronRight, ShieldCheck } from 'lucide-react'
import ConfidenceBreakdown from '@/components/ai/ConfidenceBreakdown'
import { isElectronAPIAvailable } from '@/utils/electron-api'
import { buildCredibilityInputs, fingerprint } from '@/utils/evidence-to-input'
import { toolEventsToEvidences } from '@/utils/chat-decision'
import { analyzeCotEntropyTrajectory } from '@shared/cot-trace-analyzer'
import type { AgentMessage } from '@/stores/agent-store'
import type { ConfidenceAssessment } from '@shared/agent-types'

interface ChatCredibilityProps {
  /** 已完成的 assistant 消息（需带 toolEvents） */
  message: AgentMessage
  /** 评估完成回调（决策落库复用同一 confidence） */
  onAssessed?: (assessment: ConfidenceAssessment) => void
}

/** 可信度分档配色 */
function confidenceTone(confidence: number): string {
  if (confidence >= 0.7) return 'var(--trae-status-success-default)'
  if (confidence >= 0.5) return 'var(--trae-status-alert-default)'
  return 'var(--trae-status-error-default)'
}

const ChatCredibility: FC<ChatCredibilityProps> = ({ message, onAssessed }) => {
  const [assessment, setAssessment] = useState<ConfidenceAssessment | null>(null)
  const [expanded, setExpanded] = useState(false)
  /** 指纹去重：同一批证据只评估一次（流式结束后 toolEvents 不再变化） */
  const lastFingerprintRef = useRef<string>('')

  const evidences = useMemo(
    () => toolEventsToEvidences(message.toolEvents),
    [message.toolEvents],
  )

  useEffect(() => {
    if (message.isStreaming || message.isError) return
    if (evidences.length === 0) return
    if (!isElectronAPIAvailable() || !window.electronAPI?.credibilityAssess) return

    const ctx = {
      cardId: message.id,
      evidences,
      llmVerbalized: 0.7,
      cotEntropyTrajectory: message.cotEntropyTrajectory,
    }
    const fp = fingerprint(ctx)
    if (fp === lastFingerprintRef.current) return
    lastFingerprintRef.current = fp

    let cancelled = false
    window.electronAPI
      .credibilityAssess(buildCredibilityInputs(ctx))
      .then((result) => {
        if (cancelled) return
        setAssessment(result)
        onAssessed?.(result)
      })
      .catch((err) => {
        // 评估失败不显示假数据，仅记录日志
        console.error('[ChatCredibility] credibilityAssess 失败:', err)
      })
    return () => {
      cancelled = true
    }
  }, [message.id, message.isStreaming, message.isError, message.cotEntropyTrajectory, evidences, onAssessed])

  // CoT 轨迹分析（可选，有轨迹才渲染）
  const cotAnalysis = useMemo(() => {
    const t = message.cotEntropyTrajectory
    if (!t || t.length === 0) return undefined
    try {
      return analyzeCotEntropyTrajectory(t)
    } catch {
      return undefined
    }
  }, [message.cotEntropyTrajectory])

  if (!assessment) return null

  const pct = Math.round(assessment.confidence * 100)
  const tone = confidenceTone(assessment.confidence)

  return (
    <div className="ai-credibility">
      <button
        type="button"
        className="ai-tool-row w-full text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <ShieldCheck className="size-3" style={{ color: tone }} />
        <span className="text-[var(--trae-text-default)]">可信度分析</span>
        <span className="ai-tool-badge" style={{ color: tone }}>
          {pct}% · {assessment.ruleUsed === 'pcr5' ? 'PCR5' : assessment.ruleUsed === 'mixed' ? '混合' : 'D-S'}
        </span>
        <span className="text-[9px] text-[var(--trae-text-tertiary)]">
          {evidences.length} 项证据
        </span>
        <ChevronRight
          className={`ml-auto size-2.5 text-[var(--trae-text-tertiary)] transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
        />
      </button>
      {expanded && (
        <div className="ai-credibility-body">
          <ConfidenceBreakdown assessment={assessment} cotTraceAnalysis={cotAnalysis} />
        </div>
      )}
    </div>
  )
}

export default ChatCredibility
