/**
 * 模型清单的结构判据（2026-10-10 刷新）
 *
 * 口径由用户定：每家最多 2 档 + 新增 Kimi / GLM；Claude Agent SDK 两条留到许可那条一起定；
 * 精确 id 按各家文档写，**测试只验结构、不发网络请求**。
 *
 * 所以这份判据管四件事：
 *   1. id 集合与期望表逐字相等（改一条就得改这张表，评审看得见 diff）
 *   2. 每条 id 承担的 roles 与期望表相等（删档最容易把某个角色的唯一提供者一起删掉）
 *   3. 每家（按 type）不超过两档——"精简"要能被机器检查，不能只写在注释里
 *   4. assertTemplateInvariants 既过真表、也真的会拒绝四种坏表
 *      （validator 只验真表等于没验：它可能恒返回空数组）
 */
import { describe, it, expect } from 'vitest'
import {
  PROVIDER_TEMPLATES,
  assertTemplateInvariants,
  findTemplate,
} from '../../src/main/core/agent/providers/provider-templates'
import type { ProviderConfig } from '../../src/main/core/agent/providers/types'

/** 期望的 id 全集（17 条） */
const EXPECTED_IDS = [
  'deepseek-v4',
  'deepseek-reasoner',
  'qwen-max',
  'qwen-thinking',
  'volcengine-doubao',
  'volcengine-doubao-flash',
  'kimi-k3',
  'kimi-code',
  'glm-max',
  'glm-flash',
  'gemini-pro',
  'gemini-flash',
  'claude-sonnet-4',
  'ollama-qwen3',
  'openai-compatible-custom',
]

/**
 * 期望的 roles 分配（null = 该条不设 roles，留给用户在设置里指定）
 *
 * id 沿用旧值是有原因的：SecureStore 的密钥键是 `provider:<id>`，
 * 换 id 等于让所有已配置用户重填 API Key。
 */
const EXPECTED_ROLES: Record<string, string[] | null> = {
  'deepseek-v4': ['chat', 'summarize'],
  'deepseek-reasoner': ['preview', 'edit', 'apply'],
  'qwen-max': ['chat'],
  'qwen-thinking': ['preview', 'summarize'],
  'volcengine-doubao': ['chat'],
  'volcengine-doubao-flash': ['preview'],
  'kimi-k3': ['chat', 'summarize'],
  'kimi-code': ['edit', 'apply'],
  'glm-max': ['chat', 'edit'],
  'glm-flash': ['preview', 'autocomplete'],
  'gemini-pro': ['chat', 'summarize'],
  'gemini-flash': ['preview'],
  'claude-sonnet-4': ['chat', 'edit'],
  'ollama-qwen3': ['chat', 'autocomplete'],
  'openai-compatible-custom': null,
}

describe('模型清单结构判据', () => {
  it('id 集合与期望表逐字相等（不多不少不重名）', () => {
    const ids = PROVIDER_TEMPLATES.map((t) => t.id)
    expect([...ids].sort()).toEqual([...EXPECTED_IDS].sort())
    expect(new Set(ids).size, '有重复 id').toBe(ids.length)
    expect(ids.length).toBe(15)
  })

  it.each(Object.entries(EXPECTED_ROLES))('%s 的 roles 是 %j', (id, roles) => {
    expect(findTemplate(id)?.roles ?? null).toEqual(roles)
  })

  it('每家最多两档（"精简"是判据不是注释）', () => {
    /**
     * 厂商键按 id 前缀算，不按 type 算：Kimi 与 GLM 共用 openai-compatible 这个 type
     * （不新增 ProviderType 是有意的），按 type 数会把两家数成一家。
     * Claude 再按通道分一次：Bedrock 兜底与 Agent SDK 是两个不同的东西。
     */
    const vendorKey = (t: ProviderConfig): string => {
      if (t.id === 'openai-compatible-custom') return '__custom__'
      const vendor = t.id.split('-')[0]
      return vendor
    }
    const perVendor = new Map<string, string[]>()
    for (const t of PROVIDER_TEMPLATES) {
      perVendor.set(vendorKey(t), [...(perVendor.get(vendorKey(t)) ?? []), t.id])
    }
    const over = [...perVendor.entries()].filter(([, ids]) => ids.length > 2)
    expect(over, `这些家超过两档：${over.map(([v, ids]) => `${v}=${ids.join(',')}`).join(' | ')}`).toEqual([])
    // 同时证明这条判据不是空转：确实数到了 8 家以上
    expect(perVendor.size).toBeGreaterThanOrEqual(8)
  })

  it('真表通过自检，四种坏表各自被拒（validator 不是恒返回空的废铁）', () => {
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

  it('Bedrock 那条默认禁用（它跑不通：@ai-sdk/anthropic 发 Bearer，Bedrock 要 SigV4）', () => {
    const t = findTemplate('claude-sonnet-4')
    expect(t?.enabled).toBe(false)
    expect(t?.type).toBe('anthropic')
  })

  it('Kimi 与 GLM 两家确实在表里，且都走 openai-compatible（不新增 ProviderType）', () => {
    const kimi = PROVIDER_TEMPLATES.filter((t) => t.id.startsWith('kimi-'))
    const glm = PROVIDER_TEMPLATES.filter((t) => t.id.startsWith('glm-'))
    expect(kimi.map((t) => t.model)).toEqual(['kimi-k3', 'kimi-k2.7-code-highspeed'])
    expect(glm.map((t) => t.model)).toEqual(['glm-5.3', 'glm-5.3-flash'])
    for (const t of [...kimi, ...glm]) {
      expect(t.type).toBe('openai-compatible')
    }
    // 新增两家却不扩 ProviderType：这条冻结的就是那个决定
    expect(PROVIDER_TEMPLATES.filter((t) => t.type === 'openai-compatible').length).toBe(5)
  })
})
