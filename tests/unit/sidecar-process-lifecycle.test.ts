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
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 进程是否还活着：signal 0 只探存在性，不发真信号（与 sidecar-manager 同一招） */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
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

afterAll(() => {
  fs.rmSync(workDir, { recursive: true, force: true })
})

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
      startupTimeoutMs: 1500,
    })

    void mgr.start().catch(() => undefined)

    const pidFile = path.join(workDir, 'child.pid')
    const pid = Number(await waitFor(() => (fs.existsSync(pidFile) ? fs.readFileSync(pidFile, 'utf8') : null)))
    expect(Number.isFinite(pid), `子进程应写下自己的 PID，实际读到=${pid}`).toBe(true)
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
        startupTimeoutMs: 1500,
      })
      void mgr.start().catch(() => undefined)
      const pidFile = path.join(workDir, 'child.pid')
      const pid = Number(await waitFor(() => (fs.existsSync(pidFile) ? fs.readFileSync(pidFile, 'utf8') : null)))
      pids.push(pid)
      await mgr.stop()
      await waitFor(() => (alive(pid) ? false : true), 8000)
    }
    expect(pids, '三轮应各起过一个进程').toHaveLength(3)
    const left = pids.filter(alive)
    expect(left, `三轮 stop 后仍活着的 PID：${left.join(', ')}`).toEqual([])
  }, 40_000)
})
