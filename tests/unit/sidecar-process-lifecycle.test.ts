/**
 * 阶段 D · D3 判据：sidecar 退出后不留孤儿进程
 *
 * 计划原文要的是"实测数进程数，不是看日志说清了"。
 * 这里的做法：真起一个会写自己 PID 的 python 子进程当 sidecar 替身，
 * stop() 之后确认那个 PID 真的不在了 —— 而不是信日志里那句"已停止"。
 *
 * 没有可用 Python 时整条跳过并打印原因（本机有 D:\Miniconda3；CI 上没有就跳过），
 * 不会伪绿也不会假红。
 */
import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// 本文件的每条用例都要起一个真子进程跑门禁脚本：全量并行时 20 秒全局预算不够（现量见
// scripts/quality/subprocess-test-timeout.cjs 的文件头），所以只给这一份放宽。
vi.setConfig({ testTimeout: 60000 })

/** 进程是否还活着：signal 0 只探存在性，不发真信号（与 sidecar-manager 同一招） */
function alive(pid: number): boolean {
  // pid<=0 必须先挡掉：Windows 上 process.kill(0,0) 不抛错（它发给整个进程组），
  // 于是"读到一个空 PID"会被判成"进程还活着"——2026-10-07 全量跑就是这么假红过一次的
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * 读子进程自己写下的 PID。
 * 只判"文件存在"是不够的：python 用 open(...,'w') 先截断再写，截断与写入之间读到的就是空串，
 * Number('') === 0，正是上面那个假红的来源。这里要求必须是数字，否则返回 null 让 waitFor 继续等。
 */
function readChildPid(dir: string): string | null {
  const txt = (() => {
    try {
      return fs.readFileSync(path.join(dir, 'child.pid'), 'utf8')
    } catch {
      return ''
    }
  })()
  const m = txt.match(/\d+/)
  return m ? m[0] : null
}

function findPython(): string | null {
  for (const cand of ['python', 'python3']) {
    const r = spawnSync(cand, ['--version'], { encoding: 'utf8' })
    if (r.status === 0) return cand
  }
  return null
}

const PYTHON = findPython()
if (!PYTHON) console.log('[sidecar-lifecycle] 跳过：本机没有可用的 python，测不了真子进程退出')

/** -m 会执行的模块名（SidecarManager 用 entry 拼模块路径） */
const MODULE = 'tdsf_sleepy_sidecar'

let workDir = ''

/**
 * 两条判据里 `mgr.start()` 都是故意不等到底的（健康检查注定过不了，等它就等于等 20 秒超时）。
 * 但"不等"有代价：start 内部那条失败日志会在测试文件都已经跑完之后才落到 console，
 * 撞上 worker 拆除就是 `Closing rpc while onUserConsoleLog was pending`
 * （2026-10-24 全量跑红在这条上，单独跑这个文件不出现）。
 * 所以把没等价的承诺收集起来，afterAll 里收干净再走——判据本身不看那行日志。
 */
const floatingStarts: Array<Promise<unknown>> = []

beforeAll(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdsf-sidecar-test-'))
  fs.writeFileSync(
    path.join(workDir, `${MODULE}.py`),
    [
      'import os, time',
      "with open(os.path.join(os.getcwd(), 'child.pid'), 'w') as f:",
      '    f.write(str(os.getpid()))',
      'for _ in range(600):',
      '    time.sleep(0.1)',
      '',
    ].join('\n'),
    'utf8'
  )
})

afterAll(async () => {
  await Promise.allSettled(floatingStarts)
  fs.rmSync(workDir, { recursive: true, force: true })
}, 30_000)

async function waitFor<T>(read: () => T | null, timeoutMs = 8000): Promise<T> {
  const until = Date.now() + timeoutMs
  for (;;) {
    const value = read()
    if (value !== null && value !== false) return value
    if (Date.now() > until) throw new Error(`等超时（${timeoutMs}ms）`)
    await new Promise((r) => setTimeout(r, 50))
  }
}

describe('SidecarManager 进程生命周期（D3）', () => {
  it('stop() 之后子进程真的不在了', async () => {
    if (!PYTHON) return
    const { SidecarManager } = await import('../../src/main/core/sidecar/sidecar-manager')
    const mgr = new SidecarManager({
      id: 'test-sidecar',
      name: '测试替身',
      pythonPath: PYTHON,
      workingDir: workDir,
      entry: MODULE,
      host: '127.0.0.1',
      // 故意指一个没人听的端口：健康检查过不了，start() 会失败，
      // 但我们要测的是"进程被收干净"，不是它能不能就绪
      port: 1,
      healthCheckIntervalMs: 500,
      // 只测"收得干净"，不测"起得快"：1.5s 在 Windows CI 冷启动 Python 时会把子进程
      // 提前收掉，PID 还没写出来就超时（2026-10-22 CI 连续两次复现）。给足启动预算。
      startupTimeoutMs: 20_000,
    })

    floatingStarts.push(mgr.start().catch(() => undefined))

    const pid = Number(await waitFor(() => readChildPid(workDir), 15_000))
    expect(pid, `子进程应写下自己的正 PID，实际读到=${pid}`).toBeGreaterThan(0)
    expect(alive(pid), `PID ${pid} 应活着`).toBe(true)

    await mgr.stop()

    // 宽限：stop() 先 SIGTERM，3 秒后才 SIGKILL，再给一点调度时间
    const deadline = Date.now() + 8000
    while (alive(pid) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100))
    }
    expect(alive(pid), `stop() 后 PID ${pid} 仍活着 —— 有残留进程，D3 判据不成立`).toBe(false)
  }, 30_000)

  it('反复 start/stop 不留下越积越多的子进程', async () => {
    if (!PYTHON) return
    const { SidecarManager } = await import('../../src/main/core/sidecar/sidecar-manager')
    const pids: number[] = []
    for (let round = 0; round < 3; round++) {
      fs.rmSync(path.join(workDir, 'child.pid'), { force: true })
      const mgr = new SidecarManager({
        id: `test-sidecar-${round}`,
        name: '测试替身',
        pythonPath: PYTHON,
        workingDir: workDir,
        entry: MODULE,
        host: '127.0.0.1',
        port: 1,
        healthCheckIntervalMs: 500,
        startupTimeoutMs: 20_000,
      })
      floatingStarts.push(mgr.start().catch(() => undefined))
      const pid = Number(await waitFor(() => readChildPid(workDir), 15_000))
      expect(pid, `第 ${round + 1} 轮应拿到正 PID，实际读到=${pid}`).toBeGreaterThan(0)
      pids.push(pid)
      await mgr.stop()
      await waitFor(() => (alive(pid) ? false : true), 8000)
    }
    expect(pids, '三轮应各起过一个进程').toHaveLength(3)
    const left = pids.filter(alive)
    expect(left, `三轮 stop 后仍活着的 PID：${left.join(', ')}`).toEqual([])
  }, 90_000)
})
