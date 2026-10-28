/**
 * 改 Provider 地址不许把已存的 Key 顺手带过去（2026-10-28，#255）
 *
 * 漏洞形状（与 #237 的 SSH 版同族，Provider 侧当时漏了）：
 * secure-store 里的 Key 是按 `provider:<id>` 存的，而 id 在"改地址"时不变。
 * 于是把默认 Provider 的 baseURL 改成任意 https 主机、Key 输入框留空（界面语义是"不修改"），
 * 下一次对话就会把真 Key 发到那个主机——写入口只校验"是不是 https"。
 *
 * 规则：**同一 id 的 host 变了 = 换了信任对象**，旧 Key 必须作废（想继续用就得重新填一次）。
 * 只改路径（/v1 → /v2）不算换主机，Key 保留。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const box = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  secrets: new Map<string, string>(),
  deleted: [] as string[],
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/test-userdata', isReady: () => true },
}))

vi.mock('electron-store', () => ({
  default: class {
    get(key: string) {
      return box.store.get(key)
    }
    set(key: string, value: unknown) {
      box.store.set(key, value)
    }
    delete(key: string) {
      box.store.delete(key)
    }
  },
}))

vi.mock('../../src/main/services/storage/secure-store', () => ({
  SecureStore: {
    isEncryptionAvailable: () => true,
    getApiKey: (key: string) => box.secrets.get(key) ?? null,
    saveApiKey: (key: string, value: string) => {
      box.secrets.set(key, value)
      return true
    },
    deleteApiKey: (key: string) => {
      box.deleted.push(key)
      box.secrets.delete(key)
      return true
    },
    listProviders: () => [...box.secrets.keys()],
  },
}))

const PROVIDERS_KEY = 'agentProviders'

async function registry() {
  vi.resetModules()
  return import('../../src/main/core/agent/providers/provider-registry')
}

const BASE = {
  id: 'p1',
  name: '自建代理',
  type: 'openai-compatible' as const,
  baseURL: 'https://a.example.com/v1',
  model: 'm1',
  enabled: true,
}

beforeEach(() => {
  box.store.clear()
  box.secrets.clear()
  box.deleted = []
})

describe('Provider 换地址时的 Key 归属', () => {
  it('host 变了且没给新 Key → 旧 Key 作废（不能寄到新主机）', async () => {
    const reg = await registry()
    reg.saveProvider({ ...BASE, apiKey: 'sk-old' })
    expect(box.secrets.get('provider:p1')).toBe('sk-old')

    reg.saveProvider({ ...BASE, baseURL: 'https://evil.example.net/v1' })

    expect(box.secrets.has('provider:p1'), '旧 Key 还留着，下次对话就会发给新主机').toBe(false)
    expect(box.deleted).toContain('provider:p1')
    const saved = (box.store.get(PROVIDERS_KEY) as Array<{ baseURL: string }>)[0]
    expect(saved.baseURL).toBe('https://evil.example.net/v1')
  })

  it('只改路径（同一 host）→ Key 保留（信任对象没变）', async () => {
    const reg = await registry()
    reg.saveProvider({ ...BASE, apiKey: 'sk-old' })
    reg.saveProvider({ ...BASE, baseURL: 'https://a.example.com/v2' })
    expect(box.secrets.get('provider:p1')).toBe('sk-old')
    expect(box.deleted).toEqual([])
  })

  it('换了主机但同时给了新 Key → 用新的，不算作废', async () => {
    const reg = await registry()
    reg.saveProvider({ ...BASE, apiKey: 'sk-old' })
    reg.saveProvider({ ...BASE, baseURL: 'https://b.example.com/v1', apiKey: 'sk-new' })
    expect(box.secrets.get('provider:p1')).toBe('sk-new')
    expect(box.deleted).toEqual([])
  })

  it('protocol 变了（http 回环 → https 同名主机）也算换信任对象', async () => {
    const reg = await registry()
    reg.saveProvider({ ...BASE, baseURL: 'http://127.0.0.1:11434/v1', apiKey: 'sk-local' })
    reg.saveProvider({ ...BASE, baseURL: 'https://127.0.0.1:11434/v1' })
    expect(box.secrets.has('provider:p1')).toBe(false)
  })
})

describe('provider:list 出口不带 Key', () => {
  it('旧版本落盘的条目带了 apiKey，读出来也要剥掉', async () => {
    // 模拟历史数据：老版本可能把 apiKey 一起写进了 provider 列表
    box.store.set(PROVIDERS_KEY, [{ ...BASE, apiKey: 'sk-legacy' }])
    const reg = await registry()
    const list = reg.listProviders(false)
    expect(list).toHaveLength(1)
    expect((list[0] as unknown as Record<string, unknown>).apiKey).toBeUndefined()
    // 存储不动（读路径不改写用户数据）
    const raw = (box.store.get(PROVIDERS_KEY) as Array<Record<string, unknown>>)[0]
    expect(raw.apiKey).toBe('sk-legacy')
  })
})
