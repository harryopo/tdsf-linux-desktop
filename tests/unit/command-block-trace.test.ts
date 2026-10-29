/**
 * 拦截留痕（2026-10-15 全维度系统审查 F1）
 *
 * 病根：拦截只发生在判定层，界面上的提示分别长在三个地方（终端 notice、工具返回值、
 * IPC 错误文案），而审计表里一行"被拦了"都没有——用户看到被拦却查不到拦了什么、什么时候、
 * 哪条路，这条防线对产品信任的伤害大于收益。
 *
 * 判据覆盖三条出口与两类误记：
 *   A 真拦下必须留痕（执行口 / 终端输入两条路都算，来源要分得清）
 *   B 不许误记：放行的命令、纯预检的判定，都不该在审计表里留下"拦截"
 *   C 留痕坏了不能反过来影响拦截本身（sink 抛错也必须照样拦）
 */
import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as ts from 'typescript'
import {
  CommandBlockedError,
  LineGate,
  assertCommandAllowed,
  evaluateCommand,
  setCommandBlockSink,
  type CommandBlockTrace
} from '@main/core/command-gate'
import { traceToAuditInput } from '@main/core/command-block-trace'

const ROOT = path.resolve(__dirname, '../..')

/** 收集留痕的假落点 */
function collectSink(box: CommandBlockTrace[]): () => void {
  setCommandBlockSink((t) => box.push(t))
  return () => box.splice(0, box.length)
}

const BLOCKED = 'rm -rf /'
const BENIGN = 'uptime'

afterEach(() => setCommandBlockSink(null))

describe('拦截留痕', () => {
  it('执行口拦下：既抛错又留痕，来源写清楚', () => {
    const got: CommandBlockTrace[] = []
    collectSink(got)
    expect(() => assertCommandAllowed(BLOCKED, 'SSH 执行')).toThrow(/高危命令已拦截/)
    expect(got).toHaveLength(1)
    expect(got[0].source).toBe('SSH 执行')
    expect(got[0].command).toBe(BLOCKED)
    expect(got[0].reason.length).toBeGreaterThan(4)
  })

  it('终端输入拦下：也留痕（这一路以前只在屏幕上印一行）', () => {
    const got: CommandBlockTrace[] = []
    collectSink(got)
    const gate = new LineGate()
    const v = gate.feed(`${BLOCKED}\n`)
    expect(v.allow).toBe(false)
    expect(got).toHaveLength(1)
    expect(got[0].source).toBe('终端输入')
    expect(got[0].command).toBe(BLOCKED)
  })

  it('放行的命令不许留"拦截"痕迹（反向对照，否则审计表被正常执行灌满）', () => {
    const got: CommandBlockTrace[] = []
    collectSink(got)
    expect(() => assertCommandAllowed(BENIGN, 'SSH 执行')).not.toThrow()
    const gate = new LineGate()
    expect(gate.feed(`${BENIGN}\n`).allow).toBe(true)
    expect(got, '正常执行被记成拦截＝这份记录以后没人信').toEqual([])
  })

  it('纯预检不算拦截事件：evaluateCommand 自己不写留痕', () => {
    const got: CommandBlockTrace[] = []
    collectSink(got)
    expect(evaluateCommand(BLOCKED).level).toBe('block')
    expect(got, '界面每次预检都落一行"拦截"，记录就成噪声了').toEqual([])
  })

  it('留痕落点自己抛错，不许把高危命令变成放行', () => {
    setCommandBlockSink(() => {
      throw new Error('审计库写不进去了')
    })
    expect(() => assertCommandAllowed(BLOCKED, 'SSH 执行')).toThrow(CommandBlockedError)
  })

  it('没注册落点时照常拦（留痕是旁路，不是判定的前置条件）', () => {
    setCommandBlockSink(null)
    expect(() => assertCommandAllowed(BLOCKED)).toThrow(/高危命令已拦截/)
  })

  it('留痕翻成审计行：exitCode 必须是空而不是 0', () => {
    const row = traceToAuditInput({
      source: '终端输入',
      command: BLOCKED,
      reason: '会销毁整个文件系统',
      matched: 'rm -rf /',
      riskLevel: 'block'
    })
    expect(row.category).toBe('cmd_exec')
    expect(row.action).toContain('终端输入')
    expect(row.exitCode, '被拦下等于没执行，写成 0 会被读成"跑成功了"').toBeNull()
    expect(row.details.reason).toBe('会销毁整个文件系统')
  })

  it('接线核对：主进程启动确实注册了留痕落点', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/main/index.ts'), 'utf8')
    const sf = ts.createSourceFile(path.join(ROOT, 'src/main/index.ts'), src, ts.ScriptTarget.Latest, true)
    let installed = false
    const walk = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && n.expression.getText() === 'installCommandBlockTrace') installed = true
      ts.forEachChild(n, walk)
    }
    walk(sf)
    expect(installed, '启动时没注册落点＝留痕能力只存在于测试里').toBe(true)
  })

  it('执行口拦下来的一刻就留痕（放行的那条不许留）', () => {
    const got: CommandBlockTrace[] = []
    collectSink(got)
    expect(() => assertCommandAllowed(BLOCKED, '外部工具调用')).toThrow(CommandBlockedError)
    expect(got.map((g) => g.source)).toEqual(['外部工具调用'])
    expect(got[0].command).toBe(BLOCKED)

    const got2: CommandBlockTrace[] = []
    collectSink(got2)
    expect(() => assertCommandAllowed(BENIGN, '外部工具调用')).not.toThrow()
    expect(got2, '放行的命令不该在审计表里留下"拦截"').toEqual([])
  })

  it('活着的两个拒绝出口都还挂着留痕（#281 撤掉入站派发口后，剩下的一个都不许掉）', () => {
    // "AI 在对话里调外部工具被拒"（agent-runtime）与"设置页试调用被拒"（ipc/mcp）——
    // 这两条是本应用仅存的、由外部/模型侧发起命令的拒绝出口。
    for (const rel of ['src/main/ipc/agent-runtime.ts', 'src/main/ipc/mcp.ts']) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
      expect(src.length, `${rel} 读不到——那不是判过了，那是没查`).toBeGreaterThan(0)
      expect(src.includes('emitBlockTrace('), `${rel} 的拒绝不再留痕，事后查不到这次拦截`).toBe(true)
    }
  })

  it('结构核对：每个 block 出口都挂了留痕', () => {
    const file = path.join(ROOT, 'src/main/core/command-gate.ts')
    const src = fs.readFileSync(file, 'utf8')
    const throws = (src.match(/throw new CommandBlockedError\(/g) ?? []).length
    const gateBlocks = (src.match(/allow: false, /g) ?? []).length + (src.match(/allow: false,\n/g) ?? []).length
    // 只数调用（函数定义那行不算一处留痕）
    const emits = (src.match(/emitBlockTrace\(\{/g) ?? []).length
    // 2026-10-29 #281：入站 MCP 派发口（两处拦截 + 两处留痕）整删后，判定层只剩这两处。
    // 刻度跟着真实面积走，但"漏挂留痕的那一个出口"仍会被下面那行咬红。
    expect(throws + gateBlocks, '判定层的拦截出口数量变了，这条判据要跟着改').toBeGreaterThanOrEqual(2)
    expect(emits, `留痕只有 ${emits} 处，而拦截出口有 ${throws + gateBlocks} 处——新增了没挂留痕的那一个`)
      .toBeGreaterThanOrEqual(throws + gateBlocks)
  })
})
