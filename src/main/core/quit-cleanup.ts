/**
 * 退出清理引擎（阶段 D3/D4 的第二版）
 *
 * 为什么从 index.ts 抽出来：上一版把 preventDefault 闸门写在 index.ts 里，
 * 于是"接线是否成立"只能用**读源码字符串**来断言（`expect(body).toContain('await cleanupSidecar()')`）。
 * 那种断言一改结构就红、一改语义却不红（本轮把清理改成步骤表后它就红了，但它红的是字面量，
 * 不是行为）。抽成可注入的纯模块之后，闸门、顺序、每步超时、卡死上报都能直接跑出来测。
 *
 * Electron 语义（2026-10-08 独立探针实测，不是推测）：
 * before-quit 的 async 监听器**不会被等待**——监听器一返回，退出流程继续走，
 * await 之后的代码整段蒸发。所以必须先 event.preventDefault() 拦住退出，
 * 清理真的 await 完，再第二次 app.quit() 放行。
 *
 * 两条互相冲突的要求同时守：
 * 1. 清理没跑完不许退出（否则 sidecar 子进程留在机器上）；
 * 2. 清理卡住时也必须能退出（否则窗口钉死，用户只能任务管理器）。
 * 所以每步有独立超时、整体有硬上限，且任何异常路径最后都把状态置为 done（try/finally）。
 */

import { callWithTimeout } from './with-timeout'

/** 一步清理：name 会进日志，timeoutMs 缺省用引擎默认值 */
export interface QuitStep {
  name: string
  run: () => unknown
  timeoutMs?: number
}

/** 引擎用到的日志面：与主进程 logger 同形（category, message, meta），测试替身按同形喂 */
export interface QuitLog {
  info(category: string, msg: string, meta?: Record<string, unknown>): void
  warn(category: string, msg: string, meta?: Record<string, unknown>): void
}

/** 需要收尾的资源，由 index.ts 提供真实实现（这里不 import 服务，保证可单测） */
export interface QuitServices {
  stopMonitoring: () => unknown
  stopFileWatchers: () => unknown
  disconnectSsh: () => unknown
  disconnectExternalMcp: () => unknown
  stopMcpServer: () => unknown
  /** 摘掉 MCP 生命周期那把 1 秒轮询（不摘的话退出后事件循环还有活干） */
  disposeMcpLifecycle: () => unknown
  /** 停掉应用自己起的 OpenHands 容器（后台进程，不管它就留在机器上） */
  stopOpenHands: () => unknown
  /** 关掉还开着的本机终端（node-pty 起的是真 shell 进程，不管它就留在机器上） */
  closeLocalPty: () => unknown
  shutdownLangfuse: () => unknown
  cleanupScheduler: () => unknown
  cleanupSidecar: () => unknown
  cleanupLoopEngineering: () => unknown
  releaseMainWindow: () => unknown
}

/**
 * 步骤顺序即风险顺序，两条规矩：
 * 1. **子进程最先关**（sidecar、外部 MCP 客户端都是真进程）。上一版 sidecar 排在第 6，
 *    而"断开 SSH"在真实连接下可能占满整体上限（SSH 的 stop 排在连接锁队列尾部），
 *    上限一旦被吃光后面的清理一行都不执行，D3 最初要修的孤儿进程 bug 就回来了。
 * 2. **骑在 SSH 上的东西先停**（文件监听是各条 SSH 会话上的 inotify 流 / 轮询定时器），
 *    连接先断了再去 end 流只会拿不到结果。
 */
export function buildQuitSteps(svc: QuitServices): QuitStep[] {
  return [
    { name: '关闭 sidecar', run: svc.cleanupSidecar, timeoutMs: 4000 },
    // 容器和 sidecar 一样是"应用起的后台进程"，排在最前面：
    // 一旦后面的 SSH 收尾吃光整体预算，留在那儿的就是关不掉的孤儿容器
    { name: '停止 OpenHands 容器', run: svc.stopOpenHands, timeoutMs: 8000 },
    // 本机终端也是应用起的真进程（Windows 上还要连它的子进程树一起端掉）
    { name: '关闭本机终端', run: svc.closeLocalPty },
    { name: '断开外部 MCP 客户端', run: svc.disconnectExternalMcp },
    { name: '停止文件监听', run: svc.stopFileWatchers },
    { name: '停止监控', run: svc.stopMonitoring },
    { name: '断开 SSH', run: svc.disconnectSsh },
    { name: '停止 MCP Server', run: svc.stopMcpServer },
    { name: '摘除 MCP 生命周期轮询', run: svc.disposeMcpLifecycle },
    { name: '关闭 Langfuse（trace 落盘）', run: svc.shutdownLangfuse },
    { name: '清理调度器', run: svc.cleanupScheduler },
    { name: '解绑循环工程监听', run: svc.cleanupLoopEngineering },
    { name: '释放主窗口引用', run: svc.releaseMainWindow },
  ]
}

export interface QuitCleanupOptions {
  /** 惰性取步骤：服务单例要到退出时才组装 */
  steps: () => QuitStep[]
  log: QuitLog
  /** 整体硬上限。到点就放行退出，卡住的那一步名字会进日志 */
  capMs: number
  /** 单步默认超时：某一步挂住不吃掉整体预算 */
  stepTimeoutMs: number
  quit: () => void
  /** 落盘前追加一次 flush；不传就只等固定时长（不够可靠，日志写是异步队列） */
  flush?: () => Promise<void>
  /** 收尾后到再次 quit() 之间的等待，给 stdout 管道冲尾巴 */
  tailWaitMs: number
}

export interface QuitCleanup {
  onBeforeQuit: (event: { preventDefault(): void }) => Promise<void>
  /** 仅用于测试与诊断：'null'=从没触发过 */
  state: () => 'running' | 'done' | null
}

/**
 * 带超时的 await：超时不抛错，只报"这一步花到了上限"
 *
 * 实现是共享的 `callWithTimeout`（退出流程与调度器共用一份）。
 * 之前这里自己写了一份，调度器那边又写第二份的倾向已经出现——同一件事两处实现，
 * 迟早一处记得清定时器、另一处忘记（残留 setTimeout 会钉住事件循环，退出反而更慢）。
 */
async function runWithTimeout(
  step: QuitStep,
  timeoutMs: number
): Promise<{ ok: boolean; ms: number; timedOut: boolean; error?: string }> {
  const outcome = await callWithTimeout(step.run, timeoutMs)
  return {
    ok: outcome.ok,
    ms: outcome.ms,
    timedOut: outcome.timedOut,
    ...(outcome.error ? { error: outcome.error } : {}),
  }
}

export function createQuitCleanup(opts: QuitCleanupOptions): QuitCleanup {
  let quitCleanupState: 'running' | 'done' | null = null
  const state = (): typeof quitCleanupState => quitCleanupState

  async function onBeforeQuit(event: { preventDefault(): void }): Promise<void> {
    if (quitCleanupState === 'done') return // 第二次进来：清理做完了，放行退出
    event.preventDefault() // 第一次进来：拦住，Electron 不等 async 监听器
    if (quitCleanupState === 'running') return // 清理还在跑，别重复启动

    // 日志器自己抛错绝不能中断退出路径：收尾日志在 quit() 之前一句，它一抛就永远走不到放行，
    // 而 preventDefault 已经执行过了 —— 结果是应用关不掉。诊断信息值得记，但不值得为此钉死窗口。
    const info = (msg: string, meta?: Record<string, unknown>): void => {
      try {
        opts.log.info('APP', msg, meta)
      } catch {
        /* 日志坏了不拦退出 */
      }
    }
    const warn = (msg: string, meta?: Record<string, unknown>): void => {
      try {
        opts.log.warn('APP', msg, meta)
      } catch {
        /* 同上 */
      }
    }

    quitCleanupState = 'running'
    const startedAt = Date.now()
    let currentStep = '(未开始)'
    let capTimer: NodeJS.Timeout | undefined
    try {
      const cap = new Promise<'超时'>((resolve) => {
        capTimer = setTimeout(() => resolve('超时'), opts.capMs)
      })
      const walk = (async () => {
        for (const step of opts.steps()) {
          currentStep = step.name
          const r = await runWithTimeout(step, step.timeoutMs ?? opts.stepTimeoutMs)
          if (r.timedOut) {
            warn('退出清理某一步超时（继续下一步）', {
              step: step.name,
              timeoutMs: step.timeoutMs ?? opts.stepTimeoutMs,
            })
          } else if (r.error) {
            // 单项失败不许拖垮其余项，但必须留下可查痕迹（以前是空 catch，现场查不到）
            warn('退出清理某一步失败（跳过，不影响其余）', { step: step.name, error: r.error })
          }
          if (r.ms > 300) {
            info('退出清理慢步骤', { step: step.name, ms: r.ms })
          }
        }
        return '完成' as const
      })()

      const outcome = await Promise.race([walk, cap])
      // 上限被顶穿时 walk 还在后台跑（无法取消已发出的 await），日志必须说得出卡在哪一步
      if (outcome === '超时') walk.catch(() => undefined)
      info('退出清理收尾', {
        outcome,
        ms: Date.now() - startedAt,
        stuckAt: outcome === '超时' ? currentStep : undefined,
      })
    } finally {
      if (capTimer) clearTimeout(capTimer)
      // 兜底：日志器自己抛错也不能把状态钉在 running——那会让每次 quit 都 preventDefault，
      // 应用永远关不掉（比"清理没跑完"更糟）。
      quitCleanupState = 'done'
    }

    try {
      if (opts.flush) await opts.flush()
      else await new Promise((r) => setTimeout(r, opts.tailWaitMs))
    } catch {
      // 落盘失败不拦退出
    }
    opts.quit()
  }

  return { onBeforeQuit, state }
}
