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
 * - 敏感信息（apiKey）通过主进程 safeStorage 加密存储
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { LlmConfig, SshConfig } from '@shared/models'
import { isElectronAPIAvailable } from '../utils/electron-api'

/**
 * 默认 LLM 配置
 *
 * v2.3.4 修复：与 ModelSettings 默认值对齐（DeepSeek V4 Flash）
 * - 之前默认火山方舟，但用户多数未配置火山 key → 导致连接失败被误判为大模型不可用
 * - DeepSeek V4 Flash 是国内可用 + 256K 上下文 + 价格亲民，对个人/教学用户最友好
 * - 用户可在设置中切换为其他 Provider（Provider 列表是真实可用的）
 *
 * 注意：endpoint/model/温度等是基线默认值，ModelSettings 加载时会用 Provider 列表的
 * 默认值再次覆盖，确保与 Provider 模板同步。
 */
const DEFAULT_LLM_CONFIG: LlmConfig = {
  baseUrl: 'https://api.deepseek.com',
  apiKey: '',
  model: 'deepseek-v4-flash',
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
  /** LLM 配置 */
  llmConfig: LlmConfig
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
  /** 保存设置到主进程 */
  saveSettings: () => Promise<void>
}

/** 设置 Store */
export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      llmConfig: DEFAULT_LLM_CONFIG,
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
          const { configGet, storageGetApiKey } = window.electronAPI
          // 并行加载配置
          //
          // v2.3.4 修复：API Key 存储 key 从 'llm_api_key' 改为 'llm'
          // - 主进程 llm.ts 的 getLlmClient() 调的是 SecureStore.getApiKey('llm')
          // - 之前前端用 'llm_api_key' 存，主进程用 'llm' 读 → 永远读不到用户填的 key
          //   → 这是"大模型连不上"的根因之一
          // - 改后两端都用 'llm'，存储 key 对齐
          const [llmConfig, sshDefaults, sshTimeout, apiKey] =
            await Promise.all([
              configGet<LlmConfig>('llmConfig'),
              configGet<Partial<SshConfig>>('sshDefaults'),
              configGet<number>('sshTimeout'),
              storageGetApiKey('llm'),
            ])

          set({
            llmConfig: llmConfig ?? get().llmConfig,
            sshDefaults: sshDefaults ?? get().sshDefaults,
            sshTimeout: sshTimeout ?? get().sshTimeout,
          })

          // 如果主进程存有 API Key，则使用
          if (apiKey) {
            set((state) => ({
              llmConfig: { ...state.llmConfig, apiKey },
            }))
          }
        } catch (error) {
          console.error('加载设置失败:', error)
        }
      },

      // 保存设置到主进程
      saveSettings: async () => {
        try {
          // preload 未加载时，仅使用 localStorage 持久化数据
          if (!isElectronAPIAvailable()) {
            console.warn('[SettingsStore] electronAPI 不可用，跳过保存到主进程')
            return
          }
          const { configSet, storageSaveApiKey } = window.electronAPI
          const { llmConfig, sshDefaults, sshTimeout } = get()

          // v2.3.4 修复：API Key 存储 key 对齐到 'llm'（与主进程 llm.ts 读 key 一致）
          // - 之前用 'llm_api_key'，主进程 SecureStore.getApiKey('llm') 读不到
          // - 现在用 'llm'，与 ConfigStore.saveLlmConfig 内部的 SecureStore.saveApiKey('llm', ...) 一致
          if (llmConfig.apiKey) {
            await storageSaveApiKey('llm', llmConfig.apiKey)
          }

          // 非敏感配置存入 config
          // v2.3.4 修复：使用 configSet 真正写入 ConfigStore，
          // 之前 settings-store 的 localStorage 持久化只在前端有效，主进程 llm.ts
          // 读的是 ConfigStore.getLlmConfig() → 永远读不到前端存的内容
          const safeLlmConfig = { ...llmConfig, apiKey: '' }
          await Promise.all([
            configSet('llmConfig', safeLlmConfig),
            configSet('sshDefaults', sshDefaults),
            configSet('sshTimeout', sshTimeout),
          ])
        } catch (error) {
          console.error('保存设置失败:', error)
        }
      },
    }),
    {
      name: 'tdsf-settings-store',
      // 不持久化 apiKey
      partialize: (state) => ({
        llmConfig: { ...state.llmConfig, apiKey: '' },
        sshDefaults: state.sshDefaults,
        sshTimeout: state.sshTimeout,
      }),
    }
  )
)
