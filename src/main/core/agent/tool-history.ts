/**
 * 工具链内的历史剪枝（prepareStep 的落点）
 *
 * 症状：一次 chat 最多跑 12 步工具，而 SDK 每一步都把**前面所有步**的消息重新发一遍。
 * ssh_readonly 跑一条 `journalctl -n 500` 就是几十 KB，第四次诊断命令之后，
 * 光"重发的旧输出"就能顶穿小窗口模型的上下文——上游回 400，界面上表现为
 * "AI 聊到一半突然不能用了"。这不是偶发，是长工具链的必然。
 *
 * 做法：用 SDK 的 pruneMessages，按工具名剪掉**旧的**远程输出，只保留最近两轮。
 * 为什么按名字而不是"剪最近的"：近几轮的输出正是模型当下要推理的材料，剪了等于失忆；
 * 而 kb_search/tutorial_search 这类检索工具返回的是几百字摘要，留着几乎不占窗口，
 * 剪掉反而让模型失去它引用过的出处。
 *
 * 剪的是 tool-call/tool-result **成对**移除（SDK 按 toolCallId 配对处理），
 * 所以不会出现"有调用没结果"的孤儿消息——那才是各家 API 真正会报错的形状。
 */
import { pruneMessages, type ModelMessage } from 'ai'

/**
 * 输出体积由远端/磁盘决定、因而不可预估的工具。
 * 名单与 CHAT_TOOL_CATALOG 同源，新增同类工具要一并加进来，
 * 判据 tests/unit/agent-tool-history.test.ts 会对着目录把这份名单对一次账。
 */
export const BULK_OUTPUT_TOOLS = [
  'ssh_readonly',
  'ssh_write',
  'ssh_journal_follow',
  'sftp_read',
] as const

/**
 * 保留最近几条消息里的工具内容。
 * 一步产生"assistant 的 tool-call"+"tool 的 tool-result"两条，
 * 取 4 就是保住最近两轮，模型仍能看见自己刚查到的东西。
 */
const KEEP_RECENT_MESSAGES = 4

export interface PruneStats {
  beforeCount: number
  afterCount: number
  removedMessages: number
}

/**
 * 剪掉旧的批量工具输出（幂等：已经剪过的再跑一次不会继续丢东西）
 */
export function pruneStaleToolOutputs(messages: ModelMessage[]): ModelMessage[] {
  if (messages.length <= KEEP_RECENT_MESSAGES) return messages
  return pruneMessages({
    messages,
    toolCalls: [{ type: `before-last-${KEEP_RECENT_MESSAGES}-messages`, tools: [...BULK_OUTPUT_TOOLS] }],
    // 剪完只剩空壳的消息直接移出列表：留着它每步仍要参与序列化与校验
    emptyMessages: 'remove',
  })
}

/** 剪枝前后的对账数据（写日志用，别把内容本身写进去） */
export function diffPrune(before: ModelMessage[], after: ModelMessage[]): PruneStats {
  return {
    beforeCount: before.length,
    afterCount: after.length,
    removedMessages: Math.max(0, before.length - after.length),
  }
}
