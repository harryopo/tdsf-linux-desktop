/**
 * 监控数据状态管理 Store（Zustand）
 *
 * 职责：
 * - 管理每个 SSH 会话的监控数据历史（每分钟一个采样，覆盖 24 小时）
 * - 管理每个会话的系统静态信息
 * - 提供数据清理操作
 *
 * 监控数据由主进程 monitor:data 事件推送（3 秒一条）。以前只留最近 60 条
 * （约 3 分钟），而页面提供 1H/6H/24H 三档——三档筛的是同一批点，
 * 切了图形不动，"24H"其实是假的（#183）。
 *
 * 现在同一分钟内只保留最后一个采样（画图时按档位再降采样），
 * 1441 条 ≈ 24 小时，内存可控且三档各有真实数据。
 */
import { create } from 'zustand'
import type { MonitorData, SystemInfo } from '@shared/models'
import { alertKeyBelongsToSession } from '../components/monitor/monitor-model'

/** 每个会话保留的最大历史数据条数（每分钟一条，1441 ≈ 24 小时 + 当前这一分钟） */
export const MAX_HISTORY_COUNT = 1441

/** 同一分钟内的采样只保留最后一个（时间戳分桶口径） */
export const SAMPLE_BUCKET_MS = 60_000

/**
 * 追加一条采样
 *
 * 同一分钟里后来的样本顶掉前一个——保留"这一分钟的最后一个真实值"，
 * 不插值、不平均；跨分钟才新增一条。
 */
export function appendMonitorSample(
  history: readonly MonitorData[],
  data: MonitorData
): MonitorData[] {
  const last = history[history.length - 1]
  if (
    last &&
    data.timestamp >= last.timestamp &&
    Math.floor(last.timestamp / SAMPLE_BUCKET_MS) === Math.floor(data.timestamp / SAMPLE_BUCKET_MS)
  ) {
    return [...history.slice(0, -1), data]
  }
  return [...history, data].slice(-MAX_HISTORY_COUNT)
}

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
  /** 监控数据历史：sessionId → MonitorData[]（每分钟一条，覆盖 24 小时） */
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
  /** 添加一条监控数据（同分钟覆盖，最多 24 小时） */
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

  // 添加一条监控数据（同分钟覆盖，最多 24 小时）
  addMonitorData: (sessionId, data) =>
    set((state) => {
      const newMap = new Map(state.monitorData)
      newMap.set(sessionId, appendMonitorSample(newMap.get(sessionId) ?? [], data))
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
