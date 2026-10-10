/**
 * 内置模板的精简要真的落到已存数据上（provider-registry 的 prune 判据）
 *
 * 旧实现只有"按 id 增量追加"（provider-registry.ts 里那一句
 * `PROVIDER_TEMPLATES.filter((t) => !existingIds.has(t.id))`），
 * 于是模板表删条目等于只删了"以后不再新增"——已经存过的那份永久留着，
 * "清单精简"对老用户根本不生效。2026-10-10 加了 prune，这份测试钉住它的三条边界：
 *   1. builtin === true 且不在新表里的条目被移除，它的 apiKey 一起从 SecureStore 清掉
 *   2. builtin 非 true（含字段缺失的老数据）一律当用户自建，绝不删
 *   3. 默认指针若正指向被删的那条，必须回退到一个真实存在的 id
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const box = vi.hoisted(() => ({
  /** electron-store 的替身 */
  store: new Map<string, unknown>(),
  /** SecureStore 的替身：记录写入与删除 */
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
const DEFAULT_KEY = 'agentDefaultProviderId'

/** 一条"本版本已移除"的内置模板（用真实历史 id：ollama-llama33） */
const RETIRED_BUILTIN = {
  id: 'ollama-llama33',
  name: 'Ollama (Llama 3.3)',
  type: 'ollama',
  baseURL: 'http://localhost:11434/v1',
  model: 'llama3.3:70b',
  builtin: true,
  enabled: true,
}

/** 一条用户自建（builtin 缺失也要被当作自建） */
const USER_OWNED = {
  id: 'my-vllm',
  name: '机房里的 vLLM',
  type: 'openai-compatible',
  baseURL: 'https://inference.example.invalid/v1',
  model: 'qwen-local',
  enabled: true,
}

/** 装载 provider-registry（每个用例都拿一份干净的模块状态） */
async function loadRegistry(): Promise<
  typeof import('../../src/main/core/agent/providers/provider-registry')
> {
  vi.resetModules()
  return import('../../src/main/core/agent/providers/provider-registry')
}

beforeEach(() => {
  box.store.clear()
  box.secrets.clear()
  box.deleted = []
})

describe('内置模板 prune', () => {
  it('移除已退役的内置条目并清掉它的 apiKey，用户自建的原样保留', async () => {
    box.store.set(PROVIDERS_KEY, [RETIRED_BUILTIN, USER_OWNED])
    box.secrets.set('provider:ollama-llama33', 'ollama 不需要但存过就算了')

    const reg = await loadRegistry()
    reg.ensureProvidersInitialized()

    const stored = box.store.get(PROVIDERS_KEY) as Array<{ id: string; builtin?: boolean }>
    const ids = stored.map((p) => p.id)
    expect(ids, '退役内置条目应被移除').not.toContain('ollama-llama33')
    expect(ids, '用户自建不许被顺手删掉').toContain('my-vllm')
    const kept = stored.find((p) => p.id === 'my-vllm')
    expect(kept?.builtin, '自建条目的字段不该被改写').toBeUndefined()

    // apiKey 跟着走：留着指向不存在 Provider 的密钥就是纯债
    expect(box.deleted).toContain('provider:ollama-llama33')
    expect(box.secrets.has('provider:ollama-llama33')).toBe(false)

    // 新表的 17 条应全部就位（prune 与追加在同一次对账里完成）
    expect(ids.length).toBe(18)
  })

  it('默认指针指向被删条目时回退到真实存在的 id', async () => {
    box.store.set(PROVIDERS_KEY, [RETIRED_BUILTIN])
    box.store.set(DEFAULT_KEY, 'ollama-llama33')

    const reg = await loadRegistry()
    reg.ensureProvidersInitialized()

    const next = reg.getDefaultProviderId()
    const stored = box.store.get(PROVIDERS_KEY) as Array<{ id: string }>
    expect(stored.map((p) => p.id), '默认指针不能悬空').toContain(next)
    expect(next).not.toBe('ollama-llama33')
  })

  it('注入自证：没有任何退役条目时 prune 不动数据（不是"每次都全清"）', async () => {
    const { PROVIDER_TEMPLATES } = await import(
      '../../src/main/core/agent/providers/provider-templates'
    )
    // 原样存一份当前模板表 + 一条自建
    box.store.set(PROVIDERS_KEY, [...PROVIDER_TEMPLATES, USER_OWNED])

    const reg = await loadRegistry()
    reg.ensureProvidersInitialized()

    const stored = box.store.get(PROVIDERS_KEY) as Array<{ id: string }>
    expect(stored.length).toBe(PROVIDER_TEMPLATES.length + 1)
    expect(box.deleted, '没有退役条目时不该删任何密钥').toEqual([])
    expect(stored.map((p) => p.id)).toContain('my-vllm')
  })

  it('冷启动（store 里没有 providers）直接按新表播种', async () => {
    const reg = await loadRegistry()
    reg.ensureProvidersInitialized()
    const stored = box.store.get(PROVIDERS_KEY) as Array<{ id: string }>
    expect(stored.length).toBeGreaterThan(0)
    expect(stored.map((p) => p.id)).not.toContain('ollama-llama33')
  })
})
