/**
 * Mode 注册表单元测试（v0.9.4 批次 3 - 任务 4）
 *
 * 覆盖 mode-registry.ts 的核心逻辑：
 * - MODE_CONFIGS 完整性：5 个模式均有配置
 * - getModeConfig：正确返回各模式配置
 * - isValidMode：类型守卫（合法/非法字符串）
 * - getAllowedTools：各模式工具白名单
 * - isToolAllowed：白名单包含 + '*' 通配
 * - getAllModes：返回所有模式
 * - DEFAULT_MODE = 'chat'
 * - 各模式的 canWriteFiles / canExecuteCommands / canModifySandbox 约束
 *
 * 设计依据：v0.9.4 §11 第 5 类（Mode 五模式）
 */
import { describe, it, expect } from 'vitest'
import {
  MODE_CONFIGS,
  getModeConfig,
  isValidMode,
  getAllowedTools,
  isToolAllowed,
  getAllModes,
  DEFAULT_MODE,
} from '../../src/main/core/agent/modes/mode-registry'
import type { AgentMode, ModeConfig } from '../../src/shared/agent-types'

// ============================================================================
// MODE_CONFIGS 完整性测试
// ============================================================================

describe('[mode-registry] MODE_CONFIGS 完整性', () => {
  it('包含全部 5 个模式', () => {
    const modes = Object.keys(MODE_CONFIGS)
    expect(modes).toHaveLength(5)
    expect(modes).toContain('chat')
    expect(modes).toContain('ask')
    expect(modes).toContain('plan')
    expect(modes).toContain('code')
    expect(modes).toContain('debug')
  })

  it('每个配置满足 ModeConfig 接口结构', () => {
    for (const config of Object.values(MODE_CONFIGS)) {
      expect(config).toHaveProperty('mode')
      expect(config).toHaveProperty('displayName')
      expect(config).toHaveProperty('systemPrompt')
      expect(config).toHaveProperty('allowedTools')
      expect(config).toHaveProperty('canWriteFiles')
      expect(config).toHaveProperty('canExecuteCommands')
      expect(config).toHaveProperty('canModifySandbox')
      expect(config).toHaveProperty('description')
      expect(Array.isArray(config.allowedTools)).toBe(true)
      expect(typeof config.systemPrompt).toBe('string')
      expect(config.systemPrompt.length).toBeGreaterThan(0)
    }
  })
})

// ============================================================================
// getModeConfig 测试
// ============================================================================

describe('[mode-registry] getModeConfig', () => {
  it('chat 模式返回正确配置', () => {
    const config = getModeConfig('chat')
    expect(config.mode).toBe('chat')
    expect(config.canWriteFiles).toBe(false)
    expect(config.canExecuteCommands).toBe(false)
  })

  it('code 模式允许写文件和执行命令', () => {
    const config = getModeConfig('code')
    expect(config.mode).toBe('code')
    expect(config.canWriteFiles).toBe(true)
    expect(config.canExecuteCommands).toBe(true)
  })

  it('ask 模式包含 file.read 工具', () => {
    const config = getModeConfig('ask')
    expect(config.allowedTools).toContain('file.read')
    expect(config.canWriteFiles).toBe(false)
  })

  it('plan 模式禁止写文件和执行命令', () => {
    const config = getModeConfig('plan')
    expect(config.canWriteFiles).toBe(false)
    expect(config.canExecuteCommands).toBe(false)
  })

  it('debug 模式包含 profiler 工具', () => {
    const config = getModeConfig('debug')
    expect(config.allowedTools).toContain('profiler')
    expect(config.canWriteFiles).toBe(false)
  })

  it('所有模式均不允许 canModifySandbox（保守设计）', () => {
    for (const config of Object.values(MODE_CONFIGS)) {
      expect(config.canModifySandbox).toBe(false)
    }
  })
})

// ============================================================================
// isValidMode 测试
// ============================================================================

describe('[mode-registry] isValidMode 类型守卫', () => {
  it('合法模式字符串返回 true', () => {
    expect(isValidMode('chat')).toBe(true)
    expect(isValidMode('ask')).toBe(true)
    expect(isValidMode('plan')).toBe(true)
    expect(isValidMode('code')).toBe(true)
    expect(isValidMode('debug')).toBe(true)
  })

  it('非法字符串返回 false', () => {
    expect(isValidMode('review')).toBe(false)
    expect(isValidMode('architect')).toBe(false)
    expect(isValidMode('')).toBe(false)
    expect(isValidMode('CHAT')).toBe(false) // 大小写敏感
    expect(isValidMode('chat ')).toBe(false) // 含空格
  })

  it('类型守卫正确缩窄类型', () => {
    const input: string = 'plan'
    if (isValidMode(input)) {
      // 这里 input 应被缩窄为 AgentMode
      const config: ModeConfig = getModeConfig(input)
      expect(config.mode).toBe('plan')
    } else {
      // 不应进入此分支
      expect.fail('should be valid mode')
    }
  })
})

// ============================================================================
// getAllowedTools / isToolAllowed 测试
// ============================================================================

describe('[mode-registry] getAllowedTools / isToolAllowed', () => {
  it('chat 模式工具白名单不包含 file.read', () => {
    const tools = getAllowedTools('chat')
    expect(tools).toContain('search')
    expect(tools).toContain('kb')
    expect(tools).not.toContain('file.read')
  })

  it('code 模式工具白名单为 ["*"]', () => {
    const tools = getAllowedTools('code')
    expect(tools).toEqual(['*'])
  })

  it('isToolAllowed：code 模式允许任何工具', () => {
    expect(isToolAllowed('code', 'file.write')).toBe(true)
    expect(isToolAllowed('code', 'sandbox-exec')).toBe(true)
    expect(isToolAllowed('code', 'anything-else')).toBe(true)
  })

  it('isToolAllowed：chat 模式只允许白名单内工具', () => {
    expect(isToolAllowed('chat', 'search')).toBe(true)
    expect(isToolAllowed('chat', 'file.write')).toBe(false)
    expect(isToolAllowed('chat', 'sandbox-exec')).toBe(false)
  })

  it('isToolAllowed：ask 模式允许 file.read', () => {
    expect(isToolAllowed('ask', 'file.read')).toBe(true)
    expect(isToolAllowed('ask', 'file.write')).toBe(false)
  })

  it('isToolAllowed：debug 模式允许 profiler', () => {
    expect(isToolAllowed('debug', 'profiler')).toBe(true)
    expect(isToolAllowed('debug', 'file.write')).toBe(false)
  })
})

// ============================================================================
// getAllModes / DEFAULT_MODE 测试
// ============================================================================

describe('[mode-registry] getAllModes / DEFAULT_MODE', () => {
  it('getAllModes 返回 5 个模式', () => {
    const modes = getAllModes()
    expect(modes).toHaveLength(5)
    expect(modes).toContain('chat')
    expect(modes).toContain('ask')
    expect(modes).toContain('plan')
    expect(modes).toContain('code')
    expect(modes).toContain('debug')
  })

  it('DEFAULT_MODE = "chat"', () => {
    expect(DEFAULT_MODE).toBe('chat')
  })

  it('DEFAULT_MODE 是合法 AgentMode', () => {
    expect(isValidMode(DEFAULT_MODE)).toBe(true)
  })
})

// ============================================================================
// 模式间权限差异矩阵（参考 Kilo Code §3.4）
// ============================================================================

describe('[mode-registry] 模式权限差异矩阵', () => {
  const matrix: Array<{
    mode: AgentMode
    canWrite: boolean
    canExec: boolean
    canModifySandbox: boolean
  }> = [
    { mode: 'chat', canWrite: false, canExec: false, canModifySandbox: false },
    { mode: 'ask', canWrite: false, canExec: false, canModifySandbox: false },
    { mode: 'plan', canWrite: false, canExec: false, canModifySandbox: false },
    { mode: 'code', canWrite: true, canExec: true, canModifySandbox: false },
    { mode: 'debug', canWrite: false, canExec: false, canModifySandbox: false },
  ]

  for (const { mode, canWrite, canExec, canModifySandbox } of matrix) {
    it(`${mode} 模式权限符合预期: write=${canWrite}, exec=${canExec}, sandbox=${canModifySandbox}`, () => {
      const config = getModeConfig(mode)
      expect(config.canWriteFiles).toBe(canWrite)
      expect(config.canExecuteCommands).toBe(canExec)
      expect(config.canModifySandbox).toBe(canModifySandbox)
    })
  }

  it('仅 code 模式允许写文件', () => {
    const writeModes = getAllModes().filter((m) => getModeConfig(m).canWriteFiles)
    expect(writeModes).toEqual(['code'])
  })

  it('仅 code 模式允许执行命令', () => {
    const execModes = getAllModes().filter((m) => getModeConfig(m).canExecuteCommands)
    expect(execModes).toEqual(['code'])
  })
})
