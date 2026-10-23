/**
 * 决策结果 → 校准样本（#188）
 *
 * 病根：校准页整页讲 Temperature Scaling，但**从来没有任何生产者往 tuner 里加样本**——
 * 渲染层没调过 `credibility:add-calibration-sample`，主进程也没有第二个调用点，
 * 于是「开始校准」永远 0 样本、返回 T=1.0，页面看起来能用，实际上什么都不会发生。
 *
 * 现在的口径（也是这个产品里唯一能拿到的 ground truth）：
 *   - 用户在决策卡上点"执行/发送到终端" → 这条建议被采纳，记为正确（wasCorrect=true）
 *   - 卡片只停留在待确认、用户没执行 → 记为未采纳（wasCorrect=false）
 *   - 置信度用卡片自己的 confidence（与详情页展示的是同一个数）
 *
 * 也就是说：样本不是编的，是用户每次点"执行"或"不执行"留下的真实选择。
 */
import { getCalibrationTuner } from './calibration-tuner'
import { logger } from '../../../../services/log/logger'

export interface DecisionCalibrationInput {
  /** 决策卡 id（与 decision_cards.id 同一值） */
  decisionId: string
  /** 卡片置信度 [0,1]（来自证据链融合） */
  reportedConfidence: number
  /** 用户是否采纳并执行了这条建议 */
  executed: boolean
  /** 决策时间戳 */
  timestamp: number
  /** 记在哪个 provider 名下（拿不到就用 'default'，同组累计） */
  providerId: string
}

/** 记一条样本；失败只留日志，绝不影响决策落库这条主流程 */
export function recordDecisionCalibrationSample(input: DecisionCalibrationInput): void {
  try {
    getCalibrationTuner().addSample({
      decisionId: input.decisionId,
      reportedConfidence: Math.min(1, Math.max(0, input.reportedConfidence)),
      wasCorrect: input.executed === true,
      providerId: input.providerId || 'default',
      timestamp: input.timestamp,
    })
  } catch (err) {
    logger.warn('CALIBRATION', '记录校准样本失败（不影响决策落库）', {
      decisionId: input.decisionId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
