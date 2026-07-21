/**
 * warmupSessionKeyCache + sessionKeyMap 同步集成测试（P1-2）
 *
 * 覆盖 4 个场景：
 * 1. OpenHands 未启动时 warmupSessionKeyCache 静默失败（不抛异常 + sessionKeyMap 保持空）
 * 2. 成功遍历 searchSandboxes（混合状态沙箱，只缓存 RUNNING + key 非空）
 * 3. sandbox:create 与 sessionKeyMap 同步（key 缓存到主进程，返回值 redact 为 null）
 * 4. sandbox:delete 与 sessionKeyMap 同步（key 从主进程清理）
 *
 * 验证策略：
 * - 通过 sandbox:execute IPC handler 的 SESSION_KEY_MISSING 错误码间接验证 sessionKeyMap 状态
 *   （sessionKeyMap 是模块私有 Map，不导出，无法直接读取）
 * - 通过 sandbox:approve IPC handler 自动批准审批请求，让 executeCommand 被调用
 * - 通过 spy on client.executeCommand 验证 sessionApiKey 是否被正确传入
 *
 * 设计依据：
 * - P-4 句柄模式：session_api_key 不出主进程（sandbox.ts 第 79-93 行）
 * - warmupSessionKeyCache 是 P-4 恢复方案 A（sandbox.ts 第 322-369 行）
 * - sandbox:execute 在审批前检查 sessionKeyMap（sandbox.ts 第 610-619 行）
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SandboxInfo, SandboxPage } from '../../src/main/services/sandbox/types'

// ============================================================================
// vi.hoisted：声明所有 mock 对象（vi.mock 工厂函数需要引用这些对象）
// ============================================================================

const mocks = vi.hoisted(() => {
  /** 捕获 ipcMain.handle 注册的 handler（channel → handler） */
  const ipcHandlers = new Map<string, Function>()
  /** 模拟 BrowserWindow.webContents.send（捕获主→渲染推送事件） */
  const mockWebContentsSend = vi.fn()
  /** 模拟 OpenHandsClient.searchSandboxes */
  const mockSearchSandboxes = vi.fn()
  /** 模拟 OpenHandsClient.createSandbox */
  const mockCreateSandbox = vi.fn()
  /** 模拟 OpenHandsClient.deleteSandbox */
  const mockDeleteSandbox = vi.fn()
  /** 模拟 OpenHandsClient.executeCommand */
  const mockExecuteCommand = vi.fn()
  /** 模拟 OpenHandsClient.healthCheck */
  const mockHealthCheck = vi.fn()
  /** 模拟 assessWithAst（避免加载 WASM，加速测试） */
  const mockAssessWithAst = vi.fn()

  return {
    ipcHandlers,
    mockWebContentsSend,
    mockSearchSandboxes,
    mockCreateSandbox,
    mockDeleteSandbox,
    mockExecuteCommand,
    mockHealthCheck,
    mockAssessWithAst,
  }
})

// ============================================================================
// vi.mock：替换被测模块的依赖
// ============================================================================

// Mock electron：捕获 ipcMain.handle，提供 BrowserWindow mock
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Function) => {
      mocks.ipcHandlers.set(channel, handler)
    },
  },
  BrowserWindow: vi.fn(),
}))

// Mock OpenHandsClient：避免真实网络请求
vi.mock('../../src/main/services/sandbox/openhands-client', () => ({
  OpenHandsClient: vi.fn().mockImplementation(() => ({
    searchSandboxes: mocks.mockSearchSandboxes,
    createSandbox: mocks.mockCreateSandbox,
    deleteSandbox: mocks.mockDeleteSandbox,
    executeCommand: mocks.mockExecuteCommand,
    healthCheck: mocks.mockHealthCheck,
  })),
  // 保留 OpenHandsApiError 类（sandbox.ts 中用于 instanceof 判断）
  OpenHandsApiError: class OpenHandsApiError extends Error {
    readonly statusCode: number
    readonly code: 'NETWORK' | 'AUTH' | 'NOT_FOUND' | 'SERVER' | 'UNKNOWN'
    constructor(message: string, statusCode: number, code: 'NETWORK' | 'AUTH' | 'NOT_FOUND' | 'SERVER' | 'UNKNOWN') {
      super(message)
      this.name = 'OpenHandsApiError'
      this.statusCode = statusCode
      this.code = code
    }
  },
}))

// Mock ConfigStore：避免读取实际配置（sandbox.ts 第 252 行动态 require）
vi.mock('../../src/main/services/storage/config-store', () => ({
  ConfigStore: {
    get: vi.fn(() => undefined),
  },
}))

// Mock OpenHandsRunner：避免触发 Docker 命令
vi.mock('../../src/main/services/sandbox/openhands-runner', () => ({
  OpenHandsRunner: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    stop: vi.fn(),
  })),
}))

// Mock Docker 检测：固定返回已就绪
vi.mock('../../src/main/services/sandbox/docker-detector', () => ({
  detectDockerDesktop: vi.fn(async () => ({
    installed: true,
    version: '24.0',
    running: true,
    error: undefined,
  })),
}))

// Mock risk-engine-ast：避免加载 WASM（assessWithAst 同步返回 low 风险，触发 IPC handler 完整流程）
vi.mock('../../src/main/core/risk-engine-ast', () => ({
  assessWithAst: mocks.mockAssessWithAst,
}))

// ============================================================================
// 工具函数
// ============================================================================

/** 构造 SandboxInfo */
function makeSandbox(
  id: string,
  status: SandboxInfo['status'],
  sessionApiKey: string | null
): SandboxInfo {
  return {
    id,
    created_by_user_id: 'test-user',
    sandbox_spec_id: 'default',
    status,
    session_api_key: sessionApiKey,
    exposed_urls: null,
    created_at: '2026-07-19T00:00:00Z',
  }
}

/** 构造 SandboxPage */
function makePage(items: SandboxInfo[]): SandboxPage {
  return { items, next_page_id: null }
}

/** Mock BrowserWindow 对象（safeSend 调用 webContents.send） */
const mockBrowserWindow = {
  isDestroyed: () => false,
  webContents: { send: mocks.mockWebContentsSend },
}

/**
 * 辅助函数：调用 sandbox:execute 并自动批准审批请求
 *
 * 流程：
 * 1. 调用 sandbox:execute handler（返回 Promise，进入 waitForSandboxApproval）
 * 2. 等待 assessCommandRisk 完成（mockAssessWithAst 是 async）
 * 3. 从 mockWebContentsSend 捕获审批请求，提取 callId
 * 4. 调用 sandbox:approve handler 自动批准
 * 5. 等待 sandbox:execute Promise 解决，返回结果
 *
 * @param sandboxId 沙箱 ID
 * @param command 要执行的命令
 * @returns sandbox:execute 的最终返回值
 */
async function executeWithAutoApprove(
  sandboxId: string,
  command: string,
  executeResult: { stdout: string; stderr: string; exitCode: number }
): Promise<unknown> {
  const executeHandler = mocks.ipcHandlers.get('sandbox:execute')!
  const approveHandler = mocks.ipcHandlers.get('sandbox:approve')!

  // 记录调用前的推送调用数（避免取到旧 callId）
  const callsBefore = mocks.mockWebContentsSend.mock.calls.length

  // 1. 触发 sandbox:execute（返回 pending Promise）
  const executePromise = executeHandler({}, sandboxId, command)

  // 2. 等待 assessCommandRisk 完成 + safeSend 推送审批请求
  await new Promise((r) => setTimeout(r, 50))

  // 3. 从新增的推送调用中找到审批请求
  const allCalls = mocks.mockWebContentsSend.mock.calls
  const approvalCall = allCalls
    .slice(callsBefore)
    .find((c) => c[0] === 'sandbox:approval-request')
  if (!approvalCall) {
    throw new Error('未找到 sandbox:approval-request 推送事件')
  }
  const callId = (approvalCall[1] as { callId: string }).callId

  // 4. mock executeCommand 返回结果
  mocks.mockExecuteCommand.mockResolvedValueOnce(executeResult)

  // 5. 自动批准
  await approveHandler({}, callId, true)

  // 6. 等待 sandbox:execute 完成
  return executePromise
}

// ============================================================================
// 测试用例
// ============================================================================

describe('warmup-session-key-cache — P1-2 集成测试', () => {
  let warmupSessionKeyCache: () => Promise<void>
  let registerSandboxIpcHandlers: (mainWindow: unknown) => void

  beforeEach(async () => {
    // 清空所有 mock 调用记录
    vi.clearAllMocks()
    mocks.ipcHandlers.clear()

    // 默认让 assessWithAst 返回 low 风险（避免触发 WASM 加载）
    mocks.mockAssessWithAst.mockResolvedValue({
      risk: 'low',
      reasons: [],
      matchedCommands: [],
    })

    // 重置模块缓存：让 sandbox.ts 重新执行，sessionKeyMap 是 fresh 的
    vi.resetModules()
    const sandboxModule = await import('../../src/main/ipc/sandbox')
    warmupSessionKeyCache = sandboxModule.warmupSessionKeyCache
    registerSandboxIpcHandlers = sandboxModule.registerSandboxIpcHandlers

    // 注册 IPC handlers（捕获 sandbox:create / sandbox:execute / sandbox:delete / sandbox:approve）
    registerSandboxIpcHandlers(mockBrowserWindow)
  })

  // ----------------------------------------------------------------------
  // 场景 1：OpenHands 未启动静默失败
  // ----------------------------------------------------------------------
  describe('1. OpenHands 未启动静默失败', () => {
    it('searchSandboxes 抛 NETWORK 错误时，warmupSessionKeyCache 不抛异常', async () => {
      mocks.mockSearchSandboxes.mockRejectedValueOnce(
        new Error('connect ECONNREFUSED 127.0.0.1:3000')
      )

      // 关键断言：不抛异常，返回 undefined
      await expect(warmupSessionKeyCache()).resolves.toBeUndefined()
    })

    it('warmup 失败后 sessionKeyMap 为空，sandbox:execute 返回 SESSION_KEY_MISSING', async () => {
      mocks.mockSearchSandboxes.mockRejectedValueOnce(
        new Error('connect ECONNREFUSED 127.0.0.1:3000')
      )

      await warmupSessionKeyCache()

      // 通过 sandbox:execute 间接验证 sessionKeyMap 为空
      const executeHandler = mocks.ipcHandlers.get('sandbox:execute')!
      const result = await executeHandler({}, 'any-sandbox-id', 'ls')

      // v0.9.4 批次 1：sandbox:execute 错误响应新增 sessionId 字段（4 字段），改用 objectContaining 部分匹配
      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining('session_api_key 未找到'),
        code: 'SESSION_KEY_MISSING',
      })
    })
  })

  // ----------------------------------------------------------------------
  // 场景 2：成功遍历 searchSandboxes
  // ----------------------------------------------------------------------
  describe('2. 成功遍历 searchSandboxes', () => {
    it('warmupSessionKeyCache 调用 searchSandboxes(limit=100)', async () => {
      mocks.mockSearchSandboxes.mockResolvedValueOnce(makePage([]))

      await warmupSessionKeyCache()

      expect(mocks.mockSearchSandboxes).toHaveBeenCalledWith(100)
      expect(mocks.mockSearchSandboxes).toHaveBeenCalledTimes(1)
    })

    it('warmupSessionKeyCache 只缓存 RUNNING + key 非空的沙箱', async () => {
      // 构造 5 个沙箱：混合状态
      mocks.mockSearchSandboxes.mockResolvedValueOnce(
        makePage([
          makeSandbox('running-1', 'RUNNING', 'key-1'), // ✅ 应缓存
          makeSandbox('running-null', 'RUNNING', null), // ❌ key 为 null
          makeSandbox('starting-1', 'STARTING', 'key-2'), // ❌ 状态非 RUNNING
          makeSandbox('paused-1', 'PAUSED', 'key-3'), // ❌ 状态非 RUNNING
          makeSandbox('error-1', 'ERROR', 'key-4'), // ❌ 状态非 RUNNING
        ])
      )

      await warmupSessionKeyCache()

      // 通过 sandbox:execute 间接验证 sessionKeyMap 状态
      const executeHandler = mocks.ipcHandlers.get('sandbox:execute')!

      // running-1：key 已缓存，会进入审批流程（不会立即返回 SESSION_KEY_MISSING）
      // 用 executeWithAutoApprove 自动批准，验证 executeCommand 收到正确的 sessionApiKey
      const result = await executeWithAutoApprove('running-1', 'ls', {
        stdout: 'total 0',
        stderr: '',
        exitCode: 0,
      })
      expect(result).toEqual({
        stdout: 'total 0',
        stderr: '',
        exitCode: 0,
      })
      // 验证 executeCommand 收到了 warmup 缓存的 key-1
      expect(mocks.mockExecuteCommand).toHaveBeenCalledWith('running-1', 'ls', 'key-1')

      // running-null：原数据 key 为 null，warmup 没缓存，立即返回 SESSION_KEY_MISSING
      const result2 = await executeHandler({}, 'running-null', 'ls')
      expect(result2).toMatchObject({ code: 'SESSION_KEY_MISSING' })

      // starting-1：状态非 RUNNING，warmup 没缓存
      const result3 = await executeHandler({}, 'starting-1', 'ls')
      expect(result3).toMatchObject({ code: 'SESSION_KEY_MISSING' })

      // paused-1：状态非 RUNNING，warmup 没缓存
      const result4 = await executeHandler({}, 'paused-1', 'ls')
      expect(result4).toMatchObject({ code: 'SESSION_KEY_MISSING' })

      // error-1：状态非 RUNNING，warmup 没缓存
      const result5 = await executeHandler({}, 'error-1', 'ls')
      expect(result5).toMatchObject({ code: 'SESSION_KEY_MISSING' })
    })

    it('warmupSessionKeyCache 对空列表不报错', async () => {
      mocks.mockSearchSandboxes.mockResolvedValueOnce(makePage([]))

      await expect(warmupSessionKeyCache()).resolves.toBeUndefined()
    })
  })

  // ----------------------------------------------------------------------
  // 场景 3：sandbox:create 与 sessionKeyMap 同步
  // ----------------------------------------------------------------------
  describe('3. sandbox:create 与 sessionKeyMap 同步', () => {
    it('sandbox:create 返回值的 session_api_key 为 null（redact）', async () => {
      mocks.mockCreateSandbox.mockResolvedValueOnce(
        makeSandbox('sbx-new', 'RUNNING', 'secret-key-123')
      )

      const createHandler = mocks.ipcHandlers.get('sandbox:create')!
      const result = (await createHandler({}, undefined)) as SandboxInfo

      // 返回值 id 正确
      expect(result.id).toBe('sbx-new')
      // 返回值的 session_api_key 已被 redact 为 null（P-4 句柄模式）
      expect(result.session_api_key).toBeNull()
      // createSandbox 被正确调用
      expect(mocks.mockCreateSandbox).toHaveBeenCalledWith(undefined)
    })

    it('sandbox:create 后 key 已缓存到 sessionKeyMap（通过 sandbox:execute 验证）', async () => {
      mocks.mockCreateSandbox.mockResolvedValueOnce(
        makeSandbox('sbx-new', 'RUNNING', 'secret-key-123')
      )

      // 1. 调用 sandbox:create
      const createHandler = mocks.ipcHandlers.get('sandbox:create')!
      await createHandler({}, undefined)

      // 2. 通过 sandbox:execute 验证 key 已缓存到 sessionKeyMap
      const result = await executeWithAutoApprove('sbx-new', 'echo hello', {
        stdout: 'hello',
        stderr: '',
        exitCode: 0,
      })
      expect(result).toEqual({
        stdout: 'hello',
        stderr: '',
        exitCode: 0,
      })

      // 3. 验证 executeCommand 收到了 createSandbox 返回的 secret-key-123
      expect(mocks.mockExecuteCommand).toHaveBeenCalledWith(
        'sbx-new',
        'echo hello',
        'secret-key-123'
      )
    })
  })

  // ----------------------------------------------------------------------
  // 场景 4：sandbox:delete 与 sessionKeyMap 同步
  // ----------------------------------------------------------------------
  describe('4. sandbox:delete 与 sessionKeyMap 同步', () => {
    it('sandbox:delete 后 key 已从 sessionKeyMap 清理', async () => {
      // 1. 先 sandbox:create 把 key 加入 sessionKeyMap
      mocks.mockCreateSandbox.mockResolvedValueOnce(
        makeSandbox('sbx-del', 'RUNNING', 'secret-key-del')
      )
      const createHandler = mocks.ipcHandlers.get('sandbox:create')!
      await createHandler({}, undefined)

      // 2. 调用 sandbox:delete
      mocks.mockDeleteSandbox.mockResolvedValueOnce(undefined)
      const deleteHandler = mocks.ipcHandlers.get('sandbox:delete')!
      const deleteResult = await deleteHandler({}, 'sbx-del')

      // 3. 验证 delete 返回 success: true
      expect(deleteResult).toEqual({ success: true })
      expect(mocks.mockDeleteSandbox).toHaveBeenCalledWith('sbx-del')

      // 4. 验证 sessionKeyMap 已清理：sandbox:execute 应返回 SESSION_KEY_MISSING
      const executeHandler = mocks.ipcHandlers.get('sandbox:execute')!
      const execResult = await executeHandler({}, 'sbx-del', 'ls')
      expect(execResult).toMatchObject({ code: 'SESSION_KEY_MISSING' })
    })

    it('sandbox:delete 不存在的 sandboxId 不报错（即使 sessionKeyMap 没有该条目）', async () => {
      mocks.mockDeleteSandbox.mockResolvedValueOnce(undefined)

      const deleteHandler = mocks.ipcHandlers.get('sandbox:delete')!
      const result = await deleteHandler({}, 'never-existed')

      expect(result).toEqual({ success: true })
      expect(mocks.mockDeleteSandbox).toHaveBeenCalledWith('never-existed')
    })
  })
})
