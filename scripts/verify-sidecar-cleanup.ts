/**
 * D3 真机验证脚本（一次性，不进测试套件）
 *
 * 判据原文："退出后无残留 python 进程（数进程数，不是看日志说清了）"。
 * 这里不看日志：跑一次真实的 start() → stop()，比较前后机器上的 python.exe
 * PID 集合。集合必须一模一样 —— 多出来的任何一个就是孤儿。
 *
 * 跑法：npx tsx scripts/verify-sidecar-cleanup.ts
 */
import { execFileSync } from 'node:child_process'
import { SidecarManager, SIDECAR_CONFIGS } from '../src/main/core/sidecar/sidecar-manager'

/** 列出当前所有 python.exe 的 PID */
function pythonPids(): number[] {
  const out = execFileSync(
    'tasklist',
    ['/FI', 'IMAGENAME eq python.exe', '/FO', 'CSV', '/NH'],
    { encoding: 'utf8' }
  )
  return out
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('"python.exe"'))
    .map((line) => Number(line.split('","')[1]))
    .filter((n) => Number.isFinite(n))
}

function diff(before: number[], after: number[]): number[] {
  return after.filter((p) => !before.includes(p))
}

async function main(): Promise<void> {
  const before = pythonPids()
  console.log(`基线 python.exe PID = [${before.join(', ')}]`)

  const mgr = new SidecarManager(SIDECAR_CONFIGS.sre)
  let started = false
  try {
    await mgr.start()
    started = true
    console.log(`start() 成功，status=${mgr.getStatus().status}`)
    const during = diff(before, pythonPids())
    console.log(`运行期间新增 python.exe PID = [${during.join(', ')}]`)
  } catch (err) {
    console.log(`start() 失败：${(err as Error).message.slice(0, 200)}`)
    console.log(`getStatus = ${JSON.stringify(mgr.getStatus()).slice(0, 300)}`)
  }

  const t0 = Date.now()
  await mgr.stop()
  const stopMs = Date.now() - t0
  // 给操作系统一点时间真正回收句柄
  await new Promise((r) => setTimeout(r, 1500))

  const after = pythonPids()
  const leaked = diff(before, after)
  console.log(`stop() 用时 ${stopMs}ms，status=${mgr.getStatus().status}`)
  console.log(`清理后 python.exe PID = [${after.join(', ')}]`)
  console.log(`残留（孤儿）PID = [${leaked.join(', ')}]`)

  if (leaked.length > 0) {
    console.error(`FAIL：有 ${leaked.length} 个孤儿 python 进程没被回收`)
    process.exit(1)
  }
  if (!started) {
    console.log('PARTIAL：sidecar 在本机没能起来（venv/依赖缺失），')
    console.log('        只验证了 stop() 不抛错、不挂住、且没有凭空多出 python 进程。')
    process.exit(0)
  }
  console.log('PASS：起得来的 sidecar 在 stop() 后没有留下任何 python 进程')
}

void main().catch((err) => {
  console.error('脚本异常：', err)
  process.exit(1)
})
