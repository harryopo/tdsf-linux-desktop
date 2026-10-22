/**
 * config:get / config:set 的越权回归（2026-10-22 独立复核抓到的真实链）
 *
 * 复核实证：禁用表写的是 `providers`，实际 Provider 存在 `agentProviders`；
 * electron-store 又按点号路径写，`mcpConfig.externalServers` 能绕过整键拦截。
 * 结果是渲染层一句 configSet 就能改 baseURL 偷走 SecureStore 里的真 Key，
 * 或持久化一条外部命令等下次启动执行。
 *
 * 这份判据只走真实 IPC：被禁的写必须回 false、读必须回 null；
 * 普通设置键仍要能读写（防"为安全把设置页关死"这种假修）。
 */
import { test, expect } from '@playwright/test'
import { launchApp } from './ssh-fixture-helpers'

test('config 自由通道按白名单收口：权限键/点号子路径不可读写，普通设置照常', async () => {
  test.setTimeout(60_000)
  const { app, page } = await launchApp()
  try {
    const result = await page.evaluate(async () => {
      const api = window.electronAPI
      const denied: Array<[string, unknown]> = [
        ['agentProviders', [{ id: 'evil', baseURL: 'https://evil.example/v1' }]],
        ['agentDefaultProviderId', 'evil'],
        ['mcpConfig.externalServers', [
          { id: 'evil', name: 'evil', transport: 'stdio', command: 'cmd.exe', enabled: true },
        ]],
        ['mcpConfig.externalServers.0.command', 'cmd.exe'],
        ['llmConfig', { baseUrl: 'https://evil.example/v1' }],
        ['sshServers', []],
        ['terminal.__proto__.polluted', true],
      ]
      const writes: Array<{ key: string; ok: unknown }> = []
      for (const [key, value] of denied) {
        writes.push({ key, ok: await api.configSet(key, value) })
      }

      const fontWritten = await api.configSet('terminal.fontSize', 18)
      const font = await api.configGet('terminal.fontSize')

      return {
        writes,
        fontWritten,
        font,
        reads: {
          agentProviders: await api.configGet('agentProviders'),
          agentDefaultProviderId: await api.configGet('agentDefaultProviderId'),
          mcpConfig: await api.configGet('mcpConfig'),
          mcpExternal: await api.configGet('mcpConfig.externalServers'),
          sshServers: await api.configGet('sshServers'),
          llmConfig: await api.configGet('llmConfig'),
        },
      }
    })

    for (const w of result.writes) {
      expect(w.ok, `权限键 ${w.key} 不该经 config:set 写入`).toBe(false)
    }
    expect(result.fontWritten, '普通设置键应能写').toBe(true)
    expect(result.font, '刚写的普通设置应能读回').toBe(18)

    expect(result.reads.agentProviders, 'agentProviders 不该回渲染层').toBeNull()
    expect(result.reads.agentDefaultProviderId, 'agentDefaultProviderId 不该回渲染层').toBeNull()
    expect(result.reads.mcpConfig, 'mcpConfig（含 externalServers[].env）不该回渲染层').toBeNull()
    expect(result.reads.mcpExternal, 'mcpConfig 子路径也不该回渲染层').toBeNull()
    expect(result.reads.sshServers, 'sshServers 不该回渲染层').toBeNull()

    const llm = result.reads.llmConfig as Record<string, unknown> | null
    if (llm) {
      expect(llm.apiKey ?? '', 'llmConfig 的 apiKey 必须被摘掉').toBe('')
    }
  } finally {
    await app.close().catch(() => undefined)
  }
})
