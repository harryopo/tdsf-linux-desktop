/**
 * Provider 预置模板
 *
 * 职责：
 * - 提供常用模型后端的内置模板（DeepSeek / 通义千问 / 火山方舟 / Kimi / GLM / Gemini / Claude / OpenAI 兼容）
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
 * 2026-10-28 按用户口径重刷：「不要有本地的候选项，也不要有过时的大模型」。
 * - 去掉 Ollama（本地候选）与 Bedrock Claude（它从没跑通过，只占着一个"暂不可用"的灰条）
 * - 每家换成"这一代"的型号；**id 尽量沿用旧值**——SecureStore 的 key 是 `provider:<id>`，
 *   换 id 等于让用户重填 API Key。只有从没跑通过的两条（豆包 flash、Bedrock Claude）换了 id。
 * - 型号来源（2026-10-28 查）：DeepSeek api-docs / 通义 help.aliyun.com/model-studio /
 *   Kimi platform.kimi.com/docs/models（现役：k3.1-pro、k3.1-pro-highspeed）/ GLM docs.bigmodel.cn /
 *   Gemini 4 Argon 2026-10-13 GA（id 不带 -preview）/ Claude Sonnet 5.5 /
 *   豆包 Seed 2.1 双档是 Pro + Turbo（不是 Flash）
 * - 上下文窗口按各家文档给到的真实值写进 capabilities（Kimi/GLM/通义都是 1M）；
 *   不写就会落到 openai-compatible 的 8K 保守默认，对话还没长就先被压缩
 *
 * 方案书依据：v0.9 §3 决策 3（模型后端默认配置）+ v0.9.3 §11 第 2 类（Provider 工厂增强）
 */
import type { ProviderCapabilities, ProviderConfig } from './types'
import { PROVIDER_CAPABILITIES } from './provider-capabilities'

/** 只改上下文窗口，其余能力沿用该 type 的默认声明（别在这里另抄一份能力表） */
function withContextWindow(
  type: ProviderConfig['type'],
  contextWindow: number,
): ProviderCapabilities {
  return { ...PROVIDER_CAPABILITIES[type], contextWindow }
}

/**
 * baseURL 的写法规矩（**别再写反**，2026-10-10 用仓库内 vendor 的 SDK 源码核对）：
 *
 * @ai-sdk/openai 把 baseURL 当成"已经含版本号"的 API 根：
 * 默认值是 `https://api.openai.com/v1`（dist/index.js:4986），请求路径直接是
 * `/chat/completions`（dist/index.js:887），SDK 只在末尾接这一段，**不会替我们补 /v1**。
 * 所以走 createOpenAI 的三种 type（openai-compatible / qwen / volcengine-ark）
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
  // 3.8 两档都是百万级上下文（help.aliyun.com/zh/model-studio 的模型页写明）
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
    capabilities: withContextWindow('qwen', 1_000_000),
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
    capabilities: withContextWindow('qwen', 1_000_000),
  },

  // ===== 火山方舟（豆包 Seed 2.1）=====
  // 这一代只有两档：Pro（深度推理）与 Turbo（低延迟）。旧表写的 "Flash" 是凭 pro 的命名推断的，
  // 方舟根本没有这个型号——填了只会 404，而用户会以为是自己的 Key 坏了。
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
    // id 从 volcengine-doubao-flash 换成 turbo：旧那条从没跑通过，换 id 不丢任何可用配置
    id: 'volcengine-doubao-turbo',
    name: '火山方舟 豆包 Seed 2.1 Turbo',
    type: 'volcengine-ark',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seed-2.1-turbo',
    defaultParams: { temperature: 0.6, maxTokens: 4096 },
    builtin: true,
    enabled: true,
    roles: ['preview'],
  },

  // ===== Kimi / Moonshot（长上下文 + 编程档）=====
  // type 用 openai-compatible：不新增 ProviderType（8 值联合被 provider-capabilities
  // 与 provider-pricing 两张按类型键控的表冻着，加一个值要同时补两张表，收益为零）。
  // 现役名单见 platform.kimi.com/docs/models：k3.1-pro / k3.1-pro-highspeed 是这一代，
  // K3 与 K2.7 Code 仍在服但已被取代——候选里只留这一代。
  {
    id: 'kimi-k3',
    name: 'Kimi K3.1 Pro（1M 上下文）',
    type: 'openai-compatible',
    baseURL: 'https://api.moonshot.cn/v1',
    model: 'kimi-k3.1-pro',
    defaultParams: { temperature: 0.7, maxTokens: 4096 },
    builtin: true,
    enabled: true,
    roles: ['chat', 'summarize'],
    capabilities: withContextWindow('openai-compatible', 1_000_000),
  },
  {
    id: 'kimi-code',
    name: 'Kimi K3.1 Pro 高速版',
    type: 'openai-compatible',
    baseURL: 'https://api.moonshot.cn/v1',
    model: 'kimi-k3.1-pro-highspeed',
    defaultParams: { temperature: 0.2, maxTokens: 8192 },
    builtin: true,
    enabled: true,
    roles: ['edit', 'apply'],
    capabilities: withContextWindow('openai-compatible', 1_000_000),
  },

  // ===== GLM / 智谱 =====
  // docs.bigmodel.cn 的模型页：GLM-5.3 / GLM-5.3-Flash（另有 FlashX 变体），1M 上下文。
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
    capabilities: withContextWindow('openai-compatible', 1_000_000),
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
    capabilities: withContextWindow('openai-compatible', 1_000_000),
  },

  // ===== Google Gemini =====
  // 2026-10-13 Gemini 4 Argon 转为 GA：id 就是 `gemini-4-argon`，不带 -preview。
  // Flash 这一档用 3.8（当前最新 Flash），3.7 已被取代、从候选里去掉。
  {
    id: 'gemini-pro',
    name: 'Google Gemini 4 Argon',
    type: 'google',
    baseURL: 'https://generativelanguage.googleapis.com/v1',
    model: 'gemini-4-argon',
    defaultParams: { temperature: 0.7, maxTokens: 4096 },
    builtin: true,
    enabled: true,
    roles: ['chat', 'summarize'],
  },
  {
    id: 'gemini-flash',
    name: 'Google Gemini 3.8 Flash',
    type: 'google',
    baseURL: 'https://generativelanguage.googleapis.com/v1',
    model: 'gemini-3.8-flash',
    defaultParams: { temperature: 0.6, maxTokens: 4096 },
    builtin: true,
    enabled: true,
    roles: ['preview'],
  },

  // ===== Claude（官方直连）=====
  // 旧那条写的是 Bedrock 端点、还标着"暂不可用"：@ai-sdk/anthropic 发 Bearer、Bedrock 要 SigV4，
  // 填了 Key 也是 403/404。它从没跑通过，等于候选里摆着一个永远灰着的选项。
  // 现在换官方直连：createAnthropic 默认 baseURL 就是 https://api.anthropic.com/v1。
  {
    id: 'claude-sonnet',
    name: 'Claude Sonnet 5.5',
    type: 'anthropic',
    baseURL: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-5-5',
    defaultParams: { temperature: 0.7, maxTokens: 4096 },
    builtin: true,
    enabled: true,
    roles: ['chat', 'edit'],
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
      // 本机 http 只允许回环：用户自建的本地代理常写 http://127.0.0.1:8000/v1
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
 * 已经被这一代取代、不该再作为候选项出现的型号
 *
 * 每次刷新清单时把被换掉的那批挪进来（连同日期与出处），这样"删过什么"有据可查，
 * 也防止下一个人凭印象把它们加回去。判据：tests/unit/provider-template-invariants.test.ts。
 */
export const SUPERSEDED_MODEL_IDS: readonly string[] = [
  // 2026-07-24 官方停用（旧名路由到新模型）
  'deepseek-chat',
  'deepseek-reasoner',
  // 2026-10-28 本轮换掉：本地模型与从没跑通过的占位
  'qwen3:32b', // Ollama 本地 tag
  'anthropic.claude-sonnet-4-5', // Bedrock，SigV4 签不了
  // 2026-10-28 本轮换掉：被同厂商新一代取代
  'doubao-seed-2.1-flash', // 方舟没有这个型号，同代第二档是 turbo
  'kimi-k3', // K3.1 已接棒
  'kimi-k2.7-code-highspeed', // 同上，编程档换 k3.1-pro-highspeed
  'gemini-3.7-flash', // 3.8 Flash 已是当前 Flash 档
]

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0'])

/**
 * 候选清单的"该不该出现"判据（返回问题列表，空数组 = 通过）
 *
 * 与 assertTemplateInvariants 分开：那个管**形状**（id 重复、URL 合法、角色覆盖），
 * 这个管**内容政策**——用户 2026-10-28 定的口径是「不要有本地的候选项，也不要有过时的大模型」。
 * 拆成独立纯函数是为了四条政策各自能被负向对照打红（见测试）。
 */
export function findCatalogProblems(list: ProviderConfig[] = PROVIDER_TEMPLATES): string[] {
  const problems: string[] = []
  for (const t of list) {
    let host = ''
    try {
      host = t.baseURL ? new URL(t.baseURL).hostname : ''
    } catch {
      // URL 合不合法归 assertTemplateInvariants 管，这里不重复报
    }
    if (
      host &&
      (LOOPBACK_HOSTNAMES.has(host) || host.startsWith('127.') || host.endsWith('.localhost'))
    ) {
      problems.push(`${t.id}: baseURL 指向本机地址（${host}），内置候选只收公网服务`)
    }

    if (t.model && SUPERSEDED_MODEL_IDS.includes(t.model)) {
      problems.push(`${t.id}: 模型 ${t.model} 已被取代（见 SUPERSEDED_MODEL_IDS 的日期与来源）`)
    }

    if (t.enabled === false) {
      problems.push(`${t.id}: 模板被禁用（enabled=false）——半截的候选不如没有`)
    }
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
