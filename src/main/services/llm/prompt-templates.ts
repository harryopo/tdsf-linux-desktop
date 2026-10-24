/**
 * Prompt 模板模块
 *
 * 集中管理所有 LLM 调用的提示词模板：
 * - 系统提示词（运维专家角色）
 * - 分析提示词（问题 + 证据 → 根因 + 修复命令）
 * - 决策卡片生成提示词
 * - 知识库匹配提示词
 *
 * 所有模板使用中文，包含清晰的指令和输出格式要求，
 * 确保 LLM 返回结构化、可解析的结果。
 *
 * 参考 ITOps Agent Platform 的 Prompt 工程：
 * - 角色定义（Role）
 * - 任务说明（Task）
 * - 输入格式（Input）
 * - 输出格式（Output）
 * - 约束条件（Constraints）
 */

import type {
  Evidence,
  CommandExecutionContext,
  KnowledgeEntry,
} from '@shared/models'

/**
 * 系统提示词 — 运维专家角色
 *
 * 定义 LLM 的角色、能力范围和行为规范。
 * 作为 chat 系列方法的 system message 注入。
 */
export const SYSTEM_PROMPT = `你是一名资深的 Linux 运维专家，拥有以下能力：

1. 精通 Linux 系统管理（CentOS/Ubuntu/Debian 等主流发行版）
2. 熟悉常见服务运维（Nginx/Apache/MySQL/Redis/Docker/K8s）
3. 擅长日志分析和故障排查
4. 熟悉 Shell 脚本和命令行工具
5. 了解系统性能调优和安全加固

行为规范：
- 用中文回答，技术术语可保留英文
- 给出具体可执行的命令，避免模糊描述
- 对危险操作给出明确风险提示
- 优先使用最小权限原则
- 遵循"先诊断、再修复、最后验证"的工作流程
- 不执行 rm -rf /、mkfs、dd if= 等破坏性操作`

/**
 * 分析提示词模板
 *
 * 输入：问题描述 + 证据列表
 * 输出：根因假设 + 修复命令 + 置信度
 *
 * @param problem - 问题描述
 * @param evidences - 证据列表
 * @returns 构造好的 user message
 */
export function buildAnalysisPrompt(problem: string, evidences: Evidence[]): string {
  const evidenceText = evidences.length > 0
    ? evidences.map((ev, idx) => {
        return `[证据 ${idx + 1}]
- 来源: ${ev.source} (${ev.sourceDetail})
- 内容: ${ev.content}
- 模板匹配度: ${
  ev.drainMatch === null
    ? '不适用（这类证据没有模板维度，可信度只按来源先验算）'
    : `${(ev.drainMatch * 100).toFixed(0)}%`
}
- 来源可信度: ${(ev.sourcePrior * 100).toFixed(0)}%
- 综合置信度: ${(ev.confidence * 100).toFixed(0)}%
- 已验证: ${ev.verified ? '是' : '否'}`
      }).join('\n\n')
    : '（暂无证据）'

  return `请分析以下 Linux 运维问题，给出根因假设和修复建议。

【问题描述】
${problem}

【采集到的证据】
${evidenceText}

请严格按照以下 JSON 格式输出（不要包含 Markdown 代码块标记）：
{
  "hypothesis": "根因假设，简要说明可能的原因",
  "fixCommand": "修复命令（单条命令，如需多条请用 && 连接）",
  "confidence": 0.0到1.0之间的置信度数值
}

约束：
1. fixCommand 必须是可直接在 Shell 执行的命令
2. 禁止输出 rm -rf /、mkfs、shutdown 等破坏性命令
3. 优先选择只读诊断命令（如 ps、df、free、ss、systemctl status）
4. confidence 反映你对根因假设的把握程度
5. 只输出 JSON，不要附加其他解释文字`
}

/**
 * 决策卡片生成提示词
 *
 * 输入：问题描述 + 根因假设 + 修复命令
 * 输出：完整的决策卡片信息（修复说明 + 回滚命令 + 风险评估）
 *
 * @param problem - 问题描述
 * @param hypothesis - 根因假设
 * @param fixCommand - 修复命令
 * @returns 构造好的 user message
 */
export function buildDecisionPrompt(
  problem: string,
  hypothesis: string,
  fixCommand: string
): string {
  return `请为以下运维决策生成详细的决策卡片信息。

【问题描述】
${problem}

【根因假设】
${hypothesis}

【修复命令】
${fixCommand}

请严格按照以下 JSON 格式输出（不要包含 Markdown 代码块标记）：
{
  "fixDescription": "修复说明，解释这条命令做什么、为什么能解决问题",
  "rollbackCommand": "回滚命令（如果修复失败如何恢复）",
  "riskLevel": "SAFE | LOW | MEDIUM | HIGH | CRITICAL",
  "riskDescription": "风险评估说明"
}

约束：
1. rollbackCommand 必须是安全的恢复操作
2. riskLevel 必须从给定 5 个级别中选择一个
3. 只读命令通常为 SAFE 或 LOW
4. 只输出 JSON，不要附加其他解释文字`
}

/**
 * 知识库匹配提示词
 *
 * 输入：查询问题 + 候选知识条目
 * 输出：最匹配的知识条目 ID 列表（按相关性排序）
 *
 * @param query - 查询问题
 * @param candidates - 候选知识条目（已序列化为文本）
 * @returns 构造好的 user message
 */
export function buildKnowledgeMatchPrompt(
  query: string,
  candidates: Array<{ id: string; title: string; problem: string; keywords: string[] }>
): string {
  const candidateText = candidates.length > 0
    ? candidates.map((c) => {
        return `[${c.id}] ${c.title}
  问题: ${c.problem}
  关键词: ${c.keywords.join(', ')}`
      }).join('\n\n')
    : '（无候选知识）'

  return `请从以下知识库条目中，找出与查询问题最相关的条目，按相关性从高到低排序。

【查询问题】
${query}

【候选知识条目】
${candidateText}

请严格按照以下 JSON 格式输出（不要包含 Markdown 代码块标记）：
{
  "matchedIds": ["最相关条目ID", "次相关条目ID"],
  "reasoning": "简要说明匹配理由"
}

约束：
1. matchedIds 最多返回 5 个
2. 只返回真正相关的条目，无相关条目时返回空数组
3. 只输出 JSON，不要附加其他解释文字`
}

/**
 * 普通对话提示词
 *
 * 用于 llm:chat 通道，将用户消息包装为运维场景的对话。
 *
 * @param userMessage - 用户消息
 * @returns 构造好的 user message
 */
export function buildChatPrompt(userMessage: string): string {
  return `作为 Linux 运维专家，请回答以下问题。给出具体可执行的建议，使用中文回答。

${userMessage}`
}

/**
 * 命令执行结果提示词
 *
 * 将命令、输出、退出码组合为 LLM 可分析的上下文。
 * 用于"分析命令输出"场景，例如用户执行了 `df -h` 后让 LLM 解读。
 *
 * @param ctx 命令执行上下文
 * @returns 构造好的 user message
 */
export function buildCommandResultPrompt(ctx: CommandExecutionContext): string {
  const statusLabel = ctx.exitCode === 0 ? '成功(退出码 0)' : `失败(退出码 ${ctx.exitCode})`

  // 输出过长时截断，避免超出 LLM 上下文窗口
  const maxOutputLen = 4000
  const truncated = ctx.output.length > maxOutputLen
  const output = truncated
    ? ctx.output.slice(0, maxOutputLen) + '\n... (输出已截断，仅显示前 4000 字符)'
    : ctx.output

  return `请分析以下命令的执行结果，给出诊断和后续建议。

【执行的命令】
${ctx.command}

【执行状态】
${statusLabel}

【命令输出】
${output}

请基于上述命令输出：
1. 解读命令输出的关键信息
2. 若执行失败，分析可能的失败原因
3. 给出下一步排查或修复的具体命令
4. 使用中文回答，技术术语可保留英文`
}

/**
 * 知识库匹配上下文提示词
 *
 * 将命中的知识库条目作为上下文注入对话，让 LLM 基于已有知识给出建议。
 * 用于 RAG（检索增强生成）场景。
 *
 * @param entries 命中的知识库条目列表
 * @returns 构造好的 system message 片段（注入到对话中）
 */
export function buildKnowledgeContextPrompt(entries: KnowledgeEntry[]): string {
  if (entries.length === 0) {
    return '【知识库】暂无相关匹配条目。'
  }

  const entryText = entries
    .map((e, idx) => {
      const commands = e.commands.length > 0 ? e.commands.join(' && ') : '（无）'
      const rollback =
        e.rollbackCommands && e.rollbackCommands.length > 0
          ? e.rollbackCommands.join(' && ')
          : '（无）'
      return `[条目 ${idx + 1}] ID: ${e.id}
- 类型: ${e.type === 'command_skill' ? '命令技巧' : '故障案例'}
- 标题: ${e.title}
- 问题: ${e.problem}
${e.rootCause ? `- 根因: ${e.rootCause}` : ''}
- 修复命令: ${commands}
- 回滚命令: ${rollback}
${e.verification ? `- 验证方法: ${e.verification}` : ''}
- 关键词: ${e.keywords.join(', ')}
- 历史成功率: ${(e.successRate * 100).toFixed(0)}%
- 使用次数: ${e.useCount}`
    })
    .join('\n\n')

  return `【知识库匹配条目】
以下是从知识库中检索到的相关条目，请参考这些条目给出建议：

${entryText}

请在回答中：
1. 优先参考知识库中已有成功经验的方案
2. 若知识库条目与当前问题不完全匹配，说明差异并调整
3. 引用知识库条目时注明条目 ID`
}

