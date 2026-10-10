/**
 * 本机终端 IPC Handlers（W3）
 *
 * 注册 local-tty:* 一组通道，桥接渲染进程与 services/terminal/local-pty。
 *
 * 两条规矩与远端终端完全一致：
 * - WRITE 只送按键，不判定（逐键输入无法当整条命令评估，见通道注释）；
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
import { evaluateCommand } from '../core/command-gate'
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

  /** 给一条终端挂上"输出 → 渲染层"的转发（幂等：已挂过的跳过） */
  function attachPush(shellId: string): void {
    if (pushes.has(shellId)) return
    try {
      pushes.set(
        shellId,
        localPtyManager.onShellData(shellId, (data) => {
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
      // \x15 = Ctrl+U：清掉当前行可能的半截输入，避免和命令拼在一起
      localPtyManager.writeShell(shellId, `\x15${payload}`)
      return true
    } catch (err) {
      const msg = redactSecrets((err as Error).message)
      logger.error('LocalTerminal', '执行代写命令失败', { shellId, error: msg })
      throw new Error(msg)
    }
  })

  const offExit = localPtyManager.onShellExit((shellId) => {
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
    offExit()
  }
}
