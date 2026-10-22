/**
 * 外部 MCP 工具调用必须先过人工审批（调研 P0-4 / 任务 #173 第一步）
 *
 * 为什么不是接 `assessToolCall`：那张闸按**工具名**查形状表，查不到就 fail-closed 拒
 * （`core/command-gate.ts:1387`）。外部 MCP 服务器的工具名是第三方自己定的、不可枚举，
 * 所以接上去等于把外部工具全量拒死——闸是接上了，功能是零。
 * 而且风险本来也判不了：参数里那串字符串算不算 shell 命令，取决于对面那个服务器干什么。
 * 对不透明的第三方工具，唯一诚实的控制是**每次都要有人点头**。
 *
 * 这里判两件事：
 * 1. 审批载荷本身（预览说什么、截断、riskLevel、不许编 stepIndex）
 * 2. `ipc/mcp.ts` 真的在调用外部工具**之前**等这道审批，且没批准就当场返回
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as ts from 'typescript'
import { buildExternalCallApproval, MCP_CALL_PREVIEW_LIMIT } from '@main/core/agent/mcp-approval'

describe('外部 MCP 调用的审批载荷', () => {
  it('预览里要能看见"哪个服务器的哪个工具、带什么参数"', () => {
    const p = buildExternalCallApproval('weather', 'get_forecast', { city: '上海' })
    expect(p.origin, '来源链路要单独成档，界面才知道该说什么标题').toBe('mcp')
    expect(p.command).toContain('weather')
    expect(p.command).toContain('get_forecast')
    expect(p.command).toContain('上海')
    expect(p.stepIndex, '外部调用没有"第几步"这回事，不许用 0 冒充第 1 步').toBeUndefined()
  })

  it('风险等级要说清"这是第三方程序，主进程预判不了它做什么"', () => {
    const p = buildExternalCallApproval('fs', 'write_file', { path: '/etc/hosts' })
    expect(p.riskLevel).toBe('HIGH')
    expect(p.riskDescription).toContain('第三方')
  })

  it('参数再长也不能整坨贴到卡上（截断有上限，并留下"被截了"的痕迹）', () => {
    const big = 'x'.repeat(MCP_CALL_PREVIEW_LIMIT * 3)
    const p = buildExternalCallApproval('svc', 'tool', { blob: big })
    expect(p.command.length).toBeLessThanOrEqual(MCP_CALL_PREVIEW_LIMIT + 60)
    expect(p.command).toContain('已截断')
  })

  it('非法 JSON 的参数（循环引用）不能把审批流程本身搞崩', () => {
    const circular: Record<string, unknown> = { name: 'svc' }
    circular.self = circular
    const p = buildExternalCallApproval('svc', 'tool', circular)
    expect(p.command).toContain('svc')
    expect(p.command).toContain('tool')
  })
})

/**
 * 载荷好用不等于接上了。下面这条判 `ipc/mcp.ts` 真的在调用前等审批——
 * 缺了它，"审批"就是一份没人调的漂亮函数。
 */
describe('ipc/mcp.ts 真的把外部调用接在审批之后', () => {
  const file = path.resolve(__dirname, '../../src/main/ipc/mcp.ts')
  const src = fs.readFileSync(file, 'utf8')
  const sf = ts.createSourceFile('mcp.ts', src, ts.ScriptTarget.ESNext, true)

  /** 找到 EXTERNAL_CALL 那个 handler 的回调体 */
  function handlerBody(): ts.Block | undefined {
    let found: ts.Block | undefined
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText() === 'ipcMain.handle' &&
        node.arguments.length >= 2 &&
        node.arguments[0].getText().includes('EXTERNAL_CALL')
      ) {
        const cb = node.arguments[1]
        if (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) {
          if (ts.isBlock(cb.body)) found = cb.body
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
    return found
  }

  it('找得到那个 handler（判据别对空集自嗨）', () => {
    expect(handlerBody(), 'ipc/mcp.ts 里没找到 EXTERNAL_CALL 的 handler，判据要重写').toBeDefined()
  })

  it('handler 里确实调了 requestApproval，而且在 callExternalTool 之前', () => {
    const body = handlerBody()!
    const text = body.getText()
    const ask = text.indexOf('requestApproval(')
    const call = text.indexOf('callExternalTool(')
    expect(ask, '外部 MCP 调用没过人工审批').toBeGreaterThanOrEqual(0)
    expect(call).toBeGreaterThanOrEqual(0)
    expect(ask, '先调用再审批＝审批只是个样子').toBeLessThan(call)
  })

  it('没批准就当场返回，不落进 callExternalTool', () => {
    const body = handlerBody()!
    let denyReturns = false
    const visit = (node: ts.Node): void => {
      // IfStatement 的条件属性名按本仓 typescript 版本取 `expression`
      // （`condition` 是较新版本才有的别名，钉它等于把判据绑死在某个 tsc 上）
      if (ts.isIfStatement(node) && node.expression.getText().includes('approved')) {
        const thenText = node.thenStatement.getText()
        if (node.expression.getText().startsWith('!') && thenText.includes('return')) {
          denyReturns = true
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(body)
    expect(denyReturns, '审批为假时没有提前 return（会继续往下调外部工具）').toBe(true)
  })

  it('被拒的调用要留拦截痕（不能只回一句"没批准"就当没事发生）', () => {
    expect(handlerBody()!.getText()).toMatch(/emitBlockTrace|recordBlockTrace/)
  })
})
