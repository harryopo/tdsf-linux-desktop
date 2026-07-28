/**
 * Drain3 Bridge 单元测试
 *
 * 验证要点：
 * - 降级到本地正则（不依赖 Python 进程）
 * - 提取常见模式（IP/UUID/数字/时间戳）
 * - 异常情况安全（脚本不存在时不崩溃）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { existsSync } from 'fs'
import { resolve } from 'path'
import { Drain3Bridge, getDrain3Bridge } from '../../src/main/services/log/drain3-bridge'

describe('Drain3Bridge 单元测试', () => {
  // ────────── 1. 降级到本地正则 ──────────

  describe('降级到本地正则', () => {
    let bridge: Drain3Bridge

    beforeEach(() => {
      bridge = new Drain3Bridge()
    })

    it('未启动进程时直接降级到本地正则', async () => {
      const logLines = [
        '2024-01-15 10:30:45 [ERROR] User 12345 logged in from 192.168.1.1',
        '2024-01-15 10:30:46 [ERROR] User 67890 logged in from 192.168.1.2',
        '2024-01-15 10:30:47 [INFO] Server started on port 8080'
      ]
      const templates = await bridge.extractTemplates(logLines)
      expect(templates.length).toBeGreaterThan(0)
      // 模板应包含 <*> 占位符
      const allHaveWildcard = templates.every((t) =>
        t.template.includes('<*>') ||
        t.template.includes('<IP>') ||
        t.template.includes('<TIMESTAMP>') ||
        t.template.includes('<NUM>')
      )
      expect(allHaveWildcard).toBe(true)
    })

    it('相同模式的日志应合并为同一模板', async () => {
      const logLines = [
        'INFO User 100 logged in',
        'INFO User 200 logged in',
        'INFO User 300 logged in',
        'ERROR Database connection failed'
      ]
      const templates = await bridge.extractTemplates(logLines)
      // 应有 2 个模板（INFO 登录 + ERROR 数据库）
      expect(templates.length).toBe(2)
      // 计数最大的模板应为 INFO 登录（3 次）
      expect(templates[0].count).toBe(3)
    })

    it('空日志数组返回空模板列表', async () => {
      const templates = await bridge.extractTemplates([])
      expect(templates).toEqual([])
    })
  })

  // ────────── 2. Python 脚本路径检测 ──────────

  describe('Python 脚本路径', () => {
    it('脚本存在时 start() 不抛错（不存在时抛错）', async () => {
      const customBridge = new Drain3Bridge({
        scriptPath: 'D:/definitely/not/exists/drain3_bridge.py'
      })
      await expect(customBridge.start()).rejects.toThrow(/Drain3 脚本不存在/)
    })

    it('内置脚本文件存在（drain3_bridge.py）', () => {
      const scriptPath = resolve(__dirname, '../../src/main/services/log/drain3_bridge.py')
      expect(existsSync(scriptPath)).toBe(true)
    })
  })

  // ────────── 3. 单例模式 ──────────

  it('getDrain3Bridge 单例', () => {
    const a = getDrain3Bridge()
    const b = getDrain3Bridge()
    expect(a).toBe(b)
  })

  // ────────── 4. Python 脚本存在性降级（如果系统未安装 python） ──────────

  it('即使 Python 不可用，fallbackToRegex 仍能工作', async () => {
    const bridge = new Drain3Bridge({
      pythonPath: 'definitely-not-a-python-executable',
      scriptPath: 'D:/definitely/not/exists/drain3_bridge.py'
    })
    // start() 会失败，但 extractTemplates() 应自动降级
    const templates = await bridge.extractTemplates(['test line 1', 'test line 2'])
    expect(templates.length).toBeGreaterThan(0)
  })
})
