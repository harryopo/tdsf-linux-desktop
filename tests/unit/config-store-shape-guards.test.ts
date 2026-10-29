/**
 * 配置项"形状不对"时按默认值处理，并记一条日志（#260）
 *
 * 实测：config.json 是合法 JSON、但字段类型错了（`llmConfig` 写成字符串、
 * `knowledgeBasePath` 写成数字、`uiSettings` 写成数字）时，应用能起来，界面也不报错——
 * 但这些裸 `as` 断言会把垃圾值直接交给调用方：字符串被展开成 `{0:'o',1:'o'}`、
 * 数字被当成路径去拼。这里钉住读取口的形状判定：错形状 → 默认值 + 一次 WARN。
 *
 * 服务器列表（sshServers）不在这里：它已经在 loadServerList 里按"损坏必须抛"处理，
 * 因为空列表会被渲染层反写覆盖。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const box = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  warn: vi.fn(),
}))

vi.mock('electron-store', () => ({
  default: class {
    get(key: string, fallback?: unknown) {
      return box.store.has(key) ? box.store.get(key) : (fallback ?? undefined)
    }
    set(key: string, value: unknown) {
      box.store.set(key, value)
    }
    delete(key: string) {
      box.store.delete(key)
    }
  },
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/tdsf-config-shape-test', isReady: () => true },
  safeStorage: { isEncryptionAvailable: () => true },
}))

vi.mock('../../src/main/services/storage/secure-store', () => ({
  SecureStore: {
    loadServerCredential: () => null,
    saveServerCredential: () => true,
    deleteServerCredential: () => true,
    loadApiKey: () => null,
    saveApiKey: () => true,
    deleteApiKey: () => true,
  },
}))

vi.mock('../../src/main/services/log/logger', () => ({
  logger: { warn: box.warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { ConfigStore } from '../../src/main/services/storage/config-store'

/** warnShapeOnce 是进程级去重：每个用例前清空 store，用一个新 key 规避 */
beforeEach(() => {
  box.store.clear()
  box.warn.mockClear()
})

describe('形状不对的配置项', () => {
  it('llmConfig 是字符串：回 null（不是展开成 {0,1,2…} 的对象）', () => {
    box.store.set('llmConfig', 'oops')
    expect(ConfigStore.getLlmConfig()).toBeNull()
    expect(box.warn, '悄悄按默认值处理，等于把损坏藏起来').toHaveBeenCalled()
  })

  it('uiSettings 是数字：回空对象，不把数字当设置表', () => {
    box.store.set('uiSettings', 42)
    expect(ConfigStore.getUiSettings()).toEqual({})
  })

  it('knowledgeBasePath 是数字：回空串，不让数字去拼路径', () => {
    box.store.set('knowledgeBasePath', 123)
    expect(ConfigStore.getKnowledgeBasePath()).toBe('')
  })

  it('mcpConfig 是字符串：get 回 null，OrDefault 回默认对象', () => {
    box.store.set('mcpConfig', 'x')
    expect(ConfigStore.getMcpConfig()).toBeNull()
    const fallback = ConfigStore.getMcpConfigOrDefault()
    expect(typeof fallback).toBe('object')
    // 2026-10-29 #281：默认值不再带 enabled/port（那两个字段属于已整删的入站服务）。
    // 现在"没配过"的默认就是一张空表，写入口只往里面放 externalServers。
    expect(fallback).toEqual({})
  })

  it('形状正确时原样返回（反向对照：守卫没有把好数据也削掉）', () => {
    box.store.set('knowledgeBasePath', '/data/kb')
    box.store.set('uiSettings', { theme: 'dark' })
    box.store.set('llmConfig', { baseUrl: 'https://api.example.com/v1', model: 'deepseek-flash', apiKey: 'k' })

    expect(ConfigStore.getKnowledgeBasePath()).toBe('/data/kb')
    expect(ConfigStore.getUiSettings()).toEqual({ theme: 'dark' })
    expect(ConfigStore.getLlmConfig()?.model).toBe('deepseek-flash')
    expect(box.warn).not.toHaveBeenCalled()
  })
})
