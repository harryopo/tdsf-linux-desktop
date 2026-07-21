/**
 * 服务器状态管理 Store（Zustand）
 *
 * 职责：
 * - 管理服务器配置列表（增删改查）
 * - 跟踪当前活跃的 SSH 会话 ID
 * - 记录每个服务器的连接状态
 * - **双重持久化**：localStorage 缓存 + 主进程 ConfigStore 权威存储
 *
 * 持久化策略（v0.7.0+）：
 * - localStorage（zustand persist）：快速 cache，避免 IPC 频繁往返
 * - 主进程 electron-store：权威持久化（重装/迁移不丢失）
 * - 同步流程：任何变更 → 立即 IPC serverSave → 写入主进程
 * - 加载流程：启动时优先从主进程加载（如果 localStorage 没有则用主进程数据）
 *
 * 敏感信息（密码/私钥）：
 * - 不持久化到 localStorage（脱敏）
 * - 由主进程 safeStorage 加密存储（ConfigStore.saveServerList）
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { SshConfig, SshConnectionState } from '@shared/models'
import { isElectronAPIAvailable } from '../utils/electron-api'

/** 服务器 Store 状态接口 */
interface ServerState {
  /** 服务器配置列表 */
  servers: SshConfig[]
  /** 当前活跃的 SSH 会话 ID */
  activeSessionId: string | null
  /** 服务器连接状态映射：serverId → 连接状态 */
  connectionStates: Record<string, SshConnectionState>
  /** 服务器与会话ID的映射：serverId → sessionId */
  sessionMap: Record<string, string>
  /** 是否已从主进程加载（避免重复加载） */
  _hydrated: boolean

  // ===== Actions =====
  /** 添加服务器配置 */
  addServer: (server: SshConfig) => Promise<void>
  /** 移除服务器配置 */
  removeServer: (serverId: string) => Promise<void>
  /** 更新服务器配置 */
  updateServer: (serverId: string, partial: Partial<SshConfig>) => Promise<void>
  /** 批量替换服务器列表 */
  setServers: (servers: SshConfig[]) => Promise<void>
  /** 设置当前活跃会话 */
  setActiveSession: (sessionId: string | null) => void
  /** 更新服务器连接状态 */
  setConnectionState: (serverId: string, state: SshConnectionState) => void
  /** 记录服务器与会话的映射关系 */
  setSessionMapping: (serverId: string, sessionId: string) => void
  /** 清除会话映射 */
  clearSessionMapping: (serverId: string) => void
  /** 从主进程加载（应用启动时调用） */
  hydrateFromMain: () => Promise<void>
}

/**
 * 同步到主进程（脱敏后调用 server:save）
 * 即使失败也不阻塞 UI（localStorage 已经持久化）
 */
async function syncToMain(servers: SshConfig[]): Promise<boolean> {
  if (!isElectronAPIAvailable()) {
    console.warn('[ServerStore] electronAPI 不可用，跳过主进程同步')
    return false
  }
  try {
    // 脱敏：移除密码/私钥/口令（主进程会从 safeStorage 重新加密）
    const sanitized = servers.map((s) => {
      const { password, privateKey, passphrase, ...rest } = s
      void password
      void privateKey
      void passphrase
      return rest
    })
    const ok = await window.electronAPI.serverSave(sanitized as SshConfig[])
    if (ok) {
      console.log(`[ServerStore] 已同步 ${servers.length} 个服务器到主进程`)
    }
    return ok
  } catch (err) {
    console.error('[ServerStore] 同步到主进程失败:', err)
    return false
  }
}

/** 服务器 Store */
export const useServerStore = create<ServerState>()(
  persist(
    (set, get) => ({
      servers: [],
      activeSessionId: null,
      connectionStates: {},
      sessionMap: {},
      _hydrated: false,

      // 添加服务器配置
      addServer: async (server) => {
        const newServers = [...get().servers, server]
        set({ servers: newServers })
        // 异步同步到主进程（不阻塞 UI）
        const ok = await syncToMain(newServers)
        if (!ok && isElectronAPIAvailable()) {
          console.warn(`[ServerStore] 服务器「${server.name}」未持久化到主进程`)
        }
      },

      // 移除服务器配置
      removeServer: async (serverId) => {
        const newConnectionStates = { ...get().connectionStates }
        const newSessionMap = { ...get().sessionMap }
        delete newConnectionStates[serverId]
        delete newSessionMap[serverId]
        const newServers = get().servers.filter((s) => s.id !== serverId)
        set({
          servers: newServers,
          connectionStates: newConnectionStates,
          sessionMap: newSessionMap,
        })
        await syncToMain(newServers)
      },

      // 更新服务器配置
      updateServer: async (serverId, partial) => {
        const newServers = get().servers.map((s) =>
          s.id === serverId ? { ...s, ...partial } : s
        )
        set({ servers: newServers })
        await syncToMain(newServers)
      },

      // 批量替换服务器列表
      setServers: async (newServers) => {
        set({ servers: newServers })
        await syncToMain(newServers)
      },

      // 设置当前活跃会话
      setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),

      // 更新服务器连接状态
      setConnectionState: (serverId, connectionState) =>
        set((state) => ({
          connectionStates: {
            ...state.connectionStates,
            [serverId]: connectionState,
          },
        })),

      // 记录服务器与会话的映射关系
      setSessionMapping: (serverId, sessionId) =>
        set((state) => ({
          sessionMap: {
            ...state.sessionMap,
            [serverId]: sessionId,
          },
        })),

      // 清除会话映射
      clearSessionMapping: (serverId) => {
        const newSessionMap = { ...get().sessionMap }
        delete newSessionMap[serverId]
        set({ sessionMap: newSessionMap })
      },

      /**
       * 从主进程加载服务器列表（应用启动时调用一次）
       * 优先级：localStorage（已 hydrate） > 主进程
       * 如果 localStorage 没有数据但主进程有，使用主进程数据
       */
      hydrateFromMain: async () => {
        if (!isElectronAPIAvailable()) {
          console.warn('[ServerStore] electronAPI 不可用，跳过主进程加载')
          return
        }
        if (get()._hydrated) {
          console.log('[ServerStore] 已从主进程加载过，跳过')
          return
        }
        try {
          console.log('[ServerStore] 正在从主进程加载服务器列表...')
          const mainServers = await window.electronAPI.serverList()
          const localServers = get().servers
          console.log(`[ServerStore] 主进程返回 ${mainServers.length} 个，localStorage 有 ${localServers.length} 个`)

          // 决策：localStorage 没有但主进程有 → 用主进程
          if (localServers.length === 0 && mainServers.length > 0) {
            console.log('[ServerStore] localStorage 为空，使用主进程数据')
            set({ servers: mainServers, _hydrated: true })
          } else if (localServers.length > 0) {
            // localStorage 有数据：以 localStorage 为准，但回写到主进程（防止主进程数据丢失）
            console.log('[ServerStore] localStorage 有数据，回写主进程以保证一致')
            set({ _hydrated: true })
            await syncToMain(localServers)
          } else {
            // 两边都没有
            set({ _hydrated: true })
          }
        } catch (err) {
          console.error('[ServerStore] 从主进程加载失败:', err)
          set({ _hydrated: true })
        }
      },
    }),
    {
      // 持久化到 localStorage 的 key
      name: 'tdsf-server-store',
      // 只持久化 servers 配置，连接状态和会话映射不持久化
      partialize: (state) => ({
        servers: state.servers.map((s) => {
          // 脱敏：localStorage 不保存密码/私钥/口令
          const { password, privateKey, passphrase, ...rest } = s
          void password
          void privateKey
          void passphrase
          return rest
        }),
      }),
    }
  )
)
