/**
 * 沙箱预检：把主进程那份健康状态翻译成"能不能继续 + 该对用户说什么"
 *
 * 教程页那颗「打开沙箱并执行」以前只检查 `sandboxExecute` 这把键在不在，
 * 就直接 list → create。Docker 没开时用户看到的是一串
 * `沙箱创建失败：connect ECONNREFUSED ...`，而 `sandbox:status` 早就分得清
 * 是 Docker 没跑还是容器没起（类型注释自己写着"用于 UI 展示"）。
 * 这一层把那个区分落到话上：两种成因给两句话，只有"容器没起"这一档给得出一键启动。
 */
import type { SandboxHealthStatus } from '@/types/electron'

export type SandboxPreflight =
  | { kind: 'ready'; message: ''; canStart: false }
  | { kind: 'docker-missing'; message: string; canStart: false }
  | { kind: 'container-stopped'; message: string; canStart: true }
  | { kind: 'unknown'; message: string; canStart: false }

export function planSandboxPreflight(
  status: SandboxHealthStatus | null | undefined,
): SandboxPreflight {
  if (!status) {
    return {
      kind: 'unknown',
      message: '暂时读不到沙箱环境的状态，先不执行。可以重试一次。',
      canStart: false,
    }
  }
  if (!status.dockerReady) {
    return {
      kind: 'docker-missing',
      message: '沙箱需要 Docker，但本机没检测到正在运行的 Docker。请先启动 Docker Desktop，再点一次「打开沙箱练习」。',
      canStart: false,
    }
  }
  if (!status.openhandsRunning) {
    return {
      kind: 'container-stopped',
      message: 'Docker 已就绪，但沙箱容器还没启动。现在启动吗？第一次会拉镜像，可能要等一会儿。',
      canStart: true,
    }
  }
  return { kind: 'ready', message: '', canStart: false }
}

/** `sandbox:start` 之后最多等多久（容器要拉镜像、App Server 要起） */
export const SANDBOX_START_WAIT_MS = 30_000

export interface WaitOptions {
  deadlineMs?: number
  intervalMs?: number
  /** 测试注入用：真实调用走 Date.now 与 setTimeout */
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

/**
 * 启动之后**有界地**等就绪
 *
 * `sandbox:start` 只是把容器交出去，命令回来不等于 App Server 已经能应答；
 * 读一次就判生死会把"再等两秒就好了"说成"没能起来"。
 * 只等"容器没起"这一档：中途发现 Docker 掉了立刻停，别把预算睡光。
 */
export async function waitSandboxReady(
  read: () => Promise<SandboxHealthStatus | null>,
  options: WaitOptions = {},
): Promise<SandboxPreflight> {
  const {
    deadlineMs = SANDBOX_START_WAIT_MS,
    intervalMs = 1000,
    now = Date.now,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  } = options
  let plan = planSandboxPreflight(await read())
  const startedAt = now()
  while (plan.kind === 'container-stopped' && now() - startedAt < deadlineMs) {
    await sleep(intervalMs)
    plan = planSandboxPreflight(await read())
  }
  return plan
}
