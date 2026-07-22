/**
 * 任务记忆沉淀服务单测（P2-I）
 *
 * 覆盖 src/main/core/memory/task-sediment.ts 的核心场景：
 * - 成功路径：任务完成 → 双轨写入（知识库 + Markdown）
 * - 幂等性：同一 taskId 重复沉淀 → skip
 * - 降级路径：知识库写入失败 → 仅 Markdown
 * - 降级路径：知识库 + Markdown 均失败 → skipped
 * - AttentionTracker.reset() 调用验证
 * - lessons 启发式提取（失败步骤 + 错误指示词 + 超时 + token + attention errors）
 *
 * Mock 策略（vi.hoisted 确保 mock 对象在 vi.mock factory 中可访问）：
 * - electron + electron-store（logger 间接依赖 + getSedimentDir 路径解析）
 * - KnowledgeRepository（add/getById 返回可控）
 * - DatabaseManager.getInstance（返回 mock db）
 * - AttentionTracker 单例（reset 调用 spy）
 * - fs.promises（mkdir/access/appendFile/writeFile 模拟）
 *
 * 设计依据：P2-I 实现方案（task-sediment.ts）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { TaskProtocolContext } from '../../src/main/core/agent/subagents/task-protocol-types'

// ============================================================================
// vi.hoisted：声明所有 mock 对象（确保 vi.mock factory 中可访问）
// ============================================================================
const mocks = vi.hoisted(() => ({
  // fs.promises mock
  fs: {
    mkdir: vi.fn(async () => undefined),
    access: vi.fn(async () => {
      throw new Error('ENOENT')
    }),
    appendFile: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
  },
  // KnowledgeRepository 实例 mock
  knowledgeRepo: {
    add: vi.fn(() => true),
    getById: vi.fn((): unknown => null),
    update: vi.fn(() => true),
    delete: vi.fn(() => true),
    search: vi.fn(() => []),
    exportAll: vi.fn(() => []),
    incrementUseCount: vi.fn(),
    updateSuccessRate: vi.fn(),
    importEntries: vi.fn(() => 0),
    searchByVector: vi.fn(() => []),
  },
  // DatabaseManager.getInstance mock
  dbGetInstance: vi.fn(() => ({ __mock: true })),
  // AttentionTracker 单例 mock
  attentionTracker: {
    getCurrent: vi.fn(() => ({ since: Date.now() })),
    isEmpty: vi.fn(() => true),
    reset: vi.fn(),
    trackFiles: vi.fn(),
    trackCommands: vi.fn(),
    trackErrors: vi.fn(),
    trackKeywords: vi.fn(),
    getHistory: vi.fn(() => []),
    clear: vi.fn(),
    setAttention: vi.fn(),
  },
}))

// ============================================================================
// Mock：electron（getSedimentDir + logger 间接依赖）
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
// Mock：KnowledgeRepository（构造函数返回 mock 实例）
// ============================================================================
vi.mock('../../src/main/services/db/knowledge-repo', () => ({
  KnowledgeRepository: vi.fn(() => mocks.knowledgeRepo),
}))

// ============================================================================
// Mock：DatabaseManager.getInstance
// ============================================================================
vi.mock('../../src/main/services/db/database', () => ({
  DatabaseManager: {
    getInstance: mocks.dbGetInstance,
  },
}))

// ============================================================================
// Mock：AttentionTracker 单例
// ============================================================================
vi.mock('../../src/main/core/agent/attention-tracker', () => ({
  AttentionTracker: {
    getInstance: () => mocks.attentionTracker,
  },
}))

// ============================================================================
// Mock：fs.promises
// ============================================================================
vi.mock('node:fs', () => ({
  promises: mocks.fs,
}))

// ============================================================================
// 导入被测模块（必须在 mock 注册之后）
// ============================================================================
import { sedimentTaskMemory } from '../../src/main/core/memory/task-sediment'

// ============================================================================
// 工具函数
// ============================================================================
function makeCtx(overrides: Partial<TaskProtocolContext> = {}): TaskProtocolContext {
  return {
    taskId: 'task-test-001',
    subagentName: 'coding',
    input: '请帮我修复 nginx 启动失败的问题',
    completedSteps: [
      { step: 'validate-input', success: true, durationMs: 1 },
      { step: 'check-permission', success: true, durationMs: 1 },
      { step: 'return-result', success: true, durationMs: 1 },
    ],
    currentStep: 3,
    cancelled: false,
    startTime: Date.now() - 5000,
    output: 'nginx 配置已修复，systemctl restart nginx 成功',
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, cost: 0.001 },
    attention: {
      since: Date.now(),
      files: ['/etc/nginx/nginx.conf'],
      commands: ['systemctl restart nginx'],
      errors: ['nginx: config test failed'],
    },
    ...overrides,
  }
}

// ============================================================================
// 测试用例
// ============================================================================

describe('[P2-I task-sediment] sedimentTaskMemory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 重置默认 mock 行为
    mocks.knowledgeRepo.add.mockReturnValue(true)
    mocks.knowledgeRepo.getById.mockReturnValue(null)
    mocks.fs.mkdir.mockResolvedValue(undefined)
    mocks.fs.access.mockRejectedValue(new Error('ENOENT'))
    mocks.fs.appendFile.mockResolvedValue(undefined)
    mocks.fs.writeFile.mockResolvedValue(undefined)
    mocks.attentionTracker.reset.mockImplementation(() => undefined)
    mocks.dbGetInstance.mockReturnValue({ __mock: true })
  })

  it('1.1 成功路径：知识库 + Markdown 双轨写入（writtenTo=knowledge_repo）', async () => {
    const ctx = makeCtx()
    const result = await sedimentTaskMemory(ctx)

    expect(result.writtenTo).toBe('knowledge_repo')
    expect(result.sedimentId).toMatch(/^LRN-\d{8}-\d{3}$/)
    expect(result.lessons).toBeInstanceOf(Array)
    expect(result.attentionArchived).toBe(true)

    // 验证知识库写入
    expect(mocks.knowledgeRepo.add).toHaveBeenCalledTimes(1)
    const entry = mocks.knowledgeRepo.add.mock.calls[0][0]
    expect(entry.id).toBe('sediment-task-test-001')
    expect(entry.type).toBe('incident_case')
    expect(entry.title).toContain('自动沉淀')
    expect(entry.tags).toContain('auto-sediment')
    expect(entry.tags).toContain('success')

    // 验证 Markdown 写入
    expect(mocks.fs.mkdir).toHaveBeenCalledTimes(1)
    expect(mocks.fs.appendFile).toHaveBeenCalledTimes(1)
    const mdContent = mocks.fs.appendFile.mock.calls[0][1] as string
    expect(mdContent).toContain(result.sedimentId)
    expect(mdContent).toContain('coding')
    expect(mdContent).toContain('成功')

    // 验证 attention 归档
    expect(mocks.attentionTracker.reset).toHaveBeenCalledTimes(1)
  })

  it('1.2 幂等性：同一 taskId 已存在 + Markdown 失败 → writtenTo=skipped', async () => {
    // 知识库 getById 返回已存在 → add 返回 false（不会真正写入）
    mocks.knowledgeRepo.getById.mockReturnValue({
      id: 'sediment-task-duplicate',
      title: '[自动沉淀] 已存在',
    })
    mocks.knowledgeRepo.add.mockReturnValue(false)
    // Markdown 也失败（确保走 skipped 分支）
    mocks.fs.appendFile.mockRejectedValue(new Error('mock markdown fail'))

    const ctx = makeCtx({ taskId: 'task-duplicate' })
    const result = await sedimentTaskMemory(ctx)

    expect(result.writtenTo).toBe('skipped')
    expect(result.reason).toContain('已沉淀过')
  })

  it('1.3 降级路径：知识库写入失败 + Markdown 成功 → writtenTo=markdown_only', async () => {
    mocks.knowledgeRepo.getById.mockReturnValue(null)
    mocks.knowledgeRepo.add.mockReturnValue(false)
    mocks.fs.appendFile.mockResolvedValue(undefined)

    const ctx = makeCtx({ taskId: 'task-fail-kb' })
    const result = await sedimentTaskMemory(ctx)

    expect(result.writtenTo).toBe('markdown_only')
    expect(result.sedimentId).toMatch(/^LRN-\d{8}-\d{3}$/)
    expect(mocks.fs.appendFile).toHaveBeenCalledTimes(1)
  })

  it('1.4 降级路径：知识库 + Markdown 均失败 + getById 返回 null → writtenTo=skipped', async () => {
    mocks.knowledgeRepo.getById.mockReturnValue(null)
    mocks.knowledgeRepo.add.mockReturnValue(false)
    mocks.fs.appendFile.mockRejectedValue(new Error('mock fail'))

    const ctx = makeCtx({ taskId: 'task-fail-all' })
    const result = await sedimentTaskMemory(ctx)

    expect(result.writtenTo).toBe('skipped')
    expect(result.reason).toContain('均写入失败')
  })

  it('1.5 降级路径：DatabaseManager.getInstance 抛错 → 知识库失败 → markdown_only', async () => {
    // DatabaseManager.getInstance 抛错
    mocks.dbGetInstance.mockImplementation(() => {
      throw new Error('DatabaseManager 未就绪')
    })
    mocks.fs.appendFile.mockResolvedValue(undefined)

    const ctx = makeCtx({ taskId: 'task-db-throw' })
    const result = await sedimentTaskMemory(ctx)

    // writeToKnowledgeRepo 抛错 → false
    // 决定 writtenTo 时再次调用 getInstance 也抛错 → 走 catch 分支
    // markdown 成功 → markdown_only
    expect(result.writtenTo).toBe('markdown_only')
    expect(mocks.fs.appendFile).toHaveBeenCalledTimes(1)
  })

  it('1.6 AttentionTracker.reset 抛错 → attentionArchived=false 但沉淀仍成功', async () => {
    mocks.attentionTracker.reset.mockImplementation(() => {
      throw new Error('reset 失败')
    })

    const ctx = makeCtx()
    const result = await sedimentTaskMemory(ctx)

    expect(result.writtenTo).toBe('knowledge_repo')
    expect(result.attentionArchived).toBe(false)
  })

  it('2.1 lessons 提取：失败步骤 + 错误指示词 + 超时 + token + attention errors', async () => {
    const ctx = makeCtx({
      taskId: 'task-lessons',
      completedSteps: [
        { step: 'validate-input', success: true, durationMs: 1 },
        { step: 'check-permission', success: true, durationMs: 1 },
        { step: 'invoke-subagent', success: false, durationMs: 1, error: 'timeout' },
        { step: 'return-result', success: true, durationMs: 1 },
      ],
      output: 'Error: nginx failed to start, timeout',
      startTime: Date.now() - 120_000, // 120s > 60s 阈值
      usage: { inputTokens: 8000, outputTokens: 4000, totalTokens: 12_000, cost: 0.05 },
    })

    const result = await sedimentTaskMemory(ctx)

    // 应至少包含：失败步骤 + 错误指示词 + 超时 + token + attention errors
    expect(result.lessons.length).toBeGreaterThanOrEqual(4)
    expect(result.lessons.some((l) => l.includes('失败步骤'))).toBe(true)
    expect(result.lessons.some((l) => l.includes('错误指示词'))).toBe(true)
    expect(result.lessons.some((l) => l.includes('耗时较长'))).toBe(true)
    expect(result.lessons.some((l) => l.includes('Token 消耗较高'))).toBe(true)
    expect(result.lessons.some((l) => l.includes('涉及错误'))).toBe(true)
  })

  it('2.2 lessons 提取：成功任务无错误 → lessons 数量较少', async () => {
    const ctx = makeCtx({
      taskId: 'task-clean',
      completedSteps: [
        { step: 'validate-input', success: true, durationMs: 1 },
        { step: 'return-result', success: true, durationMs: 1 },
      ],
      output: 'success',
      startTime: Date.now() - 1000,
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, cost: 0.001 },
      attention: { since: Date.now() },
    })

    const result = await sedimentTaskMemory(ctx)

    // 成功 + 无错误指示词 + 短耗时 + 低 token + 无 attention errors
    expect(result.lessons.length).toBeLessThanOrEqual(1)
  })

  it('3.1 LRN 编号格式：LRN-YYYYMMDD-NNN', async () => {
    const ctx = makeCtx()
    const result = await sedimentTaskMemory(ctx)

    expect(result.sedimentId).toMatch(/^LRN-\d{4}\d{2}\d{2}-\d{3}$/)
  })

  it('3.2 LRN 编号递增：连续调用 NNN 递增', async () => {
    const ctx1 = makeCtx({ taskId: 'task-seq-1' })
    const ctx2 = makeCtx({ taskId: 'task-seq-2' })
    const ctx3 = makeCtx({ taskId: 'task-seq-3' })

    const r1 = await sedimentTaskMemory(ctx1)
    const r2 = await sedimentTaskMemory(ctx2)
    const r3 = await sedimentTaskMemory(ctx3)

    // 提取 NNN
    const seq1 = parseInt(r1.sedimentId.split('-')[2], 10)
    const seq2 = parseInt(r2.sedimentId.split('-')[2], 10)
    const seq3 = parseInt(r3.sedimentId.split('-')[2], 10)

    expect(seq2).toBe(seq1 + 1)
    expect(seq3).toBe(seq2 + 1)
  })

  it('4.1 知识库条目字段完整性验证', async () => {
    const ctx = makeCtx({
      taskId: 'task-fields',
      subagentName: 'explore',
      mode: 'deep',
      parentSessionId: 'parent-001',
    })
    await sedimentTaskMemory(ctx)

    const entry = mocks.knowledgeRepo.add.mock.calls[0][0]
    expect(entry.id).toBe('sediment-task-fields')
    expect(entry.type).toBe('incident_case')
    expect(entry.problem).toContain('explore')
    // commands 来自 attention.commands
    expect(entry.commands).toEqual(['systemctl restart nginx'])
    expect(entry.keywords.length).toBeGreaterThan(0)
    expect(entry.keywords).toContain('explore')
    expect(entry.keywords).toContain('deep')
    expect(entry.tags).toContain('auto-sediment')
    expect(entry.tags).toContain('subagent:explore')
    expect(entry.tags).toContain('mode:deep')
    expect(entry.tags).toContain('inherited')
    expect(entry.tags).toContain('success')
    expect(entry.successRate).toBe(1.0)
    expect(entry.useCount).toBe(1)
    expect(entry.createdAt).toBeTypeOf('number')
    expect(entry.updatedAt).toBeTypeOf('number')
  })

  it('4.2 失败任务 → successRate=0, tags 含 failure', async () => {
    const ctx = makeCtx({
      taskId: 'task-failed',
      completedSteps: [
        { step: 'validate-input', success: true, durationMs: 1 },
        { step: 'invoke-subagent', success: false, durationMs: 1, error: 'failed' },
        { step: 'return-result', success: true, durationMs: 1 },
      ],
    })
    await sedimentTaskMemory(ctx)

    const entry = mocks.knowledgeRepo.add.mock.calls[0][0]
    expect(entry.successRate).toBe(0.0)
    expect(entry.tags).toContain('failure')
    expect(entry.rootCause).toContain('失败步骤')
  })

  it('5.1 Markdown 首次写入：文件不存在 → 写入标题 + 追加条目', async () => {
    const ctx = makeCtx()
    await sedimentTaskMemory(ctx)

    // access 抛 ENOENT → writeFile 写标题 → appendFile 追加
    expect(mocks.fs.writeFile).toHaveBeenCalledTimes(1)
    expect(mocks.fs.appendFile).toHaveBeenCalledTimes(1)
    const header = mocks.fs.writeFile.mock.calls[0][1] as string
    expect(header).toContain('任务记忆沉淀')
    expect(header).toContain('自动生成')
  })

  it('5.2 Markdown 已存在：仅追加，不写标题', async () => {
    // 文件已存在 → access 不抛错
    mocks.fs.access.mockResolvedValue(undefined)

    const ctx = makeCtx()
    await sedimentTaskMemory(ctx)

    expect(mocks.fs.writeFile).not.toHaveBeenCalled()
    expect(mocks.fs.appendFile).toHaveBeenCalledTimes(1)
  })
})
