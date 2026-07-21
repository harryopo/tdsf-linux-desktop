/**
 * MCP Server Service 单元测试
 *
 * 验证要点：
 * - 单例模式正确
 * - 未启用时不启动（start() 直接返回）
 * - isRunning() 正确反映状态
 * - stop() 幂等
 *
 * 注：使用 vi.mock 避免传递性加载 @modelcontextprotocol/sdk 和 electron-store
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock @modelcontextprotocol/sdk（避免 zod 3.25+ 的 subpath 解析问题）
vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: vi.fn().mockImplementation(() => ({
    setRequestHandler: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined)
  }))
}))

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn()
}))

vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  CallToolRequestSchema: 'CallToolRequestSchema',
  ListToolsRequestSchema: 'ListToolsRequestSchema'
}))

// Mock vercel-ai-service（避免 chain 加载 zod 解析问题）
vi.mock('../../src/main/services/llm/vercel-ai-service', () => ({
  sshExecTool: { name: 'ssh_exec', description: 'mock', parameters: {} },
  knowledgeQueryTool: { name: 'knowledge_query', description: 'mock', parameters: {} },
  riskCheckTool: { name: 'risk_check', description: 'mock', parameters: {} }
}))

import { McpServerService } from '../../src/main/services/mcp/server'

describe('McpServerService 单元测试', () => {
  // ────────── 1. 单例模式 ──────────

  it('单例：getInstance 多次调用返回同一实例', () => {
    const a = McpServerService.getInstance({ enabled: false, port: 3107 })
    const b = McpServerService.getInstance()
    expect(a).toBe(b)
  })

  // ────────── 2. 未启用时不启动 ──────────

  it('未启用时 start() 不启动服务', async () => {
    const service = McpServerService.getInstance({ enabled: false, port: 3107 })
    await service.start()
    expect(service.isRunning()).toBe(false)
  })

  // ────────── 3. stop() 幂等 ──────────

  it('stop() 幂等（多次调用不抛错）', async () => {
    const service = McpServerService.getInstance({ enabled: false, port: 3107 })
    await expect(service.stop()).resolves.toBeUndefined()
    await expect(service.stop()).resolves.toBeUndefined()
  })

  // ────────── 4. isRunning 状态 ──────────

  it('isRunning() 默认返回 false', () => {
    const service = McpServerService.getInstance({ enabled: false, port: 3107 })
    // 未启动时应为 false
    expect(service.isRunning()).toBe(false)
  })
})
