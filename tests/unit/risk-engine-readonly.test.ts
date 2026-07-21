/**
 * risk-engine-readonly / risk-engine-ast-utils 单元测试（v0.9.4 批次 1）
 *
 * 覆盖：
 * 1. READONLY_BASH_COMMANDS（60+ 项白名单分类完整性）
 * 2. DANGEROUS_INJECTION_PATTERNS / detectInjectionPatterns（11+ 项注入防御）
 * 3. assessCommandCombination（多命令组合风险评估）
 * 4. assessWithAst 返回 approvalReason 字段（教学属性审批理由）
 * 5. AST 失败降级日志格式（[risk-engine-ast] ... fallback to regex）
 *
 * 设计依据：v0.9.4 批次 1 任务清单（5 项加固）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  READONLY_BASH_COMMANDS,
  DANGEROUS_INJECTION_PATTERNS,
  detectInjectionPatterns,
} from '../../src/main/core/risk-engine-readonly'
import { assessCommandCombination } from '../../src/main/core/risk-engine-ast-utils'
import { assessWithAst, resetAstParser } from '../../src/main/core/risk-engine-ast'

// ============================================================================
// 1. READONLY_BASH_COMMANDS（60+ 项白名单）
// ============================================================================

describe('READONLY_BASH_COMMANDS — 只读命令白名单', () => {
  it('白名单包含 ≥ 60 项只读命令', () => {
    expect(READONLY_BASH_COMMANDS.size).toBeGreaterThanOrEqual(60)
  })

  it('包含核心系统信息命令（uname / hostname / uptime / date / whoami / id）', () => {
    expect(READONLY_BASH_COMMANDS.has('uname')).toBe(true)
    expect(READONLY_BASH_COMMANDS.has('hostname')).toBe(true)
    expect(READONLY_BASH_COMMANDS.has('uptime')).toBe(true)
    expect(READONLY_BASH_COMMANDS.has('date')).toBe(true)
    expect(READONLY_BASH_COMMANDS.has('whoami')).toBe(true)
    expect(READONLY_BASH_COMMANDS.has('id')).toBe(true)
  })

  it('包含核心文件查看命令（ls / cat / less / more / head / tail / file / stat / wc）', () => {
    for (const cmd of ['ls', 'cat', 'less', 'more', 'head', 'tail', 'file', 'stat', 'wc']) {
      expect(READONLY_BASH_COMMANDS.has(cmd)).toBe(true)
    }
  })

  it('包含核心网络诊断命令（ping / traceroute / nslookup / dig / ip / netstat / ss）', () => {
    for (const cmd of ['ping', 'traceroute', 'nslookup', 'dig', 'ip', 'netstat', 'ss']) {
      expect(READONLY_BASH_COMMANDS.has(cmd)).toBe(true)
    }
  })

  it('包含核心进程查看命令（ps / top / pgrep / pstree）', () => {
    for (const cmd of ['ps', 'top', 'pgrep', 'pstree']) {
      expect(READONLY_BASH_COMMANDS.has(cmd)).toBe(true)
    }
  })

  it('包含核心文本工具（grep / sed / awk / cut / tr / sort / uniq）', () => {
    for (const cmd of ['grep', 'sed', 'awk', 'cut', 'tr', 'sort', 'uniq']) {
      expect(READONLY_BASH_COMMANDS.has(cmd)).toBe(true)
    }
  })

  it('包含核心查找工具（find / locate / which / whereis / type）', () => {
    for (const cmd of ['find', 'locate', 'which', 'whereis', 'type']) {
      expect(READONLY_BASH_COMMANDS.has(cmd)).toBe(true)
    }
  })

  it('不包含高危命令（rm / mkfs / shutdown / reboot）', () => {
    for (const cmd of ['rm', 'mkfs', 'shutdown', 'reboot', 'dd', 'killall']) {
      expect(READONLY_BASH_COMMANDS.has(cmd)).toBe(false)
    }
  })

  it('不包含中危命令（yum / apt / sudo / systemctl / useradd）', () => {
    for (const cmd of ['yum', 'apt', 'apt-get', 'dnf', 'sudo', 'systemctl', 'useradd', 'passwd']) {
      expect(READONLY_BASH_COMMANDS.has(cmd)).toBe(false)
    }
  })
})

// ============================================================================
// 2. DANGEROUS_INJECTION_PATTERNS / detectInjectionPatterns（11+ 项）
// ============================================================================

describe('DANGEROUS_INJECTION_PATTERNS — Shell 注入防御模式', () => {
  it('注入模式列表包含 ≥ 11 项', () => {
    expect(DANGEROUS_INJECTION_PATTERNS.length).toBeGreaterThanOrEqual(11)
  })

  it('覆盖任务要求的 11 类 shell 元字符', () => {
    const patterns = DANGEROUS_INJECTION_PATTERNS.map((p) => p.pattern)
    // 任务清单要求的 11 个模式
    expect(patterns).toContain('*\\n*')   // 换行注入
    expect(patterns).toContain('*|*')     // 管道注入
    expect(patterns).toContain('*$(*')    // 命令替换 $()
    expect(patterns).toContain('*`*')     // 反引号命令替换
    expect(patterns).toContain('*>*')     // 重定向覆盖
    expect(patterns).toContain('*;*')     // 分号串联
    expect(patterns).toContain('*&&*')    // 逻辑与串联
    expect(patterns).toContain('*||*')    // 逻辑或串联
    expect(patterns).toContain('*>&*')    // 文件描述符重定向
    expect(patterns).toContain('*<(*')    // 进程替换输入
    expect(patterns).toContain('*>(*')    // 进程替换输出
  })

  it('每个模式包含 pattern / regex / match / reason 字段', () => {
    for (const p of DANGEROUS_INJECTION_PATTERNS) {
      expect(typeof p.pattern).toBe('string')
      expect(typeof p.regex).toBe('string')
      expect(typeof p.match).toBe('function')
      expect(typeof p.reason).toBe('string')
      expect(p.reason.length).toBeGreaterThan(0)
    }
  })
})

describe('detectInjectionPatterns — 注入检测函数', () => {
  it('纯只读命令不命中任何注入模式', () => {
    expect(detectInjectionPatterns('ls -la')).toEqual([])
    expect(detectInjectionPatterns('cat /etc/hosts')).toEqual([])
    expect(detectInjectionPatterns('ps aux')).toEqual([])
    expect(detectInjectionPatterns('echo hello')).toEqual([])
  })

  it('换行符命令命中换行注入模式', () => {
    const hits = detectInjectionPatterns('ls\nrm -rf /')
    expect(hits.some((p) => p.pattern === '*\\n*')).toBe(true)
  })

  it('管道命令命中管道注入模式', () => {
    const hits = detectInjectionPatterns('cat file | grep foo')
    expect(hits.some((p) => p.pattern === '*|*')).toBe(true)
  })

  it('命令替换 $() 命中命令替换模式', () => {
    const hits = detectInjectionPatterns('echo $(whoami)')
    expect(hits.some((p) => p.pattern === '*$(*')).toBe(true)
  })

  it('反引号命令命中反引号模式', () => {
    const hits = detectInjectionPatterns('echo `whoami`')
    expect(hits.some((p) => p.pattern === '*`*')).toBe(true)
  })

  it('重定向 > 命中重定向覆盖模式', () => {
    const hits = detectInjectionPatterns('echo foo > /tmp/bar')
    expect(hits.some((p) => p.pattern === '*>*')).toBe(true)
  })

  it('分号串联命中分号模式', () => {
    const hits = detectInjectionPatterns('ls; rm -rf /')
    expect(hits.some((p) => p.pattern === '*;*')).toBe(true)
  })

  it('逻辑与 && 命中逻辑与模式', () => {
    const hits = detectInjectionPatterns('ls && rm -rf /')
    expect(hits.some((p) => p.pattern === '*&&*')).toBe(true)
  })

  it('逻辑或 || 命中逻辑或模式', () => {
    const hits = detectInjectionPatterns('false || rm -rf /')
    expect(hits.some((p) => p.pattern === '*||*')).toBe(true)
  })

  it('文件描述符重定向 >& 命中 >& 模式', () => {
    const hits = detectInjectionPatterns('ls >&2')
    expect(hits.some((p) => p.pattern === '*>&*')).toBe(true)
  })

  it('进程替换输入 <( 命中 <( 模式', () => {
    const hits = detectInjectionPatterns('diff <(ls a) <(ls b)')
    expect(hits.some((p) => p.pattern === '*<(*')).toBe(true)
  })

  it('进程替换输出 >( 命中 >( 模式', () => {
    const hits = detectInjectionPatterns('tee >(gzip > file.gz)')
    expect(hits.some((p) => p.pattern === '*>(*')).toBe(true)
  })

  it('复杂命令可命中多个注入模式', () => {
    const hits = detectInjectionPatterns('ls | grep foo; cat file > out.txt')
    expect(hits.length).toBeGreaterThanOrEqual(3)
    const patterns = hits.map((h) => h.pattern)
    expect(patterns).toContain('*|*')
    expect(patterns).toContain('*;*')
    expect(patterns).toContain('*>*')
  })
})

// ============================================================================
// 3. assessCommandCombination（多命令组合风险评估）
// ============================================================================

describe('assessCommandCombination — 多命令组合风险评估', () => {
  it('空命令列表返回 low 风险', () => {
    const result = assessCommandCombination([])
    expect(result.risk).toBe('low')
    expect(result.reasons).toEqual([])
    expect(result.upgraded).toBe(false)
  })

  it('单条只读命令返回 low 风险（不升级）', () => {
    const result = assessCommandCombination(['ls'])
    expect(result.risk).toBe('low')
    expect(result.upgraded).toBe(false)
  })

  it('数据外发链路（cat + mail）→ high 风险升级', () => {
    // cat /etc/passwd + grep root + mail x@y.com → 数据外发链路
    const result = assessCommandCombination(['cat', 'grep', 'mail'])
    expect(result.risk).toBe('high')
    expect(result.upgraded).toBe(true)
    expect(result.reasons.some((r) => r.includes('数据外发链路'))).toBe(true)
  })

  it('数据外发链路（cat + curl）→ high 风险升级', () => {
    const result = assessCommandCombination(['cat', 'curl'])
    expect(result.risk).toBe('high')
    expect(result.upgraded).toBe(true)
  })

  it('数据外发链路（cat + wget）→ high 风险升级', () => {
    const result = assessCommandCombination(['cat', 'wget'])
    expect(result.risk).toBe('high')
    expect(result.upgraded).toBe(true)
  })

  it('信息收集链路（whoami + id + uname + cat）→ medium 风险升级', () => {
    // whoami → id → uname -a → cat /etc/shadow 是信息收集链路
    const result = assessCommandCombination(['whoami', 'id', 'uname', 'cat'])
    expect(result.risk).toBe('medium')
    expect(result.upgraded).toBe(true)
    expect(result.reasons.some((r) => r.includes('信息收集链路'))).toBe(true)
  })

  it('纯侦察链路（whoami + id + uname + ifconfig）→ medium 风险升级', () => {
    const result = assessCommandCombination(['whoami', 'id', 'uname', 'ifconfig'])
    expect(result.risk).toBe('medium')
    expect(result.upgraded).toBe(true)
    expect(result.reasons.some((r) => r.includes('侦察行为'))).toBe(true)
  })

  it('命令数量 ≥ 5 触发风险升级（low → medium）', () => {
    // 5 条只读命令组合，不构成链路，但仍升级为 medium
    const result = assessCommandCombination(['ls', 'cat', 'grep', 'ps', 'who'])
    expect(result.risk).toBe('medium')
    expect(result.upgraded).toBe(true)
    expect(result.reasons.some((r) => r.includes('命令组合数量'))).toBe(true)
  })

  it('命令数量 < 5 不触发升级', () => {
    const result = assessCommandCombination(['ls', 'cat', 'grep', 'ps'])
    expect(result.risk).toBe('low')
    expect(result.upgraded).toBe(false)
  })

  it('数据外发链路优先级高于信息收集（high 而非 medium）', () => {
    // cat + mail 同时满足 hasSensitiveRead + hasExfil + reconCount
    // 应判为 high（数据外发优先）
    const result = assessCommandCombination(['whoami', 'id', 'uname', 'cat', 'mail'])
    expect(result.risk).toBe('high')
    expect(result.upgraded).toBe(true)
  })

  it('去重计数（同一命令多次出现仍计为一次）', () => {
    // 5 次 ls 仍只算 1 个 unique 命令，不触发阈值
    const result = assessCommandCombination(['ls', 'ls', 'ls', 'ls', 'ls'])
    expect(result.risk).toBe('low')
    expect(result.upgraded).toBe(false)
  })
})

// ============================================================================
// 4. assessWithAst 返回 approvalReason 字段（教学属性审批理由）
// ============================================================================

describe('assessWithAst — approvalReason 字段填充', () => {
  beforeEach(() => {
    resetAstParser()
  })

  it('high 风险命令填充 approvalReason（recommendation=deny）', async () => {
    const result = await assessWithAst('rm -rf /')
    expect(result).not.toBeNull()
    expect(result!.risk).toBe('high')
    expect(result!.approvalReason).toBeDefined()
    expect(result!.approvalReason!.riskLevel).toBe('high')
    expect(result!.approvalReason!.recommendation).toBe('deny')
    expect(result!.approvalReason!.action.length).toBeGreaterThan(0)
    expect(result!.approvalReason!.explanation.length).toBeGreaterThan(0)
  })

  it('medium 风险命令填充 approvalReason（recommendation=require-admin）', async () => {
    const result = await assessWithAst('yum install nginx')
    expect(result).not.toBeNull()
    expect(result!.risk).toBe('medium')
    expect(result!.approvalReason).toBeDefined()
    expect(result!.approvalReason!.riskLevel).toBe('medium')
    expect(result!.approvalReason!.recommendation).toBe('require-admin')
  })

  it('low 风险纯只读命令填充 approvalReason（recommendation=approve）', async () => {
    const result = await assessWithAst('ls -la')
    expect(result).not.toBeNull()
    expect(result!.risk).toBe('low')
    expect(result!.approvalReason).toBeDefined()
    expect(result!.approvalReason!.riskLevel).toBe('low')
    expect(result!.approvalReason!.recommendation).toBe('approve')
  })

  it('low 风险含注入字符命令不填充 approvalReason（交由 sandbox 审批）', async () => {
    // ls | grep foo：低风险但有管道，应走审批，不预填 approve
    const result = await assessWithAst('ls | grep foo')
    expect(result).not.toBeNull()
    expect(result!.risk).toBe('low')
    // 含管道字符，不应填充 approvalReason
    expect(result!.approvalReason).toBeUndefined()
  })

  it('mkfs 命令 approvalReason 的 explanation 提及 mkfs 危险性', async () => {
    const result = await assessWithAst('mkfs /dev/sda')
    expect(result).not.toBeNull()
    expect(result!.risk).toBe('high')
    expect(result!.approvalReason).toBeDefined()
    expect(result!.approvalReason!.explanation).toContain('mkfs')
  })

  it('chmod 777 命令 approvalReason 的 explanation 提及权限开放', async () => {
    const result = await assessWithAst('chmod 777 /etc')
    expect(result).not.toBeNull()
    expect(result!.approvalReason).toBeDefined()
    expect(result!.approvalReason!.explanation).toContain('chmod 777')
  })

  it('Base64 混淆命令 approvalReason 的 explanation 提及 Base64', async () => {
    const result = await assessWithAst('echo "cm0gLXJmIC8=" | base64 -d | sh')
    expect(result).not.toBeNull()
    expect(result!.risk).toBe('high')
    expect(result!.approvalReason).toBeDefined()
    expect(result!.approvalReason!.explanation).toContain('Base64')
  })

  it('sudo 命令 approvalReason 的 explanation 提及 sudo 提权', async () => {
    const result = await assessWithAst('sudo rm file')
    expect(result).not.toBeNull()
    expect(result!.risk).toBe('medium')
    expect(result!.approvalReason).toBeDefined()
    expect(result!.approvalReason!.explanation).toContain('sudo')
  })

  it('approvalReason 字段为可选（向后兼容）', async () => {
    // 验证 RiskAssessmentResult 类型中 approvalReason 是可选的
    const result = await assessWithAst('echo hello')
    expect(result).not.toBeNull()
    // approvalReason 可选；echo hello 是纯只读 → 会填充
    // 但验证字段存在不破坏现有调用方
    expect('approvalReason' in result!).toBe(true)
  })
})

// ============================================================================
// 5. AST 失败降级日志格式
// ============================================================================
//
// 注意：因为 vi.resetModules + vi.doMock + dynamic import 会重新加载
// risk-engine-ast.ts，新加载的模块会重新 import logger 模块，创建新的
// logger 实例。所以不能在测试外 spy 原 logger 实例。
// 解决方案：在 vi.doMock 中同时 mock logger 模块，传入 mock 的 warn 函数。
// ============================================================================

describe('assessWithAst — AST 失败降级日志格式', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('WASM 加载失败时输出 [risk-engine-ast] WASM load failed: ..., fallback to regex 日志', async () => {
    const warnCalls: Array<{ category: string; message: string }> = []

    // 同时 mock web-tree-sitter 和 logger，确保新加载的 risk-engine-ast
    // 引用的是 mock 后的 logger（同一实例）
    vi.doMock('web-tree-sitter', () => {
      class MockParser {
        static async init(): Promise<void> {
          throw new Error('WASM init failed: file not found')
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

    vi.doMock('../../src/main/services/log/logger', () => ({
      logger: {
        info: () => {},
        warn: (category: string, message: string) => {
          warnCalls.push({ category, message })
        },
        error: () => {},
        debug: () => {},
      },
    }))

    const { assessWithAst, resetAstParser } = await import(
      '../../src/main/core/risk-engine-ast'
    )
    resetAstParser()
    const result = await assessWithAst('ls')
    expect(result).toBeNull()

    // 验证 warn 日志包含任务要求的格式
    expect(warnCalls.length).toBeGreaterThan(0)
    const fallbackCall = warnCalls.find((c) => c.message.includes('WASM load failed'))
    expect(fallbackCall).toBeDefined()
    expect(fallbackCall!.message).toContain('[risk-engine-ast]')
    expect(fallbackCall!.message).toContain('WASM load failed')
    expect(fallbackCall!.message).toContain('fallback to regex')
    expect(fallbackCall!.category).toBe('RISK.AST')
  })

  it('AST parse 返回 null 时输出 [risk-engine-ast] AST parse returned null, fallback to regex 日志', async () => {
    const warnCalls: Array<{ category: string; message: string }> = []

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

    vi.doMock('../../src/main/services/log/logger', () => ({
      logger: {
        info: () => {},
        warn: (category: string, message: string) => {
          warnCalls.push({ category, message })
        },
        error: () => {},
        debug: () => {},
      },
    }))

    const { assessWithAst, resetAstParser } = await import(
      '../../src/main/core/risk-engine-ast'
    )
    resetAstParser()
    const result = await assessWithAst('ls')
    expect(result).toBeNull()

    const parseNullCall = warnCalls.find((c) =>
      c.message.includes('AST parse returned null')
    )
    expect(parseNullCall).toBeDefined()
    expect(parseNullCall!.message).toContain('[risk-engine-ast]')
    expect(parseNullCall!.message).toContain('fallback to regex')
  })

  it('AST parse 抛错时输出 [risk-engine-ast] AST parse failed: ..., fallback to regex 日志', async () => {
    const warnCalls: Array<{ category: string; message: string }> = []

    vi.doMock('web-tree-sitter', () => {
      class MockParser {
        static async init(): Promise<void> {}
        setLanguage(): void {}
        parse(): never {
          throw new Error('parse internal error')
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

    vi.doMock('../../src/main/services/log/logger', () => ({
      logger: {
        info: () => {},
        warn: (category: string, message: string) => {
          warnCalls.push({ category, message })
        },
        error: () => {},
        debug: () => {},
      },
    }))

    const { assessWithAst, resetAstParser } = await import(
      '../../src/main/core/risk-engine-ast'
    )
    resetAstParser()
    const result = await assessWithAst('ls')
    expect(result).toBeNull()

    const parseFailCall = warnCalls.find((c) => c.message.includes('AST parse failed'))
    expect(parseFailCall).toBeDefined()
    expect(parseFailCall!.message).toContain('[risk-engine-ast]')
    expect(parseFailCall!.message).toContain('fallback to regex')
    expect(parseFailCall!.message).toContain('parse internal error')
  })
})
