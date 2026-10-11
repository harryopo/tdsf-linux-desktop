/**
 * 本机终端 IPC Handlers（W3）
 *
 * 注册 local-tty:* 一组通道，桥接渲染进程与 services/terminal/local-pty。
 *
 * 三条规矩与远端终端完全一致：
 * - WRITE 走 LineGate：逐键输入不在逐字符阶段判，攒到 `\r`（PTY 里就是 accept-line）
 *   再整行判一次；全屏程序（vim/less 等）期间暂停判定（P0-2）；
 * - RUN_AUTHORED 是"别人代写的整条命令"（AI 建议 / 决策页重跑），
 *   必须先过 core/command-gate，block 级直接拒绝。本机命令同样要过闸——
 *   用户明确要求过这一点。
 *
 * 输出复用 terminal:data 通道（载荷首参 shellId），退出用 local-tty:exit 通知，
 * 渲染层据此摘掉标签，避免出现"进程已经没了但标签还在"的死终端。
 */
import { ipcMain } from 'electron'
import { LOCAL_TTY, TERMINAL } from '@shared/ipc-channels'
import { localPtyManager, type PtySize } from '../services/terminal/local-pty'
import { broadcastToWindows } from '../windows/main-window'
import { evaluateCommand, LineGate, PTY_ABANDON_LINE } from '../core/command-gate'
import { logger } from '../services/log/logger'
import { redactSecrets } from '../core/agent/providers/redact'

/**
 * 注册本机终端通道
 *
 * 输出与退出都广播给所有窗口（终端属于这条通道，不属于哪个窗口把它开出来的）。
 *
 * @returns 撤销函数：退订输出转发与退出通知（重复注册前必须先调用，
 *          否则同一份 PTY 输出会被推两遍 —— W0 修过的那类缺陷）
 */
export function registerLocalTerminalHandlers(): () => void {
  /** shellId → 输出转发的退订函数 */
  const pushes = new Map<string, () => void>()
  /** shellId → 逐键写入的行缓冲闸（P0-2）。会话关闭时必须 delete，否则 Map 泄漏 */
  const lineGates = new Map<string, LineGate>()

  /** 取这条终端的闸，没有就建一个 */
  function gateOf(shellId: string): LineGate {
    let gate = lineGates.get(shellId)
    if (!gate) {
      gate = new LineGate()
      lineGates.set(shellId, gate)
    }
    return gate
  }

  /** 给一条终端挂上"输出 → 渲染层"的转发（幂等：已挂过的跳过） */
  function attachPush(shellId: string): void {
    if (pushes.has(shellId)) return
    // 闸必须在挂转发之前就存在：备用屏指令（vim/less 进出）通常比用户第一次
    // 按键先到，那时闸还不存在就等于这条指令被丢了
    gateOf(shellId)
    try {
      pushes.set(
        shellId,
        localPtyManager.onShellData(shellId, (data) => {
          // 备用屏指令是程序写给终端的，只能从输出侧观察 —— vim/less 期间要靠它暂停判定
          lineGates.get(shellId)?.observeOutput(data)
          broadcastToWindows(TERMINAL.DATA, shellId, data)
        }),
      )
    } catch {
      // 终端在这一瞬间就没了：没什么可转发的
    }
  }

  ipcMain.handle(LOCAL_TTY.STATUS, () => localPtyManager.getStatus())

  ipcMain.handle(LOCAL_TTY.LIST, () => localPtyManager.listShells())

  ipcMain.handle(LOCAL_TTY.START, (_event, size?: PtySize) => {
    const started = localPtyManager.startShell(size)
    if ('error' in started) throw new Error(started.error)
    attachPush(started.shellId)
    return started.shellId
  })

  ipcMain.handle(LOCAL_TTY.WRITE, (_event, shellId: string, data: string) => {
    try {
      const verdict = gateOf(shellId).feed(data)
      if (!verdict.allow) {
        logger.warn('LocalTerminal', '用户输入被风险闸拦截', {
          shellId,
          line: redactSecrets(verdict.line ?? ''),
          reason: redactSecrets(verdict.reason ?? ''),
        })
        // 两件事，方向不同，弄反了就是执行：
        // 1) stdin 发 Ctrl-C 弃掉 shell 行缓冲里已经躺着的这条命令（不放这一下，
        //    用户再按一次回车就真的执行了 —— 比不拦更糟）
        // 2) 提示走**输出**通道渲染到屏幕上。写进 stdin 等于把提示文本交给 shell
        localPtyManager.writeShell(shellId, PTY_ABANDON_LINE)
        broadcastToWindows(TERMINAL.DATA, shellId, verdict.notice ?? '')
        // 返回 false 而不是 throw：连接是好的，这是"按设计拒绝"，
        // 渲染层 onData 回调不读返回值，throw 反而会伪装成发送失败。
        return false
      }
      localPtyManager.writeShell(shellId, data)
      return true
    } catch (err) {
      const msg = redactSecrets((err as Error).message)
      logger.warn('LocalTerminal', '写入本机终端失败', { shellId, error: msg })
      throw new Error(msg)
    }
  })

  ipcMain.handle(LOCAL_TTY.RESIZE, (_event, shellId: string, cols: number, rows: number) => {
    try {
      localPtyManager.resizeShell(shellId, cols, rows)
      return true
    } catch (err) {
      const msg = redactSecrets((err as Error).message)
      logger.warn('LocalTerminal', '调整本机终端大小失败', { shellId, error: msg })
      return false
    }
  })

  ipcMain.handle(LOCAL_TTY.CLOSE, (_event, shellId: string) => {
    lineGates.delete(shellId)
    const off = pushes.get(shellId)
    if (off) {
      pushes.delete(shellId)
      try {
        off()
      } catch {
        // 退订失败不挡关闭
      }
    }
    return localPtyManager.closeShell(shellId)
  })

  ipcMain.handle(LOCAL_TTY.RUN_AUTHORED, (_event, shellId: string, command: string) => {
    const verdict = evaluateCommand(command)
    if (verdict.level === 'block') {
      logger.warn('LocalTerminal', '代写命令被风险闸拒绝', {
        shellId,
        command: redactSecrets(command),
        reason: verdict.reason,
      })
      throw new Error(`高危命令已被拦截：${verdict.reason}`)
    }
    const payload = command.endsWith('\n') ? command : `${command}\n`
    try {
      // \x15 = Ctrl+U：清掉当前行可能的半截输入，避免和命令拼在一起。
      // 行缓冲闸也必须同步清 —— 它镜像的就是 readline 当前行，不清会把
      // 用户敲了一半的输入和这条代写命令拼成一行去判。
      lineGates.get(shellId)?.reset()
      localPtyManager.writeShell(shellId, `\x15${payload}`)
      return true
    } catch (err) {
      const msg = redactSecrets((err as Error).message)
      logger.error('LocalTerminal', '执行代写命令失败', { shellId, error: msg })
      throw new Error(msg)
    }
  })

  const offExit = localPtyManager.onShellExit((shellId) => {
    // shell 自己退出（exit / 崩溃）时也要摘闸，否则 Map 里留着这条 shellId
    lineGates.delete(shellId)
    const off = pushes.get(shellId)
    if (off) {
      pushes.delete(shellId)
      try {
        off()
      } catch {
        // 同上
      }
    }
    broadcastToWindows(LOCAL_TTY.EXIT, shellId)
  })

  return () => {
    for (const off of pushes.values()) {
      try {
        off()
      } catch {
        // 逐条退订，一条失败不影响其它
      }
    }
    pushes.clear()
    lineGates.clear()
    offExit()
  }
}
