/**
 * 流内用量累积：取消那一轮也要有账（调研 P0-2 第二半）
 *
 * 为什么要在流里攒，而不是等 `result.usage`：取消（点"停止"）会让 `for await` 当场抛，
 * 拿账那段代码根本走不到；而 ai-sdk 在流里其实**已经**把每一步的用量报过一次
 * （`finish-step` 带 `usage`，`finish` 带 `totalUsage`，形状见 node_modules/ai/dist/index.d.ts:3035-3050）。
 * 在循环里顺手攒下来，取消与失败这两路就不再是"烧了 token 但账上什么都没有"。
 *
 * 这个函数被写成纯的：给它一串 part，它回一个累加器。
 * 于是"取消轮的用量从哪来"这件事第一次可以在不启动 SDK 的情况下被钉住。
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as ts from 'typescript'
import { createUsageAccumulator, observeStreamPart, type StreamUsageAccumulator } from '@main/core/agent/stream-stats'

const step = (inputTokens: number, outputTokens: number) => ({
  type: 'finish-step',
  usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
})

describe('流内用量累积', () => {
  it('多步工具链：每一步都入账（各步之和才是这一轮真烧掉的）', () => {
    let acc: StreamUsageAccumulator = createUsageAccumulator()
    for (const part of [step(1000, 5), step(1100, 7), step(1200, 9)]) {
      acc = observeStreamPart(part, acc)
    }
    expect(acc.total).toEqual({ inputTokens: 3300, outputTokens: 21, totalTokens: 3321 })
    // 徽章口径：末步的 prompt + completion 才是"这一轮真实占用"
    expect(acc.lastStep).toEqual({ inputTokens: 1200, outputTokens: 9, totalTokens: 1209 })
    expect(acc.steps).toBe(3)
  })

  it('中途取消：只有已完成的步也算得出来（修前的缺口就是这里报 0）', () => {
    let acc: StreamUsageAccumulator = createUsageAccumulator()
    acc = observeStreamPart(step(900, 12), acc)
    acc = observeStreamPart({ type: 'abort', reason: 'user cancelled' }, acc)
    expect(acc.aborted).toBe(true)
    expect(acc.total).toEqual({ inputTokens: 900, outputTokens: 12, totalTokens: 912 })
  })

  it('流末尾的 finish 带 totalUsage 时以它为准（与 result.usage 同口径，避免自己加错）', () => {
    let acc: StreamUsageAccumulator = createUsageAccumulator()
    acc = observeStreamPart(step(900, 12), acc)
    acc = observeStreamPart(
      { type: 'finish', finishReason: 'stop', totalUsage: { inputTokens: 950, outputTokens: 40, totalTokens: 990 } },
      acc
    )
    expect(acc.total).toEqual({ inputTokens: 950, outputTokens: 40, totalTokens: 990 })
  })

  it('一个字都没吐就断：账保持 undefined，不许凭空造一个 0 说"这是事实"', () => {
    let acc: StreamUsageAccumulator = createUsageAccumulator()
    acc = observeStreamPart({ type: 'abort' }, acc)
    expect(acc.total).toBeUndefined()
    expect(acc.steps).toBe(0)
  })

  it('文本增量等无关事件不改动累加器', () => {
    const before = createUsageAccumulator()
    const after = observeStreamPart({ type: 'text-delta', text: '你好' }, before)
    expect(after).toEqual(before)
  })
})

/**
 * 上面四条只证明这件工具好用，不证明 supervisor 真的在用它。
 * 少了这一条，"取消轮的账"就退回成一份没人调的漂亮函数——本项目为这类形状付过几次学费了。
 */
describe('supervisor 真的在流里攒这份账', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../src/main/core/agent/supervisor.ts'),
    'utf8'
  )

  it('遍历 result.stream 的那个循环第一件事就是把 part 交给 observeStreamPart', () => {
    const sf = ts.createSourceFile('supervisor.ts', src, ts.ScriptTarget.ESNext, true)
    let found = false
    const visit = (node: ts.Node): void => {
      // for await (const part of result.stream) { ... }
      if (
        ts.isForOfStatement(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.getText() === 'result.stream'
      ) {
        // for-of 的 statement 是循环体那个 Block，第一句在它的 statements[0]
        const body = node.statement
        const first = ts.isBlock(body) ? body.statements[0] : body
        if (
          first !== undefined &&
          ts.isExpressionStatement(first) &&
          // 循环体第一句必须是"把这一个 part 交给累加器"（写法是 usageAcc = observeStreamPart(...)，
          // 所以按"这一句以该赋值开头"认，不按"整句以函数名开头"认）
          first.expression.getText().startsWith('usageAcc = observeStreamPart(')
        ) {
          found = true
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
    expect(found, '流循环里没有 observeStreamPart —— 取消那一轮的账又是空的').toBe(true)
  })

  it('取消分支要按这份账记一次用量（不是只 onDone 一串 0）', () => {
    // 从 catch 里的取消分支取（#236 之后 "signal.aborted" 在压缩阶段也多了一处，
    // 按第一处取会读到那块"还没开始就取消"的收尾，它本来就没有可记的账）
    const idx = src.indexOf('const plannedCancel = planUsageRecord')
    expect(idx, '找不到取消分支里的 planUsageRecord').toBeGreaterThan(-1)
    const branch = src.slice(idx, idx + 2200)
    expect(branch, '取消轮攒到的用量没入账').toContain('recordUsageOnce(plannedCancel)')
    expect(branch, '取消轮的用量要交给 onDone，界面才知道该不该显示读数').toContain(
      'usage: cancelledUsage'
    )
  })
})
