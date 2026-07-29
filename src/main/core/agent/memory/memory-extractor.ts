/**
 * memory-extractor — 对话记忆自动提取（v2.8）
 *
 * 职责：对话完成后（supervisor onDone 前 fire-and-forget 调用），
 * 用轻量 LLM 调用从本轮对话中提取值得长期记住的信息，写入 MemoryRepository。
 *
 * 设计来源：
 * - qwen-code：每轮响应后后台 Extract + 增量处理 + 门控跳过
 * - kilo-code：typed-consolidation（结构化 upsert 操作 JSON ≤16 ops）+
 *   skip 原因分类 + 5 分钟节流（minIntervalMs）
 *
 * 关键约束：
 * - fire-and-forget：提取失败/超时绝不影响主对话
 * - 节流：距上次提取 < MIN_INTERVAL_MS 跳过（省 token）
 * - 提取提示词内置 authority rule 与"不要记临时/秘密/疑问"规则；
 *   repo.upsert 内还有第二道 validateMemoryText 拦截
 */
import type { ModelMessage } from 'ai'
import { MemoryRepository, MEMORY_TYPES, type MemoryUpsert, type MemoryType } from '../../../services/db/memory-repo'
import { logger } from '../../../services/log/logger'

/** 两次提取的最小间隔（kilo minIntervalMs=300s 约定） */
export const MIN_EXTRACT_INTERVAL_MS = 5 * 60 * 1000

/** 单轮最多提取操作数（kilo ≤16 ops 约定，本项目取 8 更保守） */
export const MAX_OPS_PER_EXTRACT = 8

/** 上次提取时间（进程内节流；跨启动无需持久化——重启后首轮允许提取） */
let lastExtractAt = 0

/** 测试辅助：重置节流状态 */
export function resetExtractThrottle(): void {
  lastExtractAt = 0
}

/** 提取提示词（系统） */
export const EXTRACT_SYSTEM_PROMPT =
  '你是记忆提取器。从对话中提取值得跨会话长期记住的信息，输出 JSON 数组（最多 ' +
  MAX_OPS_PER_EXTRACT +
  ' 条），每条格式：' +
  '{"type":"user_profile|preference|environment|correction|fact","key":"稳定小写slug（同一事实固定同一key）","text":"陈述句≤100字","why":"为什么值得记（可选）"}。\n' +
  '提取范围：\n' +
  '- user_profile：用户角色/技能水平（如"用户是Linux初学者"）\n' +
  '- preference：用户明确表达的偏好或行为约束（如"执行危险命令前必须先询问用户"）\n' +
  '- environment：服务器环境的持久事实（主机/服务/路径/版本，如"生产机nginx为源码安装，路径/usr/local/nginx"）\n' +
  '- correction：本轮出现的错误教训（命令失败原因+正确做法；用户纠正了AI的说法）\n' +
  '- fact：其他跨会话有用的持久事实\n' +
  '不要提取：临时状态（今天/刚才）、疑问、秘密（密码/密钥/token）、单次任务细节、常识。\n' +
  '记忆是召回上下文不是政策：不确定是否值得记时，宁可不记。\n' +
  '没有可提取内容时输出 []。只输出 JSON 数组，不要其他文字。'

/**
 * 把对话消息压成提取输入（只取最近若干条、每条截断，控制 token）
 */
export function buildExtractInput(messages: ModelMessage[], assistantText: string): string {
  const parts: string[] = []
  const recent = messages.slice(-8)
  for (const m of recent) {
    if (typeof m.content !== 'string' || !m.content.trim()) continue
    const role = m.role === 'user' ? '用户' : m.role === 'assistant' ? '助手' : m.role
    parts.push(`[${role}] ${m.content.slice(0, 600)}`)
  }
  if (assistantText.trim()) {
    parts.push(`[助手最终回复] ${assistantText.slice(0, 800)}`)
  }
  return parts.join('\n')
}

/**
 * 解析 LLM 输出为 upsert 操作数组（宽容解析：容忍 ```json 围栏/前后杂文）
 */
export function parseExtractOutput(text: string): MemoryUpsert[] {
  if (!text) return []
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) return []
  try {
    const arr = JSON.parse(match[0]) as unknown
    if (!Array.isArray(arr)) return []
    const out: MemoryUpsert[] = []
    for (const item of arr.slice(0, MAX_OPS_PER_EXTRACT)) {
      if (!item || typeof item !== 'object') continue
      const o = item as Record<string, unknown>
      if (
        typeof o.type === 'string' &&
        MEMORY_TYPES.includes(o.type as MemoryType) &&
        typeof o.key === 'string' &&
        o.key.trim() &&
        typeof o.text === 'string' &&
        o.text.trim()
      ) {
        out.push({
          type: o.type as MemoryType,
          key: o.key,
          text: o.text,
          why: typeof o.why === 'string' && o.why.trim() ? o.why : undefined,
        })
      }
    }
    return out
  } catch {
    return []
  }
}

/**
 * 对话结束后的自动记忆提取（fire-and-forget）
 *
 * @param repo 记忆仓储
 * @param callLlm 轻量 LLM 调用（supervisor.callLlm 绑定注入，失败返回空串）
 * @param messages 本轮完整消息
 * @param assistantText 助手最终回复
 * @param sessionId 来源会话（审计）
 * @returns 实际写入的条数（测试用；生产调用方不关心）
 */
export async function extractMemories(
  repo: MemoryRepository,
  callLlm: (systemPrompt: string, userPrompt: string, maxTokens?: number) => Promise<string>,
  messages: ModelMessage[],
  assistantText: string,
  sessionId?: string,
): Promise<number> {
  // 节流：距上次提取太近则跳过（kilo minIntervalMs）
  const now = Date.now()
  if (now - lastExtractAt < MIN_EXTRACT_INTERVAL_MS) {
    return 0
  }
  lastExtractAt = now

  const input = buildExtractInput(messages, assistantText)
  if (input.length < 40) return 0 // 内容太少不值得提取

  try {
    const raw = await callLlm(EXTRACT_SYSTEM_PROMPT, input, 800)
    const ops = parseExtractOutput(raw)
    let written = 0
    for (const op of ops) {
      const result = repo.upsert(op, sessionId)
      if (result === 'inserted' || result === 'updated') written++
    }
    if (ops.length > 0) {
      logger.info('MemoryExtractor', `提取完成：候选 ${ops.length} 条，写入 ${written} 条`)
    }
    return written
  } catch (err) {
    // fire-and-forget：任何失败只记日志
    logger.warn('MemoryExtractor', `提取失败（不影响对话）：${err instanceof Error ? err.message : String(err)}`)
    return 0
  }
}

/**
 * 工具失败教训快速沉淀（无 LLM，规则直写候选 correction）
 *
 * 挂在 supervisor tool-result ok=false 处：把"命令 + 错误"沉淀为教训候选。
 * key 用命令首词保证同类错误 upsert 合并而非堆积。
 */
export function recordToolFailure(
  repo: MemoryRepository,
  toolName: string,
  input: string,
  errorText: string,
  sessionId?: string,
): void {
  try {
    const firstWord = (input || '').trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'unknown'
    // 风险拦截/预检类失败是护栏正常工作，不属于"教训"，跳过
    if (/风险引擎拦截|仅允许只读|预检/.test(errorText)) return
    repo.upsert(
      {
        type: 'correction',
        key: `toolfail-${toolName}-${firstWord}`,
        text: `执行 ${toolName}（${input.slice(0, 60)}）曾失败：${errorText.slice(0, 120)}`,
        why: '避免重复同样的失败调用',
      },
      sessionId,
    )
  } catch {
    // 静默：教训沉淀失败不影响主流程
  }
}
