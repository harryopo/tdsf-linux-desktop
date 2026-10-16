/**
 * 退役 Provider 类型的告警只能说一次（读路径的日志卫生）
 *
 * 现场（2026-10-16 用户实测日志）：loadFromStore 是读路径，一次会话里被调几十次，
 * 同一条"移除 2 条已退役的 Provider 类型"11 分钟刷了 151 次，占当天新增日志的三分之二，
 * 把同时段真正的 chat 失败埋掉了。
 *
 * 三条判据：
 *   1. 有退役条目时，读 5 次也只留 1 条告警，且每次读都拿不到那条（过滤照旧生效）
 *   2. 没有退役条目时一条告警都不发（不是"每次都发"）
 *   3. 告警里要带被忽略的是哪几条（id + type），否则用户看到一句话也不知道改哪
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const box = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  warns: [] as Array<{ msg: string; meta?: unknown }>,
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
    getApiKey: (key: string) => `stub-key-for-${key}`,
    saveApiKey: () => true,
    deleteApiKey: () => true,
    listProviders: () => [],
  },
}))

vi.mock('../../src/main/services/log/logger', () => ({
  logger: {
    debug: () => undefined,
    info: () => undefined,
    warn: (category: string, message: string, meta?: unknown) => {
      if (category === 'AGENT.PROVIDER') box.warns.push({ msg: message, meta })
    },
    error: () => undefined,
  },
}))

const PROVIDERS_KEY = 'agentProviders'

/** 本版本已撤掉的类型（PROVIDER_CAPABILITIES 里没有 claude-sdk） */
const RETIRED_TYPE = {
  id: 'claude-sonnet-4-5',
  name: 'Claude Sonnet 4.5',
  type: 'claude-sdk',
  baseURL: 'https://api.anthropic.com/v1',
  model: 'claude-sonnet-4-5',
  enabled: true,
}

const LIVE = {
  id: 'kimi-k2',
  name: 'Kimi K2',
  type: 'openai-compatible',
  baseURL: 'https://api.moonshot.cn/v1',
  model: 'kimi-k2-0711-preview',
  enabled: true,
}

async function loadRegistry(): Promise<
  typeof import('../../src/main/core/agent/providers/provider-registry')
> {
  vi.resetModules()
  return import('../../src/main/core/agent/providers/provider-registry')
}

beforeEach(() => {
  box.store.clear()
  box.warns = []
})

describe('退役 Provider 类型的告警只发一次', () => {
  it('读 5 次只留 1 条告警，且每次都拿不到那条', async () => {
    box.store.set(PROVIDERS_KEY, [RETIRED_TYPE, LIVE])
    const reg = await loadRegistry()

    for (let i = 0; i < 5; i++) {
      const ids = reg.listProviders().map((p) => p.id)
      expect(ids, '退役类型每次都不该出现在可读列表里').not.toContain('claude-sonnet-4-5')
      expect(ids).toContain('kimi-k2')
    }

    const retiredWarns = box.warns.filter((w) => w.msg.includes('已退役'))
    expect(retiredWarns.length, '同一条告警刷 5 次 = 把真问题埋掉的日志噪音').toBe(1)
    expect((retiredWarns[0].meta as { retired: Array<{ id: string }> }).retired[0].id).toBe(
      'claude-sonnet-4-5',
    )
  })

  it('阳性对照：全是可用类型时一条告警都不发', async () => {
    box.store.set(PROVIDERS_KEY, [LIVE])
    const reg = await loadRegistry()
    reg.listProviders()
    reg.listProviders()
    expect(
      box.warns.filter((w) => w.msg.includes('已退役')),
      '没有退役条目还发告警，这条判据就成了常驻噪音',
    ).toEqual([])
  })

  it('读路径不动存储：被忽略的那条仍然留在盘上', async () => {
    box.store.set(PROVIDERS_KEY, [RETIRED_TYPE, LIVE])
    const reg = await loadRegistry()
    reg.listProviders()
    const stored = box.store.get(PROVIDERS_KEY) as Array<{ id: string }>
    expect(
      stored.map((p) => p.id),
      '未知类型可能是新版程序写的，老程序不该顺手删用户配置',
    ).toContain('claude-sonnet-4-5')
  })
})
