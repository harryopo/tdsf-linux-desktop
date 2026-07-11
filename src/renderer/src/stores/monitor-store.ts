/**
 * 监控数据状态管理 Store（Zustand）
 *
 * 职责：
 * - 管理每个 SSH 会话的监控数据历史（最近 60 条）
 * - 管理每个会话的系统静态信息
 * - 提供数据清理操作
 *
 * 监控数据由主进程 monitor:data 事件推送，渲染进程接收后存入 Store。
 * 每个 sessionId 保留最多 60 条历史数据（约 60 秒，1 秒/条）。
 */
import { create } from 'zustand'
import type { MonitorData, SystemInfo } from '@shared/models'

/** 每个会话保留的最大历史数据条数 */
const MAX_HISTORY_COUNT = 60

/** 监控 Store 状态接口 */
interface MonitorState {
  /** 监控数据历史：sessionId → MonitorData[]（最近60条） */
  monitorData: Map<string, MonitorData[]>
  /** 系统静态信息：sessionId → SystemInfo */
  systemInfo: Map<string, SystemInfo>

  // ===== Actions =====
  /** 添加一条监控数据（自动保留最近60条） */
  addMonitorData: (sessionId: string, data: MonitorData) => void
  /** 设置系统信息 */
  setSystemInfo: (sessionId: string, info: SystemInfo) => void
  /** 清除指定会话的监控数据 */
  clearMonitorData: (sessionId: string) => void
  /** 清除所有监控数据 */
  clearAllMonitorData: () => void
  /** 获取指定会话的监控数据历史 */
  getMonitorData: (sessionId: string) => MonitorData[]
  /** 获取指定会话的最新监控数据 */
  getLatestMonitorData: (sessionId: string) => MonitorData | null
  /** 获取指定会话的系统信息 */
  getSystemInfo: (sessionId: string) => SystemInfo | null
}

/** 监控 Store */
export const useMonitorStore = create<MonitorState>()((set, get) => ({
  monitorData: new Map(),
  systemInfo: new Map(),

  // 添加一条监控数据（自动保留最近60条）
  addMonitorData: (sessionId, data) =>
    set((state) => {
      const newMap = new Map(state.monitorData)
      const history = newMap.get(sessionId) ?? []
      // 追加新数据，超出上限则截断
      const newHistory = [...history, data].slice(-MAX_HISTORY_COUNT)
      newMap.set(sessionId, newHistory)
      return { monitorData: newMap }
    }),

  // 设置系统信息
  setSystemInfo: (sessionId, info) =>
    set((state) => {
      const newMap = new Map(state.systemInfo)
      newMap.set(sessionId, info)
      return { systemInfo: newMap }
    }),

  // 清除指定会话的监控数据
  clearMonitorData: (sessionId) =>
    set((state) => {
      const newMonitorMap = new Map(state.monitorData)
      const newSystemMap = new Map(state.systemInfo)
      newMonitorMap.delete(sessionId)
      newSystemMap.delete(sessionId)
      return { monitorData: newMonitorMap, systemInfo: newSystemMap }
    }),

  // 清除所有监控数据
  clearAllMonitorData: () =>
    set({ monitorData: new Map(), systemInfo: new Map() }),

  // 获取指定会话的监控数据历史
  getMonitorData: (sessionId) => {
    const state = get()
    return state.monitorData.get(sessionId) ?? []
  },

  // 获取指定会话的最新监控数据
  getLatestMonitorData: (sessionId) => {
    const state = get()
    const history = state.monitorData.get(sessionId)
    if (!history || history.length === 0) return null
    return history[history.length - 1]
  },

  // 获取指定会话的系统信息
  getSystemInfo: (sessionId) => {
    const state = get()
    return state.systemInfo.get(sessionId) ?? null
  },
}))
