/**
 * Task Protocol 步骤 1-5 单元测试（v2.0 Phase D）
 *
 * 覆盖 task-protocol-steps-early.ts 的 5 个步骤函数：
 * - step 1: validate-input（校验 taskId / subagentName 非空字符串）
 * - step 2: check-permission（cancelled 状态检查 + 默认允许）
 * - step 3: load-subagent-config（registry 查找 / 内置兜底）
 * - step 4: derive-permissions（denyRules + inherited 标记）
 * - step 5: prepare-context（AttentionTracker + toolWhitelist）
 *
 * Mock 策略：
 * - electron + electron-store（logger 间接依赖）
 * - AttentionTracker 单例（避免依赖真实状态）
 * - task-protocol-helpers.createBuiltinRegistry（避免触发 createAllSubagents 完整依赖链）
 *   保留 log / readInputField / extractStringField 真实实现（纯函数）
 *
 * 设计依据：v2.0 Phase D（task-protocol-steps-early.ts §1-5）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { TaskProtocolContext } from '../../src/main/core/agent/subagents/task-protocol-types'
import type { Subagent, SubagentRegistry } from '../../src/main/core/agent/subagents/base'

// ============================================================================
// Mock：electron + electron-store（logger 间接依赖）
// ============================================================================
vi.mock('electron', () => ({
  app: {
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

// ============================================================================
// Mock：AttentionTracker 单例（避免依赖真实状态）
// ============================================================================
const mockAttentionTracker = {
  getCurrent: vi.fn(() => ({ since: Date.now() })),
  isEmpty: vi.fn(() => true),
}

vi.mock('../../src/main/core/agent/attention-tracker', () => ({
  AttentionTracker: {
    getInstance: () => mockAttentionTracker,
  },
}))

// ============================================================================
// Mock：task-protocol-helpers（替换 createBuiltinRegistry，保留纯函数）
// ============================================================================
const mockBuiltinRegistry: SubagentRegistry = {
  get: vi.fn(() => null),
  list: vi.fn(() => []),
}

vi.mock('../../src/main/core/agent/subagents/task-protocol-helpers', () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  readInputField: (input: unknown, field: string): unknown => {
    if (input && typeof input === 'object' && !Array.isArray(input)) {
      return (input as Record<string, unknown>)[field]
    }
    return undefined
  },
  extractStringField: (input: unknown, field: string): string | undefined => {
    if (input && typeof input === 'object' && !Array.isArray(input)) {
      const v = (input as Record<string, unknown>)[field]
      return typeof v === 'string' && v.length > 0 ? v : undefined
    }
    return undefined
  },
  createBuiltinRegistry: () => mockBuiltinRegistry,
}))

// ============================================================================
// 导入被测模块（必须在 mock 注册之后）
// ============================================================================
import {
  stepValidateInput,
  stepCheckPermission,
  stepLoadSubagentConfig,
  stepDerivePermissions,
  stepPrepareContext,
} from '../../src/main/core/agent/subagents/task-protocol-steps-early'

// ============================================================================
// 工具函数
// ============================================================================
function makeCtx(overrides: Partial<TaskProtocolContext> = {}): TaskProtocolContext {
  return {
    taskId: 'task-001',
    subagentName: 'coding',
    input: 'test input',
    completedSteps: [],
    currentStep: 0,
    cancelled: false,
    ...overrides,
  }
}

function makeSubagent(name: string): Subagent {
  return {
    name,
    displayName: `Display-${name}`,
    description: `Mock subagent ${name}`,
    async execute() {
      return { taskId: 'x', success: true, output: null, durationMs: 0 }
    },
  }
}

// ============================================================================
// 测试用例
// ============================================================================

describe('[task-protocol-step-1] validate-input', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('1.1 成功路径：taskId + subagentName 均合法 → success=true 并初始化 startTime', async () => {
    const ctx = makeCtx({ startTime: undefined })
    const result = await stepValidateInput(ctx)

    expect(result.success).toBe(true)
    expect(result.step).toBe('validate-input')
    expect(result.output).toEqual({
      taskId: 'task-001',
      subagentName: 'coding',
    })
    expect(ctx.startTime).toBeTypeOf('number')
    expect(ctx.startTime).toBeGreaterThan(0)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('1.2 失败路径：taskId 为空字符串 → success=false 且不初始化 startTime', async () => {
    const ctx = makeCtx({ taskId: '', startTime: undefined })
    const result = await stepValidateInput(ctx)

    expect(result.success).toBe(false)
    expect(result.step).toBe('validate-input')
    expect(result.error).toContain('taskId')
    expect(ctx.startTime).toBeUndefined()
  })

  it('1.3 失败路径：subagentName 为非字符串类型 → success=false', async () => {
    const ctx = makeCtx({ subagentName: 123 as unknown as string, startTime: undefined })
    const result = await stepValidateInput(ctx)

    expect(result.success).toBe(false)
    expect(result.error).toContain('subagentName')
  })

  it('1.4 边界：input 为 undefined/null 时仍通过（input 允许任意值）', async () => {
    for (const inputVal of [undefined, null, {}, [], 42, 'hello']) {
      const ctx = makeCtx({ input: inputVal, startTime: undefined })
      const result = await stepValidateInput(ctx)
      expect(result.success).toBe(true)
    }
  })

  it('1.5 边界：startTime 已存在时不被覆盖（保留调用方设置值）', async () => {
    const preset = 100000
    const ctx = makeCtx({ startTime: preset })
    const result = await stepValidateInput(ctx)

    expect(result.success).toBe(true)
    expect(ctx.startTime).toBe(preset)
  })
})

describe('[task-protocol-step-2] check-permission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('2.1 成功路径：cancelled=false 且未注入 mainWindow → 降级默认允许（source=default-allow-no-mainwindow）', async () => {
    const ctx = makeCtx({ cancelled: false })
    const result = await stepCheckPermission(ctx)

    expect(result.success).toBe(true)
    expect(result.step).toBe('check-permission')
    expect(result.output).toEqual({
      approved: true,
      source: 'default-allow-no-mainwindow',
      mode: 'always',
    })
  })

  it('2.2 失败路径：cancelled=true → success=false 且 error 提示已取消', async () => {
    const ctx = makeCtx({ cancelled: true })
    const result = await stepCheckPermission(ctx)

    expect(result.success).toBe(false)
    expect(result.step).toBe('check-permission')
    expect(result.error).toContain('cancelled')
    expect(result.error).toContain('取消')
  })

  it('2.3 边界：durationMs 字段始终为非负数字', async () => {
    const ctx = makeCtx()
    const result = await stepCheckPermission(ctx)
    expect(typeof result.durationMs).toBe('number')
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('2.4 边界：defaultPermission=auto → 自动允许（source=mode-auto，不依赖 mainWindow）', async () => {
    const ctx = makeCtx({ cancelled: false, defaultPermission: 'auto' })
    const result = await stepCheckPermission(ctx)

    expect(result.success).toBe(true)
    expect(result.output).toEqual({
      approved: true,
      source: 'mode-auto',
      mode: 'auto',
    })
  })

  it('2.5 失败路径：defaultPermission=never → 自动拒绝（不推送审批请求）', async () => {
    const ctx = makeCtx({ cancelled: false, defaultPermission: 'never' })
    const result = await stepCheckPermission(ctx)

    expect(result.success).toBe(false)
    expect(result.error).toContain('never')
    expect(result.error).toContain(ctx.subagentName)
  })
})

describe('[task-protocol-step-3] load-subagent-config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('3.1 成功路径：ctx.registry 注入且匹配 → 写入 subagentInstance + subagentMeta', async () => {
    const subagent = makeSubagent('coding')
    const registry: SubagentRegistry = {
      get: vi.fn((name: string) => (name === 'coding' ? subagent : null)),
      list: vi.fn(() => [subagent]),
    }
    const ctx = makeCtx({ subagentName: 'coding', registry })

    const result = await stepLoadSubagentConfig(ctx)

    expect(result.success).toBe(true)
    expect(result.step).toBe('load-subagent-config')
    expect(ctx.subagentInstance).toBe(subagent)
    expect(ctx.subagentMeta).toEqual({
      name: 'coding',
      displayName: 'Display-coding',
      description: 'Mock subagent coding',
      source: 'builtin',
    })
    expect(result.output).toHaveProperty('subagentName', 'coding')
    expect(result.output).toHaveProperty('displayName', 'Display-coding')
  })

  it('3.2 失败路径：subagentName 未在 registry 中找到 → success=false', async () => {
    const registry: SubagentRegistry = {
      get: vi.fn(() => null),
      list: vi.fn(() => []),
    }
    const ctx = makeCtx({ subagentName: 'unknown-agent', registry })

    const result = await stepLoadSubagentConfig(ctx)

    expect(result.success).toBe(false)
    expect(result.error).toContain('未在注册表中找到')
    expect(result.error).toContain('unknown-agent')
    expect(ctx.subagentInstance).toBeUndefined()
    expect(ctx.subagentMeta).toBeUndefined()
  })

  it('3.3 边界：ctx.registry 未注入时使用 createBuiltinRegistry 兜底', async () => {
    const subagent = makeSubagent('explore')
    mockBuiltinRegistry.get = vi.fn(() => subagent)
    mockBuiltinRegistry.list = vi.fn(() => [subagent])
    const ctx = makeCtx({ subagentName: 'explore' })
    // 不提供 ctx.registry，应触发 createBuiltinRegistry
    delete ctx.registry

    const result = await stepLoadSubagentConfig(ctx)

    expect(result.success).toBe(true)
    expect(mockBuiltinRegistry.get).toHaveBeenCalledWith('explore')
    expect(ctx.subagentInstance).toBe(subagent)
    expect(ctx.subagentMeta?.name).toBe('explore')
  })

  it('3.4 边界：内置 registry 也未找到时返回失败并提示可用列表', async () => {
    mockBuiltinRegistry.get = vi.fn(() => null)
    mockBuiltinRegistry.list = vi.fn(() => [makeSubagent('coding')])
    const ctx = makeCtx({ subagentName: 'nonexistent' })
    delete ctx.registry

    const result = await stepLoadSubagentConfig(ctx)

    expect(result.success).toBe(false)
    expect(result.error).toContain('nonexistent')
    // 错误信息中应包含可用列表
    expect(result.error).toContain('coding')
  })
})

describe('[task-protocol-step-4] derive-permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('4.1 成功路径：parentSessionId 存在 → inherited=true 且 denyRules 含交互工具', async () => {
    const ctx = makeCtx({ parentSessionId: 'parent-session-1' })

    const result = await stepDerivePermissions(ctx)

    expect(result.success).toBe(true)
    expect(result.step).toBe('derive-permissions')
    expect(ctx.derivedPermissions).toBeDefined()
    expect(ctx.derivedPermissions!.denyRules).toEqual([
      'question',
      'interactive_terminal',
    ])
    expect(ctx.derivedPermissions!.inherited).toBe(true)
    expect(ctx.derivedPermissions!.parentSessionId).toBe('parent-session-1')
    expect(ctx.derivedPermissions!.externalDirectory).toEqual([])
    expect(result.output).toMatchObject({
      inherited: true,
      denyRules: ['question', 'interactive_terminal'],
    })
  })

  it('4.2 边界：parentSessionId 未定义 → inherited=false', async () => {
    const ctx = makeCtx()
    delete ctx.parentSessionId

    const result = await stepDerivePermissions(ctx)

    expect(result.success).toBe(true)
    expect(ctx.derivedPermissions!.inherited).toBe(false)
    expect(ctx.derivedPermissions!.parentSessionId).toBeUndefined()
  })

  it('4.3 边界：parentSessionId 为 null → inherited=false（null 与 undefined 等同）', async () => {
    const ctx = makeCtx({ parentSessionId: undefined })
    // 模拟 null 情况：源码用 !== undefined && !== null，所以 null 也应判 false
    ;(ctx as { parentSessionId: string | null }).parentSessionId = null

    const result = await stepDerivePermissions(ctx)

    expect(result.success).toBe(true)
    expect(ctx.derivedPermissions!.inherited).toBe(false)
  })

  it('4.4 边界：denyRules 始终包含 question 和 interactive_terminal 两个工具', async () => {
    const ctx = makeCtx()
    await stepDerivePermissions(ctx)
    expect(ctx.derivedPermissions!.denyRules).toHaveLength(2)
    expect(ctx.derivedPermissions!.denyRules).toContain('question')
    expect(ctx.derivedPermissions!.denyRules).toContain('interactive_terminal')
  })
})

describe('[task-protocol-step-5] prepare-context', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('5.1 成功路径：attention 为空时 attentionContext="" 且 toolWhitelist 仍写入', async () => {
    mockAttentionTracker.isEmpty.mockReturnValue(true)
    mockAttentionTracker.getCurrent.mockReturnValue({ since: Date.now() })

    const ctx = makeCtx()
    const result = await stepPrepareContext(ctx)

    expect(result.success).toBe(true)
    expect(result.step).toBe('prepare-context')
    expect(ctx.attentionContext).toBe('')
    expect(ctx.toolWhitelist).toEqual([
      'search',
      'kb',
      'log',
      'metric',
      'history',
      'tutorial',
    ])
    expect(ctx.attention).toEqual({ since: expect.any(Number) })
    expect(result.output).toMatchObject({
      prepared: true,
      attentionEmpty: true,
      attentionContextLength: 0,
    })
  })

  it('5.2 成功路径：attention 含 files + commands → attentionContext 拼接正确', async () => {
    mockAttentionTracker.isEmpty.mockReturnValue(false)
    mockAttentionTracker.getCurrent.mockReturnValue({
      files: ['/etc/nginx/nginx.conf', '/var/log/nginx/error.log'],
      commands: ['systemctl status nginx'],
      errors: undefined,
      keywords: undefined,
      since: 12345,
    })

    const ctx = makeCtx()
    const result = await stepPrepareContext(ctx)

    expect(result.success).toBe(true)
    expect(ctx.attentionContext).toContain('关注文件')
    expect(ctx.attentionContext).toContain('/etc/nginx/nginx.conf')
    expect(ctx.attentionContext).toContain('/var/log/nginx/error.log')
    expect(ctx.attentionContext).toContain('关注命令')
    expect(ctx.attentionContext).toContain('systemctl status nginx')
    expect(result.output).toMatchObject({
      attentionEmpty: false,
      attentionContextLength: expect.any(Number),
    })
  })

  it('5.3 边界：attention 含 errors + keywords → attentionContext 含所有 4 类字段', async () => {
    mockAttentionTracker.isEmpty.mockReturnValue(false)
    mockAttentionTracker.getCurrent.mockReturnValue({
      files: [],
      commands: [],
      errors: ['nginx: config test failed'],
      keywords: ['nginx', '502'],
      since: 1,
    })

    const ctx = makeCtx()
    const result = await stepPrepareContext(ctx)

    expect(result.success).toBe(true)
    // 由于 source code 使用 `attention.files.length > 0`，空数组不会拼接对应字段
    // errors + keywords 字段应被拼接（非空数组）
    expect(ctx.attentionContext).toContain('关注错误')
    expect(ctx.attentionContext).toContain('nginx: config test failed')
    expect(ctx.attentionContext).toContain('关注关键词')
    expect(ctx.attentionContext).toContain('nginx')
    expect(ctx.attentionContext).toContain('502')
  })

  it('5.4 边界：toolWhitelist 始终为 6 个工具的只读集合', async () => {
    mockAttentionTracker.isEmpty.mockReturnValue(true)
    mockAttentionTracker.getCurrent.mockReturnValue({ since: 1 })

    const ctx = makeCtx()
    await stepPrepareContext(ctx)

    expect(ctx.toolWhitelist).toHaveLength(6)
    // 验证 subagent 默认工具集（不含 file.write 等写权限工具）
    expect(ctx.toolWhitelist).not.toContain('file.write')
    expect(ctx.toolWhitelist).not.toContain('shell.exec')
  })
})
