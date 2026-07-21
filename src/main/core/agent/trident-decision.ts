/**
 * Trident 三叉决策评分工具（借鉴 instructkr/claw-code §3.1）
 *
 * 三大评分维度：
 * - dangerScore：命令危险度反向值（0=极高危，1=安全）
 *   ↪ 来源：risk-engine 风险等级逆向映射
 *   ↪ 公式：SAFE=1.0, LOW=0.85, MEDIUM=0.6, HIGH=0.3, CRITICAL=0.1
 *
 * - idempotentScore：操作幂等性（0=破坏性，1=完全幂等）
 *   ↪ 来源：命令关键词匹配（rm/>/kill 扣分，>> / append / restart 适中，查询类+1）
 *   ↪ 启发式规则集（保守估计）
 *
 * - relevanceScore：上下文关联度（0=无证据，1=充分证据）
 *   ↪ 来源：evidences 数量 × 0.2 + 来源多样性 × 0.3
 *   ↪ 上限 1.0，至少需要 4 个证据 + 3 个不同来源
 *
 * 综合分计算公式：
 * compositeScore = dangerScore × 0.35 + idempotentScore × 0.25 + relevanceScore × 0.40
 *
 * 参考来源：idea-to-dev-output/33-源码分析-claw-code.md §四 (B1 借鉴点)
 */

import type { DecisionCard, Evidence, RiskAssessment, RiskLevel } from '@shared/models'

/** 风险等级 → danger 分数映射 */
const RISK_TO_DANGER_SCORE: Record<RiskLevel, number> = {
  SAFE: 1.0,
  LOW: 0.85,
  MEDIUM: 0.6,
  HIGH: 0.3,
  CRITICAL: 0.1,
}

/**
 * 启发式：判断命令的幂等性
 *
 * 完全幂等（1.0）：查询类 / 状态查看
 * - ls / cat / grep / ps / top / df / du / free / uname / whoami
 * - systemctl status / journalctl / tail / head
 *
 * 大部分幂等（0.85）：日志类追加 / 重启类（重启是有限幂等）
 * - systemctl restart/reload / service restart
 * - echo / printf
 * - apt install（已装则跳过）
 *
 * 部分幂等（0.6）：追加 / 写入 / 软修改
 * - echo > / tee / cp / mv / touch / mkdir
 * - chmod / chown
 *
 * 破坏性（0.3）：修改 / 删除 / 强制覆盖
 * - rm / rm -rf / mv 覆盖 / dd
 *
 * 极度破坏（0.1）：擦除 / 递归强制 / 不可逆
 * - dd of=/dev/ / mkfs / fdisk / shutdown / reboot
 * - chmod 777 / chown -R
 */
function assessIdempotency(command: string): number {
  const cmd = command.trim().toLowerCase()

  // 极度破坏
  if (/\b(dd\s+of=\/dev|mkfs|fdisk|shutdown|reboot|halt|poweroff|init\s+[06])\b/.test(cmd)) {
    return 0.1
  }

  // 破坏性
  if (/\brm(\s+-[a-z]*[rf][a-z]*\s+|\s+-rf|\s+-fr|\s+--force)\b/.test(cmd)) {
    return 0.2
  }
  if (/\b(chmod\s+777|chown\s+-R|>\/dev\/sda)\b/.test(cmd)) {
    return 0.2
  }

  // 部分幂等
  if (/\b(rm|cp\s+-f|mv\s+-f|tee|>|chmod|chown|mkdir|touch)\b/.test(cmd)) {
    return 0.6
  }

  // 大部分幂等
  if (/\b(systemctl\s+(restart|reload|try-restart|reload-or-restart)|service\s+\S+\s+restart|echo|printf|apt\s+install)\b/.test(cmd)) {
    return 0.85
  }

  // 完全幂等（查询类）
  if (/\b(ls|cat|grep|ps|top|df|du|free|uname|whoami|which|find|awk|sed\s+-n|tail|head|less|more|systemctl\s+status|journalctl|netstat|ss\s+|ip\s+(addr|route|link)|curl\s+-I|wget\s+--spider)\b/.test(cmd)) {
    return 1.0
  }

  // 默认中性（无法判断时给 0.5）
  return 0.5
}

/**
 * 启发式：根据证据计算上下文关联度
 *
 * 算法：
 * - base = min(evidenceCount * 0.15, 0.6)
 *   ↪ 4 个证据就达到 0.6 上限
 * - diversity = min(uniqueSourceCount * 0.15, 0.4)
 *   ↪ 3 个不同来源达到 0.4 上限
 * - score = base + diversity
 *
 * 上限 1.0
 */
function assessRelevance(evidences: Evidence[]): number {
  if (evidences.length === 0) return 0

  const base = Math.min(evidences.length * 0.15, 0.6)
  const uniqueSources = new Set(evidences.map((e) => e.source)).size
  const diversity = Math.min(uniqueSources * 0.15, 0.4)

  return Math.min(base + diversity, 1.0)
}

/**
 * 启发式：根据 risk 对象提取 dangerScore
 */
function assessDanger(risk: RiskAssessment): number {
  return RISK_TO_DANGER_SCORE[risk.level] ?? 0.5
}

/**
 * 计算 Trident 三叉评分
 *
 * @param card 决策卡片（必须有 risk 和 evidences，fixCommand 可选）
 * @returns Trident 三叉评分对象
 */
export function computeTrident(card: Pick<DecisionCard, 'risk' | 'evidences' | 'fixCommand'>): {
  dangerScore: number
  idempotentScore: number
  relevanceScore: number
  compositeScore: number
  source: 'heuristic' | 'llm' | 'hybrid'
} {
  const dangerScore = assessDanger(card.risk)
  const idempotentScore = card.fixCommand
    ? assessIdempotency(card.fixCommand)
    : 0.5 // 无命令时给中性
  const relevanceScore = assessRelevance(card.evidences)

  // 综合分（与 confidence 同公式）
  const compositeScore = dangerScore * 0.35 + idempotentScore * 0.25 + relevanceScore * 0.4

  return {
    dangerScore: round2(dangerScore),
    idempotentScore: round2(idempotentScore),
    relevanceScore: round2(relevanceScore),
    compositeScore: round2(compositeScore),
    source: 'heuristic',
  }
}

/** 保留 2 位小数 */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * 推断 source 字段
 *
 * 当前默认 heuristic，未来 LLM 集成后：
 * - heuristic：纯命令关键词匹配
 * - llm：LLM 直接评估
 * - hybrid：LLM 评估 + 启发式交叉验证
 */
export function inferTridentSource(): 'heuristic' | 'llm' | 'hybrid' {
  // v0.9.5 阶段：纯启发式
  return 'heuristic'
}
