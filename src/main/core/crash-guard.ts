/**
 * 主进程崩溃兜底（P0-3）
 *
 * 为什么必须有：主进程是所有窗口的宿主。Node 的默认行为是 uncaughtException 没人监听就
 * 打印堆栈并退出进程 —— 于是任何一处漏 catch 的异步异常都会带走整个应用：
 * 所有 SSH 会话、终端滚动缓冲、AI 上下文、正在执行的命令一起没了，而且不给用户任何解释。
 * 本项目 238 条 IPC 通道 + ssh2 回调 + node-pty 数据事件 + LLM 流式回调，触发面是常态级的。
 *
 * 三条原则：
 * 1. **不静默吞掉**：吞掉会让界面停在原地像卡死，比明确报错更糟
 * 2. **只弹一次**：连环异常不能弹出一排对话框
 * 3. **记全量日志**：logger 自己会脱敏（口令/密钥不落盘），崩溃现场要能复盘
 *
 * 刻意不调 process.exit：让用户自己决定什么时候关，已经建立的 SSH 连接还有机会走
 * 正常退出收尾（quit-cleanup 那道闸门只在 app.quit 时跑）。
 */
import { dialog } from 'electron'
import { logger } from '../services/log/logger'
// 崩溃弹窗是第三个出口：err.message 里可能带整条命令（connection-manager 的超时文案
// 就是 `命令执行超时(...): ${command}`，命令原文可以是 `mysql -uroot -p...`）。
// 日志与 IPC 信封都装了脱敏，弹到用户屏幕上的这一份不能是漏网的。
import { redactSecrets } from '../services/security/redact'

export type CrashSource = 'uncaughtException' | 'unhandledRejection'

export interface CrashGuardDeps {
  log: (message: string, meta: Record<string, unknown>) => void
  /** 只有未捕获异常会走这里；Promise 拒绝只记日志，不弹窗打扰 */
  notify: (title: string, detail: string) => void
}

const DEFAULT_DEPS: CrashGuardDeps = {
  log: (message, meta) => logger.error('CRASH', message, meta),
  notify: (title, detail) => {
    // showErrorBox 是同步的且自身可能失败（比如 app 正在退出），失败也不能再抛
    try {
      dialog.showErrorBox(title, detail)
    } catch {
      logger.error('CRASH', '崩溃对话框弹不出来', { title })
    }
  },
}

export interface CrashGuardHandle {
  dispose: () => void
  /** 已经弹过几次对话框（判据用：多次崩溃也只许弹一次） */
  dialogsShown: () => number
}

/**
 * 装上兜底。返回可卸载的句柄（测试要用它把监听摘干净，别污染后面的用例）。
 */
export function installCrashGuard(deps: Partial<CrashGuardDeps> = {}): CrashGuardHandle {
  const d: CrashGuardDeps = { ...DEFAULT_DEPS, ...deps }
  let dialogs = 0

  const record = (source: CrashSource, err: Error): void => {
    try {
      d.log(`主进程${source === 'uncaughtException' ? '未捕获异常' : '未处理的 Promise 拒绝'}`, {
        source,
        message: err.message,
        stack: err.stack ?? '',
      })
    } catch {
      // logger 自己也坏了（比如还没 initLogger、或写盘抛错）时不能再抛出去——
      // 那会让兜底变成新的崩溃源。这里刻意不退回 console：打包后的 Windows 里
      // console 到不了任何地方（见 tests/unit/log-console-budget.test.ts），
      // 用户那一侧由下面的对话框兜着。
    }
  }

  const onException = (err: Error): void => {
    record('uncaughtException', err)
    if (dialogs === 0) {
      dialogs += 1
      d.notify(
        '程序遇到一个内部错误',
        '刚才的操作没有完成，程序没有退出，但这次操作的结果不可信。\n' +
          'SSH 连接可能已中断，重新连接后可以继续。\n\n' +
          `错误：${redactSecrets(err.message)}`
      )
    }
  }

  const onRejection = (reason: unknown): void => {
    record('unhandledRejection', reason instanceof Error ? reason : new Error(String(reason)))
    // 不弹窗：它通常来自后台任务失败，界面那条任务自己的 loading 会回落；
    // 弹窗会把"某个后台坏了"升级成"整个应用来烦你"。
  }

  process.on('uncaughtException', onException)
  process.on('unhandledRejection', onRejection)

  return {
    dispose: () => {
      process.off('uncaughtException', onException)
      process.off('unhandledRejection', onRejection)
    },
    dialogsShown: () => dialogs,
  }
}
