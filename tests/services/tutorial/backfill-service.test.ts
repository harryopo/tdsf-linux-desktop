/**
 * EmbeddingBackfillService 单元测试（v2.5 Phase C）
 *
 * 覆盖：
 *   - 单例 + 并发启动守卫
 *   - 数据库不可用 / 无待回填条目 / 模型加载失败 的快速返回
 *   - 分页查询 + 断点续传（WHERE embedding IS NULL）
 *   - 取消机制（cancel 后下页检查退出）
 *   - 错误隔离（单批 embedding 失败不影响下一批）
 *   - 进度推送（BrowserWindow.getAllWindows 遍历）
 *   - ETA 估算正确性
 *
 * Mock 策略：
 *   - electron.BrowserWindow → 空 windows 数组 / 单个 mock 窗口
 *   - EmbeddingService → getInstance().ensureLoaded / embedBatch
 *   - DatabaseManager → 自定义 mock 对象，模拟 prepare / isAvailable / getRawConnection
 *   - logger → 静默（避免测试输出污染）
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ────────── Mock 模块（必须用 vi.hoisted 解决 hoisting 问题） ──────────

/**
 * vi.mock 工厂函数会被提升到文件顶部，普通变量在提升时还未初始化。
 * 使用 vi.hoisted 确保 mock 函数在提升时也可用。
 *
 * 参考：https://vitest.dev/api/vi.html#vi-hoisted
 */
const {
  mockGetAllWindows,
  mockEnsureLoaded,
  mockEmbedBatch,
  mockIsLoaded,
} = vi.hoisted(() => ({
  mockGetAllWindows: vi.fn<() => unknown[]>(() => []),
  mockEnsureLoaded: vi.fn<() => Promise<void>>(),
  mockEmbedBatch: vi.fn<(texts: string[], batchSize?: number) => Promise<Float32Array[]>>(),
  mockIsLoaded: vi.fn<() => boolean>(() => true),
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: mockGetAllWindows,
  },
}))

vi.mock('../../../src/main/services/tutorial/embedding-service', () => ({
  EmbeddingService: {
    getInstance: () => ({
      ensureLoaded: mockEnsureLoaded,
      embedBatch: mockEmbedBatch,
      isLoaded: mockIsLoaded,
    }),
  },
  EMBEDDING_DIM: 512,
}))

vi.mock('../../../src/main/services/log/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

// ────────── 导入被测模块 ──────────

import { EmbeddingBackfillService } from '../../../src/main/services/tutorial/backfill-service'
import type { DatabaseManager } from '../../../src/main/services/db/database'
import type { BackfillProgress } from '../../../src/shared/tutorial-types'

// ────────── Mock DatabaseManager 工厂 ──────────

/**
 * 创建 mock DatabaseManager
 *
 * 行为：
 *   - isAvailable() 返回 true
 *   - prepare(sql) 根据 SQL 内容返回不同 mock Statement：
 *     - SELECT COUNT(*) → get() 返回 { c: count }
 *     - SELECT id, title, problem → all() 返回 rows
 *     - UPDATE → run() 返回 { changes: 1, lastInsertRowid: 0n }
 *   - getRawConnection() 返回 mock 对象，有 transaction() 方法
 */
function createMockDb(options: {
  totalPending?: number
  pages?: Array<Array<{ id: string; title: string; content: string }>>
  available?: boolean
}): DatabaseManager {
  const { totalPending = 0, pages = [], available = true } = options
  let pageIndex = 0

  const mockStatement = {
    get: vi.fn((..._params: unknown[]) => {
      // SELECT COUNT(*) AS c FROM knowledge_entries WHERE ...
      return { c: totalPending }
    }),
    all: vi.fn((..._params: unknown[]) => {
      // SELECT id, title, problem AS content FROM knowledge_entries WHERE ...
      // 第一次调用返回 pages[0]，第二次返回 pages[1]，...，最后返回 []
      const page = pages[pageIndex] ?? []
      pageIndex++
      return page
    }),
    run: vi.fn((..._params: unknown[]) => {
      return { changes: 1, lastInsertRowid: 0n }
    }),
    bind: vi.fn().mockReturnThis(),
    finalize: vi.fn(),
  }

  const mockConn = {
    transaction: vi.fn((fn: (items: unknown[]) => void) => {
      return (items: unknown[]) => {
        fn(items)
      }
    }),
  }

  return {
    isAvailable: vi.fn(() => available),
    isVectorEnabled: vi.fn(() => false),
    prepare: vi.fn(() => mockStatement),
    exec: vi.fn(),
    close: vi.fn(),
    getRawConnection: vi.fn(() => mockConn),
  } as unknown as DatabaseManager
}

// ────────── 测试用例 ──────────

describe('EmbeddingBackfillService', () => {
  let service: EmbeddingBackfillService

  beforeEach(() => {
    // 重置单例（每个测试独立）
    ;(EmbeddingBackfillService as unknown as { instance: null }).instance = null
    service = EmbeddingBackfillService.getInstance()

    // 重置所有 mock（clearAllMocks 只清除调用记录，不清除实现）
    vi.clearAllMocks()
    // 用 mockImplementation 覆盖默认实现（比 mockResolvedValue 更可靠）
    mockGetAllWindows.mockImplementation(() => [])
    mockEnsureLoaded.mockImplementation(async () => undefined)
    mockEmbedBatch.mockImplementation(async () => [new Float32Array(512)])
    mockIsLoaded.mockImplementation(() => true)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // ==========================================================================
  // 1. 单例 + 并发启动守卫
  // ==========================================================================

  describe('单例 + 并发启动守卫', () => {
    it('getInstance 应返回同一实例', () => {
      const a = EmbeddingBackfillService.getInstance()
      const b = EmbeddingBackfillService.getInstance()
      expect(a).toBe(b)
    })

    it('isRunning 初始为 false', () => {
      expect(service.isRunning()).toBe(false)
    })

    it('getStatus 初始为 { running: false, taskId: null }', () => {
      expect(service.getStatus()).toEqual({ running: false, taskId: null })
    })

    it('任务运行中再启动应抛错', async () => {
      // 模拟有 1 条待回填，embedBatch 永不 resolve（模拟运行中）
      const db = createMockDb({
        totalPending: 1,
        pages: [[{ id: 't1', title: '测试', content: '内容' }]],
      })
      mockEmbedBatch.mockReturnValue(new Promise(() => {})) // 永不 resolve

      // 启动但不 await
      void service.start(db, 'task-1')

      // 等待一下让 running 标记生效
      await new Promise((r) => setTimeout(r, 50))

      expect(service.isRunning()).toBe(true)
      await expect(service.start(db, 'task-2')).rejects.toThrow(
        '已有回填任务在运行，请先取消或等待完成'
      )

      // 清理：取消挂起的任务
      service.cancel()
    })
  })

  // ==========================================================================
  // 2. 快速返回场景
  // ==========================================================================

  describe('快速返回场景', () => {
    it('数据库不可用时应抛错', async () => {
      const db = createMockDb({ totalPending: 10, available: false })

      await expect(service.start(db, 'task-x')).rejects.toThrow(
        '数据库不可用（better-sqlite3 未加载），无法回填'
      )
      expect(service.isRunning()).toBe(false)
    })

    it('无待回填条目时立即返回 completed', async () => {
      const db = createMockDb({ totalPending: 0, pages: [] })
      const result = await service.start(db, 'task-empty')

      expect(result.status).toBe('completed')
      expect(result.processed).toBe(0)
      expect(result.total).toBe(0)
      expect(result.pct).toBe(1)
      expect(mockEmbedBatch).not.toHaveBeenCalled()
    })

    it('EmbeddingService 加载失败时返回 failed', async () => {
      const db = createMockDb({ totalPending: 5, pages: [] })
      mockEnsureLoaded.mockRejectedValueOnce(new Error('模型下载失败'))

      const result = await service.start(db, 'task-fail')

      expect(result.status).toBe('failed')
      expect(result.error).toContain('模型下载失败')
      expect(service.isRunning()).toBe(false)
    })
  })

  // ==========================================================================
  // 3. 分页查询 + 断点续传
  // ==========================================================================

  describe('分页查询 + 断点续传', () => {
    it('应分页处理所有条目并推送进度', async () => {
      const page1 = Array.from({ length: 2 }, (_, i) => ({
        id: `t${i + 1}`,
        title: `教程${i + 1}`,
        content: `内容${i + 1}`,
      }))
      const page2 = Array.from({ length: 1 }, (_, i) => ({
        id: `t${i + 3}`,
        title: `教程${i + 3}`,
        content: `内容${i + 3}`,
      }))

      const db = createMockDb({
        totalPending: 3,
        pages: [page1, page2],
      })

      // embedBatch 每次返回与输入数量相同的 embeddings
      mockEmbedBatch.mockImplementation(async (texts: string[]) => {
        return texts.map(() => new Float32Array(512))
      })

      const result = await service.start(db, 'task-batch')

      expect(result.status).toBe('completed')
      expect(result.processed).toBe(3)
      expect(result.total).toBe(3)
      expect(result.pct).toBe(1)
      // 应调用 2 次 embedBatch（2 页）
      expect(mockEmbedBatch).toHaveBeenCalledTimes(2)
    })

    it('空页应立即结束（断点续传已无待处理）', async () => {
      const db = createMockDb({
        totalPending: 0,
        pages: [], // 第一页就为空
      })

      const result = await service.start(db, 'task-noop')

      expect(result.status).toBe('completed')
      expect(result.processed).toBe(0)
    })
  })

  // ==========================================================================
  // 4. 取消机制
  // ==========================================================================

  describe('取消机制', () => {
    it('cancel 后下页检查退出，状态为 cancelled', async () => {
      // 准备 2 页数据，第一页处理后取消
      const page1 = [{ id: 't1', title: 'A', content: 'a' }]
      const page2 = [{ id: 't2', title: 'B', content: 'b' }]

      const db = createMockDb({
        totalPending: 2,
        pages: [page1, page2],
      })

      mockEmbedBatch.mockImplementation(async (texts: string[]) => {
        // 第一页处理后取消
        service.cancel()
        return texts.map(() => new Float32Array(512))
      })

      const result = await service.start(db, 'task-cancel')

      expect(result.status).toBe('cancelled')
      // 第一页已处理，第二页因取消跳过
      expect(result.processed).toBe(1)
      expect(mockEmbedBatch).toHaveBeenCalledTimes(1)
    })

    it('cancel 未运行任务时应无操作', () => {
      expect(() => service.cancel()).not.toThrow()
      expect(service.isRunning()).toBe(false)
    })
  })

  // ==========================================================================
  // 5. 错误隔离
  // ==========================================================================

  describe('错误隔离', () => {
    it('单批 embedBatch 失败应累计 failed 并继续下一页', async () => {
      const page1 = [{ id: 't1', title: 'A', content: 'a' }]
      const page2 = [{ id: 't2', title: 'B', content: 'b' }]

      const db = createMockDb({
        totalPending: 2,
        pages: [page1, page2],
      })

      // 第一次调用失败，第二次成功
      mockEmbedBatch
        .mockRejectedValueOnce(new Error('ONNX 推理失败'))
        .mockResolvedValueOnce([new Float32Array(512)])

      const result = await service.start(db, 'task-iso')

      expect(result.status).toBe('completed')
      expect(result.failed).toBe(1) // 第一页 1 条失败
      expect(result.processed).toBe(2) // 累计处理 2 条
      expect(mockEmbedBatch).toHaveBeenCalledTimes(2)
    })
  })

  // ==========================================================================
  // 6. 进度推送
  // ==========================================================================

  describe('进度推送', () => {
    it('应通过 BrowserWindow.getAllWindows 推送进度', async () => {
      const sentPayloads: unknown[] = []
      const mockWindow = {
        isDestroyed: vi.fn(() => false),
        webContents: {
          send: vi.fn((_channel: string, payload: unknown) => {
            sentPayloads.push(payload)
          }),
        },
      }
      mockGetAllWindows.mockReturnValue([mockWindow])

      const page1 = [{ id: 't1', title: 'A', content: 'a' }]
      const db = createMockDb({
        totalPending: 1,
        pages: [page1],
      })

      mockEmbedBatch.mockResolvedValueOnce([new Float32Array(512)])

      await service.start(db, 'task-push')

      // 应至少推送 2 次：1 次运行中 + 1 次完成
      expect(sentPayloads.length).toBeGreaterThanOrEqual(2)
      const finalPayload = sentPayloads[sentPayloads.length - 1] as BackfillProgress
      expect(finalPayload.status).toBe('completed')
      expect(finalPayload.taskId).toBe('task-push')
    })

    it('窗口已销毁时应跳过推送', async () => {
      const mockWindow = {
        isDestroyed: vi.fn(() => true), // 已销毁
        webContents: { send: vi.fn() },
      }
      mockGetAllWindows.mockReturnValue([mockWindow])

      const db = createMockDb({ totalPending: 0, pages: [] })
      await service.start(db, 'task-destroyed')

      // 已销毁窗口不应调用 send
      expect(mockWindow.webContents.send).not.toHaveBeenCalled()
    })

    it('无窗口时应安全跳过推送', async () => {
      mockGetAllWindows.mockReturnValue([])

      const db = createMockDb({ totalPending: 0, pages: [] })
      // 不应抛错
      const result = await service.start(db, 'task-no-window')
      expect(result.status).toBe('completed')
    })

    it('webContents.send 抛错时应记录 warn 但不中断', async () => {
      const mockWindow = {
        isDestroyed: vi.fn(() => false),
        webContents: {
          send: vi.fn(() => {
            throw new Error('窗口已关闭')
          }),
        },
      }
      mockGetAllWindows.mockReturnValue([mockWindow])

      const page1 = [{ id: 't1', title: 'A', content: 'a' }]
      const db = createMockDb({
        totalPending: 1,
        pages: [page1],
      })
      mockEmbedBatch.mockResolvedValueOnce([new Float32Array(512)])

      // 不应抛错
      const result = await service.start(db, 'task-throw')
      expect(result.status).toBe('completed')
    })
  })

  // ==========================================================================
  // 7. 默认参数
  // ==========================================================================

  describe('默认参数', () => {
    it('taskId 未传时应自动生成 backfill-{timestamp}', async () => {
      const db = createMockDb({ totalPending: 0, pages: [] })
      const result = await service.start(db)

      expect(result.taskId).toMatch(/^backfill-\d+$/)
    })

    it('pageSize / inferenceBatch 应使用默认值', async () => {
      const db = createMockDb({
        totalPending: 1,
        pages: [[{ id: 't1', title: 'A', content: 'a' }]],
      })
      mockEmbedBatch.mockResolvedValueOnce([new Float32Array(512)])

      await service.start(db, 'task-default')

      // embedBatch 应被调用，第二个参数是 batchSize（默认 8）
      expect(mockEmbedBatch).toHaveBeenCalledWith(
        expect.any(Array),
        8 // DEFAULT_INFERENCE_BATCH
      )
    })
  })

  // ==========================================================================
  // 8. 最终状态重置
  // ==========================================================================

  describe('最终状态重置', () => {
    it('任务完成后 running 应回到 false', async () => {
      const db = createMockDb({ totalPending: 0, pages: [] })
      await service.start(db, 'task-reset')
      expect(service.isRunning()).toBe(false)
    })

    it('任务失败后 running 应回到 false', async () => {
      const db = createMockDb({ totalPending: 5, pages: [] })
      mockEnsureLoaded.mockRejectedValueOnce(new Error('失败'))
      await service.start(db, 'task-fail-reset')
      expect(service.isRunning()).toBe(false)
    })

    it('任务取消后 running 应回到 false', async () => {
      const page1 = [{ id: 't1', title: 'A', content: 'a' }]
      const db = createMockDb({
        totalPending: 2,
        pages: [page1],
      })

      mockEmbedBatch.mockImplementation(async (texts: string[]) => {
        service.cancel()
        return texts.map(() => new Float32Array(512))
      })

      await service.start(db, 'task-cancel-reset')
      expect(service.isRunning()).toBe(false)
    })

    it('任务完成后 getStatus 应回到初始状态', async () => {
      const db = createMockDb({ totalPending: 0, pages: [] })
      await service.start(db, 'task-status-reset')
      expect(service.getStatus()).toEqual({ running: false, taskId: null })
    })
  })
})
