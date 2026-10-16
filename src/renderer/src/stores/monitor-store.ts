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
import { alertKeyBelongsToSession } from '../components/monitor/monitor-model'

/** 每个会话保留的最大历史数据条数 */
const MAX_HISTORY_COUNT = 60

/**
 * 无数据时的稳定空数组。
 *
 * 不能每次调用现造 `[]`：zustand 5 走 React 原生 useSyncExternalStore，
 * 选择器返回新引用会被判成"快照变了"，直接 Maximum update depth exceeded
 * （监控页 CpuAreaChart 在 React 18 下不报，升 19 后必崩）。
 */
const EMPTY_MONITOR_DATA: MonitorData[] = Object.freeze([]) as unknown as MonitorData[]

/** 监控 Store 状态接口 */
interface MonitorState {
  /** 监控数据历史：sessionId → MonitorData[]（最近60条） */
  monitorData: Map<string, MonitorData[]>
  /** 系统静态信息：sessionId → SystemInfo */
  systemInfo: Map<string, SystemInfo>
  /**
   * 本次会话里被"标记已处理"的告警键（见 monitor-model 的 alertKey）
   *
   * 只在内存：指标恢复后这条键会被清掉，再越线重新算未处理。
   * 故意不做持久化——重启后假装"用户已经处理过这条磁盘告警"是不安全的默认。
   */
  ackedAlerts: Set<string>

  // ===== Actions =====
  /** 添加一条监控数据（自动保留最近60条） */
  addMonitorData: (sessionId: string, data: MonitorData) => void
  /** 设置系统信息 */
  setSystemInfo: (sessionId: string, info: SystemInfo) => void
  /** 登记一条告警已处理 */
  ackAlert: (key: string) => void
  /** 清掉某会话里已经不再成立的确认（告警消失＝这轮结束了） */
  pruneSessionAcks: (sessionId: string, liveKeys: string[]) => void
  /** 清除所有监控数据 */
  clearAllMonitorData: () => void
  /** 获取指定会话的监控数据历史（无会话/无数据返回同一个稳定空数组） */
  getMonitorData: (sessionId?: string | null) => MonitorData[]
  /** 获取指定会话的系统信息 */
  getSystemInfo: (sessionId: string) => SystemInfo | null
}

/** 监控 Store */
export const useMonitorStore = create<MonitorState>()((set, get) => ({
  monitorData: new Map(),
  systemInfo: new Map(),
  ackedAlerts: new Set(),

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

  // 清除所有监控数据
  clearAllMonitorData: () =>
    set({ monitorData: new Map(), systemInfo: new Map(), ackedAlerts: new Set() }),

  // 登记一条告警已处理（换新 Set 引用，useSyncExternalStore 才认这是变了）
  ackAlert: (key) =>
    set((state) => {
      if (state.ackedAlerts.has(key)) return state
      const next = new Set(state.ackedAlerts)
      next.add(key)
      return { ackedAlerts: next }
    }),

  // 该会话里不在 liveKeys 中的确认一律作废
  pruneSessionAcks: (sessionId, liveKeys) =>
    set((state) => {
      const live = new Set(liveKeys)
      const next = new Set<string>()
      for (const k of state.ackedAlerts) {
        if (alertKeyBelongsToSession(k, sessionId)) {
          if (live.has(k)) next.add(k)
        } else {
          next.add(k)
        }
      }
      if (next.size === state.ackedAlerts.size) return state
      return { ackedAlerts: next }
    }),

  // 获取指定会话的监控数据历史
  getMonitorData: (sessionId) => {
    if (!sessionId) return EMPTY_MONITOR_DATA
    return get().monitorData.get(sessionId) ?? EMPTY_MONITOR_DATA
  },

  // 获取指定会话的系统信息
  getSystemInfo: (sessionId) => {
    const state = get()
    return state.systemInfo.get(sessionId) ?? null
  },
}))
