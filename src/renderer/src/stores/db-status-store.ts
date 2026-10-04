/**
 * 数据库状态 Store（Zustand）— A4：SQLite 降级可见化
 *
 * 职责：
 * - 启动时从主进程读一次 db:status
 * - 把"是否降级 / 迁移是否中断"交给全局横幅
 *
 * 持久化策略：不持久化。dismissed 只在本次会话生效，
 * 因为降级是持续存在的事实，重启应用后应当重新提醒。
 */
import { create } from 'zustand'
import type { DbStatus } from '@shared/db-types'
import { getElectronAPI } from '@/utils/electron-api'

/** 数据库状态 Store 接口 */
interface DbStatusState {
  /** 主进程返回的状态；null = 尚未取到（含非 Electron 环境与查询失败） */
  status: DbStatus | null
  /** 是否已完成过一次查询（避免重复请求） */
  loaded: boolean
  /** 用户是否关闭了横幅（本次会话内不再显示） */
  dismissed: boolean

  // ===== Actions =====
  /** 从主进程拉取数据库状态 */
  hydrateFromMain: () => Promise<void>
  /** 关闭横幅 */
  dismiss: () => void
}

/** 数据库状态 Store */
export const useDbStatusStore = create<DbStatusState>()((set, get) => ({
  status: null,
  loaded: false,
  dismissed: false,

  hydrateFromMain: async () => {
    if (get().loaded) return
    const api = getElectronAPI()
    if (!api?.dbGetStatus) {
      // 浏览器预览 / 测试环境：无 IPC 桥，按"未知"处理，横幅不显示
      set({ loaded: true })
      return
    }
    try {
      const status = await api.dbGetStatus()
      set({ status, loaded: true })
    } catch {
      // 查询失败同样按"未知"处理：宁可少提醒，也不要在状态未知时误报数据丢失
      set({ loaded: true })
    }
  },

  dismiss: () => set({ dismissed: true }),
}))
