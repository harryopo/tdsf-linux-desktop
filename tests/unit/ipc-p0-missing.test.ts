/**
 * v0.9.5 P0 补齐通道的单元测试（IPC 4 步同步铁律验证）
 *
 * 覆盖 1 个方法：
 * - token:cost-stats（1 个）— 成本透明
 *
 * 曾有第 3 组 subagent:list / subagent:reload（6 个用例），2026-10-25 随实现整删（#216）：
 * 那两把键渲染层零调用、界面上从来没有 Agent 列表，而 `loadCustomAgents` 唯一的读者就是它们，
 * 这 6 个用例测的就是那层包装本身——与下面第 4、5 组同一口径：包装没有执行体就不留。
 * - token:cost-stats（1 个）— 成本透明
 * - subagent:list / subagent:reload（2 个）— 自定义 Agent 加载器
 *
 * 曾有第 4 组 mode:list / mode:set-default / mode:get-current（8 个用例），
 * 2026-10-24 随实现整删：五模式既不注入 system prompt 也不拦工具，
 * 渲染层零调用，测试测的是一层没有执行体的包装。
 * 曾有第 5 组 provider:capabilities* / pricing*（8 个用例），同日同批整删（#210）：
 * 能力随 provider:list 带出、成本由主进程按定价表算好后经 token:cost-stats 回一个数，
 * 那四条通道只是同一份知识的第二个出口，而这 8 个用例测的就是那层包装本身。
 *
 * 测试策略（混合 Mock + 真实模块）：
 * - Mock electron（ipcMain.handle 捕获 + app.getAppPath）+ electron-store（logger 依赖）
 * - Mock IO 依赖模块：getCostStats / getProvider
 * - 每个测试用例独立隔离（beforeEach 清空 handlers map + 清空 Mock 调用记录）
 *
 * IPC 4 步同步铁律验证：
 * - 步骤 1：main 层 handler 已注册到 ipcMain.handle（通过 handlers map 捕获验证）
 * - 步骤 2：ipc/index.ts 已调用 registerXxxHandlers（通过 handlers map 非空验证）
 * - 步骤 3+4：preload 暴露 + electron.d.ts 类型声明由 typecheck:web 验证
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================================
// Mock：electron（ipcMain.handle 捕获 + app.getAppPath）
// ============================================================================

/**
 * 捕获 ipcMain.handle 注册的 handler（按 channel 索引）
 *
 * Electron 的 ipcMain.handle(channel, handler) 会将 handler 注册到内部 map。
 * 测试中通过此 map 直接调用 handler，绕过 Electron 的 IPC 机制。
 */
const handlers: Record<string, (...args: any[]) => any> = {}

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: any) => {
      handlers[channel] = handler
    },
  },
  app: {
    // subagent.ts 的 getDefaultAgentsDir() 使用 app.getAppPath() + '.tdsf/agent/'
    // 测试中返回固定路径（目录不存在，用于测试 subagent:reload 全部重载的目录不存在分支）
    getAppPath: () => '/tmp/test-app-path',
    getPath: () => '/tmp/test-userdata',
    isReady: () => true,
  },
}))

// ============================================================================
// Mock：electron-store（logger 间接依赖）
// ============================================================================

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

// ============================================================================
// Mock：IO 依赖模块（控制返回值，避免依赖文件系统 / electron-store 持久化状态）
// ============================================================================

// Mock token-stats 的 getCostStats（同步函数，控制返回值）
vi.mock('../../src/main/core/agent/providers/token-stats', () => ({
  getCostStats: vi.fn(),
}))

// Mock provider-registry 的 getProvider（同步函数，控制返回值）
vi.mock('../../src/main/core/agent/providers/provider-registry', () => ({
  getProvider: vi.fn(),
}))


// ============================================================================
// 导入被测模块（在 Mock 设置之后导入，确保 Mock 生效）
//
// mode:* 三通道与其 handlers 已于 2026-10-24 整删，本文件组 2 同步移除。
// ============================================================================

import { registerTokenCostStatsHandlers } from '../../src/main/ipc/token-stats'

// 导入 Mock 模块的引用（用于在测试中控制返回值）
import { getCostStats } from '../../src/main/core/agent/providers/token-stats'
import { getProvider } from '../../src/main/core/agent/providers/provider-registry'

// 导入类型
import type { CostStats } from '@shared/agent-types'

// ============================================================================
// Mock event（ipcMain.handle 的 handler 第一个参数是 IpcMainInvokeEvent）
// ============================================================================

/**
 * Mock 的 IpcMainInvokeEvent
 *
 * 大部分 handler 用 _event 接收但不使用，传 null 即可。
 * 为类型安全起见，使用 unknown 类型的 null。
 */
const mockEvent = null as unknown as Parameters<typeof handlers['token:cost-stats']>[0]

// ============================================================================
// 全局 setup：每个测试前重置状态 + 重新注册 handlers
// ============================================================================

beforeEach(() => {
  // 清空 handlers map（避免重复注册）
  for (const key of Object.keys(handlers)) {
    delete handlers[key]
  }

  // 注册组 1 的 IPC handler（捕获到 handlers map）
  registerTokenCostStatsHandlers()

  // 重置 Mock 函数（清除调用记录 + 重置实现为返回 undefined）
  vi.mocked(getCostStats).mockReset()
  vi.mocked(getProvider).mockReset()
})

// ============================================================================
// 组 1：token:cost-stats（成本透明）— 3 个测试
// ============================================================================

describe('[组 1] token:cost-stats IPC 通道', () => {
  it('1.1 通道已注册到 ipcMain.handle', () => {
    expect(handlers['token:cost-stats']).toBeDefined()
    expect(typeof handlers['token:cost-stats']).toBe('function')
  })

  it('1.2 返回 CostStats 结构（含所有必需字段）', async () => {
    const mockStats: CostStats = {
      todayCost: 0.5,
      weekCost: 3.2,
      monthCost: 12.8,
      totalCost: 45.6,
      bySubagent: { supervisor: 30.1, 'coding-subagent': 15.5 },
      byProvider: { 'deepseek-v4': 40.2, 'anthropic-claude': 5.4 },
    }
    vi.mocked(getCostStats).mockReturnValue(mockStats)

    const result = await handlers['token:cost-stats'](mockEvent)

    expect(result).toEqual(mockStats)
    expect(result.todayCost).toBe(0.5)
    expect(result.totalCost).toBe(45.6)
    expect(result.bySubagent).toHaveProperty('supervisor')
    expect(result.byProvider).toHaveProperty('deepseek-v4')
    expect(vi.mocked(getCostStats)).toHaveBeenCalledTimes(1)
  })

  it('1.3 getCostStats 抛错时 handler 抛出错误', async () => {
    vi.mocked(getCostStats).mockImplementation(() => {
      throw new Error('provider-registry not initialized')
    })

    await expect(handlers['token:cost-stats'](mockEvent)).rejects.toThrow(
      '获取成本统计失败'
    )
  })
})

