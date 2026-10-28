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
      id: 'p-local',
      name: '自建本地服务',
      type: 'openai-compatible',
      baseURL: 'http://127.0.0.1:11434/v1',
      model: 'qwen2.5:7b',
      enabled: true,
    })
    const { listProviders } = await registry()
    const list = listProviders(false)
    expect(list).toHaveLength(1)
    expect(list[0].capabilities?.contextWindow, '默认表里 openai-compatible 是 8K，不补就是渲染层自己猜').toBe(8_000)
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

  it('运行时取 Provider 也带能力表（压缩按它算，不能只给渲染层用）', async () => {
    seedProvider({
      id: 'p-runtime',
      name: '自建本地服务',
      type: 'openai-compatible',
      baseURL: 'http://127.0.0.1:11434/v1',
      model: 'qwen2.5:7b',
      enabled: true,
    })
    const { getProviderWithApiKey } = await registry()
    const runtime = getProviderWithApiKey('p-runtime')
    expect(runtime?.capabilities?.contextWindow, 'supervisor 读 config.capabilities，缺了会按 150K 绝对尺压缩').toBe(8_000)
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

describe("存储里只留真覆盖（#89 的回归防线）", () => {
  // provider:list 现在恒带解析后的 capabilities，而 ModelSettings 的同步是
  // providerSave({...target, ...}) 整条回写。不在写入口剥掉与默认表相同的那份，
  // 能力表就会被冻进存储，以后改默认表对老用户永久失效。
  const localProxy = {
    id: 'p-local', name: '自建本地服务', type: 'openai-compatible',
    baseURL: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b', enabled: true,
  }

  it('与默认表相同的能力声明不入库', async () => {
    const { listProviders, saveProvider } = await registry()
    seedProvider(localProxy)
    const resolved = listProviders(false)[0]
    saveProvider(resolved as never)
    const stored = (box.store.get(PROVIDERS_KEY) as Array<Record<string, unknown>>)[0]
    expect(stored.capabilities, '整条回写把默认能力冻进了存储').toBeUndefined()
  })

  it('用户真改过的窗口大小要入库', async () => {
    const { listProviders, saveProvider } = await registry()
    seedProvider(localProxy)
    const resolved = listProviders(false)[0]
    saveProvider({
      ...(resolved as object),
      capabilities: { ...resolved.capabilities!, contextWindow: 131_072 },
    } as never)
    const stored = (box.store.get(PROVIDERS_KEY) as Array<Record<string, unknown>>)[0]
    expect((stored.capabilities as { contextWindow: number }).contextWindow).toBe(131_072)
  })

  it('往返幂等：list 出来的对象直接存回去，存储内容不变', async () => {
    const { listProviders, saveProvider } = await registry()
    seedProvider(localProxy)
    const before = JSON.stringify(box.store.get(PROVIDERS_KEY))
    saveProvider(listProviders(false)[0] as never)
    expect(JSON.stringify(box.store.get(PROVIDERS_KEY)), saveProvider.name).toBe(before)
  })
})

describe('provider:save 的 baseURL 策略（2026-10-13 后端审查 P0）', () => {
  // baseURL 决定"SecureStore 里的真 key 寄到哪个主机"，而渲染层能写它。
  // 老只在本机回环这一侧被 config:saveLlm 校验过一次，provider:save 直接落库。
  const base = {
    id: 'p-deepseek',
    name: 'DeepSeek',
    type: 'deepseek',
    model: 'deepseek-chat',
    enabled: true,
  }

  it('明文 http 指向远端 → 整条拒写，且口令/密钥一个字节都不落', async () => {
    const { saveProvider } = await registry()
    seedProvider({ ...base, baseURL: 'https://api.deepseek.com/v1' })
    const before = JSON.stringify(box.store.get(PROVIDERS_KEY))

    const ok = saveProvider({
      ...base,
      baseURL: 'http://attacker.example.com/v1',
      // 拆成相邻字面量：完整的 sk-… 形状会被 GitHub 密钥扫描当真并给仓库所有者发信，
      // 事后删掉警报也不会自动关
      apiKey: ['sk-', 'should-not-be-persisted'].join(''),
    } as never)

    expect(ok).toBe(false)
    expect(JSON.stringify(box.store.get(PROVIDERS_KEY)), '地址被拒却把旧记录改掉了').toBe(before)
    expect([...box.secrets.keys()], '拒写发生在 SecureStore 之前，key 不该已经存进去').toEqual([])
  })

  it('https 正常地址照样保存（负向对照：这道闸不是一律拒绝）', async () => {
    const { saveProvider } = await registry()
    seedProvider({ ...base, baseURL: 'https://api.deepseek.com/v1' })

    expect(saveProvider({ ...base, baseURL: 'https://api.deepseek.com/v1' } as never)).toBe(true)
    const stored = (box.store.get(PROVIDERS_KEY) as Array<Record<string, unknown>>)[0]
    expect(stored.baseURL).toBe('https://api.deepseek.com/v1')
  })

  it('本机自建服务的明文 http 仍然放行（挡住远端不能顺手挡住本地）', async () => {
    const { saveProvider } = await registry()
    seedProvider({ ...base, id: 'p-local', type: 'openai-compatible', baseURL: 'http://127.0.0.1:11434/v1' })
    expect(
      saveProvider({ ...base, id: 'p-local', type: 'openai-compatible', baseURL: 'http://localhost:11434/v1' } as never)
    ).toBe(true)
  })

  it('URL 里内嵌账号口令 → 拒', async () => {
    const { saveProvider } = await registry()
    seedProvider({ ...base, baseURL: 'https://api.deepseek.com/v1' })
    expect(saveProvider({ ...base, baseURL: 'https://evil:***@api.deepseek.com/v1' } as never)).toBe(false)
  })

  it('file:// 之类的非 http 协议 → 拒（白名单口径，不是黑名单补洞）', async () => {
    const { saveProvider } = await registry()
    seedProvider({ ...base, baseURL: 'https://api.deepseek.com/v1' })
    const before = JSON.stringify(box.store.get(PROVIDERS_KEY))
    expect(saveProvider({ ...base, baseURL: 'file:///C:/windows/system32/calc.exe' } as never)).toBe(false)
    expect(JSON.stringify(box.store.get(PROVIDERS_KEY))).toBe(before)
  })
})
