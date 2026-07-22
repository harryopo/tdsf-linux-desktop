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
 * - localStorage（zustand persist）：非敏感字段的快速 cache（脱敏，无密码）
 * - 主进程 electron-store + SecureStore：权威持久化（含敏感信息加密存储）
 * - 同步流程：任何变更 → 立即 IPC serverSave（传完整对象含密码）→ 主进程分离存储
 * - 加载流程：启动时以主进程为权威数据源（含密码），覆盖 localStorage 缓存
 *
 * 敏感信息（密码/私钥）：
 * - 不持久化到 localStorage（partialize 脱敏）
 * - 由主进程 safeStorage 加密存储（ConfigStore.saveServerList 分离存储逻辑）
 * - syncToMain 传完整对象给主进程，不在渲染层脱敏（否则主进程收不到密码）
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
 * 同步到主进程（传完整 server 对象，含敏感信息）
 *
 * 注意：不在此处脱敏。主进程的 saveServerList 会自行分离存储：
 * - 非敏感字段（host/port/username 等）→ electron-store（明文 JSON）
 * - 敏感字段（password/privateKey/passphrase）→ SecureStore（safeStorage 加密）
 *
 * IPC 通道是进程内通信，password 不经过网络，安全风险可控。
 * 若在此处脱敏，主进程将永远收不到敏感信息，SecureStore 不会被写入，
 * 重启后密码丢失。
 *
 * 即使失败也不阻塞 UI（localStorage 已经持久化非敏感字段）。
 */
async function syncToMain(servers: SshConfig[]): Promise<boolean> {
  if (!isElectronAPIAvailable()) {
    console.warn('[ServerStore] electronAPI 不可用，跳过主进程同步')
    return false
  }
  try {
    const ok = await window.electronAPI.serverSave(servers)
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
        // 先清除 SecureStore 中该服务器的凭据（防止密码残留泄漏），再同步列表
        // saveServerList 只保存现存服务器的凭据，不会清理已删除服务器的旧凭据
        if (isElectronAPIAvailable()) {
          try {
            await window.electronAPI.serverDeleteCred(serverId)
          } catch (err) {
            console.error(`[ServerStore] 清除服务器 ${serverId} 凭据失败:`, err)
          }
        }
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
       *
       * 策略：主进程权威 + localStorage 缓存非敏感字段
       * - 密码/privateKey/passphrase 只从主进程获取（localStorage 脱敏，不含敏感信息）
       * - 主进程有数据：始终以主进程为准（含密码），覆盖 localStorage 缓存
       * - 主进程无数据但 localStorage 有：可能是旧版本迁移或主进程数据丢失，
       *   用 localStorage 回写主进程（注意：此时密码可能缺失，需用户重新输入）
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

          if (mainServers.length > 0) {
            // 主进程权威：使用主进程完整数据（含密码），覆盖 localStorage 缓存
            console.log('[ServerStore] 使用主进程数据（含密码）作为权威数据源')
            set({ servers: mainServers, _hydrated: true })
          } else if (localServers.length > 0) {
            // 主进程为空但 localStorage 有：可能是旧版本迁移，回写主进程
            console.log('[ServerStore] 主进程为空，使用 localStorage 数据回写主进程')
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
