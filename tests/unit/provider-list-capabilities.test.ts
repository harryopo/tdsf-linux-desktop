/**
 * provider:list 是否把"真实窗口大小"带到渲染层（#89）
 *
 * 判据：Composer 的上下文徽章要按选中模型的真实窗口算百分比。
 * 窗口表只有一份（provider-capabilities.ts 的 PROVIDER_CAPABILITIES，主进程侧），
 * 渲染层不许手抄——所以单源只能在 listProviders 的返回里出现，
 * 这三条测试钉的就是"确实带出来了、且优先用户覆盖"。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const box = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  secrets: new Map<string, string>(),
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
      box.secrets.delete(key)
      return true
    },
    listProviders: () => [...box.secrets.keys()],
  },
}))

const PROVIDERS_KEY = 'agentProviders'

/** 直接往存储里塞一条自建 Provider，绕开内置模板初始化 */
function seedProvider(config: Record<string, unknown>): void {
  box.store.set(PROVIDERS_KEY, [config])
}

async function registry() {
  const mod = await import('../../src/main/core/agent/providers/provider-registry')
  return mod
}

beforeEach(() => {
  box.store.clear()
  box.secrets.clear()
})

describe('listProviders 带出真实窗口', () => {
  it('没写 capabilities 的自建 Provider 按 type 默认表补上', async () => {
    seedProvider({
      id: 'p-ollama',
      name: '本地 Ollama',
      type: 'ollama',
      baseURL: 'http://127.0.0.1:11434/v1',
      model: 'qwen2.5:7b',
      enabled: true,
    })
    const { listProviders } = await registry()
    const list = listProviders(false)
    expect(list).toHaveLength(1)
    expect(list[0].capabilities?.contextWindow, '默认表里 ollama 是 8K，不补就是渲染层自己猜').toBe(8_000)
  })

  it('用户显式覆盖优先于默认表', async () => {
    seedProvider({
      id: 'p-self',
      name: '自部署长窗口',
      type: 'openai-compatible',
      baseURL: 'http://10.0.0.9:8000/v1',
      model: 'my-llama',
      enabled: true,
      capabilities: {
        streaming: true,
        toolCall: true,
        vision: false,
        contextWindow: 131_072,
        logprobs: true,
      },
    })
    const { listProviders } = await registry()
    expect(listProviders(false)[0].capabilities?.contextWindow).toBe(131_072)
  })

  it('每条都带 capabilities，且不与存储里的原对象共享引用', async () => {
    const caps = {
      streaming: true,
      toolCall: true,
      vision: false,
      contextWindow: 64_000,
      logprobs: true,
    }
    seedProvider({
      id: 'p-qwen',
      name: '通义',
      type: 'qwen',
      baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-plus',
      enabled: true,
      capabilities: caps,
    })
    const { listProviders } = await registry()
    const got = listProviders(false)[0].capabilities
    expect(got).toBeTruthy()
    expect(got).not.toBe(caps)
    // 改返回值不该影响默认表或存储
    got!.contextWindow = 1
    expect(listProviders(false)[0].capabilities?.contextWindow).toBe(64_000)
  })

  it('内置模板初始化后每条窗口都是正数（没有 0 占位）', async () => {
    const { listProviders } = await registry()
    const list = listProviders(false)
    expect(list.length).toBeGreaterThan(0)
    for (const p of list) {
      expect(p.capabilities!.contextWindow, `${p.id} 窗口为 0 会让徽章显示"未知"`).toBeGreaterThan(0)
    }
  })
})
