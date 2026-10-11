/**
 * 远端 Shell 集成 IPC Handlers（#61）
 *
 * 三条通道都以"这条会话现在活着吗"开头：SshConnectionManager.getClient 对
 * 不存在/未连接的会话直接抛错，正好当准入闸门——不给"给一台没连的机器写文件"留路。
 *
 * install 没有额外的确认字段：确认这件事发生在界面上（它先读 status 里那两份原文），
 * 到主进程这一步就是"用户已经点过头"。真正拦着乱装的是这里没有批量入口，
 * 以及写入路径全部由 shell-integration.ts 定死。
 */
import { ipcMain } from 'electron'
import { SHELL_INTEGRATION } from '@shared/ipc-channels'
import type { ShellIntegrationResult, ShellIntegrationStatus } from '@shared/models'
import { SshConnectionManager } from '../services/ssh/connection-manager'
import { shellIntegration } from '../services/ssh/shell-integration-runtime'

export function registerShellIntegrationHandlers(): void {
  const requireSession = (sessionId: string): string => {
    SshConnectionManager.getInstance().getClient(sessionId)
    return sessionId
  }

  ipcMain.handle(
    SHELL_INTEGRATION.STATUS,
    async (_event, sessionId: string): Promise<ShellIntegrationStatus> =>
      shellIntegration.status(requireSession(sessionId)),
  )

  ipcMain.handle(
    SHELL_INTEGRATION.INSTALL,
    async (_event, sessionId: string): Promise<ShellIntegrationResult> =>
      shellIntegration.install(requireSession(sessionId)),
  )

  ipcMain.handle(
    SHELL_INTEGRATION.UNINSTALL,
    async (_event, sessionId: string): Promise<ShellIntegrationResult> =>
      shellIntegration.uninstall(requireSession(sessionId)),
  )
}
