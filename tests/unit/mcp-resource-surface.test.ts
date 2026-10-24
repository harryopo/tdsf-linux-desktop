/**
 * MCP 对外资源清单的回归钉（#196）
 *
 * 为什么需要这份测试：`tdsf://config/agent-mode` 曾把 `allowedTools` /
 * `canWriteFiles` / `canExecuteCommands` 当成真实能力报给外部 MCP 客户端，
 * 而主进程里根本没有读这些字段的执行体（Supervisor 取 systemPrompt 不看 mode，
 * `getAllowedTools` 生产零调用）。对面据此以为"切到 ask 模式就写不了文件"，
 * 是被误导，不是功能。2026-10-24 随五模式整删。
 *
 * 这里钉三件事，防止它以另一种写法悄悄回来：
 * 1. 资源清单按 URI 精确对账——新增一条就必须同时改这份清单，逼人看一眼自己承诺了什么；
 * 2. `agent-mode` 不在清单里；
 * 3. 直接读那条 URI 会**报错**，而不是返回空壳（半态比缺失更坏）。
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  app: {
    getAppPath: () => '/tmp/test-app-path',
    getPath: () => '/tmp/test-userdata',
    isReady: () => true,
  },
}))

vi.mock('electron-store', () => {
  const store = new Map<string, unknown>()
  return {
    default: class {
      get(key: string) {
        return store.get(key)
      }
      set(key: string, value: unknown) {
        store.set(key, value)
      }
      delete(key: string) {
        store.delete(key)
      }
    },
  }
})

import { MCP_RESOURCES, readResource } from '../../src/main/services/mcp/resources'

describe('[mcp-resource-surface] 对外资源清单', () => {
  it('清单与 URI 白名单逐条相等（不多不少不重复）', () => {
    const expected = [
      'tdsf://config/risk-rules',
      'tdsf://knowledge/linux-basics',
      'tdsf://knowledge/selinux',
      'tdsf://knowledge/samba',
      'tdsf://knowledge/troubleshooting',
      'tdsf://runtime/decisions',
      'tdsf://runtime/sessions',
    ].sort()
    const actual = MCP_RESOURCES.map((r) => r.uri).sort()
    expect(actual).toEqual(expected)
    // 正向对照：量具真的看得见条目，而不是把空数组比空数组
    expect(actual.length).toBe(7)
  })

  it('不再对外报 agent-mode（五模式谎报已随实现整删）', () => {
    expect(MCP_RESOURCES.map((r) => r.uri)).not.toContain('tdsf://config/agent-mode')
  })

  it('读那条 URI 是明确报错，不是返回空壳', async () => {
    await expect(readResource('tdsf://config/agent-mode')).rejects.toThrow(/未知配置资源/)
  })
})
