/**
 * 取消链路必须只有一条真的（2026-10-15 全维度审查 D1 现场取证）
 *
 * 病根：agent:chat:cancel 里做两步"双保险"，其中第一步 registry.abortById()
 * 掐的是注册表自己 new 的一把 controller——没有任何代码读过它的 signal。
 * 于是取消永远"成功"：日志写"已发出取消信号"，界面解卡，底层请求照常跑完。
 *
 * 现在的契约：注册表不再自己造 controller，由持有请求的一方（supervisor）attach 进来。
 * 因此 abort() 的 true 是可兑现的，false 也是有意义的（没挂上管道 = 取消无处可发）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as ts from 'typescript'
import { getSessionRegistry, resetSessionRegistry } from '@main/core/agent/session-registry'

const ROOT = path.resolve(__dirname, '../..')

function makeId(n: string): string {
  return `sess-${n}`
}

beforeEach(() => {
  resetSessionRegistry()
})
afterEach(() => {
  resetSessionRegistry()
})

describe('会话注册表的取消语义', () => {
  it('没 attach 之前不许把取消报成成功（这正是原来的谎）', () => {
    const r = getSessionRegistry()
    const id = r.register({ sessionId: makeId('no-attach'), correlationId: 'corr-1', kind: 'agent:chat' })
    expect(r.abort(id)).toBe(false)
  })

  it('attach 之后 abort() 中止的就是那一把 controller', () => {
    const r = getSessionRegistry()
    const id = r.register({ sessionId: makeId('attached'), correlationId: 'corr-2', kind: 'agent:chat' })
    const controller = new AbortController()
    expect(r.attachAbortController(id, controller)).toBe(true)
    expect(r.abort(id)).toBe(true)
    expect(controller.signal.aborted, '返回 true 却没真的中止＝又一次谎报').toBe(true)
  })

  it('按 correlationId 也能走到同一把 controller（取消入口两种 ID 都要真）', () => {
    const r = getSessionRegistry()
    r.register({ sessionId: makeId('by-corr'), correlationId: 'corr-3', kind: 'agent:chat' })
    const controller = new AbortController()
    expect(r.attachAbortController('corr-3', controller)).toBe(true)
    expect(r.abortById('corr-3')).toBe(true)
    expect(controller.signal.aborted).toBe(true)
  })

  it('重复取消幂等：第二次仍然 true，但不重复 abort', () => {
    const r = getSessionRegistry()
    const id = r.register({ sessionId: makeId('twice'), correlationId: 'corr-4', kind: 'agent:chat' })
    const controller = new AbortController()
    const spy = vi.spyOn(controller, 'abort')
    r.attachAbortController(id, controller)
    expect(r.abort(id)).toBe(true)
    expect(r.abort(id)).toBe(true)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('attach 到不存在的会话要说找不到，不能悄悄收下', () => {
    const r = getSessionRegistry()
    expect(r.attachAbortController('corr-nope', new AbortController())).toBe(false)
  })

  it('接线核对：supervisor 建 controller 后确实挂给了注册表', () => {
    const file = path.join(ROOT, 'src/main/core/agent/supervisor.ts')
    const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    let attached = false
    const walk = (n: ts.Node): void => {
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        n.expression.name.getText() === 'attachAbortController' &&
        n.arguments.length >= 2
      ) {
        attached = true
      }
      ts.forEachChild(n, walk)
    }
    walk(sf)
    expect(attached, 'supervisor 不再 attach，取消就退回到"报成功但没中止"').toBe(true)
  })

  it('注册表不再自己造 controller（造了就又是一把没人读的装饰）', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/main/core/agent/session-registry.ts'), 'utf8')
    const created = (src.match(/new AbortController\(\)/g) ?? []).length
    expect(created, `注册表里出现 ${created} 处自建 controller`).toBe(0)
  })
})
