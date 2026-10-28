/**
 * 模型清单的结构判据（2026-10-28 按各家现役型号重刷）
 *
 * 口径由用户定（2026-10-28 原话）：「不要有本地的候选项，也不要有过时的大模型」。
 * 精确 id 按各家文档/发布记录写，**测试只验结构与名单、不发网络请求**。
 *
 * 这份判据管六件事：
 *   1. id 集合与期望表逐字相等（改一条就得改这张表，评审看得见 diff）
 *   2. 每条 id 承担的 roles 与期望表相等（删档最容易把某个角色的唯一提供者一起删掉）
 *   3. 每家（按 id 前缀）不超过两档——"精简"要能被机器检查，不能只写在注释里
 *   4. assertTemplateInvariants 既过真表、也真的会拒绝坏表
 *      （validator 只验真表等于没验：它可能恒返回空数组）
 *   5. findCatalogProblems：内置候选里不许有本机地址、退役型号与禁用条目
 *      ——三条各有负向对照，喂一条坏表进去必须报出来
 *      （"本地模型"这一条不用查表：ProviderType 联合里已经没有 ollama，编译期就挡住）
 *   6. 每个厂商档位写的是"这一代"的型号（id 沿用旧值只为不让用户重填 Key）
 */
import { describe, it, expect } from 'vitest'
import {
  PROVIDER_TEMPLATES,
  assertTemplateInvariants,
  findCatalogProblems,
  findTemplate,
  SUPERSEDED_MODEL_IDS,
} from '../../src/main/core/agent/providers/provider-templates'
import type { ProviderConfig } from '../../src/main/core/agent/providers/types'

/** 期望的 id 全集（14 条：8 家云服务各 ≤2 档 + 自定义槽） */
const EXPECTED_IDS = [
  'deepseek-v4',
  'deepseek-reasoner',
  'qwen-max',
  'qwen-thinking',
  'volcengine-doubao',
  'volcengine-doubao-turbo',
  'kimi-k3',
  'kimi-code',
  'glm-max',
  'glm-flash',
  'gemini-pro',
  'gemini-flash',
  'claude-sonnet',
  'openai-compatible-custom',
]

/**
 * 期望的 roles 分配（null = 该条不设 roles，留给用户在设置里指定）
 *
 * id 沿用旧值是有原因的：SecureStore 的密钥键是 `provider:<id>`，
 * 换 id 等于让已配置用户重填 API Key。所以「Kimi K3 → K3.1」「Gemini 3.8 → 4 Argon」
 * 这类换代只改 model 与显示名，id 不动；只有从没跑通过的那两条（豆包 flash、Bedrock Claude）
 * 才换 id。
 */
const EXPECTED_ROLES: Record<string, string[] | null> = {
  'deepseek-v4': ['chat', 'summarize'],
  'deepseek-reasoner': ['preview', 'edit', 'apply'],
  'qwen-max': ['chat'],
  'qwen-thinking': ['preview', 'summarize'],
  'volcengine-doubao': ['chat'],
  'volcengine-doubao-turbo': ['preview'],
  'kimi-k3': ['chat', 'summarize'],
  'kimi-code': ['edit', 'apply'],
  'glm-max': ['chat', 'edit'],
  'glm-flash': ['preview', 'autocomplete'],
  'gemini-pro': ['chat', 'summarize'],
  'gemini-flash': ['preview'],
  'claude-sonnet': ['chat', 'edit'],
  'openai-compatible-custom': null,
}

/** 每家写的是"这一代"的型号（2026-10-28 按各家文档/发布记录核对） */
const EXPECTED_MODELS: Record<string, string> = {
  'deepseek-v4': 'deepseek-flash', // V4.1 Flash（2026-09-10 上线，10-17 更新到 1017 版）
  'deepseek-reasoner': 'deepseek-v4-pro', // V4 Pro 旗舰
  'qwen-max': 'qwen3.8-max',
  'qwen-thinking': 'qwen3.8-flash',
  'volcengine-doubao': 'doubao-seed-2.1-pro', // 2026-09-16 更新到 0915 版
  'volcengine-doubao-turbo': 'doubao-seed-2.1-turbo', // 同代第二档是 Turbo，不是 Flash
  'kimi-k3': 'kimi-k3.1-pro', // K3.1 系列首个模型，3T 参数 / 1M 上下文
  'kimi-code': 'kimi-k3.1-pro-highspeed',
  'glm-max': 'glm-5.3',
  'glm-flash': 'glm-5.3-flash',
  'gemini-pro': 'gemini-4-argon', // 2026-10-13 GA，id 不带 -preview
  'gemini-flash': 'gemini-3.8-flash',
  'claude-sonnet': 'claude-sonnet-5-5',
  'openai-compatible-custom': '',
}

describe('模型清单结构判据', () => {
  it('id 集合与期望表逐字相等（不多不少不重名）', () => {
    const ids = PROVIDER_TEMPLATES.map((t) => t.id)
    expect([...ids].sort()).toEqual([...EXPECTED_IDS].sort())
    expect(new Set(ids).size, '有重复 id').toBe(ids.length)
    expect(ids.length).toBe(14)
  })

  it.each(Object.entries(EXPECTED_ROLES))('%s 的 roles 是 %j', (id, roles) => {
    expect(findTemplate(id)?.roles ?? null).toEqual(roles)
  })

  it.each(Object.entries(EXPECTED_MODELS))('%s 写的是现役型号 %s', (id, model) => {
    expect(findTemplate(id)?.model).toBe(model)
  })

  it('每家最多两档（"精简"是判据不是注释）', () => {
    /**
     * 厂商键按 id 前缀算，不按 type 算：Kimi 与 GLM 共用 openai-compatible 这个 type
     * （不新增 ProviderType 是有意的），按 type 数会把两家数成一家。
     */
    const vendorKey = (t: ProviderConfig): string => {
      if (t.id === 'openai-compatible-custom') return '__custom__'
      return t.id.split('-')[0]
    }
    const perVendor = new Map<string, string[]>()
    for (const t of PROVIDER_TEMPLATES) {
      perVendor.set(vendorKey(t), [...(perVendor.get(vendorKey(t)) ?? []), t.id])
    }
    const over = [...perVendor.entries()].filter(([, ids]) => ids.length > 2)
    expect(over, `这些家超过两档：${over.map(([v, ids]) => `${v}=${ids.join(',')}`).join(' | ')}`).toEqual([])
    // 同时证明这条判据不是空转：确实数到了 8 家
    expect(perVendor.size).toBeGreaterThanOrEqual(8)
  })

  it('真表通过自检，坏表各自被拒（validator 不是恒返回空的废铁）', () => {
    expect(assertTemplateInvariants()).toEqual([])

    const base = PROVIDER_TEMPLATES[0]
    const brokenCases: Array<{ title: string; list: ProviderConfig[]; hit: string }> = [
      {
        title: 'id 重复',
        list: [base, { ...base }],
        hit: 'id 重复',
      },
      {
        title: '未知角色',
        list: [{ ...base, roles: ['superagent' as never] }],
        hit: '未知角色',
      },
      {
        title: 'compat 系 baseURL 缺版本段',
        list: [{ ...base, type: 'qwen', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode' }],
        hit: '版本段',
      },
      {
        title: 'model 为空且不是自定义槽',
        list: [{ ...base, id: 'deepseek-v4', model: '' }],
        hit: 'model 为空',
      },
      {
        title: '明文 http 指向非回环地址',
        list: [{ ...base, type: 'qwen', baseURL: 'http://far.example.com/v1', model: 'm' }],
        hit: '只允许本机回环',
      },
    ]

    for (const c of brokenCases) {
      const problems = assertTemplateInvariants(c.list)
      expect(
        problems.some((p) => p.includes(c.hit)),
        `${c.title} 本该被报出来，实际得到：${problems.join(' | ') || '(空)'}`,
      ).toBe(true)
    }
  })

  it('六个角色都有启用中的模板承担（删档不许把角色删空）', () => {
    const covered = new Set<string>()
    for (const t of PROVIDER_TEMPLATES) {
      if (t.enabled === false) continue
      for (const role of t.roles ?? []) covered.add(role)
    }
    for (const role of ['chat', 'edit', 'preview', 'apply', 'summarize', 'autocomplete']) {
      expect(covered.has(role), `没有启用中的模板承担 ${role}`).toBe(true)
    }
    // 已知缺口如实写明：embedding / rerank 至今没有任何内置提供者
    expect(covered.has('embedding'), '若已补上 embedding，请同步改这条判据').toBe(false)
    expect(covered.has('rerank'), '若已补上 rerank，请同步改这条判据').toBe(false)
  })

  it('候选清单里没有本机地址、退役型号、禁用条目（本地模型由类型系统挡住）', () => {
    expect(findCatalogProblems()).toEqual([])
  })

  it('三条各自的负向对照：喂一条坏表进去必须报，且报的是对应的那条', () => {
    const base = PROVIDER_TEMPLATES[0]
    const cases: Array<{ title: string; list: ProviderConfig[]; hit: string }> = [
      {
        title: '本机地址（即使 type 是云服务）',
        list: [{ ...base, id: 'proxy-x', type: 'openai-compatible', baseURL: 'http://127.0.0.1:8000/v1' }],
        hit: '本机地址',
      },
      {
        title: '退役型号',
        list: [{ ...base, id: 'old-x', model: SUPERSEDED_MODEL_IDS[0] }],
        hit: '已被取代',
      },
      {
        title: '禁用条目占位',
        list: [{ ...base, id: 'dead-x', enabled: false }],
        hit: '禁用',
      },
    ]
    for (const c of cases) {
      const problems = findCatalogProblems(c.list)
      expect(
        problems.some((p) => p.includes(c.hit)),
        `${c.title} 本该被报出来，实际得到：${problems.join(' | ') || '(空)'}`,
      ).toBe(true)
    }
  })

  it('Claude 走官方直连（Bedrock 那条"暂不可用"的占位不再存在）', () => {
    const t = findTemplate('claude-sonnet')
    expect(t?.type).toBe('anthropic')
    expect(t?.enabled).toBe(true)
    expect(t?.baseURL).toBe('https://api.anthropic.com/v1')
    expect(findTemplate('claude-sonnet-4'), 'Bedrock 占位不该回来').toBeUndefined()
  })

  it('Kimi / GLM 走 openai-compatible，但把 1M 上下文写进模板（否则按 8K 保守值压缩）', () => {
    const compat = PROVIDER_TEMPLATES.filter(
      (t) => t.id.startsWith('kimi-') || t.id.startsWith('glm-'),
    )
    expect(compat).toHaveLength(4)
    for (const t of compat) {
      expect(t.type).toBe('openai-compatible')
      expect(t.capabilities?.contextWindow, `${t.id} 没有写真实上下文窗口`).toBe(1_000_000)
    }
    // 通义 3.8 也是百万级：原来按类型给的 256K 会提前压缩
    for (const id of ['qwen-max', 'qwen-thinking']) {
      expect(findTemplate(id)?.capabilities?.contextWindow).toBe(1_000_000)
    }
  })
})
