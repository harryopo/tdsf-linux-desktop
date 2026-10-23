/**
 * 长工具链的上下文剪枝（2026-10-15 全维度审查 D1/D4 的稳定性半边）
 *
 * 钉住的真实故障：一次 chat 最多 12 步工具，SDK 每一步都把前面所有步重发一遍。
 * 一条 `journalctl -n 500` 就是几十 KB，第四次诊断之后光"重发的旧输出"就能顶穿
 * 小窗口模型的上下文，上游回 400——用户看到的是"AI 聊到一半突然不能用了"。
 *
 * 判据面（每条都对应一种会静默复发的退化）：
 * - 旧的批量输出确实被剪掉，最近一轮必须还在（剪错了就是让模型失忆）
 * - 名单外的检索工具不剪（它的结果只有几百字，剪掉反而丢出处）
 * - 剪完不许留下"有调用没结果"的孤儿——各家 API 真正报错的形状就长这样
 * - 幂等、短列表不动
 * - 名单与工具目录对账：工具改名时这里先红，而不是剪枝悄悄失灵
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as ts from 'typescript'
import type { ModelMessage } from 'ai'
import { BULK_OUTPUT_TOOLS, pruneStaleToolOutputs } from '@main/core/agent/tool-history'
import { CHAT_TOOL_CATALOG } from '@main/core/agent/tools/chat-tool-router'

const ROOT = path.resolve(__dirname, '../..')

/** 造一轮工具调用：assistant 发起 + tool 回结果（big 用来模拟远端大输出） */
function toolRound(index: number, toolName: string, big = 'x'.repeat(2000)): ModelMessage[] {
  const id = `call-${index}`
  return [
    {
      role: 'assistant',
      content: [
        { type: 'text', text: `第 ${index} 步：先看一眼` },
        { type: 'tool-call', toolCallId: id, toolName, input: { command: 'df -h' } },
      ],
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: id,
          toolName,
          output: { type: 'text', value: big },
        },
      ],
    },
  ]
}

/** 五轮 ssh 诊断 + 末尾用户追问 */
function longChain(): ModelMessage[] {
  const msgs: ModelMessage[] = [{ role: 'system', content: '你是运维助手' }, { role: 'user', content: '帮我查磁盘' }]
  for (let i = 1; i <= 5; i++) msgs.push(...toolRound(i, 'ssh_readonly'))
  return msgs
}

/** 收集列表里所有工具调用 id / 结果 id 与所属工具名 */
function collect(msgs: ModelMessage[]) {
  const calls = new Set<string>()
  const results = new Set<string>()
  const names = new Set<string>()
  for (const m of msgs) {
    if (typeof m.content === 'string') continue
    for (const part of m.content as Array<Record<string, unknown>>) {
      if (part.type === 'tool-call') {
        calls.add(String(part.toolCallId))
        names.add(`${String(part.toolName)}:${String(part.toolCallId)}`)
      } else if (part.type === 'tool-result') {
        results.add(String(part.toolCallId))
        names.add(`${String(part.toolName)}:${String(part.toolCallId)}`)
      }
    }
  }
  return { calls, results, names }
}

describe('旧的批量工具输出会被剪掉', () => {
  it('正对照：剪之前确实存在成对的 ssh 调用与结果', () => {
    const before = collect(longChain())
    expect(before.calls.size).toBe(5)
    expect(before.results.size).toBe(5)
  })

  it('最近一轮的工具内容保留，更早的被剪', () => {
    const after = pruneStaleToolOutputs(longChain())
    const { names } = collect(after)
    // 最后一轮是 call-5（assistant + tool 两条占了尾部 2 个位置）
    expect(names.has(`ssh_readonly:call-5`)).toBe(true)
    expect(names.has(`ssh_readonly:call-1`)).toBe(false)
    expect(names.has(`ssh_readonly:call-2`)).toBe(false)
  })

  it('名单外的检索工具即使很旧也保留（结果本来就是短摘要）', () => {
    const msgs: ModelMessage[] = [
      { role: 'user', content: '查知识库' },
      ...toolRound(1, 'kb_search'),
      ...toolRound(2, 'kb_search'),
      ...toolRound(3, 'tutorial_search'),
      ...toolRound(4, 'kb_search'),
      ...toolRound(5, 'kb_search'),
      { role: 'user', content: '继续' },
    ]
    const after = pruneStaleToolOutputs(msgs)
    const { names } = collect(after)
    expect(names.has('kb_search:call-1')).toBe(true)
    expect(names.has('tutorial_search:call-3')).toBe(true)
  })

  it('剪完不留孤儿：调用集合与结果集合仍然相等', () => {
    const after = pruneStaleToolOutputs(longChain())
    const { calls, results } = collect(after)
    expect([...calls].sort()).toEqual([...results].sort())
  })

  /**
   * 外部 MCP 工具的名字是运行时才知道的（mcp__<服务器>__<工具>），进不了静态名单，
   * 所以由 supervisor 把本轮真挂上的名字交进来。两条一起写才说得清这是参数在起作用：
   * 只判"传了就剪"等于把判据绑在参数顺序上，补一条"不传就不剪"才钉住这个开关。
   */
  it('本轮挂上的外部工具名传进来才剪旧输出（正反两向）', () => {
    const ext = 'mcp__srv-1__get_forecast'
    const chain = (): ModelMessage[] => [
      { role: 'system', content: 's' },
      { role: 'user', content: '查天气' },
      ...toolRound(1, ext),
      ...toolRound(2, ext),
      ...toolRound(3, ext),
      ...toolRound(4, ext),
      ...toolRound(5, ext),
      { role: 'user', content: '继续' },
    ]

    const withNames = collect(pruneStaleToolOutputs(chain(), [ext])).names
    expect(withNames.has(`${ext}:call-5`), '最近一轮被误剪').toBe(true)
    expect(withNames.has(`${ext}:call-1`), '传了名字仍然没剪旧输出').toBe(false)

    const withoutNames = collect(pruneStaleToolOutputs(chain())).names
    expect(withoutNames.has(`${ext}:call-1`), '没传名字时不该剪外部工具').toBe(true)
  })

  it('幂等：再剪一次不继续丢东西', () => {
    const once = pruneStaleToolOutputs(longChain())
    const twice = pruneStaleToolOutputs(once)
    expect(twice).toEqual(once)
  })

  it('短列表（未超过保留窗口）原样不动', () => {
    const short: ModelMessage[] = [
      { role: 'user', content: '看一下磁盘' },
      ...toolRound(1, 'ssh_readonly'),
    ]
    expect(pruneStaleToolOutputs(short)).toEqual(short)
  })

  it('system 与用户消息本身不会被当成空壳丢掉', () => {
    const after = pruneStaleToolOutputs(longChain())
    const roles = after.map((m) => m.role)
    expect(roles).toContain('system')
    expect(roles.filter((r) => r === 'user').length).toBe(1)
  })
})

describe('剪枝名单与工具目录对账', () => {
  it('名单里每个工具都真的存在于 CHAT_TOOL_CATALOG（改名要先在这里红）', () => {
    const catalogIds = new Set(CHAT_TOOL_CATALOG.map((e) => e.id))
    for (const name of BULK_OUTPUT_TOOLS) {
      expect(catalogIds.has(name)).toBe(true)
    }
  })

  it('目录里"输出可能很大"的远端类工具都在名单内（漏一个就是一个盲区）', () => {
    const listed = new Set<string>(BULK_OUTPUT_TOOLS)
    // 这四个是本次判定要覆盖的集合：任何一个是新加的同类远端 IO 工具，都必须进名单
    for (const id of ['ssh_readonly', 'ssh_write', 'ssh_journal_follow', 'sftp_read']) {
      expect(listed.has(id)).toBe(true)
    }
  })
})

describe('supervisor 真的把剪枝接到了每一步前面', () => {
  /** 在 streamText(...) 的实参子树里找名为 prepareStep 的属性 */
  function hasPropertyInsideStreamTextCall(source: string, propertyName: string): boolean {
    const file = ts.createSourceFile('supervisor.ts', source, ts.ScriptTarget.Latest, true)
    let found = false
    const walk = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'streamText'
      ) {
        const scan = (inner: ts.Node): void => {
          if (
            ts.isPropertyAssignment(inner) &&
            ts.isIdentifier(inner.name) &&
            inner.name.text === propertyName
          ) {
            found = true
          }
          ts.forEachChild(inner, scan)
        }
        node.arguments.forEach(scan)
      }
      ts.forEachChild(node, walk)
    }
    walk(file)
    return found
  }

  it('streamText 带 prepareStep（否则剪枝一次也不会跑）', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/main/core/agent/supervisor.ts'), 'utf8')
    expect(hasPropertyInsideStreamTextCall(src, 'prepareStep')).toBe(true)
  })

  it('阴性对照：找一个不存在的属性名必须是 false（证明上面那条不是恒真）', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/main/core/agent/supervisor.ts'), 'utf8')
    expect(hasPropertyInsideStreamTextCall(src, 'definitelyNotARealOption')).toBe(false)
  })

  it('prepareStep 调的就是剪枝函数（不是随便一个空回调）', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/main/core/agent/supervisor.ts'), 'utf8')
    const file = ts.createSourceFile('supervisor.ts', src, ts.ScriptTarget.Latest, true)
    let prunesStepMessages = false
    let pruneCallsSeen = 0
    const walk = (node: ts.Node): void => {
      if (
        ts.isPropertyAssignment(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === 'prepareStep'
      ) {
        const scan = (inner: ts.Node): void => {
          if (
            ts.isCallExpression(inner) &&
            ts.isIdentifier(inner.expression) &&
            inner.expression.text === 'pruneStaleToolOutputs'
          ) {
            pruneCallsSeen++
            if (inner.arguments[0]?.getText() === 'stepMessages') prunesStepMessages = true
          }
          ts.forEachChild(inner, scan)
        }
        scan(node)
      }
      ts.forEachChild(node, walk)
    }
    walk(file)
    // 判"第一件事是剪 stepMessages"，不判整串源码文字：多带一个实参就红是假红，
    // 而把 stepMessages 换掉不剪才是真断了这条链。
    expect(pruneCallsSeen, 'prepareStep 里一次都没调用剪枝函数').toBeGreaterThan(0)
    expect(prunesStepMessages, '剪枝调用的第一个实参不是这一步的消息列表').toBe(true)
  })
})
