/**
 * useServerConnect — 「连上一台服务器并备好终端」这条路的唯一实现
 *
 * 工作台顶栏的服务器菜单与启动页的快速连接都走这里。以前这段只长在
 * WorkbenchTitlebar 里，启动页要复用就得抄一遍 —— 抄一遍就意味着两条路会分叉
 * （谁忘了 setSessionMapping，另一处就会把命令打进上一个会话里）。
 *
 * 凭据口径照旧（安全审查 P0-3）：
 * - 已保存的服务器只交 ID，口令/私钥由主进程从 SecureStore 取；
 *   oneTimePassword 是用户此刻当场重输的那一份，只用于这一次连接。
 * - 只有对话框里现填的新配置才整份交给 sshConnect。
 */
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { useServerStore } from '@/stores/server-store'
import { ensureShellForSession, shellTitleOf } from '@/terminal/shell-launcher'
import { isElectronAPIAvailable } from '@/utils/electron-api'
import type { SshConfig } from '@shared/models'

/**
 * 连接目标：id 用于状态登记，name/host 只用于提示文案。
 *
 * 故意不写成 SshConfig —— 列表里的 ServerListItem 与对话框现填的表单都能套进来，
 * 而"把整份配置交给主进程"这件事只在新建那一条路上才需要。
 */
export interface ConnectTarget {
  id: string
  name: string
  host: string
}

export interface UseServerConnectOptions {
  /** 会话就绪（含"已有会话直接切过去"）后回调，供调用方收起自己的菜单 */
  onConnected?: () => void
}

export function useServerConnect({ onConnected }: UseServerConnectOptions = {}) {
  const sessionMap = useServerStore((s) => s.sessionMap)
  const connectionStates = useServerStore((s) => s.connectionStates)
  const setActiveSession = useServerStore((s) => s.setActiveSession)
  const setConnectionState = useServerStore((s) => s.setConnectionState)
  const setSessionMapping = useServerStore((s) => s.setSessionMapping)
  const [connectingId, setConnectingId] = useState<string | null>(null)

  const openSession = useCallback(
    async (target: ConnectTarget, obtain: () => Promise<string>): Promise<void> => {
      if (!isElectronAPIAvailable()) {
        toast.error('请在 Electron 桌面端运行')
        return
      }
      // 已有会话直接切换
      const existing = sessionMap[target.id]
      if (existing && connectionStates[target.id] === 'connected') {
        setActiveSession(existing)
        onConnected?.()
        return
      }

      setConnectingId(target.id)
      setConnectionState(target.id, 'connecting')
      try {
        const sessionId = await obtain()
        try {
          // 连接成功后顺手开一个终端；这台主机已经有终端就复用，不再叠一个
          // （以前每条连接都直接 sshShellStart，两次点击就等于两条转发回调）
          const shell = await ensureShellForSession(sessionId, shellTitleOf(target.name ?? target.host))
          if (!shell.ok) toast.warning(`终端没能打开：${shell.reason}`)
        } catch (shellErr) {
          console.warn('[useServerConnect] shell start failed', shellErr)
          toast.warning('Shell 启动失败，终端可能不可用')
        }
        setConnectionState(target.id, 'connected')
        setSessionMapping(target.id, sessionId)
        setActiveSession(sessionId)
        // 监控由 setActiveSession 统一拉起（见 server-store 的 MONITOR_INTERVAL_MS）
        onConnected?.()
        toast.success(`已连接 ${target.name || target.host}`)
      } catch (err) {
        setConnectionState(target.id, 'error')
        toast.error(`连接失败: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        setConnectingId(null)
      }
    },
    [sessionMap, connectionStates, setActiveSession, setConnectionState, setSessionMapping, onConnected],
  )

  const connectSavedServer = useCallback(
    (server: ConnectTarget, oneTimePassword?: string): Promise<void> =>
      openSession(server, () => window.electronAPI.sshConnectById(server.id, oneTimePassword)),
    [openSession],
  )

  const connectFreshConfig = useCallback(
    (config: SshConfig): Promise<void> => openSession(config, () => window.electronAPI.sshConnect(config)),
    [openSession],
  )

  return { connectingId, connectSavedServer, connectFreshConfig }
}
