/**
 * Provider 预置模板
 *
 * 职责：
 * - 提供常用模型后端的内置模板（DeepSeek / 通义千问 / 火山方舟 / Kimi / GLM / Gemini / Claude / Ollama / OpenAI 兼容）
 * - 模板仅含 baseURL/model 等非敏感信息，API Key 由 SecureStore 单独管理
 *
 * 设计要点：
 * - 国产模型优先（DeepSeek / 通义 / 方舟 / Kimi / GLM）—— 国内可用 + 成本低
 * - 每家最多两档：旗舰档（主对话）+ 快档或编程专用档（预览/编辑），不再一家三条
 * - OpenAI 兼容（自定义 baseURL）支持任意第三方兼容服务
 *
 * roles 字段：主进程通过 getProviderByRole(role) 查找匹配的 Provider，
 * 用户可在设置中覆盖（增删 roles 数组）。8 档含义见下方 ProviderConfig 用法。
 *
 * 2026-10-10 全量刷新（模型名按各家文档核对；**未经真实调用验证**的条目在各自注释里写明来源）：
 * - 已按文档核实：DeepSeek（api-docs.deepseek.com）、Kimi（platform.kimi.com）、
 *   通义（help.aliyun.com/zh/model-studio）、GLM（docs.bigmodel.cn，id 串按官方 glm-5.1 的写法推断）
 * - 二手来源、未实测：Gemini 3.8/3.7 flash、豆包 Seed 2.1 两档、Claude 5 系列 id
 *   （Gemini/OpenAI 官方文档站取不到正文，Anthropic 文档本站区域屏蔽，火山方舟文档页是 JS 渲染）
 * - id 一律沿用旧值：SecureStore 的 key 是 `provider:<id>`，改 id 等于让用户重填 API Key
 *
 * 方案书依据：v0.9 §3 决策 3（模型后端默认配置）+ v0.9.3 §11 第 2 类（Provider 工厂增强）
 */
import type { ProviderConfig } from './types'

/**
 * baseURL 的写法规矩（**别再写反**，2026-10-10 用仓库内 vendor 的 SDK 源码核对）：
 *
 * @ai-sdk/openai 把 baseURL 当成"已经含版本号"的 API 根：
 * 默认值是 `https://api.openai.com/v1`（dist/index.js:4986），请求路径直接是
 * `/chat/completions`（dist/index.js:887），SDK 只在末尾接这一段，**不会替我们补 /v1**。
 * 所以走 createOpenAI 的四种 type（openai-compatible / qwen / volcengine-ark / ollama）
 * 与 deepseek 一样，baseURL 必须自己带版本段。
 * 旧模板里 DeepSeek 写成 `https://api.deepseek.com` 并注释"SDK 会自动追加 /v1"，
 * 那句话与该版本的真实行为相反，等于每次调用都打在不存在的端点上。
 *
 * 这条规矩由 assertTemplateInvariants() 钉住，并有 provider-baseurl-join.test.ts
 * 用真 SDK 组一次 URL 做行为对照（不是比字符串前缀）。
 */
const OPENAI_COMPAT_BASE_URL_RULE = 'baseURL 必须以版本段结尾（例如 /v1、/v3、/compatible-mode/v1）'

/** 预置 Provider 模板列表（builtin=true 表示系统内置，用户不可删除，但可禁用） */
export const PROVIDER_TEMPLATES: ProviderConfig[] = [
  // ===== DeepSeek（主推，国内可用 + 成本低）=====
  // 旧名 deepseek-chat / deepseek-reasoner 于 2026-07-24 停用；
  // deepseek-v4-flash 已在 2026-09-10 下线（官方暂时把旧名路由到 V4.1 Flash），改用 deepseek-flash。
  {
    id: 'deepseek-v4',
    name: 'DeepSeek V4.1 Flash',
    type: 'deepseek',
    baseURL: 'https://api.deepseek.com/v1',
    model: 'deepseek-flash',
    defaultParams: { temperature: 0.7, maxTokens: 4096 },
    builtin: true,
    enabled: true,
    roles: ['chat', 'summarize'],
  },
  // 思考档（V4 Pro）：预览 + 编辑 + 应用，替掉原先单独的 coder 一条
  {
    id: 'deepseek-reasoner',
    name: 'DeepSeek V4 Pro',
    type: 'deepseek',
    baseURL: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-pro',
    defaultParams: { temperature: 0.6, maxTokens: 8192 },
    builtin: true,
    enabled: true,
    roles: ['preview', 'edit', 'apply'],
  },

  // ===== 通义千问 / DashScope =====
  {
    id: 'qwen-max',
    name: '通义千问 3.8 Max',
    type: 'qwen',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3.8-max',
    defaultParams: { temperature: 0.7, maxTokens: 4096 },
    builtin: true,
    enabled: true,
    roles: ['chat'],
  },
  {
    id: 'qwen-thinking',
    name: '通义千问 3.8 Flash',
    type: 'qwen',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3.8-flash',
    defaultParams: { temperature: 0.6, maxTokens: 8192 },
    builtin: true,
    enabled: true,
    roles: ['preview', 'summarize'],
  },

  // ===== 火山方舟（豆包 Seed 2.1）=====
  // 来源：二手（方舟文档中心正文是 JS 渲染，抓不到 model id 列表）。保存前请在控制台核对。
  {
    id: 'volcengine-doubao',
    name: '火山方舟 豆包 Seed 2.1 Pro',
    type: 'volcengine-ark',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seed-2.1-pro',
    defaultParams: { temperature: 0.7, maxTokens: 4096 },
    builtin: true,
    enabled: true,
    roles: ['chat'],
  },
  {
    id: 'volcengine-doubao-flash',
    name: '火山方舟 豆包 Seed 2.1 Flash',
    type: 'volcengine-ark',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    // 来源：二手，未实测；档名按 pro 的命名推断
    model: 'doubao-seed-2.1-flash',
    defaultParams: { temperature: 0.6, maxTokens: 4096 },
    builtin: true,
    enabled: true,
    roles: ['preview'],
  },

  // ===== Kimi / Moonshot（新增，长上下文 + 编程档）=====
  // type 用 openai-compatible：不新增 ProviderType（8 值联合被 provider:capabilities-all
  // 与 provider:pricing-all 两条测试冻结，且两张按类型键控的表要跟着扩，收益为零）
  {
    id: 'kimi-k3',
    name: 'Kimi K3（1M 上下文）',
    type: 'openai-compatible',
    baseURL: 'https://api.moonshot.cn/v1',
    model: 'kimi-k3',
    defaultParams: { temperature: 0.7, maxTokens: 4096 },
    builtin: true,
    enabled: true,
    roles: ['chat', 'summarize'],
  },
  {
    id: 'kimi-code',
    name: 'Kimi K2.7 Code Highspeed',
    type: 'openai-compatible',
    baseURL: 'https://api.moonshot.cn/v1',
    model: 'kimi-k2.7-code-highspeed',
    defaultParams: { temperature: 0.2, maxTokens: 8192 },
    builtin: true,
    enabled: true,
    roles: ['edit', 'apply'],
  },

  // ===== GLM / 智谱（新增）=====
  // 官方发布记录里的名字是 GLM-5.3 / GLM-5.3-Flash；id 串按官方 GLM-5.1 页面的写法（glm-5.1）
  // 推断为小写，**未实测**。
  {
    id: 'glm-max',
    name: 'GLM 5.3',
    type: 'openai-compatible',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-5.3',
    defaultParams: { temperature: 0.7, maxTokens: 4096 },
    builtin: true,
    enabled: true,
    roles: ['chat', 'edit'],
  },
  {
    id: 'glm-flash',
    name: 'GLM 5.3 Flash',
    type: 'openai-compatible',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-5.3-flash',
    defaultParams: { temperature: 0.6, maxTokens: 4096 },
    builtin: true,
    enabled: true,
    roles: ['preview', 'autocomplete'],
  },

  // ===== Google Gemini =====
  // 官方文档站取不到正文，3.8/3.7 Flash 的 GA 状态与 id 来自引用官方表的二手来源。
  {
    id: 'gemini-pro',
    name: 'Google Gemini 3.8 Flash',
    type: 'google',
    baseURL: 'https://generativelanguage.googleapis.com/v1',
    model: 'gemini-3.8-flash',
    defaultParams: { temperature: 0.7, maxTokens: 4096 },
    builtin: true,
    enabled: true,
    roles: ['chat', 'summarize'],
  },
  {
    id: 'gemini-flash',
    name: 'Google Gemini 3.7 Flash',
    type: 'google',
    baseURL: 'https://generativelanguage.googleapis.com/v1',
    model: 'gemini-3.7-flash',
    defaultParams: { temperature: 0.6, maxTokens: 4096 },
    builtin: true,
    enabled: true,
    roles: ['preview'],
  },

  // ===== Claude（AWS Bedrock 兜底）=====
  // 这条**默认禁用**，不是省事，是它跑不通：@ai-sdk/anthropic 发的是 Bearer token，
  // 默认 baseURL 是 https://api.anthropic.com/v1（dist/index.js:4104），而 Bedrock 的
  // model 端点是 /model/<arn>/invoke… 且要求 SigV4 签名。填了 Key 也是 403/404。
  // 保留条目只为不丢历史配置；真要走 Bedrock 得换签名客户端（SigV4），本仓不做。
  {
    id: 'claude-sonnet-4',
    name: 'Claude Sonnet 4.5 (Bedrock · 暂不可用)',
    type: 'anthropic',
    baseURL: 'https://bedrock-runtime.cn-northwest-1.amazonaws.com.cn',
    model: 'anthropic.claude-sonnet-4-5',
    defaultParams: { temperature: 0.7, maxTokens: 4096 },
    builtin: true,
    enabled: false,
    roles: ['chat', 'edit'],
  },

  // ===== Ollama（本地离线，隐私场景）=====
  // 本地只留一档：tag 取决于用户实际 pull 了什么，摆第二条"备选模型"等于摆一个假选择
  // （没拉过的 tag 直接报错，而用户会以为是服务坏了）。
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

  // ===== OpenAI 兼容（自定义 baseURL，覆盖任意第三方）=====
  // 不设置 roles：用户自定义 Provider，角色由用户在设置中指定。
  // baseURL/model 允许留空——assertTemplateInvariants 对这一条放行（见 CUSTOM_ID 注释）。
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

/** 允许 baseURL/model 为空的占位模板 id（就是给用户自己填的那一条） */
const CUSTOM_TEMPLATE_ID = 'openai-compatible-custom'

/** 8 档角色（与 ModelRole 一致；写全是为了能在本文件里自检） */
const ALL_ROLES = [
  'chat',
  'edit',
  'autocomplete',
  'embedding',
  'rerank',
  'preview',
  'apply',
  'summarize',
] as const

/** 走 createOpenAI 家族的 type：baseURL 必须自带版本段（见文件头 OPENAI_COMPAT_BASE_URL_RULE） */
const VERSIONED_BASE_URL_TYPES: ProviderConfig['type'][] = [
  'openai-compatible',
  'qwen',
  'volcengine-ark',
  'ollama',
  'deepseek',
]

/** 版本号段的形状：以 /v<数字> 结尾，允许前面还有路径（compatible-mode/v1、api/v3、api/paas/v4） */
const VERSION_SUFFIX = /\/v\d+$/

/**
 * 模板自检：返回问题描述列表（空数组 = 通过）
 *
 * 为什么要有这个函数而不是只靠测试：模板是数据，数据出错最像"配置问题"而不是"代码 bug"，
 * 而下一次改这份表的人未必是跑过测试的人。校验规则本身写成可单测的纯函数，
 * 判据（provider-template-invariants.test.ts）用四份手工坏表证明它真的会报。
 */
export function assertTemplateInvariants(list: ProviderConfig[] = PROVIDER_TEMPLATES): string[] {
  const problems: string[] = []

  const seen = new Set<string>()
  for (const t of list) {
    if (seen.has(t.id)) problems.push(`${t.id}: id 重复`)
    seen.add(t.id)

    if (t.builtin !== true) problems.push(`${t.id}: 预置模板必须 builtin=true`)

    for (const role of t.roles ?? []) {
      if (!(ALL_ROLES as readonly string[]).includes(role)) {
        problems.push(`${t.id}: roles 里有未知角色 ${role}`)
      }
    }

    if (t.id !== CUSTOM_TEMPLATE_ID && !t.model) {
      problems.push(`${t.id}: model 为空（只有 ${CUSTOM_TEMPLATE_ID} 允许留空待用户填写）`)
    }

    if (t.baseURL) {
      let url: URL
      try {
        url = new URL(t.baseURL)
      } catch {
        problems.push(`${t.id}: baseURL 不是合法 URL：${t.baseURL}`)
        continue
      }
      const plainHttp = url.protocol === 'http:'
      if (url.protocol !== 'https:' && !plainHttp) {
        problems.push(`${t.id}: baseURL 协议 ${url.protocol} 不被允许（只支持 https，本机 http）`)
      }
      // 本机 http 只允许回环：Ollama 是 http://localhost:11434/v1
      if (plainHttp && !['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
        problems.push(`${t.id}: 明文 http 只允许本机回环（${url.hostname} 会把 Key 走明文发到远端）`)
      }
      if (url.username || url.password) {
        problems.push(`${t.id}: baseURL 不允许内嵌账号口令`)
      }
      if (VERSIONED_BASE_URL_TYPES.includes(t.type) && !VERSION_SUFFIX.test(url.pathname)) {
        problems.push(`${t.id}: ${OPENAI_COMPAT_BASE_URL_RULE}，当前是 ${t.baseURL}`)
      }
    }
  }

  // 角色覆盖：删档时最容易把某个角色的唯一提供者一起删掉
  const covered = new Set<string>()
  for (const t of list) {
    if (t.enabled !== false) for (const role of t.roles ?? []) covered.add(role)
  }
  const required = ['chat', 'edit', 'preview', 'apply', 'summarize', 'autocomplete']
  for (const role of required) {
    if (!covered.has(role)) problems.push(`角色 ${role} 没有任何启用中的模板承担`)
  }

  return problems
}

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
