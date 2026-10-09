/**
 * Sidecar 监督测试（D3）
 *
 * 覆盖这次真正补上的三件事：
 *   1. 重启预算改成 30 秒滚动窗口（以前"累计 3 次、成功即清零"，
 *      每 30 秒崩一次的 sidecar 能无限重启）
 *   2. 退出清理真的被接上（以前 cleanupSidecar 只挂到 global 上，没人调用，
 *      应用关了 Python 进程还留在机器上）
 *   3. 状态里带 stderr 尾部（崩溃现场不能只剩一句"退出了"）
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import ts from 'typescript'
import {
  RESTART_BUDGET_MAX,
  RESTART_BUDGET_WINDOW_MS,
  STDERR_RING_SIZE,
  canRestartWithinBudget,
  remainingRestartBudget,
} from '../../src/main/core/sidecar/sidecar-manager'

const ROOT = path.resolve(__dirname, '../..')

describe('重启预算：30 秒滚动窗口', () => {
  const T0 = 1_700_000_000_000

  it('空预算给满 3 次', () => {
    expect(remainingRestartBudget([], T0)).toBe(RESTART_BUDGET_MAX)
    expect(canRestartWithinBudget([], T0)).toBe(true)
  })

  it('窗口内连崩 3 次后不再重启', () => {
    const times = [T0, T0 + 1000, T0 + 2000]
    expect(remainingRestartBudget(times, T0 + 3000)).toBe(0)
    expect(canRestartWithinBudget(times, T0 + 3000)).toBe(false)
  })

  it('超出窗口的旧崩溃不计入（慢速崩溃不会被误判成崩溃风暴）', () => {
    const times = [T0, T0 + 1000]
    // 两次崩溃都满 30 秒出去之后，预算应完全恢复
    const muchLater = T0 + RESTART_BUDGET_WINDOW_MS + 1000
    expect(remainingRestartBudget(times, muchLater)).toBe(RESTART_BUDGET_MAX)
    expect(canRestartWithinBudget(times, muchLater)).toBe(true)
  })

  it('只有一部分崩溃出窗时按剩余计', () => {
    const times = [T0, T0 + 1000]
    const partlyAged = T0 + RESTART_BUDGET_WINDOW_MS + 1
    expect(remainingRestartBudget(times, partlyAged)).toBe(RESTART_BUDGET_MAX - 1)
  })

  it('窗口边界按半开区间算：刚好 30 秒的不算在内', () => {
    const times = [T0]
    expect(remainingRestartBudget(times, T0 + RESTART_BUDGET_WINDOW_MS)).toBe(RESTART_BUDGET_MAX)
    expect(remainingRestartBudget(times, T0 + RESTART_BUDGET_WINDOW_MS - 1)).toBe(RESTART_BUDGET_MAX - 1)
  })

  it('预算不会变成负数', () => {
    const times = Array.from({ length: 10 }, (_, i) => T0 + i)
    expect(remainingRestartBudget(times, T0 + 100)).toBe(0)
  })
})

describe('退出清理接线（S15）', () => {
  const mainIndex = fs.readFileSync(path.join(ROOT, 'src/main/index.ts'), 'utf8')
  const ipcIndex = fs.readFileSync(path.join(ROOT, 'src/main/ipc/index.ts'), 'utf8')

  /** 找出模块顶层（不在任何回调里）的 app.on('<event>') 注册 */
  function topLevelAppOn(source: string): string[] {
    const sf = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const found: string[] = []
    for (const stmt of sf.statements) {
      if (!ts.isExpressionStatement(stmt)) continue
      const expr = stmt.expression
      if (!ts.isCallExpression(expr)) continue
      const callee = expr.expression
      if (
        ts.isPropertyAccessExpression(callee) &&
        callee.expression.getText(sf) === 'app' &&
        callee.name.getText(sf) === 'on'
      ) {
        const arg = expr.arguments[0]
        if (arg && ts.isStringLiteral(arg)) found.push(arg.text)
      }
    }
    return found
  }

  it('清理走可注入引擎，sidecar 作为服务被接进去', () => {
    // 上一版这条断言写的是 toContain('await cleanupSidecar()')：改结构就假红，
    // 而它本来也证明不了运行时行为。真正的行为判据在 tests/unit/quit-cleanup.test.ts。
    expect(mainIndex).toContain('createQuitCleanup')
    expect(mainIndex).toMatch(/cleanupSidecar: \(\) => cleanupSidecar\(\)/)
    expect(mainIndex).not.toMatch(/runQuitCleanup\s*\(/)
  })

  it('before-quit 注册在模块顶层，不在 whenReady 回调里', () => {
    // 藏在 whenReady().then() 最后一句时：前面任何初始化抛错，闸门根本没装上，
    // 退出零清理且日志无痕。同文件里的 activate 正是那种写法，拿来当阴性对照。
    const tops = topLevelAppOn(mainIndex)
    expect(tops).toContain('before-quit')
    expect(tops, 'activate 需要 app 就绪，本来就该在 whenReady 里——扫不到它才说明这个取数是真的分层').not.toContain(
      'activate'
    )
  })

  it('不再用 global 中转清理函数（那条路从来没人调用）', () => {
    expect(ipcIndex).not.toContain('__cleanupSidecar')
    expect(ipcIndex).not.toContain('__cleanupLoopEngineering')
  })
})

describe('状态形状与 stderr 环形缓冲', () => {
  it('getStatus 暴露 restartsInWindow 与 stderrTail，未启动时为空', async () => {
    const { SidecarManager, SIDECAR_CONFIGS } = await import(
      '../../src/main/core/sidecar/sidecar-manager'
    )
    const mgr = new SidecarManager(SIDECAR_CONFIGS.sre)
    const s = mgr.getStatus()
    expect(s.status).toBe('stopped')
    expect(s.restartsInWindow).toBe(0)
    expect(s.stderrTail).toEqual([])
    expect(s.lastError).toBeNull()
  })

  it('stderr 缓冲上限是 40 行', () => {
    expect(STDERR_RING_SIZE).toBe(40)
  })
})
