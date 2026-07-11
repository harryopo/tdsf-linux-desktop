/**
 * 服务器状态管理 Store（Zustand）
 *
 * 职责：
 * - 管理服务器配置列表（增删改查）
 * - 跟踪当前活跃的 SSH 会话 ID
 * - 记录每个服务器的连接状态
 * - 持久化服务器配置到 localStorage
 *
 * 注意：密码/私钥等敏感信息不持久化到 localStorage，
 * 由主进程 safeStorage 加密存储。
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { SshConfig, SshConnectionState } from '@shared/models'

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

  // ===== Actions =====
  /** 添加服务器配置 */
  addServer: (server: SshConfig) => void
  /** 移除服务器配置 */
  removeServer: (serverId: string) => void
  /** 更新服务器配置 */
  updateServer: (serverId: string, partial: Partial<SshConfig>) => void
  /** 设置当前活跃会话 */
  setActiveSession: (sessionId: string | null) => void
  /** 更新服务器连接状态 */
  setConnectionState: (serverId: string, state: SshConnectionState) => void
  /** 记录服务器与会话的映射关系 */
  setSessionMapping: (serverId: string, sessionId: string) => void
  /** 清除会话映射 */
  clearSessionMapping: (serverId: string) => void
}

/** 服务器 Store */
export const useServerStore = create<ServerState>()(
  persist(
    (set) => ({
      servers: [],
      activeSessionId: null,
      connectionStates: {},
      sessionMap: {},

      // 添加服务器配置
      addServer: (server) =>
        set((state) => ({
          servers: [...state.servers, server],
        })),

      // 移除服务器配置
      removeServer: (serverId) =>
        set((state) => {
          const newConnectionStates = { ...state.connectionStates }
          const newSessionMap = { ...state.sessionMap }
          delete newConnectionStates[serverId]
          delete newSessionMap[serverId]
          return {
            servers: state.servers.filter((s) => s.id !== serverId),
            connectionStates: newConnectionStates,
            sessionMap: newSessionMap,
          }
        }),

      // 更新服务器配置
      updateServer: (serverId, partial) =>
        set((state) => ({
          servers: state.servers.map((s) =>
            s.id === serverId ? { ...s, ...partial } : s
          ),
        })),

      // 设置当前活跃会话
      setActiveSession: (sessionId) =>
        set({ activeSessionId: sessionId }),

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
      clearSessionMapping: (serverId) =>
        set((state) => {
          const newSessionMap = { ...state.sessionMap }
          delete newSessionMap[serverId]
          return { sessionMap: newSessionMap }
        }),
    }),
    {
      // 持久化到 localStorage 的 key
      name: 'tdsf-server-store',
      // 只持久化 servers 配置，连接状态和会话映射不持久化
      partialize: (state) => ({ servers: state.servers }),
    }
  )
)
