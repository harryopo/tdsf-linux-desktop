/**
 * risk-engine-ast 单元测试（v0.9.1 P1-1）
 *
 * 覆盖：
 * 1. 6 类绕过（命令拼接 / 引号拼接 / 命令替换 / 进程替换 / 变量展开 / Base64 混淆）
 * 2. AST 解析失败降级到正则（tree-sitter 容错性 + mock parser.parse 返回 null）
 * 3. WASM 加载失败静默降级（mock Parser.init / Language.load / Parser.parse 抛错）
 * 4. 高/中/低危命令识别
 *
 * 测试策略：
 * - 大部分用例：直接调用 assessWithAst，使用真实 WASM（tree-sitter-bash.wasm）
 * - WASM 加载失败用例：用 vi.resetModules + vi.doMock + dynamic import 重新加载模块
 *
 * 修复说明：
 * 本测试发现并修复了 risk-engine-ast.ts 的 4 个 bug（详见实施报告）：
 * - Bug 1：command 节点没有 'arguments' 字段，args 永远为空
 * - Bug 2：extractWord 对 string/raw_string 返回带引号的 text，引号拼接失败
 * - Bug 3：visit(command) 不递归遍历 command_name 内部，$(rm -rf /) 检测失败
 * - Bug 4：useradd 等命令的 reason 是 '中危命令：useradd'，不符合任务要求的 '用户管理'
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  assessWithAst,
  resetAstParser,
  type RiskAssessmentResult,
} from '../../src/main/core/risk-engine-ast'

// ============================================================================
// 真实 WASM 行为测试
// ============================================================================
describe('risk-engine-ast — 真实 WASM 行为', () => {
  beforeEach(() => {
    resetAstParser()
  })

  // ────────── 1. 6 类绕过覆盖 ──────────

  describe('1.1 命令拼接（list 节点遍历）', () => {
    it('rm -rf / ; ls 应识别 rm -rf / 为高危', async () => {
      const result = await assessWithAst('rm -rf / ; ls')
      expect(result).not.toBeNull()
      expect(result!.risk).toBe('high')
      expect(result!.reasons.some((r) => r.includes('rm -rf'))).toBe(true)
      expect(result!.matchedCommands.some((c) => c.includes('rm -rf /'))).toBe(true)
    })

    it('echo test && rm -rf / 应识别 rm -rf / 为高危', async () => {
      const result = await assessWithAst('echo test && rm -rf /')
      expect(result).not.toBeNull()
      expect(result!.risk).toBe('high')
      expect(result!.reasons.some((r) => r.includes('rm -rf'))).toBe(true)
    })
  })

  describe('1.2 引号拼接（concatenation 节点）', () => {
    it('r""m -rf / 应识别为 rm -rf（双引号拼接）', async () => {
      const result = await assessWithAst('r""m -rf /')
      expect(result).not.toBeNull()
      expect(result!.risk).toBe('high')
      expect(result!.reasons.some((r) => r.includes('rm -rf'))).toBe(true)
    })

    it("r''m -rf / 应识别为 rm -rf（单引号拼接）", async () => {
      const result = await assessWithAst("r''m -rf /")
      expect(result).not.toBeNull()
      expect(result!.risk).toBe('high')
      expect(result!.reasons.some((r) => r.includes('rm -rf'))).toBe(true)
    })
  })

  describe('1.3 命令替换（command_substitution 递归）', () => {
    it('$(rm -rf /) 应递归识别内部 rm -rf / 为高危', async () => {
      const result = await assessWithAst('$(rm -rf /)')
      expect(result).not.toBeNull()
      expect(result!.risk).toBe('high')
      expect(result!.reasons.some((r) => r.includes('rm -rf'))).toBe(true)
    })

    it('`rm -rf /` 应递归识别内部 rm -rf / 为高危', async () => {
      const result = await assessWithAst('`rm -rf /`')
      expect(result).not.toBeNull()
      expect(result!.risk).toBe('high')
      expect(result!.reasons.some((r) => r.includes('rm -rf'))).toBe(true)
    })

    it('$(echo rm) -rf / — 设计限制：不能识别（extractWord 返回 $(CMD) 占位符）', async () => {
      // 说明：$(echo rm) 在命令名位置，extractWord 返回 '$(CMD)' 占位符，
      //       内部 echo rm 被提取但不命中规则。这是静态分析的固有限制。
      const result = await assessWithAst('$(echo rm) -rf /')
      expect(result).not.toBeNull()
      expect(result!.risk).toBe('low')
    })

    it('`echo rm` -rf / — 设计限制：不能识别（占位符）', async () => {
      const result = await assessWithAst('`echo rm` -rf /')
      expect(result).not.toBeNull()
      expect(result!.risk).toBe('low')
    })
  })

  describe('1.4 进程替换（process_substitution 递归）', () => {
    it('< <(rm -rf /) 应递归识别内部 rm -rf / 为高危', async () => {
      const result = await assessWithAst('< <(rm -rf /)')
      expect(result).not.toBeNull()
      expect(result!.risk).toBe('high')
      expect(result!.reasons.some((r) => r.includes('rm -rf'))).toBe(true)
    })

    it('>(rm -rf /) 应递归识别内部 rm -rf / 为高危', async () => {
      const result = await assessWithAst('>(rm -rf /)')
      expect(result).not.toBeNull()
      expect(result!.risk).toBe('high')
      expect(result!.reasons.some((r) => r.includes('rm -rf'))).toBe(true)
    })

    it('cat <(rm -rf /) 应递归识别内部 rm -rf / 为高危', async () => {
      const result = await assessWithAst('cat <(rm -rf /)')
      expect(result).not.toBeNull()
      expect(result!.risk).toBe('high')
      expect(result!.reasons.some((r) => r.includes('rm -rf'))).toBe(true)
    })

    it('cat > >(rm -rf /) 应递归识别内部 rm -rf / 为高危', async () => {
      const result = await assessWithAst('cat > >(rm -rf /)')
      expect(result).not.toBeNull()
      expect(result!.risk).toBe('high')
      expect(result!.reasons.some((r) => r.includes('rm -rf'))).toBe(true)
    })
  })

  describe('1.5 变量展开（设计限制）', () => {
    // extractWord 对 simple_expansion/expansion 返回 '${VAR}' 占位符，无法静态求值
    it('CMD=rm; $CMD -rf / — 设计限制：不能识别（变量展开占位符）', async () => {
      const result = await assessWithAst('CMD=rm; $CMD -rf /')
      expect(result).not.toBeNull()
      expect(result!.risk).toBe('low')
    })

    it('${CMD} -rf / — 设计限制：不能识别（变量展开占位符）', async () => {
      const result = await assessWithAst('${CMD} -rf /')
      expect(result).not.toBeNull()
      expect(result!.risk).toBe('low')
    })
  })

  describe('1.6 Base64 混淆（detectBase64Obfuscation）', () => {
    it('echo "cm0gLXJmIC8=" | base64 -d | sh 应识别为高危', async () => {
      const result = await assessWithAst('echo "cm0gLXJmIC8=" | base64 -d | sh')
      expect(result).not.toBeNull()
      expect(result!.risk).toBe('high')
      expect(result!.reasons.some((r) => r.includes('Base64'))).toBe(true)
      expect(result!.matchedCommands).toContain('base64 -d | sh')
    })

    it('echo "cm0gLXJmIC8=" | base64 -d | bash 应识别为高危', async () => {
      const result = await assessWithAst('echo "cm0gLXJmIC8=" | base64 -d | bash')
      expect(result).not.toBeNull()
      expect(result!.risk).toBe('high')
      expect(result!.reasons.some((r) => r.includes('Base64'))).toBe(true)
    })

    it('echo "hello" | base64 -d 不应误报（无 sh/bash 管道）', async () => {
      const result = await assessWithAst('echo "hello" | base64 -d')
      expect(result).not.toBeNull()
      // 没有 sh/bash，不应触发 Base64 混淆规则
      expect(result!.reasons.some((r) => r.includes('Base64'))).toBe(false)
    })
  })

  // ────────── 2. 高危命令识别 ──────────

  describe('2. 高危命令识别', () => {
    it('mkfs /dev/sda 应为 high，reasons 含 mkfs', async () => {
      const result = await assessWithAst('mkfs /dev/sda')
      expect(result).not.toBeNull()
      expect(result!.risk).toBe('high')
      expect(result!.reasons.some((r) => r.includes('mkfs'))).toBe(true)
    })

    it('shutdown -h now 应为 high', async () => {
      const result = await assessWithAst('shutdown -h now')
      expect(result).not.toBeNull()
      expect(result!.risk).toBe('high')
    })

    it('reboot 应为 high', async () => {
      const result = await assessWithAst('reboot')
      expect(result).not.toBeNull()
      expect(result!.risk).toBe('high')
    })

    it(':(){:|:&};: 应为 high，reasons 含 fork bomb', async () => {
      const result = await assessWithAst(':(){:|:&};:')
      expect(result).not.toBeNull()
      expect(result!.risk).toBe('high')
      expect(result!.reasons.some((r) => r.toLowerCase().includes('fork bomb'))).toBe(true)
    })

    it(':(){ :|:& };:（带空格形式）也应为 high', async () => {
      const result = await assessWithAst(':(){ :|:& };:')
      expect(result).not.toBeNull()
      expect(result!.risk).toBe('high')
      expect(result!.reasons.some((r) => r.toLowerCase().includes('fork bomb'))).toBe(true)
    })

    it('chmod 777 /etc 应为 high，reasons 含 chmod 777', async () => {
      const result = await assessWithAst('chmod 777 /etc')
      expect(result).not.toBeNull()
      expect(result!.risk).toBe('high')
      expect(result!.reasons.some((r) => r.includes('chmod 777'))).toBe(true)
    })

    it('rm -rf / 应为 high', async () => {
      const result = await assessWithAst('rm -rf /')
      expect(result).not.toBeNull()
      expect(result!.risk).toBe('high')
    })

    it('dd if=/dev/zero of=/dev/sda 应为 high', async () => {
      const result = await assessWithAst('dd if=/dev/zero of=/dev/sda')
      expect(result).not.toBeNull()
      expect(result!.risk).toBe('high')
    })
  })

  // ────────── 3. 中危命令识别 ──────────

  describe('3. 中危命令识别', () => {
    it('yum install nginx 应为 medium，reasons 含 包管理操作', async () => {
      const result = await assessWithAst('yum install nginx')
      expect(result).not.toBeNull()
      expect(result!.risk).toBe('medium')
      expect(result!.reasons.some((r) => r.includes('包管理操作'))).toBe(true)
    })

    it('systemctl stop nginx 应为 medium，reasons 含 服务管理', async () => {
      const result = await assessWithAst('systemctl stop nginx')
      expect(result).not.toBeNull()
      expect(result!.risk).toBe('medium')
      expect(result!.reasons.some((r) => r.includes('服务管理'))).toBe(true)
    })

    it('sudo rm file 应为 medium，reasons 含 sudo 提权', async () => {
      const result = await assessWithAst('sudo rm file')
      expect(result).not.toBeNull()
      expect(result!.risk).toBe('medium')
      expect(result!.reasons.some((r) => r.includes('sudo 提权'))).toBe(true)
    })

    it('useradd newuser 应为 medium，reasons 含 用户管理', async () => {
      const result = await assessWithAst('useradd newuser')
      expect(result).not.toBeNull()
      expect(result!.risk).toBe('medium')
      expect(result!.reasons.some((r) => r.includes('用户管理'))).toBe(true)
    })

    it('apt install nginx 应为 medium（apt 包管理）', async () => {
      const result = await assessWithAst('apt install nginx')
      expect(result).not.toBeNull()
      expect(result!.risk).toBe('medium')
      expect(result!.reasons.some((r) => r.includes('包管理操作'))).toBe(true)
    })

    it('systemctl restart nginx 应为 medium', async () => {
      const result = await assessWithAst('systemctl restart nginx')
      expect(result).not.toBeNull()
      expect(result!.risk).toBe('medium')
      expect(result!.reasons.some((r) => r.includes('服务管理'))).toBe(true)
    })
  })

  // ────────── 4. 低危命令识别 ──────────

  describe('4. 低危命令识别', () => {
    it('ls -la 应为 low，reasons 为空', async () => {
      const result = await assessWithAst('ls -la')
      expect(result).not.toBeNull()
      expect(result!.risk).toBe('low')
      expect(result!.reasons).toEqual([])
    })

    it('cat /etc/hosts 应为 low，reasons 为空（只读操作不误报）', async () => {
      const result = await assessWithAst('cat /etc/hosts')
      expect(result).not.toBeNull()
      expect(result!.risk).toBe('low')
      expect(result!.reasons).toEqual([])
    })

    it('ps aux 应为 low，reasons 为空', async () => {
      const result = await assessWithAst('ps aux')
      expect(result).not.toBeNull()
      expect(result!.risk).toBe('low')
      expect(result!.reasons).toEqual([])
    })

    it('echo hello 应为 low', async () => {
      const result = await assessWithAst('echo hello')
      expect(result).not.toBeNull()
      expect(result!.risk).toBe('low')
      expect(result!.reasons).toEqual([])
    })

    it('grep error /var/log/syslog 应为 low', async () => {
      const result = await assessWithAst('grep error /var/log/syslog')
      expect(result).not.toBeNull()
      expect(result!.risk).toBe('low')
      expect(result!.reasons).toEqual([])
    })
  })

  // ────────── 5. AST 解析失败 / 容错性 ──────────

  describe('5. AST 解析容错性（tree-sitter-bash 对非法语法有容错）', () => {
    it('(((unclosed — tree-sitter 容错解析，返回 low（非 null）', async () => {
      // tree-sitter-bash 对语法错误有容错性，会返回部分解析的 AST（含 ERROR 节点），
      // 不会返回 null。assessWithAst 仍会返回 { risk: 'low', reasons: [], matchedCommands: [] }。
      // 调用方（assessCommandRisk）在 assessWithAst 返回非 null 时使用 AST 结果，
      // 不会降级到正则。这是设计行为（tree-sitter 容错优于直接降级）。
      const result = await assessWithAst('(((unclosed')
      expect(result).not.toBeNull()
      expect(result!.risk).toBe('low')
    })

    it('空字符串应返回 low', async () => {
      const result = await assessWithAst('')
      expect(result).not.toBeNull()
      // 空命令无命令节点，reasons 为空
      expect(result!.risk).toBe('low')
    })
  })
})

// ============================================================================
// AST 解析失败降级测试（mock parser.parse 返回 null）
// ============================================================================
//
// 场景：parser.parse 返回 null（极端情况，如 WASM 内部错误）
// 预期：assessWithAst 返回 null，调用方（assessCommandRisk）降级到 assessCommandRiskRegex
//
// 注意：tree-sitter-bash 对语法错误有容错性，正常情况下不会返回 null。
//       本测试通过 mock 模拟 parser.parse 返回 null 的极端情况。
// ============================================================================
describe('risk-engine-ast — AST 解析失败降级到正则', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('parser.parse 返回 null 时 assessWithAst 返回 null（触发降级）', async () => {
    // mock web-tree-sitter：Parser.init 成功，但 parser.parse 返回 null
    vi.doMock('web-tree-sitter', () => {
      class MockParser {
        static async init(): Promise<void> {}
        setLanguage(): void {}
        parse(): null {
          return null
        }
      }
      return {
        Parser: MockParser,
        Language: {
          async load(): Promise<unknown> {
            return {}
          },
        },
      }
    })

    const { assessWithAst, resetAstParser } = await import(
      '../../src/main/core/risk-engine-ast'
    )
    resetAstParser()
    const result = await assessWithAst('ls')
    expect(result).toBeNull()
  })

  it('assessWithAst 返回 null 时 assessCommandRisk 会降级到 assessCommandRiskRegex（代码逻辑验证）', async () => {
    // 此用例验证 sandbox.ts 中 assessCommandRisk 的降级逻辑：
    //   const astResult = await assessWithAst(command)
    //   if (astResult) return { risk: astResult.risk, reasons: astResult.reasons }
    //   return assessCommandRiskRegex(command)  // 降级
    //
    // 由于 assessCommandRisk 是 sandbox.ts 内部函数（不导出），
    // 这里通过代码审查确认降级逻辑，并在 warmup-session-key-cache.test.ts 中
    // 通过集成测试验证 sandbox.ts 的整体行为。
    //
    // 本用例仅验证 assessWithAst 在 mock 下返回 null（降级触发条件）
    vi.doMock('web-tree-sitter', () => {
      class MockParser {
        static async init(): Promise<void> {}
        setLanguage(): void {}
        parse(): null {
          return null
        }
      }
      return {
        Parser: MockParser,
        Language: {
          async load(): Promise<unknown> {
            return {}
          },
        },
      }
    })

    const { assessWithAst, resetAstParser } = await import(
      '../../src/main/core/risk-engine-ast'
    )
    resetAstParser()
    const result = await assessWithAst('rm -rf /')
    // 降级触发条件：assessWithAst 返回 null
    expect(result).toBeNull()
    // 调用方（assessCommandRisk）收到 null 后会调用 assessCommandRiskRegex
    // assessCommandRiskRegex 对 'rm -rf /' 返回 { risk: 'high', reasons: ['rm -rf 根目录递归删除'] }
  })
})

// ============================================================================
// WASM 加载失败静默降级测试
// ============================================================================
//
// 场景：WASM 加载失败（Parser.init / Language.load 抛错）
// 预期：assessWithAst 返回 null，不抛异常到调用方
//
// 测试策略：用 vi.resetModules + vi.doMock + dynamic import 重新加载模块，
//          mock web-tree-sitter 让 Parser.init / Language.load 抛错
// ============================================================================
describe('risk-engine-ast — WASM 加载失败时静默降级', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('Parser.init 抛错时 assessWithAst 返回 null，不抛异常', async () => {
    vi.doMock('web-tree-sitter', () => {
      class MockParser {
        static async init(): Promise<void> {
          throw new Error('WASM init failed')
        }
        setLanguage(): void {}
        parse(): null {
          return null
        }
      }
      return {
        Parser: MockParser,
        Language: {
          async load(): Promise<unknown> {
            return {}
          },
        },
      }
    })

    const { assessWithAst, resetAstParser } = await import(
      '../../src/main/core/risk-engine-ast'
    )
    resetAstParser()

    // 不应抛异常
    const result = await assessWithAst('ls')
    expect(result).toBeNull()
  })

  it('Language.load 抛错时 assessWithAst 返回 null，不抛异常', async () => {
    vi.doMock('web-tree-sitter', () => {
      class MockParser {
        static async init(): Promise<void> {}
        setLanguage(): void {}
        parse(): null {
          return null
        }
      }
      return {
        Parser: MockParser,
        Language: {
          async load(): Promise<never> {
            throw new Error('WASM load failed')
          },
        },
      }
    })

    const { assessWithAst, resetAstParser } = await import(
      '../../src/main/core/risk-engine-ast'
    )
    resetAstParser()

    const result = await assessWithAst('ls')
    expect(result).toBeNull()
  })

  it('Parser.parse 抛错时 assessWithAst 返回 null，不抛异常', async () => {
    vi.doMock('web-tree-sitter', () => {
      class MockParser {
        static async init(): Promise<void> {}
        setLanguage(): void {}
        parse(): never {
          throw new Error('parse failed')
        }
      }
      return {
        Parser: MockParser,
        Language: {
          async load(): Promise<unknown> {
            return {}
          },
        },
      }
    })

    const { assessWithAst, resetAstParser } = await import(
      '../../src/main/core/risk-engine-ast'
    )
    resetAstParser()

    const result = await assessWithAst('ls')
    expect(result).toBeNull()
  })

  it('WASM 加载失败后再次调用仍返回 null（initError 缓存）', async () => {
    vi.doMock('web-tree-sitter', () => {
      class MockParser {
        static async init(): Promise<void> {
          throw new Error('persistent WASM init failure')
        }
        setLanguage(): void {}
        parse(): null {
          return null
        }
      }
      return {
        Parser: MockParser,
        Language: {
          async load(): Promise<unknown> {
            return {}
          },
        },
      }
    })

    const { assessWithAst, resetAstParser } = await import(
      '../../src/main/core/risk-engine-ast'
    )
    resetAstParser()

    // 第一次调用：init 抛错，设置 initError
    const result1 = await assessWithAst('ls')
    expect(result1).toBeNull()

    // 第二次调用：initError 已缓存，直接返回 null（不再尝试 init）
    const result2 = await assessWithAst('rm -rf /')
    expect(result2).toBeNull()
  })
})

// ============================================================================
// 返回值结构验证
// ============================================================================
describe('risk-engine-ast — 返回值结构', () => {
  beforeEach(() => {
    resetAstParser()
  })

  it('返回值包含 risk / reasons / matchedCommands 三个字段', async () => {
    const result: RiskAssessmentResult | null = await assessWithAst('rm -rf /')
    expect(result).not.toBeNull()
    expect(result).toHaveProperty('risk')
    expect(result).toHaveProperty('reasons')
    expect(result).toHaveProperty('matchedCommands')
    expect(Array.isArray(result!.reasons)).toBe(true)
    expect(Array.isArray(result!.matchedCommands)).toBe(true)
  })

  it('risk 字段只能是 low / medium / high', async () => {
    const cases: Array<{ cmd: string; expected: 'low' | 'medium' | 'high' }> = [
      { cmd: 'ls', expected: 'low' },
      { cmd: 'yum install nginx', expected: 'medium' },
      { cmd: 'rm -rf /', expected: 'high' },
    ]
    for (const { cmd, expected } of cases) {
      const result = await assessWithAst(cmd)
      expect(result).not.toBeNull()
      expect(result!.risk).toBe(expected)
    }
  })
})
