/**
 * 服务器状态管理 Store（Zustand）
 *
 * 职责：
 * - 管理服务器配置列表（增删改查）
 * - 跟踪当前活跃的 SSH 会话 ID
 * - 记录每个服务器的连接状态
 * - **双重持久化**：localStorage 缓存 + 主进程 ConfigStore 权威存储
 *
 * 持久化策略（v0.7.0+，2026-10-09 P0-3 收口）：
 * - localStorage（zustand persist）：非敏感字段的快速 cache（脱敏，无密码）
 * - 主进程 electron-store + SecureStore：权威持久化（敏感信息加密存储）
 * - 同步流程：任何变更 → IPC serverSave；凭据只可能是用户此刻在表单里现填的那一份
 * - 加载流程：启动时 serverList() 拿 **ServerListItem**（无凭据 + hasCredential 布尔），
 *   主进程里那份解密后的凭据永不跨进程边界
 *
 * 敏感信息（密码/私钥/口令）在本 Store 的规矩：
 * - 状态里不存在这三键（类型 ServerListItem 从根上不给）——要连已保存的服务器请走
 *   `window.electronAPI.sshConnectById(id, 一次性口令)`，主进程自己去 SecureStore 取
 * - 只有 addServer / updateServer 的入参可以短暂携带用户当场输入的凭据，
 *   用途仅限"把它交给主进程存好"，落进 state 前一律经 toListItem 剥掉
 * - 因此 addServer 的入参是 SshConfig（新建表单原样），state 里存的是 ServerListItem
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ServerListItem, SshConfig, SshConnectionState } from '@shared/models'
import { isElectronAPIAvailable } from '../utils/electron-api'

/** 服务器 Store 状态接口 */
interface ServerState {
  /** 服务器列表（渲染层形状：凭据三键不存在，只有 hasCredential） */
  servers: ServerListItem[]
  /** 当前活跃的 SSH 会话 ID */
  activeSessionId: string | null
  /** 服务器连接状态映射：serverId → 连接状态 */
  connectionStates: Record<string, SshConnectionState>
  /** 服务器与会话ID的映射：serverId → sessionId */
  sessionMap: Record<string, string>
  /** 是否已从主进程加载（避免重复加载） */
  _hydrated: boolean

  // ===== Actions =====
  /** 添加服务器配置（入参是新建表单的原样，可能带用户当场输入的凭据） */
  addServer: (server: SshConfig) => Promise<boolean>
  /** 移除服务器配置 */
  removeServer: (serverId: string) => Promise<void>
  /** 更新服务器配置（partial 里的凭据同样是用户当场重输的，落 state 前剥掉） */
  updateServer: (serverId: string, partial: Partial<SshConfig>) => Promise<void>
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
 * 收敛成渲染层能持有的形状：剥掉 password / privateKey / passphrase，换成 hasCredential。
 *
 * 与主进程 ConfigStore.loadServerListPublic() 同一口径（连 jumpHost 一起剥），
 * 保证"本地算出来的形状"和"主进程下发的形状"一致，UI 只认 hasCredential 一个来源。
 *
 * @param server 任意来源的配置（可以是刚填完的表单，也可以是已有列表项）
 * @param hasCredential 主进程是否存有这台机器的凭据；由调用方按场景决定，
 *                      不从 server 上反推——本地这一份带的凭据只是用户当场填的，
 *                      不代表主进程里存过什么。
 */
function toListItem(server: SshConfig, hasCredential: boolean): ServerListItem {
  const { password, privateKey, passphrase, jumpHost, ...rest } = server
  void password
  void privateKey
  void passphrase
  const item: ServerListItem = { ...rest, hasCredential }
  if (jumpHost) {
    const { password: jhPassword, privateKey: jhKey, passphrase: jhPassphrase, ...jhRest } = jumpHost
    void jhPassword
    void jhKey
    void jhPassphrase
    item.jumpHost = jhRest
  }
  return item
}

/** 这份配置是否自带凭据（只用于推导 hasCredential，不读取原文、不外传） */
function providesCredential(server: Partial<SshConfig>): boolean {
  return Boolean(server.password || server.privateKey || server.passphrase)
}

/**
 * 监控采集间隔（毫秒）—— 全应用唯一口径
 *
 * 原先三处各传各的：工作台标题栏传 `monitorStart(sessionId, 3)`（v2.4 起这个参数按毫秒算，
 * 3 被主进程下限夹成 1000，本意其实是 3 秒），监控页传 5000，设置页的连接路径根本没启动。
 * 于是"从哪条路连上的"决定了指标走不走 —— 用户看到的"进程监控失败/首页永远离线"就是这条。
 */
export const MONITOR_INTERVAL_MS = 3000

/**
 * 让主进程开始采集这台主机的指标
 *
 * 只在"会话被激活"这一个时点触发，主进程侧是幂等的（同会话重复启动直接返回 true）。
 * 起不来不外抛：指标缺失由各界面自己的"无数据"形态负责显示，
 * 在这里抛错只会把连接流程打断。
 */
function ensureMonitoring(sessionId: string): void {
  const api = typeof window === 'undefined' ? undefined : window.electronAPI
  if (!api?.monitorStart) return
  api.monitorStart(sessionId, MONITOR_INTERVAL_MS).catch(() => {})
}

/**
 * 同步到主进程
 *
 * 出站列表 = 主进程里存的那些（本来就没有凭据）+ 用户此刻在表单里现填的凭据。
 * 主进程 saveServerList 自行分离存储：
 * - 非敏感字段（host/port/username 等）→ electron-store（明文 JSON）
 * - 敏感字段（password/privateKey/passphrase）→ SecureStore（safeStorage 加密）
 * 且只在凭据非空时写入，所以列表里"没有凭据"的老条目不会被空值覆盖掉已存的那份。
 *
 * 加载方向反过来：主进程不再下发凭据，渲染层要连接只交 ID（sshConnectById）。
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
        const current = get().servers
        // 出站那份保留用户当场填的凭据（主进程负责加密存好）
        const outgoing = [...current, server]
        // 进 state 的那份必须脱敏：界面上任何组件都读不到 password/privateKey/passphrase
        set({ servers: [...current, toListItem(server, providesCredential(server))] })
        // 异步同步到主进程（不阻塞 UI）
        const ok = await syncToMain(outgoing)
        if (!ok && isElectronAPIAvailable()) {
          console.warn(`[ServerStore] 服务器「${server.name}」未持久化到主进程`)
        }
        // 把成败带回给调用方：新建这条带着用户当场填的口令，
        // 主进程存不进加密存储时页面要能说出"下次连接要重输"，而不是"已添加"。
        return ok
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
        // 出站：partial 可能带用户当场重输的凭据，原样交给主进程（主进程只在非空时覆盖存的那份）
        const outgoing = get().servers.map((s) => (s.id === serverId ? { ...s, ...partial } : s))
        // 进 state：脱敏。hasCredential = "主进程本来就存有" 或 "这次带来了新的"，任一为真即真
        const newServers = outgoing.map((s) =>
          s.id === serverId ? toListItem(s, s.hasCredential || providesCredential(partial)) : s,
        )
        set({ servers: newServers })
        await syncToMain(outgoing)
      },

      // 设置当前活跃会话：顺带确保这台主机的监控在采集（见 MONITOR_INTERVAL_MS 注释）
      setActiveSession: (sessionId) => {
        set({ activeSessionId: sessionId })
        if (sessionId) ensureMonitoring(sessionId)
      },

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
       * - 凭据（password/privateKey/passphrase）根本不在返回形状里（2026-10-09 P0-3）：
       *   server:list 只下发 ServerListItem（非敏感字段 + hasCredential），
       *   要连接已保存的服务器请走 sshConnectById(id)，主进程自己从 SecureStore 取凭据。
       * - 主进程有数据：以主进程为准，覆盖 localStorage 缓存
       * - 主进程无数据但 localStorage 有：可能是旧版本迁移或主进程数据丢失，
       *   用 localStorage 回写主进程（此时必然无凭据，用户要重新输一次口令）
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
            // 主进程权威：直接用主进程下发的形状（本来就不含凭据），覆盖 localStorage 缓存
            console.log('[ServerStore] 使用主进程数据作为权威数据源（不含凭据，hasCredential 标记已带）')
            set({ servers: mainServers, _hydrated: true })
          } else if (localServers.length > 0) {
            // 主进程为空但 localStorage 有：可能是旧版本迁移，回写主进程（此时必然无凭据）
            console.log('[ServerStore] 主进程为空，使用 localStorage 数据回写主进程（凭据需用户重输）')
            set({ _hydrated: true })
            await syncToMain(localServers)
          } else {
            // 两边都没有
            set({ _hydrated: true })
          }
        } catch (err) {
          console.error('[ServerStore] 从主进程加载失败:', err)
          // 读失败不等于"服务器列表是空的"：这里以前也置 _hydrated=true，
          // 于是这一次失败被永久认账——守卫再也不放行重读，界面上的空列表看起来就是事实。
          // 保持未水合，下一个挂载点（App / SSH 设置页）会再读一次。
        }
      },
    }),
    {
      // 持久化到 localStorage 的 key
      name: 'tdsf-server-store',
      // 只持久化 servers 配置，连接状态和会话映射不持久化。
      // 再走一遍 toListItem 做兜底脱敏：state 里本来就没有凭据三键，
      // 但旧版本写过的缓存 / 将来有人改类型都不能让口令落到磁盘上（localStorage 是明文）。
      partialize: (state) => ({
        servers: state.servers.map((s) => toListItem(s, s.hasCredential)),
      }),
    }
  )
)
