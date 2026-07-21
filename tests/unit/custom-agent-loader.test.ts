/**
 * 自定义 Agent 加载器单元测试（v0.9.4 批次 4 - 任务 3 测试）
 *
 * 覆盖 agent-loader.ts 的核心逻辑：
 * - FRONTMATTER_REGEX 正则匹配（合法/非法格式）
 * - parseYamlFrontmatter 简单 YAML 解析（key: value + 数组）
 * - loadCustomAgent 单文件加载（必填字段校验 + 异常处理）
 * - loadCustomAgents 目录批量加载（目录不存在 + 空 + 多文件 + 部分失败）
 *
 * 测试策略：
 * - 使用 os.tmpdir() 创建临时目录 + 临时文件（每个用例独立隔离）
 * - Mock electron + electron-store（logger 间接依赖）
 * - afterEach 清理临时文件
 *
 * 设计依据：v0.9.4 §11 第 4 类（Subagent 调度 3 项 - 任务 3）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'

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
// 导入被测模块
// ============================================================================
import {
  loadCustomAgent,
  loadCustomAgents,
  type CustomAgentConfig,
} from '../../src/main/core/agent/subagents/agent-loader'

// ============================================================================
// 测试工具：创建临时目录 + 临时文件
// ============================================================================

/** 临时目录路径（每个测试用例共享，afterEach 清理） */
let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loader-test-'))
})

afterEach(async () => {
  try {
    await fs.rm(tmpDir, { recursive: true, force: true })
  } catch {
    // 忽略清理失败
  }
})

/**
 * 在临时目录下创建 agent md 文件
 *
 * @param fileName 文件名（如 'linux-expert.md'）
 * @param content 文件内容（含 frontmatter + 正文）
 * @returns 文件绝对路径
 */
async function writeAgentFile(fileName: string, content: string): Promise<string> {
  const filePath = path.join(tmpDir, fileName)
  await fs.writeFile(filePath, content, 'utf8')
  return filePath
}

/**
 * 构造标准 agent md 内容
 */
function makeAgentContent(
  frontmatter: Record<string, string | string[]>,
  body = '你是 Linux 运维专家，特别擅长故障排查。'
): string {
  const lines: string[] = ['---']
  for (const [key, value] of Object.entries(frontmatter)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`)
      for (const item of value) {
        lines.push(`  - ${item}`)
      }
    } else {
      lines.push(`${key}: ${value}`)
    }
  }
  lines.push('---', '', body)
  return lines.join('\n')
}

// ============================================================================
// 测试用例
// ============================================================================

describe('[agent-loader] loadCustomAgent 单文件加载', () => {
  it('3.1 合法 frontmatter + 正文 → 成功加载', async () => {
    const filePath = await writeAgentFile(
      'linux-expert.md',
      makeAgentContent({
        name: 'linux-expert',
        displayName: 'Linux 专家',
        description: 'Linux 运维专家',
        tools: ['search', 'log', 'metric'],
      })
    )

    const config = await loadCustomAgent(filePath)

    expect(config).not.toBeNull()
    expect(config!.name).toBe('linux-expert')
    expect(config!.displayName).toBe('Linux 专家')
    expect(config!.description).toBe('Linux 运维专家')
    expect(config!.tools).toEqual(['search', 'log', 'metric'])
    expect(config!.systemPrompt).toContain('Linux 运维专家')
    expect(config!.systemPrompt).toContain('故障排查')
    expect(config!.sourceFile).toBe(filePath)
  })

  it('3.2 缺少 name 字段 → 返回 null', async () => {
    const filePath = await writeAgentFile(
      'no-name.md',
      makeAgentContent({
        displayName: 'No Name',
        description: '缺少 name',
      })
    )

    const config = await loadCustomAgent(filePath)
    expect(config).toBeNull()
  })

  it('3.3 缺少 displayName 字段 → 返回 null', async () => {
    const filePath = await writeAgentFile(
      'no-display.md',
      makeAgentContent({
        name: 'no-display',
        description: '缺少 displayName',
      })
    )

    const config = await loadCustomAgent(filePath)
    expect(config).toBeNull()
  })

  it('3.4 缺少 description 字段 → 返回 null', async () => {
    const filePath = await writeAgentFile(
      'no-desc.md',
      makeAgentContent({
        name: 'no-desc',
        displayName: 'No Desc',
      })
    )

    const config = await loadCustomAgent(filePath)
    expect(config).toBeNull()
  })

  it('3.5 文件不存在 → 返回 null（不抛错）', async () => {
    const nonExistentPath = path.join(tmpDir, 'does-not-exist.md')

    const config = await loadCustomAgent(nonExistentPath)
    expect(config).toBeNull()
  })

  it('3.6 文件无 frontmatter（缺 --- 分隔符）→ 返回 null', async () => {
    const filePath = await writeAgentFile(
      'no-frontmatter.md',
      '这是普通的 Markdown 内容，没有 frontmatter。'
    )

    const config = await loadCustomAgent(filePath)
    expect(config).toBeNull()
  })

  it('3.7 frontmatter 不带 tools 字段 → tools 默认为空数组', async () => {
    const filePath = await writeAgentFile(
      'no-tools.md',
      makeAgentContent({
        name: 'no-tools',
        displayName: 'No Tools',
        description: '无 tools 字段',
      })
    )

    const config = await loadCustomAgent(filePath)
    expect(config).not.toBeNull()
    expect(config!.tools).toEqual([])
  })

  it('3.8 frontmatter 含注释行 → 跳过注释', async () => {
    const content = [
      '---',
      '# 这是一个注释',
      'name: comment-test',
      'displayName: Comment Test',
      'description: 含注释的 agent',
      '---',
      '',
      '正文内容',
    ].join('\n')
    const filePath = await writeAgentFile('comment.md', content)

    const config = await loadCustomAgent(filePath)
    expect(config).not.toBeNull()
    expect(config!.name).toBe('comment-test')
    expect(config!.displayName).toBe('Comment Test')
    expect(config!.description).toBe('含注释的 agent')
  })

  it('3.9 单行 value 含空格 → 原样保留', async () => {
    const filePath = await writeAgentFile(
      'spaces.md',
      makeAgentContent({
        name: 'spaces-test',
        displayName: 'Has Multiple Spaces',
        description: 'value 含多个空格  不压缩',
      })
    )

    const config = await loadCustomAgent(filePath)
    expect(config).not.toBeNull()
    expect(config!.displayName).toBe('Has Multiple Spaces')
    expect(config!.description).toBe('value 含多个空格  不压缩')
  })

  it('3.10 正文为空 → systemPrompt 为空字符串', async () => {
    const content = [
      '---',
      'name: empty-body',
      'displayName: Empty Body',
      'description: 空正文',
      '---',
      '', // 正文为空
    ].join('\n')
    const filePath = await writeAgentFile('empty-body.md', content)

    const config = await loadCustomAgent(filePath)
    expect(config).not.toBeNull()
    expect(config!.systemPrompt).toBe('')
  })

  it('3.11 文件含 CRLF 换行 → 仍能正确解析', async () => {
    const content = [
      '---',
      'name: crlf-test',
      'displayName: CRLF Test',
      'description: CRLF 换行测试',
      '---',
      '',
      '正文',
    ].join('\r\n')
    const filePath = await writeAgentFile('crlf.md', content)

    const config = await loadCustomAgent(filePath)
    expect(config).not.toBeNull()
    expect(config!.name).toBe('crlf-test')
    expect(config!.displayName).toBe('CRLF Test')
  })
})

describe('[agent-loader] loadCustomAgents 目录批量加载', () => {
  it('3.12 目录不存在 → 返回空数组（不抛错）', async () => {
    const nonExistentDir = path.join(tmpDir, 'does-not-exist')

    const configs = await loadCustomAgents(nonExistentDir)
    expect(configs).toEqual([])
  })

  it('3.13 目录为空（无 .md 文件）→ 返回空数组', async () => {
    // 创建空目录
    const emptyDir = path.join(tmpDir, 'empty-dir')
    await fs.mkdir(emptyDir, { recursive: true })

    const configs = await loadCustomAgents(emptyDir)
    expect(configs).toEqual([])
  })

  it('3.14 多个合法 .md 文件 → 全部加载', async () => {
    await writeAgentFile(
      'agent1.md',
      makeAgentContent({
        name: 'agent-1',
        displayName: 'Agent 1',
        description: '第一个 agent',
      })
    )
    await writeAgentFile(
      'agent2.md',
      makeAgentContent({
        name: 'agent-2',
        displayName: 'Agent 2',
        description: '第二个 agent',
      })
    )

    const configs = await loadCustomAgents(tmpDir)

    expect(configs).toHaveLength(2)
    const names = configs.map((c) => c.name).sort()
    expect(names).toEqual(['agent-1', 'agent-2'])
  })

  it('3.15 部分文件解析失败 → 仅返回成功的', async () => {
    // 合法文件
    await writeAgentFile(
      'valid.md',
      makeAgentContent({
        name: 'valid',
        displayName: 'Valid',
        description: '合法 agent',
      })
    )
    // 非法文件（缺 name）
    await writeAgentFile(
      'invalid.md',
      makeAgentContent({
        displayName: 'Invalid',
        description: '缺 name 字段',
      })
    )

    const configs = await loadCustomAgents(tmpDir)

    expect(configs).toHaveLength(1)
    expect(configs[0].name).toBe('valid')
  })

  it('3.16 非 .md 文件（如 .txt）→ 跳过', async () => {
    await writeAgentFile(
      'agent.md',
      makeAgentContent({
        name: 'md-agent',
        displayName: 'MD Agent',
        description: 'Markdown 文件',
      })
    )
    // 创建 .txt 文件（应被忽略）
    await fs.writeFile(
      path.join(tmpDir, 'notes.txt'),
      '这是一个 txt 文件，不应被加载',
      'utf8'
    )

    const configs = await loadCustomAgents(tmpDir)

    expect(configs).toHaveLength(1)
    expect(configs[0].name).toBe('md-agent')
  })

  it('3.17 加载结果包含完整字段（sourceFile 为绝对路径）', async () => {
    const fileName = 'full.md'
    const filePath = await writeAgentFile(
      fileName,
      makeAgentContent({
        name: 'full-agent',
        displayName: 'Full Agent',
        description: '完整字段测试',
        tools: ['tool1', 'tool2'],
      })
    )

    const configs = await loadCustomAgents(tmpDir)

    expect(configs).toHaveLength(1)
    const config = configs[0]
    expect(config.name).toBe('full-agent')
    expect(config.displayName).toBe('Full Agent')
    expect(config.description).toBe('完整字段测试')
    expect(config.tools).toEqual(['tool1', 'tool2'])
    expect(config.systemPrompt).toBeTruthy()
    // sourceFile 应为完整路径
    expect(config.sourceFile).toBe(filePath)
    expect(path.isAbsolute(config.sourceFile)).toBe(true)
  })

  it('3.18 大写扩展名 .MD → 也能加载（大小写不敏感）', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'uppercase.MD'),
      makeAgentContent({
        name: 'uppercase-ext',
        displayName: 'Uppercase Ext',
        description: '大写扩展名',
      }),
      'utf8'
    )

    const configs = await loadCustomAgents(tmpDir)

    expect(configs).toHaveLength(1)
    expect(configs[0].name).toBe('uppercase-ext')
  })
})
