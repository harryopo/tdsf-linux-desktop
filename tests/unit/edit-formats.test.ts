/**
 * Edit Format 多策略单元测试（v0.9.4 批次 3）
 *
 * 覆盖 3 项任务的核心逻辑：
 * 1. 任务 1：editblock 4 级匹配（exact / whitespace / fuzzy / most-similar）
 *    - levenshtein / diceCoefficient 工具函数
 *    - matchExact：精确匹配 + 空字符串 + 多行
 *    - matchWhitespaceInsensitive：缩进差异 + 行内多余空格
 *    - matchFuzzy：单字符差异 + 容差边界
 *    - matchMostSimilar：相似度阈值 + 重写场景
 *    - parseEditBlocks：标准格式 + 多块 + 宽松格式 + 未闭合
 *    - applyEditBlock：4 级降级链
 * 2. 任务 2：策略自动选择
 *    - 文件 ≤ 100 行 → whole-file
 *    - 改动 ≤ 50 行 → editblock
 *    - 改动 > 50 行 → udiff
 *    - llmPreference 覆盖
 *    - 边界：空文件 / 改动行数 ≥ 文件行数
 * 3. 任务 3：dirty commit 前置
 *    - parsePorcelainOutput：各种状态码解析
 *    - isClean：空列表 vs 非空列表
 *    - checkDirtyCommit：mock spawn（git 不可用 / 非 git 仓库 / 干净 / dirty）
 *
 * 测试策略：
 * - 不依赖真实 git 命令：mock child_process.spawn
 * - 纯函数测试为主，无外部依赖
 *
 * 设计依据：v0.9.4 §11 第 3 类 3 项
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ============================================================================
// 任务 1：editblock 4 级匹配
// ============================================================================
import {
  levenshtein,
  diceCoefficient,
  matchExact,
  matchWhitespaceInsensitive,
  matchFuzzy,
  matchMostSimilar,
  parseEditBlocks,
  applyEditBlock,
  type EditBlock,
} from '../../src/main/core/agent/edit-formats/editblock'

// ============================================================================
// 任务 2：策略自动选择
// ============================================================================
import {
  selectStrategy,
  WHOLE_FILE_THRESHOLD,
  EDITBLOCK_THRESHOLD,
  type StrategySelectionParams,
} from '../../src/main/core/agent/edit-formats/strategy-selector'

// ============================================================================
// 任务 3：dirty commit 前置
// ============================================================================
import {
  parsePorcelainOutput,
  isClean,
  checkDirtyCommit,
  GIT_STATUS_TIMEOUT_MS,
} from '../../src/main/core/agent/edit-formats/dirty-commit'

// Mock child_process.spawn（用于 dirty-commit 测试）
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}))

import { spawn } from 'child_process'

// ============================================================================
// 工具函数测试
// ============================================================================

describe('[editblock] levenshtein 编辑距离', () => {
  it('相同字符串返回 0', () => {
    expect(levenshtein('hello', 'hello')).toBe(0)
  })

  it('空字符串与有内容的距离等于有内容的长度', () => {
    expect(levenshtein('', 'abc')).toBe(3)
    expect(levenshtein('abc', '')).toBe(3)
  })

  it('单个字符差异返回 1', () => {
    expect(levenshtein('cat', 'bat')).toBe(1)
  })

  it('kitten → sitting 经典用例 = 3', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3)
  })

  it('保证 a/b 顺序无关', () => {
    expect(levenshtein('abc', 'xyz')).toBe(levenshtein('xyz', 'abc'))
  })
})

describe('[editblock] diceCoefficient 相似度', () => {
  it('相同字符串返回 1.0', () => {
    expect(diceCoefficient('hello', 'hello')).toBe(1.0)
  })

  it('完全不同字符串返回 0', () => {
    expect(diceCoefficient('abc', 'xyz')).toBe(0)
  })

  it('hello vs hallo 大于 0 小于 1', () => {
    const sim = diceCoefficient('hello', 'hallo')
    expect(sim).toBeGreaterThan(0)
    expect(sim).toBeLessThan(1)
  })

  it('长度 < 2 的字符串特殊处理', () => {
    expect(diceCoefficient('a', 'a')).toBe(1.0)
    expect(diceCoefficient('a', 'b')).toBe(0.0)
  })
})

// ============================================================================
// matchExact 测试
// ============================================================================

describe('[editblock] matchExact 精确匹配', () => {
  it('匹配成功：confidence=1.0，行号正确', () => {
    const content = 'line1\nline2\nline3\nline4'
    const search = 'line2\nline3'
    const result = matchExact(content, search)
    expect(result.matched).toBe(true)
    expect(result.strategy).toBe('exact')
    expect(result.confidence).toBe(1.0)
    expect(result.startLine).toBe(1)
    expect(result.endLine).toBe(2)
  })

  it('匹配失败：未找到 search', () => {
    const content = 'line1\nline2'
    const result = matchExact(content, 'not-exist')
    expect(result.matched).toBe(false)
    expect(result.startLine).toBe(-1)
    expect(result.endLine).toBe(-1)
    expect(result.failureReason).toContain('not found')
  })

  it('空 search 返回失败', () => {
    const result = matchExact('content', '')
    expect(result.matched).toBe(false)
    expect(result.failureReason).toContain('empty')
  })

  it('单行匹配：startLine === endLine', () => {
    const result = matchExact('a\nb\nc', 'b')
    expect(result.matched).toBe(true)
    expect(result.startLine).toBe(1)
    expect(result.endLine).toBe(1)
  })
})

// ============================================================================
// matchWhitespaceInsensitive 测试
// ============================================================================

describe('[editblock] matchWhitespaceInsensitive 去空白匹配', () => {
  it('缩进差异可匹配', () => {
    const content = '  line1\n\tline2\n    line3'
    const search = 'line1\nline2\nline3'
    const result = matchWhitespaceInsensitive(content, search)
    expect(result.matched).toBe(true)
    expect(result.strategy).toBe('whitespace-insensitive')
    expect(result.confidence).toBe(0.9)
    expect(result.startLine).toBe(0)
    expect(result.endLine).toBe(2)
  })

  it('行内多余空格可匹配', () => {
    const content = 'foo  bar\nbaz    qux'
    const search = 'foo bar\nbaz qux'
    const result = matchWhitespaceInsensitive(content, search)
    expect(result.matched).toBe(true)
  })

  it('exact 能匹配的 whitespace 也能匹配', () => {
    const content = 'line1\nline2'
    const result = matchWhitespaceInsensitive(content, 'line1')
    expect(result.matched).toBe(true)
    expect(result.startLine).toBe(0)
    expect(result.endLine).toBe(0)
  })

  it('内容完全不同时匹配失败', () => {
    const result = matchWhitespaceInsensitive('aaa\nbbb', 'xxx\nyyy')
    expect(result.matched).toBe(false)
    expect(result.failureReason).toContain('not found')
  })
})

// ============================================================================
// matchFuzzy 测试
// ============================================================================

describe('[editblock] matchFuzzy 模糊匹配', () => {
  it('单字符差异在容差内可匹配', () => {
    const content = 'hello world\nfoo bar'
    const search = 'hello worId\nfoo bar' // 'l' → 'I'
    const result = matchFuzzy(content, search, 2)
    expect(result.matched).toBe(true)
    expect(result.strategy).toBe('fuzzy')
    expect(result.confidence).toBeGreaterThan(0)
    expect(result.confidence).toBeLessThanOrEqual(1)
  })

  it('差异超过容差匹配失败', () => {
    const content = 'hello world'
    const search = 'completely different'
    const result = matchFuzzy(content, search, 2)
    expect(result.matched).toBe(false)
    expect(result.failureReason).toContain('tolerance')
  })

  it('容差 = 0 等同于精确匹配（行级）', () => {
    const content = 'exact line\nanother'
    const result = matchFuzzy(content, 'exact line', 0)
    expect(result.matched).toBe(true)
  })

  it('多行匹配：每行距离都 ≤ tolerance', () => {
    const content = 'abc\nxyz\npqr'
    const search = 'abd\nxyz\npqe' // 两行各差 1
    const result = matchFuzzy(content, search, 1)
    expect(result.matched).toBe(true)
    expect(result.startLine).toBe(0)
    expect(result.endLine).toBe(2)
  })
})

// ============================================================================
// matchMostSimilar 测试
// ============================================================================

describe('[editblock] matchMostSimilar 最相似匹配', () => {
  it('高相似度可匹配', () => {
    const content = 'function add(a, b) {\n  return a + b\n}'
    const search = 'function add(a, b) {\n  return a + c\n}' // 仅 1 字符差异
    const result = matchMostSimilar(content, search, 0.7)
    expect(result.matched).toBe(true)
    expect(result.strategy).toBe('most-similar')
    expect(result.confidence).toBeGreaterThan(0.7)
  })

  it('相似度低于阈值匹配失败', () => {
    const content = 'aaaaaaaaaa'
    const search = 'zzzzzzzzzz'
    const result = matchMostSimilar(content, search, 0.7)
    expect(result.matched).toBe(false)
    expect(result.failureReason).toContain('threshold')
  })

  it('完全相同 similarity=1.0', () => {
    const result = matchMostSimilar('hello\nworld', 'hello\nworld', 0.7)
    expect(result.matched).toBe(true)
    expect(result.confidence).toBe(1.0)
  })
})

// ============================================================================
// parseEditBlocks 测试
// ============================================================================

describe('[editblock] parseEditBlocks SEARCH/REPLACE 解析', () => {
  it('解析标准格式单个块', () => {
    const text = `前置文本
<<<<<<< SEARCH
old line
=======
new line
>>>>>>> REPLACE
后置文本`
    const blocks = parseEditBlocks(text)
    expect(blocks.length).toBe(1)
    expect(blocks[0].search).toBe('old line')
    expect(blocks[0].replace).toBe('new line')
  })

  it('解析多个块', () => {
    const text = `<<<<<<< SEARCH
old1
=======
new1
>>>>>>> REPLACE
中间文本
<<<<<<< SEARCH
old2
=======
new2
>>>>>>> REPLACE`
    const blocks = parseEditBlocks(text)
    expect(blocks.length).toBe(2)
    expect(blocks[0].search).toBe('old1')
    expect(blocks[1].search).toBe('old2')
  })

  it('多行 search/replace 内容', () => {
    const text = `<<<<<<< SEARCH
line1
line2
line3
=======
new1
new2
>>>>>>> REPLACE`
    const blocks = parseEditBlocks(text)
    expect(blocks.length).toBe(1)
    expect(blocks[0].search).toBe('line1\nline2\nline3')
    expect(blocks[0].replace).toBe('new1\nnew2')
  })

  it('宽松格式（不带 SEARCH/REPLACE 后缀）', () => {
    const text = `<<<<<<<
old
=======
new
>>>>>>>`
    const blocks = parseEditBlocks(text)
    expect(blocks.length).toBe(1)
    expect(blocks[0].search).toBe('old')
    expect(blocks[0].replace).toBe('new')
  })

  it('未闭合块被跳过（无 REPLACE 尾）', () => {
    const text = `<<<<<<< SEARCH
old
=======
new
没有 REPLACE 尾`
    const blocks = parseEditBlocks(text)
    expect(blocks.length).toBe(0)
  })

  it('无任何块返回空数组', () => {
    const text = '普通文本，无 SEARCH/REPLACE 块'
    const blocks = parseEditBlocks(text)
    expect(blocks.length).toBe(0)
  })

  it('空块（search 和 replace 都为空）被跳过', () => {
    const text = `<<<<<<< SEARCH
=======
>>>>>>> REPLACE`
    const blocks = parseEditBlocks(text)
    expect(blocks.length).toBe(0)
  })
})

// ============================================================================
// applyEditBlock 测试
// ============================================================================

describe('[editblock] applyEditBlock 主入口', () => {
  it('exact 匹配成功：直接替换', () => {
    const content = 'foo\nbar\nbaz'
    const block: EditBlock = { search: 'bar', replace: 'BAR' }
    const { newContent, result } = applyEditBlock(content, block)
    expect(result.matched).toBe(true)
    expect(result.strategy).toBe('exact')
    expect(newContent).toBe('foo\nBAR\nbaz')
  })

  it('exact 失败 → whitespace 匹配成功', () => {
    const content = '  foo  bar  \n\tbaz'
    const block: EditBlock = { search: 'foo bar\nbaz', replace: 'FOO BAR\nBAZ' }
    const { newContent, result } = applyEditBlock(content, block)
    expect(result.matched).toBe(true)
    expect(result.strategy).toBe('whitespace-insensitive')
    expect(newContent).toContain('FOO BAR')
    expect(newContent).toContain('BAZ')
  })

  it('4 级全部失败：返回原 content + matched=false', () => {
    const content = 'aaa\nbbb'
    const block: EditBlock = { search: 'xxx\nyyy', replace: 'XXX\nYYY' }
    const { newContent, result } = applyEditBlock(content, block)
    expect(result.matched).toBe(false)
    expect(result.failureReason).toContain('all 4 strategies failed')
    expect(newContent).toBe(content)
  })

  it('replace 为空 = 删除 search 内容', () => {
    const content = 'foo\nbar\nbaz'
    const block: EditBlock = { search: 'bar\n', replace: '' }
    const { newContent, result } = applyEditBlock(content, block)
    expect(result.matched).toBe(true)
    expect(newContent).toBe('foo\nbaz')
  })
})

// ============================================================================
// 任务 2：策略自动选择测试
// ============================================================================

describe('[strategy-selector] selectStrategy 策略自动选择', () => {
  it('文件 ≤ 100 行 → whole-file', () => {
    const params: StrategySelectionParams = {
      fileLines: 80,
      estimatedChangeLines: 5,
      isFirstEdit: false,
    }
    expect(selectStrategy(params)).toBe('whole-file')
  })

  it('文件 = 100 行（边界）→ whole-file', () => {
    const params: StrategySelectionParams = {
      fileLines: WHOLE_FILE_THRESHOLD,
      estimatedChangeLines: 10,
      isFirstEdit: false,
    }
    expect(selectStrategy(params)).toBe('whole-file')
  })

  it('文件 > 100 行 + 改动 ≤ 50 行 → editblock', () => {
    const params: StrategySelectionParams = {
      fileLines: 500,
      estimatedChangeLines: 30,
      isFirstEdit: false,
    }
    expect(selectStrategy(params)).toBe('editblock')
  })

  it('文件 > 100 行 + 改动 > 50 行 → udiff', () => {
    const params: StrategySelectionParams = {
      fileLines: 1000,
      estimatedChangeLines: 100,
      isFirstEdit: false,
    }
    expect(selectStrategy(params)).toBe('udiff')
  })

  it('llmPreference 覆盖所有规则', () => {
    const params: StrategySelectionParams = {
      fileLines: 50, // 本应 whole-file
      estimatedChangeLines: 5,
      isFirstEdit: false,
      llmPreference: 'udiff',
    }
    expect(selectStrategy(params)).toBe('udiff')
  })

  it('空文件（fileLines ≤ 0）→ whole-file', () => {
    const params: StrategySelectionParams = {
      fileLines: 0,
      estimatedChangeLines: 0,
      isFirstEdit: true,
    }
    expect(selectStrategy(params)).toBe('whole-file')
  })

  it('改动行数 ≥ 文件总行数 → whole-file（全量重写）', () => {
    const params: StrategySelectionParams = {
      fileLines: 200,
      estimatedChangeLines: 200, // 等于 fileLines
      isFirstEdit: false,
    }
    expect(selectStrategy(params)).toBe('whole-file')
  })

  it('改动 = 50 行（边界）→ editblock', () => {
    const params: StrategySelectionParams = {
      fileLines: 500,
      estimatedChangeLines: EDITBLOCK_THRESHOLD,
      isFirstEdit: false,
    }
    expect(selectStrategy(params)).toBe('editblock')
  })

  it('改动 = 51 行（边界外）→ udiff', () => {
    const params: StrategySelectionParams = {
      fileLines: 500,
      estimatedChangeLines: EDITBLOCK_THRESHOLD + 1,
      isFirstEdit: false,
    }
    expect(selectStrategy(params)).toBe('udiff')
  })
})

// ============================================================================
// 任务 3：dirty commit 前置测试
// ============================================================================

describe('[dirty-commit] parsePorcelainOutput 解析', () => {
  it('空输出返回空数组', () => {
    expect(parsePorcelainOutput('')).toEqual([])
  })

  it('解析 " M" 工作区修改', () => {
    const output = ' M src/index.ts\n M README.md'
    expect(parsePorcelainOutput(output)).toEqual(['src/index.ts', 'README.md'])
  })

  it('解析 "M " 已 staged', () => {
    expect(parsePorcelainOutput('M  src/index.ts')).toEqual(['src/index.ts'])
  })

  it('解析 "??" 未跟踪文件', () => {
    expect(parsePorcelainOutput('?? new-file.txt')).toEqual(['new-file.txt'])
  })

  it('解析 "R " 重命名取 dst 路径', () => {
    const output = 'R  old-name.ts -> new-name.ts'
    expect(parsePorcelainOutput(output)).toEqual(['new-name.ts'])
  })

  it('去除文件名引号', () => {
    const output = ' M "file with space.txt"'
    expect(parsePorcelainOutput(output)).toEqual(['file with space.txt'])
  })

  it('多状态混合解析', () => {
    const output = [
      ' M src/a.ts',
      'M  src/b.ts',
      '?? src/c.ts',
      'A  src/d.ts',
      'D  src/e.ts',
    ].join('\n')
    expect(parsePorcelainOutput(output)).toEqual([
      'src/a.ts',
      'src/b.ts',
      'src/c.ts',
      'src/d.ts',
      'src/e.ts',
    ])
  })
})

describe('[dirty-commit] isClean 便捷方法', () => {
  it('空列表 = clean', () => {
    expect(isClean([])).toBe(true)
  })

  it('非空列表 = dirty', () => {
    expect(isClean(['file.ts'])).toBe(false)
  })
})

describe('[dirty-commit] checkDirtyCommit 集成', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /**
   * 辅助函数：构造 mock spawn 返回
   */
  function mockSpawn(opts: {
    stdout?: string
    stderr?: string
    code?: number
    error?: Error
  }) {
    const listeners: Record<string, (...args: unknown[]) => void> = {}
    const child = {
      stdout: {
        on: (event: string, cb: (...args: unknown[]) => void) => {
          listeners.stdout = cb
        },
      },
      stderr: {
        on: (event: string, cb: (...args: unknown[]) => void) => {
          listeners.stderr = cb
        },
      },
      on: (event: string, cb: (...args: unknown[]) => void) => {
        listeners[event] = cb
      },
      kill: () => {},
    }
    vi.mocked(spawn).mockReturnValue(child as never)

    // 异步触发事件（模拟 child_process 异步行为）
    queueMicrotask(() => {
      if (opts.error) {
        listeners.error?.(opts.error)
      } else {
        if (opts.stdout) listeners.stdout?.(opts.stdout)
        if (opts.stderr) listeners.stderr?.(opts.stderr)
        listeners.close?.(opts.code ?? 0)
      }
    })

    return child
  }

  it('工作区干净（stdout 为空）→ allowEdit=true', async () => {
    mockSpawn({ stdout: '', code: 0 })
    const result = await checkDirtyCommit('/fake/repo')
    expect(result.allowEdit).toBe(true)
    expect(result.dirtyFiles).toEqual([])
  })

  it('有未提交文件 → allowEdit=false, suggestion=commit', async () => {
    mockSpawn({
      stdout: ' M src/index.ts\n?? README.md',
      code: 0,
    })
    const result = await checkDirtyCommit('/fake/repo')
    expect(result.allowEdit).toBe(false)
    expect(result.dirtyFiles).toEqual(['src/index.ts', 'README.md'])
    expect(result.suggestion).toBe('commit')
    expect(result.reason).toContain('dirty')
  })

  it('非 git 仓库（exit 128 + stderr）→ allowEdit=true, 跳过检查', async () => {
    mockSpawn({
      stdout: '',
      stderr: 'fatal: not a git repository',
      code: 128,
    })
    const result = await checkDirtyCommit('/fake/not-a-repo')
    expect(result.allowEdit).toBe(true)
    expect(result.reason).toContain('not a git repo')
    expect(result.dirtyFiles).toEqual([])
  })

  it('git 命令执行失败（error 事件）→ allowEdit=true, 跳过检查', async () => {
    mockSpawn({ error: new Error('spawn git ENOENT') })
    const result = await checkDirtyCommit('/fake/repo')
    expect(result.allowEdit).toBe(true)
    expect(result.reason).toContain('git not available')
    expect(result.dirtyFiles).toEqual([])
  })

  it('git status 失败（非 0 非 128）→ allowEdit=true, 跳过检查', async () => {
    mockSpawn({
      stdout: '',
      stderr: 'some other error',
      code: 1,
    })
    const result = await checkDirtyCommit('/fake/repo')
    expect(result.allowEdit).toBe(true)
    expect(result.reason).toContain('git status failed')
    expect(result.dirtyFiles).toEqual([])
  })

  it('GIT_STATUS_TIMEOUT_MS = 5000', () => {
    expect(GIT_STATUS_TIMEOUT_MS).toBe(5000)
  })
})
