/**
 * 对话历史落盘的跨进程单源形状（任务 #177）
 *
 * 为什么单独一个文件而不是塞进 models.ts：这条记录同时被三头用——
 * 主进程仓储（写库）、契约（判形状）、渲染层（回看时直接铺进消息列表）。
 * 抄一份在任一头都会漂，而这张表的漂法是静默的：字段少一个只是"回看时少看一样东西"。
 *
 * 落盘口径（与判据 tests/unit/chat-repo.test.ts 同源）：
 * - 一条消息一行，按 id 覆盖：流式期先落半截、收尾那一笔补全同一条；
 * - sshSessionId 为 null 是合法的一档（没连服务器时的对话），不与任何服务器混；
 * - 回看不能比当场看到的少：思考链、工具卡、用量（含 estimated 标记）、
 *   取消与失败两档都要有地方放。
 */

/** 对话里的一条消息（只存用户与助手两档：工具与思考是助手消息的附属，不是独立角色） */
export const CHAT_ROLES = ['user', 'assistant'] as const
export type ChatRole = (typeof CHAT_ROLES)[number]

export interface ChatMessageRecord {
  /** 渲染层的消息 id（同一条的收尾那一笔靠它覆盖） */
  id: string
  /** 一次请求的关联 ID；界面用它把工具卡与消息配对 */
  correlationId?: string | null
  /** 这条对话发生在哪台 SSH 会话上；null = 没连服务器时的对话 */
  sshSessionId?: string | null
  role: ChatRole
  content: string
  reasoning?: string | null
  toolEvents?: unknown[] | null
  providerId?: string | null
  model?: string | null
  /** 用量原样存；#137 的 estimated 标记（实测 vs 估算）不能在落盘时抹平 */
  usage?: unknown | null
  cancelled?: boolean
  isError?: boolean
  errorCode?: string | null
  /**
   * 错误原文（v2.11 起错误不掺进 content，单独放这里）。
   * 不落它的话，重启后那条失败回答只剩一个红边卡片、正文是空的——等于把故障现场擦了。
   */
  errorMessage?: string | null
  /**
   * 本轮结束时对话真实占用的 tokens（徽章分子）。
   * 不落它，徽章只能退回 usage.inputTokens——那是各步之和，多步工具链会把同一份上下文数 N 遍。
   */
  contextTokens?: number | null
  /** 主进程这一轮做了上下文压缩时的说明；没有则不显示那一行 */
  contextNote?: string | null
  /** CoT 熵轨迹（可信度卡的熵图数据）；不落它，回看时那张图直接不画 */
  cotEntropyTrajectory?: number[] | null
  createdAt: number
}

/** 回看一次最多给多少条（超出的更早消息仍在库里，只是这一屏不取） */
export const CHAT_HISTORY_MAX_LIMIT = 200
