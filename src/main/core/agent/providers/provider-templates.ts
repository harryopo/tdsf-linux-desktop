/**
 * Provider 预置模板
 *
 * 职责：
 * - 提供常用模型后端的内置模板（DeepSeek / 通义千问 / 火山方舟 / Ollama / Claude / OpenAI 兼容）
 * - 模板仅含 baseURL/model 等非敏感信息，API Key 由 SecureStore 单独管理
 *
 * 设计要点：
 * - 国产模型优先（DeepSeek / 通义 / 方舟）—— 国内可用 + 成本低
 * - Claude 走 AWS Bedrock 兜底（不直连，方案书 §3 决策 2）
 * - OpenAI 兼容（自定义 baseURL）支持任意第三方兼容服务
 *
 * v0.9.4 批次 2 - 任务 3：为每个预置模板补充 roles 字段
 * - 借鉴 ContinueDev ModelRole，声明该 Provider 适配的模型角色
 * - 主进程通过 getProviderByRole(role) 查找匹配的 Provider
 * - 用户可在设置中覆盖（增删 roles 数组）
 *
 * 方案书依据：v0.9 §3 决策 3（模型后端默认配置）+ v0.9.3 §11 第 2 类（Provider 工厂增强）
 */
import type { ProviderConfig } from './types'

/**
 * 预置 Provider 模板列表
 *
 * builtin=true 表示系统内置，用户不可删除（但可禁用）
 *
 * roles 字段（v0.9.4 批次 2 - 任务 3）：
 * - 'chat'：主对话（用户聊天）
 * - 'edit'：代码编辑（生成 diff）
 * - 'autocomplete'：自动补全（IDE 内联）
 * - 'embedding'：向量嵌入（代码库索引）
 * - 'rerank'：重排序（检索结果精排）
 * - 'preview'：预览模型（廉价快速预览）
 * - 'apply'：应用模型（执行代码块）
 * - 'summarize'：摘要模型（长上下文压缩）
 */
export const PROVIDER_TEMPLATES: ProviderConfig[] = [
  // ===== DeepSeek（主推，国内可用 + 256K 上下文 + 成本低）=====
  // 主对话 + 摘要（256K 长上下文适合压缩任务）
  {
    id: 'deepseek-v4',
    name: 'DeepSeek V4',
    type: 'deepseek',
    baseURL: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    defaultParams: { temperature: 0.7, maxTokens: 4096 },
    builtin: true,
    enabled: true,
    roles: ['chat', 'summarize'],
  },
  // DeepSeek Coder（编程 Subagent 专用）→ edit + apply
  {
    id: 'deepseek-coder-v3',
    name: 'DeepSeek Coder V3',
    type: 'deepseek',
    baseURL: 'https://api.deepseek.com/v1',
    model: 'deepseek-coder',
    defaultParams: { temperature: 0.2, maxTokens: 8192 },
    builtin: true,
    enabled: true,
    roles: ['edit', 'apply'],
  },
  // DeepSeek Reasoner（思考 Subagent 专用，对应 DeepSeek-R1 推理模型）→ preview
  // R1 推理模型适合"先思考再回答"的预览场景
  {
    id: 'deepseek-reasoner',
    name: 'DeepSeek Reasoner (R1)',
    type: 'deepseek',
    baseURL: 'https://api.deepseek.com/v1',
    model: 'deepseek-reasoner',
    defaultParams: { temperature: 0.6, maxTokens: 8192 },
    builtin: true,
    enabled: true,
    roles: ['preview'],
  },

  // ===== 通义千问 / DashScope（备选主对话）=====
  // 通义千问 Max → chat
  {
    id: 'qwen-max',
    name: '通义千问 Max',
    type: 'qwen',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-max',
    defaultParams: { temperature: 0.7, maxTokens: 4096 },
    builtin: true,
    enabled: true,
    roles: ['chat'],
  },
  // 通义千问 Thinking（思考 Subagent 专用）→ preview
  {
    id: 'qwen-thinking',
    name: '通义千问 Thinking',
    type: 'qwen',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3-thinking',
    defaultParams: { temperature: 0.6, maxTokens: 8192 },
    builtin: true,
    enabled: true,
    roles: ['preview'],
  },

  // ===== 火山方舟（豆包系列）=====
  // 豆包 Pro → chat
  {
    id: 'volcengine-doubao',
    name: '火山方舟 豆包 Pro',
    type: 'volcengine-ark',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-pro-32k',
    defaultParams: { temperature: 0.7, maxTokens: 4096 },
    builtin: true,
    enabled: true,
    roles: ['chat'],
  },

  // ===== Claude（走 AWS Bedrock 兜底，不直连）=====
  // Claude Sonnet 4.5（Bedrock）→ chat + edit
  {
    id: 'claude-sonnet-4',
    name: 'Claude Sonnet 4.5 (Bedrock)',
    type: 'anthropic',
    // AWS Bedrock 区域端点（cn-northwest-1 中国区）
    baseURL: 'https://bedrock-runtime.cn-northwest-1.amazonaws.com.cn',
    model: 'anthropic.claude-sonnet-4-5',
    defaultParams: { temperature: 0.7, maxTokens: 4096 },
    builtin: true,
    enabled: true,
    roles: ['chat', 'edit'],
  },

  // ===== Claude Agent SDK（走 @anthropic-ai/claude-agent-sdk query() agent loop）=====
  // 与上面 'anthropic' 类型的区别：
  // - 'anthropic' 走 @ai-sdk/anthropic 的 LanguageModelV2 单次调用契约（streamText/doGenerate）
  // - 'claude-sdk' 走 Claude Agent SDK 的 query() 异步生成器（多轮工具调用 + 反思）
  // - 不通过 provider-factory.createLanguageModel 创建，由 IPC handler 直接实例化 ClaudeSdkProvider
  // - 调用方通过 `claude-sdk:generate` / `claude-sdk:stream` IPC 通道使用
  // baseURL 留空：SDK 默认走 https://api.anthropic.com（可通过 ANTHROPIC_BASE_URL env 覆盖）
  // Claude Sonnet 4.5（Agent SDK）→ chat + edit
  {
    id: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5 (Agent SDK)',
    type: 'claude-sdk',
    // baseURL 留空：SDK 默认 https://api.anthropic.com；用户可在设置中覆盖为 Bedrock / 代理端点
    baseURL: '',
    model: 'claude-sonnet-4-5',
    defaultParams: { temperature: 0.7, maxTokens: 4096 },
    builtin: true,
    enabled: true,
    roles: ['chat', 'edit'],
  },
  // Claude Opus 4.1（Agent SDK）→ edit + apply
  {
    id: 'claude-opus-4-1',
    name: 'Claude Opus 4.1 (Agent SDK)',
    type: 'claude-sdk',
    baseURL: '',
    model: 'claude-opus-4-1',
    defaultParams: { temperature: 0.7, maxTokens: 4096 },
    builtin: true,
    enabled: true,
    roles: ['edit', 'apply'],
  },

  // ===== Google Gemini（备选）=====
  // Gemini Pro → chat + summarize（100 万 token 长上下文，适合摘要）
  {
    id: 'gemini-pro',
    name: 'Google Gemini Pro',
    type: 'google',
    baseURL: 'https://generativelanguage.googleapis.com/v1',
    model: 'gemini-2.5-pro',
    defaultParams: { temperature: 0.7, maxTokens: 4096 },
    builtin: true,
    enabled: true,
    roles: ['chat', 'summarize'],
  },

  // ===== Ollama（本地离线，隐私场景）=====
  // Ollama Qwen3 → chat + autocomplete（本地低延迟，适合 IDE 内联补全）
  {
    id: 'ollama-qwen3',
    name: 'Ollama (Qwen3-32B)',
    type: 'ollama',
    baseURL: 'http://localhost:11434/v1',
    model: 'qwen3:32b',
    defaultParams: { temperature: 0.7, maxTokens: 4096 },
    builtin: true,
    enabled: true,
    roles: ['chat', 'autocomplete'],
  },
  // Ollama Llama 3.3（备选本地）→ chat
  {
    id: 'ollama-llama33',
    name: 'Ollama (Llama 3.3)',
    type: 'ollama',
    baseURL: 'http://localhost:11434/v1',
    model: 'llama3.3:70b',
    defaultParams: { temperature: 0.7, maxTokens: 4096 },
    builtin: true,
    enabled: true,
    roles: ['chat'],
  },

  // ===== OpenAI 兼容（自定义 baseURL，覆盖任意第三方）=====
  // 不设置 roles：用户自定义 Provider，角色由用户在设置中指定
  {
    id: 'openai-compatible-custom',
    name: 'OpenAI 兼容 (自定义)',
    type: 'openai-compatible',
    baseURL: '',
    model: '',
    defaultParams: { temperature: 0.7, maxTokens: 4096 },
    builtin: true,
    enabled: true,
  },
]

/**
 * 按 ID 查找预置模板
 *
 * @param id Provider ID
 * @returns 模板对象，未找到返回 undefined
 */
export function findTemplate(id: string): ProviderConfig | undefined {
  return PROVIDER_TEMPLATES.find((t) => t.id === id)
}

/**
 * 列出所有预置模板的简要信息（UI 选择器用）
 */
export function listTemplateSummaries(): Array<{
  id: string
  name: string
  type: string
  baseURL: string
  defaultModel: string
}> {
  return PROVIDER_TEMPLATES.map((t) => ({
    id: t.id,
    name: t.name,
    type: t.type,
    baseURL: t.baseURL,
    defaultModel: t.model,
  }))
}
