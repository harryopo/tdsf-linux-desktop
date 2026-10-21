/**
 * 保存设置：主进程的"没写进去"必须传到界面上（2026-10-15 全维度审查 P1）
 *
 * 病根：saveSettings 把三条写回的判定全丢了——
 *   - storage:saveApiKey 在加密后端不可用（Linux 无 libsecret）时是 return false，不抛错
 *   - config:set 拒写时也是 false
 *   - config:saveLlm 回 {ok:false,error}信封，以前只落到 console
 * 于是 ModelSettings 弹"配置已保存"、SshSettings 弹 toast.success，用户下次开机发现 Key 没了。
 * 现在 saveSettings 返回原因字符串（null=全部生效），两个调用方都据此改提示。
 *
 * mock 的返回形状按主进程真实现取（ipc/storage.ts 的 handler + preload 的 Promise<boolean>），
 * 不然是"测试自己把缺陷演没了"。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useSettingsStore } from '@renderer/stores/settings-store'

interface ApiCalls {
  storageSaveApiKey: (provider: string, key: string) => Promise<boolean>
  configSet: (key: string, value: unknown) => Promise<boolean>
  configSaveLlm: (config: unknown) => Promise<{ ok: boolean; error?: string }>
  storageDeleteApiKey: (provider: string) => Promise<boolean>
}

/**
 * 装一个可控的 window.electronAPI。
 * 键名必须是 preload 上的那三个（store 里是 `const { configSet, configSaveLlm, storageSaveApiKey } = window.electronAPI`），
 * 名字对不上就会拿到 undefined，测试变成在演"调用不存在的方法"。
 */
function installApi(partial: Partial<ApiCalls>): void {
  const api: ApiCalls = {
    storageSaveApiKey: async () => true,
    configSet: async () => true,
    configSaveLlm: async () => ({ ok: true }),
    storageDeleteApiKey: async () => true,
    ...partial,
  }
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { electronAPI: api },
  })
}

beforeEach(() => {
  useSettingsStore.setState({
    llmConfig: {
      baseUrl: 'https://api.example.invalid',
      apiKey: '',
      model: 'x',
      temperature: 0.2,
      maxTokens: 4096,
      timeout: 60000,
    },
    hasLlmApiKey: false,
    sshDefaults: { port: 22, username: 'root' },
    sshTimeout: 30000,
  })
})

describe('saveSettings 如实回报主进程的拒绝', () => {
  it('三条都放行 → 返回 null，Key 布尔量翻成已存', async () => {
    installApi({})
    useSettingsStore.getState().setLlmConfig({ apiKey: 'sk-test-123' })
    const err = await useSettingsStore.getState().saveSettings()
    expect(err).toBeNull()
    expect(useSettingsStore.getState().hasLlmApiKey).toBe(true)
  })

  it('加密后端不可用（saveApiKey 回 false）→ 必须给出原因，且不许说"已保存"', async () => {
    installApi({ storageSaveApiKey: async () => false })
    useSettingsStore.getState().setLlmConfig({ apiKey: 'sk-test-123' })
    const err = await useSettingsStore.getState().saveSettings()
    expect(err, '主进程回 false 却被说成保存成功＝界面在撒谎').not.toBeNull()
    expect(err).toMatch(/安全存储/)
    expect(useSettingsStore.getState().hasLlmApiKey, '没存成的 Key 不许把界面提示翻成已保存').toBe(false)
  })

  it('config:set 回 false（拒写带权限键/非法值）→ 说清是 SSH 那两格没写进去', async () => {
    installApi({ configSet: async () => false })
    const err = await useSettingsStore.getState().saveSettings()
    expect(err).toMatch(/SSH 默认配置被主进程拒绝写入/)
    expect(err).toMatch(/SSH 连接超时被主进程拒绝写入/)
  })

  it('config:saveLlm 的信封拒绝要带上主进程给的原因原文', async () => {
    installApi({ configSaveLlm: async () => ({ ok: false, error: 'baseUrl 不在允许的白名单内' }) })
    const err = await useSettingsStore.getState().saveSettings()
    expect(err).toMatch(/baseUrl 不在允许的白名单内/)
  })

  it('多条同时被拒要都带出来（只报第一条会把"部分没存"说成"只有这一处问题"）', async () => {
    installApi({ storageSaveApiKey: async () => false, configSet: async () => false })
    useSettingsStore.getState().setLlmConfig({ apiKey: 'sk-test-123' })
    const err = await useSettingsStore.getState().saveSettings()
    expect(err).toMatch(/安全存储/)
    expect(err).toMatch(/SSH 默认配置/)
    expect(err!.split('；').length, '拒绝条数与失败写入数对不上').toBeGreaterThanOrEqual(3)
  })

  it('IPC 直接抛错也不能静默（以前只落 console.error）', async () => {
    installApi({ configSaveLlm: async () => { throw new Error('通道被拒绝') } })
    const err = await useSettingsStore.getState().saveSettings()
    expect(err).toMatch(/保存失败：通道被拒绝/)
  })
})

describe('clearLlmApiKey 是显式删除，不与输入框留空混为一谈', () => {
  it('主进程确认删除 → 布尔量翻回未存，Key 字段清空', async () => {
    let deletedProvider = ''
    installApi({
      storageDeleteApiKey: async (provider) => {
        deletedProvider = provider
        return true
      },
    })
    useSettingsStore.setState({ hasLlmApiKey: true })
    useSettingsStore.getState().setLlmConfig({ apiKey: 'sk-test-123' })

    const err = await useSettingsStore.getState().clearLlmApiKey()

    expect(err).toBeNull()
    expect(deletedProvider, '删的必须是主进程 llm.ts 实际读取的那条 llm').toBe('llm')
    expect(useSettingsStore.getState().hasLlmApiKey).toBe(false)
    expect(useSettingsStore.getState().llmConfig.apiKey).toBe('')
  })

  it('主进程回 false → 报原因且不改界面状态', async () => {
    installApi({ storageDeleteApiKey: async () => false })
    useSettingsStore.setState({ hasLlmApiKey: true })

    const err = await useSettingsStore.getState().clearLlmApiKey()

    expect(err).toMatch(/没有确认删除/)
    expect(useSettingsStore.getState().hasLlmApiKey, '没删成不许把界面显示成未存').toBe(true)
  })
})
