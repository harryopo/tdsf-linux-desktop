/**
 * 设置状态管理 Store（Zustand）
 *
 * 职责：
 * - 管理 LLM 配置（API Key / Base URL / 模型名 / 温度等）
 * - 管理 SSH 默认配置（默认端口 / 用户名 / 超时）
 * - 管理风险规则（命令黑名单）
 * - 提供 loadSettings / saveSettings 方法与主进程同步
 *
 * 持久化策略：
 * - 非敏感配置（baseUrl/model/temperature 等）持久化到 localStorage
 * - 敏感信息（apiKey）通过主进程 safeStorage 加密存储
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { LlmConfig, SshConfig, RiskLevel } from '@shared/models'
import { isElectronAPIAvailable } from '../utils/electron-api'

/** 风险规则条目 */
export interface RiskRule {
  /** 规则名称 */
  name: string
  /** 风险等级 */
  level: RiskLevel
  /** 匹配模式（正则字符串） */
  pattern: string
  /** 风险描述 */
  description: string
  /** 是否启用 */
  enabled: boolean
}

/** 资产标签 */
export interface AssetTag {
  id: string
  name: string
  color: string
}

/** 默认 LLM 配置 */
const DEFAULT_LLM_CONFIG: LlmConfig = {
  baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  apiKey: '',
  model: 'doubao-seed-1-6-250615',
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
}

/** 默认风险规则 */
const DEFAULT_RISK_RULES: RiskRule[] = [
  {
    name: '禁止 rm -rf /',
    level: 'CRITICAL',
    pattern: 'rm\\s+-rf?\\s+/?($|\\s)',
    description: '禁止递归删除根目录',
    enabled: true,
  },
  {
    name: '禁止 mkfs 格式化',
    level: 'CRITICAL',
    pattern: 'mkfs\\.',
    description: '禁止格式化文件系统',
    enabled: true,
  },
  {
    name: '禁止 dd 写设备',
    level: 'CRITICAL',
    pattern: 'dd\\s+.*of=/dev/',
    description: '禁止直接写入设备文件',
    enabled: true,
  },
  {
    name: '禁止修改 passwd/shadow',
    level: 'HIGH',
    pattern: '(chmod|chown).*(/etc/passwd|/etc/shadow)',
    description: '禁止修改系统密码文件权限',
    enabled: true,
  },
  {
    name: '禁止 iptables flush',
    level: 'HIGH',
    pattern: 'iptables\\s+(-F|--flush)',
    description: '禁止清空防火墙规则',
    enabled: true,
  },
]

/** 设置 Store 状态接口 */
interface SettingsState {
  /** LLM 配置 */
  llmConfig: LlmConfig
  /** SSH 默认配置 */
  sshDefaults: Partial<SshConfig>
  /** SSH 连接超时（毫秒） */
  sshTimeout: number
  /** 风险规则列表 */
  riskRules: RiskRule[]
  /** 资产标签列表 */
  assetTags: AssetTag[]

  // ===== Actions =====
  /** 设置 LLM 配置 */
  setLlmConfig: (config: Partial<LlmConfig>) => void
  /** 设置 SSH 默认配置 */
  setSshDefaults: (defaults: Partial<SshConfig>) => void
  /** 设置 SSH 超时 */
  setSshTimeout: (timeout: number) => void
  /** 添加风险规则 */
  addRiskRule: (rule: RiskRule) => void
  /** 更新风险规则 */
  updateRiskRule: (index: number, partial: Partial<RiskRule>) => void
  /** 删除风险规则 */
  removeRiskRule: (index: number) => void
  /** 添加资产标签 */
  addAssetTag: (tag: AssetTag) => void
  /** 删除资产标签 */
  removeAssetTag: (tagId: string) => void
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
      riskRules: DEFAULT_RISK_RULES,
      assetTags: [],

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

      // 添加风险规则
      addRiskRule: (rule) =>
        set((state) => ({
          riskRules: [...state.riskRules, rule],
        })),

      // 更新风险规则
      updateRiskRule: (index, partial) =>
        set((state) => ({
          riskRules: state.riskRules.map((r, i) =>
            i === index ? { ...r, ...partial } : r
          ),
        })),

      // 删除风险规则
      removeRiskRule: (index) =>
        set((state) => ({
          riskRules: state.riskRules.filter((_, i) => i !== index),
        })),

      // 添加资产标签
      addAssetTag: (tag) =>
        set((state) => ({
          assetTags: [...state.assetTags, tag],
        })),

      // 删除资产标签
      removeAssetTag: (tagId) =>
        set((state) => ({
          assetTags: state.assetTags.filter((t) => t.id !== tagId),
        })),

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
          const [llmConfig, sshDefaults, sshTimeout, riskRules, assetTags, apiKey] =
            await Promise.all([
              configGet<LlmConfig>('llmConfig'),
              configGet<Partial<SshConfig>>('sshDefaults'),
              configGet<number>('sshTimeout'),
              configGet<RiskRule[]>('riskRules'),
              configGet<AssetTag[]>('assetTags'),
              storageGetApiKey('llm_api_key'),
            ])

          set({
            llmConfig: llmConfig ?? get().llmConfig,
            sshDefaults: sshDefaults ?? get().sshDefaults,
            sshTimeout: sshTimeout ?? get().sshTimeout,
            riskRules: riskRules ?? get().riskRules,
            assetTags: assetTags ?? get().assetTags,
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
          const { llmConfig, sshDefaults, sshTimeout, riskRules, assetTags } = get()

          // API Key 单独加密存储
          if (llmConfig.apiKey) {
            await storageSaveApiKey('llm_api_key', llmConfig.apiKey)
          }

          // 非敏感配置存入 config
          const safeLlmConfig = { ...llmConfig, apiKey: '' }
          await Promise.all([
            configSet('llmConfig', safeLlmConfig),
            configSet('sshDefaults', sshDefaults),
            configSet('sshTimeout', sshTimeout),
            configSet('riskRules', riskRules),
            configSet('assetTags', assetTags),
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
        riskRules: state.riskRules,
        assetTags: state.assetTags,
      }),
    }
  )
)
