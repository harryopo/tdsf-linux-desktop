/**
 * ModelSettings — 模型配置（P0 关键页面）
 *
 * 路由：/settings/model
 *
 * 设计稿：settings-model.html（1:1 迁移）
 * - PageHeader: 模型配置 / AI 模型管理与 Token 用量统计
 * - Section 1: KPI 统计行（Token 总量 / 成本 / 对话次数 / 成功率）→ ModelKpiBar
 * - Section 2: 模型配置（当前模型 + 可选模型列表 + 温度滑块+预设 + 思考强度分段 + 3 列数字输入）
 * - Section 3: API 接入与测试（Endpoint + API Key + 组织 ID + 测试连接 + 结果卡 + 日志）
 * - Section 4: Token 使用统计 → TokenUsageChart
 * - Section 5: 功能调用统计（5 条水平条形图 + 总览行）
 * - Section 6: 对话记录（搜索 + 表格 + 分页）
 * - Section 7: 预算与告警（月度预算 + 告警阈值 + 邮件通知 + 告警历史）
 * - ActionBar: 恢复默认 / 导出统计 / 保存所有配置
 *
 * v1.5 改造：接入真实 IPC 存储（providerList / providerSave / providerSetDefault）
 */
import { useState, useEffect, useRef } from 'react'
import {
  Cpu,
  KeyRound,
  BarChart3,
  Layers,
  ListOrdered,
  AlertCircle,
  Search,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Zap,
  Check,
  CheckCircle2,
  RotateCcw,
  Terminal as TerminalIcon,
  Info,
  FileText,
  Loader2,
  type LucideIcon,
} from 'lucide-react'
import type { PersistedProviderConfig } from '@shared/agent-types'
import { SettingsPageHeader } from '@/components/settings/SettingsPageHeader'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { ModelKpiBar } from '@/components/settings/ModelKpiBar'
import { TokenUsageChart } from '@/components/settings/TokenUsageChart'
import { Slider } from '@/components/trae/Slider'
import { Switch } from '@/components/trae/Switch'
import { useSettingsStore } from '@/stores/settings-store'
import { isElectronAPIAvailable } from '@/utils/electron-api'

/** 可选模型卡片 */
interface ModelOption {
  name: string
  tag: string
  tagType: 'brand' | 'default'
  desc: string
  selected: boolean
}

/** 温度预设按钮 */
interface TempPreset {
  label: string
  value: number
}

/** 功能调用统计行 */
interface ToolCallStat {
  name: string
  count: number
  percent: number
}

/** 对话记录行 */
interface ConversationRow {
  time: string
  input: string
  model: string
  modelTagType: 'brand' | 'neutral'
  inputTokens: string
  outputTokens: string
  status: string
  statusType: 'success' | 'warning' | 'danger'
}

/** 告警历史行 */
interface AlertHistoryRow {
  level: 'alert' | 'error'
  text: string
  time: string
}

/** 测试连接日志行（动态渲染真实 llmTest 结果） */
interface TestLogLine {
  time: string
  text: string
  tone: 'default' | 'success' | 'error'
}

const MODELS: ModelOption[] = [
  {
    name: 'DeepSeek-R1',
    tag: '推荐',
    tagType: 'brand',
    desc: '推理强 · 适合复杂分析',
    selected: true,
  },
  {
    name: 'GPT-4o',
    tag: '可选',
    tagType: 'default',
    desc: '通用强 · 速度快',
    selected: false,
  },
  {
    name: 'Claude-3.5',
    tag: '可选',
    tagType: 'default',
    desc: '代码强 · 上下文长',
    selected: false,
  },
]

const TEMP_PRESETS: TempPreset[] = [
  { label: '保守', value: 0.1 },
  { label: '平衡', value: 0.3 },
  { label: '创新', value: 0.7 },
]

const THINKING_LEVELS = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
] as const

const TOOL_CALL_STATS: ToolCallStat[] = [
  { name: '终端命令执行', count: 89, percent: 35 },
  { name: '知识库检索', count: 67, percent: 26 },
  { name: '联网搜索', count: 45, percent: 18 },
  { name: 'Skill调用', count: 38, percent: 15 },
  { name: '方法论应用', count: 15, percent: 6 },
]

const CONVERSATIONS: ConversationRow[] = [
  {
    time: '14:23',
    input: 'nginx延迟排查',
    model: 'DeepSeek-R1',
    modelTagType: 'brand',
    inputTokens: '1,245',
    outputTokens: '890',
    status: '成功',
    statusType: 'success',
  },
  {
    time: '13:45',
    input: 'MySQL连接数',
    model: 'DeepSeek-R1',
    modelTagType: 'brand',
    inputTokens: '980',
    outputTokens: '670',
    status: '成功',
    statusType: 'success',
  },
  {
    time: '12:30',
    input: '高危命令拦截',
    model: 'DeepSeek-R1',
    modelTagType: 'brand',
    inputTokens: '320',
    outputTokens: '150',
    status: '已拦截',
    statusType: 'warning',
  },
  {
    time: '11:15',
    input: 'nginx reload',
    model: 'GPT-4o',
    modelTagType: 'neutral',
    inputTokens: '450',
    outputTokens: '280',
    status: '成功',
    statusType: 'success',
  },
  {
    time: '10:08',
    input: 'Docker重启',
    model: 'DeepSeek-R1',
    modelTagType: 'brand',
    inputTokens: '680',
    outputTokens: '520',
    status: '失败',
    statusType: 'danger',
  },
]

const ALERT_HISTORY: AlertHistoryRow[] = [
  { level: 'alert', text: 'Token日消耗超过5000', time: '3天前' },
  { level: 'alert', text: 'API响应时间 > 500ms', time: '1周前' },
  { level: 'error', text: '连接失败3次', time: '2周前' },
]

export function ModelSettings() {
  const { llmConfig, setLlmConfig, loadSettings, saveSettings } = useSettingsStore()

  // Provider 列表
  const [providers, setProviders] = useState<PersistedProviderConfig[]>([])
  const [loadingProviders, setLoadingProviders] = useState(false)
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null)

  // Section 2: 模型配置
  const [selectedModel, setSelectedModel] = useState(llmConfig.model || 'deepseek-chat')
  const [temperature, setTemperature] = useState(llmConfig.temperature ?? 0.3)
  const [thinkingLevel, setThinkingLevel] = useState<'low' | 'medium' | 'high'>('medium')
  const [maxToken, setMaxToken] = useState(llmConfig.maxTokens ?? 4096)
  const [contextWindow, setContextWindow] = useState(32768)
  const [requestTimeout, setRequestTimeout] = useState((llmConfig.timeout ?? 30000) / 1000)

  // Section 3: API 接入
  const [endpoint, setEndpoint] = useState(llmConfig.baseUrl || 'https://api.deepseek.com/v1')
  const [apiKey, setApiKey] = useState(llmConfig.apiKey || '')
  const [showApiKey, setShowApiKey] = useState(false)
  const [organization, setOrganization] = useState('')

  // Section 7: 预算与告警
  const [monthlyBudget, setMonthlyBudget] = useState(2.0)
  const [alertThreshold, setAlertThreshold] = useState(80)
  const [emailNotify, setEmailNotify] = useState(true)

  // Section 3: API 测试连接
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<'idle' | 'success' | 'error'>('idle')
  const [testLatency, setTestLatency] = useState<number | null>(null)
  const [testLogs, setTestLogs] = useState<TestLogLine[]>([])
  const [lastTestTime, setLastTestTime] = useState<string>('')

  // Section 6: 对话记录
  const [statusFilter, setStatusFilter] = useState<'全部状态' | '成功' | '已拦截' | '失败'>('全部状态')
  const [currentPage, setCurrentPage] = useState(1)

  // 导出统计反馈
  const [exportFeedback, setExportFeedback] = useState<string | null>(null)
  const exportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 加载 Provider 列表
  useEffect(() => {
    const loadProviders = async () => {
      if (!isElectronAPIAvailable()) return
      setLoadingProviders(true)
      try {
        const list = await window.electronAPI.providerList()
        setProviders(list)
        // 如果有默认 provider，使用它的配置
        if (list.length > 0 && !llmConfig.baseUrl) {
          const defaultProvider = list[0]
          setEndpoint(defaultProvider.baseURL)
          setSelectedModel(defaultProvider.model)
          if (defaultProvider.defaultParams?.temperature !== undefined) {
            setTemperature(defaultProvider.defaultParams.temperature)
          }
          if (defaultProvider.defaultParams?.maxTokens !== undefined) {
            setMaxToken(defaultProvider.defaultParams.maxTokens)
          }
        }
      } catch (err) {
        console.error('[ModelSettings] 加载 Provider 列表失败:', err)
      } finally {
        setLoadingProviders(false)
      }
    }

    loadProviders()
    loadSettings()
  }, [])

  // 同步 settings store 到本地状态
  useEffect(() => {
    if (llmConfig.baseUrl) setEndpoint(llmConfig.baseUrl)
    if (llmConfig.model) setSelectedModel(llmConfig.model)
    if (llmConfig.temperature !== undefined) setTemperature(llmConfig.temperature)
    if (llmConfig.maxTokens !== undefined) setMaxToken(llmConfig.maxTokens)
    if (llmConfig.timeout !== undefined) setRequestTimeout(llmConfig.timeout / 1000)
    if (llmConfig.apiKey) setApiKey(llmConfig.apiKey)
  }, [llmConfig])

  // 清理定时器
  useEffect(() => {
    return () => {
      if (exportTimerRef.current != null) clearTimeout(exportTimerRef.current)
      if (saveFeedbackTimerRef.current != null) clearTimeout(saveFeedbackTimerRef.current)
    }
  }, [])

  // 切换模型：循环切换到下一个模型
  const handleSwitchModel = () => {
    const modelOptions = providers.length > 0
      ? providers.map((p) => p.model)
      : MODELS.map((m) => m.name)
    const currentIndex = modelOptions.findIndex((m) => m === selectedModel)
    const nextIndex = (currentIndex + 1) % modelOptions.length
    setSelectedModel(modelOptions[nextIndex])
  }

  // 测试连接：调用真实 llmTest IPC（llm:test 通道），测量往返延迟
  const handleTestConnection = async () => {
    if (isTesting) return
    setIsTesting(true)
    setTestResult('idle')
    setTestLatency(null)

    const timestamp = () => {
      const now = new Date()
      const hh = String(now.getHours()).padStart(2, '0')
      const mm = String(now.getMinutes()).padStart(2, '0')
      const ss = String(now.getSeconds()).padStart(2, '0')
      return `${hh}:${mm}:${ss}`
    }

    const logs: TestLogLine[] = [
      { time: timestamp(), text: '发送测试请求...', tone: 'default' },
    ]
    setTestLogs(logs)

    if (!isElectronAPIAvailable()) {
      setTestResult('error')
      setTestLogs((prev) => [
        ...prev,
        { time: timestamp(), text: 'electronAPI 不可用，无法发起测试', tone: 'error' },
      ])
      setIsTesting(false)
      return
    }

    const startedAt = performance.now()
    try {
      const ok = await window.electronAPI.llmTest({
        baseUrl: endpoint,
        apiKey,
        model: selectedModel,
        temperature,
        maxTokens: maxToken,
        timeout: requestTimeout * 1000,
      })
      const latency = Math.round(performance.now() - startedAt)
      setTestLatency(latency)
      setLastTestTime(timestamp())
      if (ok) {
        setTestResult('success')
        setTestLogs((prev) => [
          ...prev,
          { time: timestamp(), text: `收到响应 (${latency}ms)`, tone: 'default' },
          { time: timestamp(), text: '连接验证通过', tone: 'success' },
        ])
      } else {
        setTestResult('error')
        setTestLogs((prev) => [
          ...prev,
          { time: timestamp(), text: `连接失败 (${latency}ms)`, tone: 'error' },
          { time: timestamp(), text: '请检查 API Key / Endpoint / 模型名配置', tone: 'error' },
        ])
      }
    } catch (err) {
      const latency = Math.round(performance.now() - startedAt)
      setTestLatency(latency)
      setTestResult('error')
      setLastTestTime(timestamp())
      setTestLogs((prev) => [
        ...prev,
        { time: timestamp(), text: `连接异常 (${latency}ms)`, tone: 'error' },
        {
          time: timestamp(),
          text: err instanceof Error ? err.message : String(err),
          tone: 'error',
        },
      ])
      console.error('[ModelSettings] 测试连接失败:', err)
    } finally {
      setIsTesting(false)
    }
  }

  // 保存所有配置
  const handleSaveAll = async () => {
    try {
      // 先更新本地 store
      setLlmConfig({
        baseUrl: endpoint,
        apiKey,
        model: selectedModel,
        temperature,
        maxTokens: maxToken,
        timeout: requestTimeout * 1000,
      })

      // 保存到主进程
      await saveSettings()

      // 如果有真实的 providerSave，也保存一份
      if (isElectronAPIAvailable() && providers.length > 0) {
        const defaultProvider = providers[0]
        await window.electronAPI.providerSave({
          ...defaultProvider,
          baseURL: endpoint,
          model: selectedModel,
          apiKey,
          defaultParams: {
            ...defaultProvider.defaultParams,
            temperature,
            maxTokens: maxToken,
          },
        })
        await window.electronAPI.providerSetDefault(defaultProvider.id)
      }

      setSaveFeedback('配置已保存')
      if (saveFeedbackTimerRef.current != null) clearTimeout(saveFeedbackTimerRef.current)
      saveFeedbackTimerRef.current = setTimeout(() => {
        setSaveFeedback(null)
      }, 3000)
    } catch (err) {
      setSaveFeedback('保存失败')
      console.error('[ModelSettings] 保存配置失败:', err)
      if (saveFeedbackTimerRef.current != null) clearTimeout(saveFeedbackTimerRef.current)
      saveFeedbackTimerRef.current = setTimeout(() => {
        setSaveFeedback(null)
      }, 3000)
    }
  }

  // 恢复默认：重置可编辑模型参数为默认值（不触发保存）
  const handleResetDefaults = () => {
    setTemperature(0.3)
    setThinkingLevel('medium')
    setMaxToken(4096)
    setContextWindow(32768)
    setRequestTimeout(30)
    setMonthlyBudget(2.0)
    setAlertThreshold(80)
    setEmailNotify(true)
    setSaveFeedback('已恢复默认参数（尚未保存）')
    if (saveFeedbackTimerRef.current != null) clearTimeout(saveFeedbackTimerRef.current)
    saveFeedbackTimerRef.current = setTimeout(() => {
      setSaveFeedback(null)
    }, 3000)
  }

  // 导出统计：模拟导出反馈
  const handleExportStats = () => {
    setExportFeedback('正在导出统计数据...')
    if (exportTimerRef.current != null) clearTimeout(exportTimerRef.current)
    exportTimerRef.current = setTimeout(() => {
      setExportFeedback('已导出到 ~/.tdsf/exports/stats.json')
    }, 600)
    exportTimerRef.current = setTimeout(() => {
      setExportFeedback(null)
    }, 3000)
  }

  // 切换状态筛选
  const handleCycleStatusFilter = () => {
    const filters = ['全部状态', '成功', '已拦截', '失败'] as const
    const currentIndex = filters.indexOf(statusFilter)
    const nextIndex = (currentIndex + 1) % filters.length
    setStatusFilter(filters[nextIndex])
    setCurrentPage(1)
  }

  // 过滤对话记录
  const filteredConversations = CONVERSATIONS.filter((row) => {
    if (statusFilter === '全部状态') return true
    return row.status === statusFilter
  })

  // 可选模型列表（优先使用真实 provider 数据，降级用 mock）
  const modelOptions: ModelOption[] = providers.length > 0
    ? providers.map((p) => ({
        name: p.model,
        tag: p.builtin ? '推荐' : '可选',
        tagType: (p.builtin ? 'brand' : 'default') as 'brand' | 'default',
        desc: p.name,
        selected: p.model === selectedModel,
      }))
    : MODELS

  return (
    <div>
      <SettingsPageHeader
        icon={Cpu as LucideIcon}
        title="模型配置"
        desc="AI模型管理与Token用量统计"
      />

      <div className="flex flex-col gap-5 p-6">
        {/* Section 1: KPI 统计行 */}
        <ModelKpiBar />

        {/* Section 2: 模型配置 */}
        <SettingsCard icon={Cpu} title="模型配置" tag="model.config" className="p-5">
          {/* 当前模型展示行 */}
          <div className="mb-4 flex items-center justify-between gap-4 rounded-[var(--trae-radius-6)] bg-[var(--trae-bg-overlay-l1)] p-3">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <span className="text-[18px] font-semibold text-[var(--trae-text-default)]">
                {selectedModel}
              </span>
              <span className="inline-flex h-[18px] items-center rounded-[var(--trae-radius-2)] bg-[var(--trae-bg-overlay-l4)] px-1.5 text-[10px] font-medium text-[var(--trae-text-default)]">
                v1.0
              </span>
              <span className="inline-flex items-center gap-1 text-[10px] text-[var(--trae-status-success-default)]">
                <CheckCircle2 className="size-3.5" />
                已连接
              </span>
            </div>
            <button
              type="button"
              onClick={handleSwitchModel}
              disabled={loadingProviders}
              aria-label="切换模型"
              className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] px-3 text-[10px] font-medium text-[var(--trae-text-default)] transition-colors hover:bg-[var(--trae-bg-overlay-l2)] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span>切换模型</span>
              <ChevronDown className="size-3.5" />
            </button>
          </div>

          {/* 可选模型列表 */}
          <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-3">
            {modelOptions.map((m) => {
              const isSelected = m.name === selectedModel
              return (
                <button
                  key={m.name}
                  type="button"
                  onClick={() => setSelectedModel(m.name)}
                  className={
                    'rounded-[var(--trae-radius-6)] bg-[var(--trae-bg-overlay-l1)] p-3 text-left transition-colors ' +
                    (isSelected
                      ? 'border border-[var(--trae-bg-brand)]'
                      : 'border border-[var(--trae-border-neutral-l1)] cursor-pointer hover:bg-[var(--trae-bg-overlay-l2)]')
                  }
                >
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-[11px] font-medium text-[var(--trae-text-default)]">
                      {m.name}
                    </span>
                    <span
                      className={
                        'inline-flex h-[18px] items-center rounded-[var(--trae-radius-2)] px-1.5 text-[10px] ' +
                        (m.tagType === 'brand'
                          ? 'bg-[var(--trae-bg-brand-popup)] text-[var(--trae-text-brand)]'
                          : 'border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-overlay-l2)] text-[var(--trae-text-secondary)]')
                      }
                    >
                      {m.tag}
                    </span>
                  </div>
                  <p className="text-[10px] text-[var(--trae-text-secondary)]">
                    {m.desc}
                  </p>
                </button>
              )
            })}
          </div>

          {/* 参数配置区 */}
          <div className="flex flex-col gap-4">
            {/* a. 温度参数 */}
            <div className="flex flex-col gap-2 border-t border-[var(--trae-border-neutral-l1)] py-3">
              <div className="flex items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="text-[11px] font-medium text-[var(--trae-text-default)]">
                    温度参数 Temperature
                  </span>
                  <span className="text-[10px] text-[var(--trae-text-tertiary)]">
                    0.0 – 1.0
                  </span>
                </div>
                <span className="shrink-0 font-mono text-[11px] font-medium tabular-nums text-[var(--trae-bg-brand)]">
                  {temperature.toFixed(1)}
                </span>
              </div>
              <Slider
                value={[temperature]}
                min={0}
                max={1}
                step={0.1}
                onValueChange={(arr) => setTemperature(arr[0] ?? 0)}
                className="w-full"
              />
              <div className="flex items-start gap-1.5">
                <Info className="mt-0.5 size-3.5 shrink-0 text-[var(--trae-bg-brand)]" />
                <p className="text-[10px] leading-[1.5] text-[var(--trae-text-secondary)]">
                  推荐：运维分析场景建议 0.2-0.4，平衡准确性与创造性。过低(0-0.2)回复过于保守，过高(0.6-1.0)可能产生幻觉。
                </p>
              </div>
              <div className="flex items-center gap-2">
                {TEMP_PRESETS.map((p) => {
                  const active = Math.abs(temperature - p.value) < 0.001
                  return (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => setTemperature(p.value)}
                      className={
                        'inline-flex h-7 items-center rounded-[var(--trae-radius-6)] px-3 text-[10px] font-medium transition-colors active:scale-[0.97] ' +
                        (active
                          ? 'border border-[var(--trae-bg-brand)] bg-[var(--trae-bg-brand)] text-[var(--trae-text-onbrand)]'
                          : 'border border-[var(--trae-border-neutral-l2)] text-[var(--trae-text-secondary)] hover:bg-[var(--trae-bg-overlay-l2)]')
                      }
                    >
                      {p.label} {p.value}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* b. 思考强度 */}
            <div className="flex flex-col gap-2 border-t border-[var(--trae-border-neutral-l1)] py-3">
              <div className="flex items-center justify-between gap-4">
                <span className="text-[11px] font-medium text-[var(--trae-text-default)]">
                  思考强度 Thinking Effort
                </span>
              </div>
              <div className="inline-flex rounded-[var(--trae-radius-6)] bg-[var(--trae-bg-overlay-l2)] p-0.5">
                {THINKING_LEVELS.map((t) => {
                  const active = thinkingLevel === t.value
                  return (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setThinkingLevel(t.value)}
                      className={
                        'inline-flex h-7 items-center justify-center rounded-[var(--trae-radius-4)] px-4 text-[10px] font-medium ' +
                        (active
                          ? 'bg-[var(--trae-bg-brand)] text-[var(--trae-text-onbrand)]'
                          : 'text-[var(--trae-text-secondary)] transition-colors')
                      }
                    >
                      {t.label}
                    </button>
                  )
                })}
              </div>
              <p className="text-[10px] text-[var(--trae-text-tertiary)]">
                低=快速响应 · 中=平衡 · 高=深度推理（消耗更多token）
              </p>
            </div>

            {/* c/d/e. 数字输入组 */}
            <div className="grid grid-cols-1 gap-4 border-t border-[var(--trae-border-neutral-l1)] py-3 md:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-medium text-[var(--trae-text-secondary)]">
                  最大Token Max Tokens
                </label>
                <input
                  type="number"
                  value={maxToken}
                  onChange={(e) => setMaxToken(Number(e.target.value))}
                  aria-label="最大Token"
                  className="h-8 w-full rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-overlay-l1)] px-3 font-mono text-[11px] tabular-nums text-[var(--trae-text-default)] outline-none transition-colors focus:border-[var(--trae-bg-brand)]"
                />
                <span className="text-[10px] text-[var(--trae-text-tertiary)]">
                  单次响应最大长度
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-medium text-[var(--trae-text-secondary)]">
                  上下文窗口 Context Window
                </label>
                <input
                  type="number"
                  value={contextWindow}
                  onChange={(e) => setContextWindow(Number(e.target.value))}
                  aria-label="上下文窗口"
                  className="h-8 w-full rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-overlay-l1)] px-3 font-mono text-[11px] tabular-nums text-[var(--trae-text-default)] outline-none transition-colors focus:border-[var(--trae-bg-brand)]"
                />
                <span className="text-[10px] text-[var(--trae-text-tertiary)]">
                  对话历史保留长度
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-medium text-[var(--trae-text-secondary)]">
                  请求超时 Timeout
                </label>
                <input
                  type="number"
                  value={requestTimeout}
                  onChange={(e) => setRequestTimeout(Number(e.target.value))}
                  aria-label="请求超时"
                  className="h-8 w-full rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-overlay-l1)] px-3 font-mono text-[11px] tabular-nums text-[var(--trae-text-default)] outline-none transition-colors focus:border-[var(--trae-bg-brand)]"
                />
                <span className="text-[10px] text-[var(--trae-text-tertiary)]">秒</span>
              </div>
            </div>
          </div>
        </SettingsCard>

        {/* Section 3: API 接入与测试 */}
        <SettingsCard icon={KeyRound} title="API接入与测试" tag="api.config" className="p-5">
          {/* API 配置表单 */}
          <div className="mb-4 flex flex-col gap-3">
            <div className="grid grid-cols-1 items-center gap-3 md:grid-cols-[180px_1fr]">
              <label className="text-[10px] font-medium text-[var(--trae-text-secondary)]">
                API Endpoint
              </label>
              <input
                type="text"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                aria-label="API Endpoint"
                className="h-8 w-full rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-overlay-l1)] px-3 font-mono text-[11px] text-[var(--trae-text-default)] outline-none transition-colors focus:border-[var(--trae-bg-brand)]"
              />
            </div>
            <div className="grid grid-cols-1 items-center gap-3 md:grid-cols-[180px_1fr]">
              <label className="text-[10px] font-medium text-[var(--trae-text-secondary)]">
                API Key
              </label>
              <div className="flex items-center gap-2">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  aria-label="API Key"
                  className="h-8 min-w-0 flex-1 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-overlay-l1)] px-3 font-mono text-[11px] text-[var(--trae-text-default)] outline-none transition-colors focus:border-[var(--trae-bg-brand)]"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey((v) => !v)}
                  aria-label="显示/隐藏API Key"
                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] text-[var(--trae-text-secondary)] transition-colors hover:bg-[var(--trae-bg-overlay-l2)] active:scale-[0.97]"
                >
                  {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 items-center gap-3 md:grid-cols-[180px_1fr]">
              <label className="text-[10px] font-medium text-[var(--trae-text-secondary)]">
                组织ID Organization{' '}
                <span className="text-[var(--trae-text-tertiary)]">(可选)</span>
              </label>
              <input
                type="text"
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
                placeholder="输入组织ID（可选）"
                aria-label="组织ID"
                className="h-8 w-full rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-overlay-l1)] px-3 text-[11px] text-[var(--trae-text-default)] outline-none transition-colors focus:border-[var(--trae-bg-brand)]"
              />
            </div>
          </div>

          {/* 连接测试区 */}
          <div className="flex flex-col gap-3 rounded-[var(--trae-radius-6)] border-t border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-overlay-l1)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={isTesting}
                aria-label="测试连接"
                className="inline-flex h-8 items-center gap-1.5 rounded-[var(--trae-radius-6)] border border-[var(--trae-bg-brand)] bg-[var(--trae-bg-brand)] px-4 text-[11px] font-medium text-[var(--trae-text-onbrand)] transition-colors active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isTesting ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Zap className="size-3.5" />
                )}
                <span>{isTesting ? '测试中...' : '测试连接'}</span>
              </button>
              <span className="text-[10px] text-[var(--trae-text-tertiary)]">
                最近测试 {lastTestTime}
              </span>
            </div>

            {/* 测试结果卡片 */}
            {testResult !== 'idle' && (
              <div
                className={
                  'flex flex-wrap items-center gap-4 rounded-[var(--trae-radius-6)] border p-3 ' +
                  (testResult === 'success'
                    ? 'border-[var(--trae-status-success-default)] bg-[var(--trae-bg-base-secondary)]'
                    : 'border-[var(--trae-status-error-default)] bg-[var(--trae-bg-base-secondary)]')
                }
              >
                <span
                  className={
                    'inline-flex items-center gap-1.5 text-[11px] font-medium ' +
                    (testResult === 'success'
                      ? 'text-[var(--trae-status-success-default)]'
                      : 'text-[var(--trae-status-error-default)]')
                  }
                >
                  <CheckCircle2 className="size-4" />
                  {testResult === 'success' ? '连接成功' : '连接失败'}
                </span>
                {testResult === 'success' && (
                  <>
                    <span className="font-mono text-[10px] tabular-nums text-[var(--trae-text-secondary)]">
                      响应时间{' '}
                      <span className="font-mono text-[var(--trae-text-default)]">
                        {testLatency != null ? `${testLatency}ms` : '--'}
                      </span>
                    </span>
                    <span className="text-[10px] text-[var(--trae-text-secondary)]">
                      模型版本{' '}
                      <span className="font-mono text-[var(--trae-text-default)]">
                        {selectedModel}
                      </span>
                    </span>
                    <svg
                      width="100"
                      height="28"
                      viewBox="0 0 100 28"
                      className="ml-auto"
                      aria-hidden="true"
                    >
                      <polyline
                        points="0,18 20,14 40,16 60,10 80,12 100,8"
                        fill="none"
                        stroke="var(--trae-status-success-default)"
                        strokeWidth="1.5"
                      />
                      <circle cx="100" cy="8" r="2" fill="var(--trae-status-success-default)" />
                    </svg>
                  </>
                )}
              </div>
            )}

            {/* 测试日志 */}
            <div className="rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-default)] p-3">
              <div className="mb-2 flex items-center gap-1.5">
                <TerminalIcon className="size-3 text-[var(--trae-text-tertiary)]" />
                <span className="text-[10px] font-medium text-[var(--trae-text-tertiary)]">
                  测试日志
                </span>
              </div>
              <pre
                className="m-0 whitespace-pre-wrap font-mono text-[12px] leading-[18px] text-[var(--trae-text-secondary)]"
                style={{ fontFamily: 'var(--trae-font-family-mono, JetBrains Mono, monospace)' }}
              >
                {testLogs.length === 0 ? (
                  <span className="text-[var(--trae-text-tertiary)]">
                    点击「测试连接」开始验证 API 配置...
                  </span>
                ) : (
                  testLogs.map((line, idx) => (
                    <span key={`${line.time}-${idx}`}>
                      {idx > 0 && '\n'}
                      <span className="text-[var(--trae-text-tertiary)]">{line.time}</span>{' '}
                      <span
                        className={
                          line.tone === 'success'
                            ? 'text-[var(--trae-status-success-default)]'
                            : line.tone === 'error'
                              ? 'text-[var(--trae-status-error-default)]'
                              : 'text-[var(--trae-text-secondary)]'
                        }
                      >
                        {line.text}
                      </span>
                    </span>
                  ))
                )}
              </pre>
            </div>
          </div>
        </SettingsCard>

        {/* Section 4: Token 使用统计 */}
        <SettingsCard icon={BarChart3} title="Token使用统计" tag="usage.tokens" className="p-5">
          <TokenUsageChart />
        </SettingsCard>

        {/* Section 5: 功能调用统计 */}
        <SettingsCard icon={Layers} title="功能调用统计" tag="usage.tools" className="p-5">
          {/* 功能调用排行（水平条形图） */}
          <div className="mb-4 flex flex-col gap-3">
            {TOOL_CALL_STATS.map((s) => (
              <div key={s.name} className="flex items-center gap-3">
                <span className="w-28 shrink-0 text-[11px] text-[var(--trae-text-default)]">
                  {s.name}
                </span>
                <div className="h-5 flex-1 overflow-hidden rounded-[var(--trae-radius-4)] bg-[var(--trae-bg-overlay-l1)]">
                  <div
                    className="flex h-full items-center justify-end rounded-[var(--trae-radius-4)] bg-[var(--trae-bg-brand)] pr-2"
                    style={{ width: `${s.percent}%` }}
                  >
                    <span className="font-mono text-[10px] font-medium tabular-nums text-[var(--trae-text-onbrand)]">
                      {s.count}
                    </span>
                  </div>
                </div>
                <span className="w-10 shrink-0 text-right font-mono text-[10px] tabular-nums text-[var(--trae-text-secondary)]">
                  {s.percent}%
                </span>
              </div>
            ))}
          </div>

          {/* 底部统计行 */}
          <div className="flex flex-wrap items-center gap-6 rounded-[var(--trae-radius-6)] border-t border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-overlay-l1)] p-3">
            <span className="text-[10px] text-[var(--trae-text-secondary)]">
              总调用{' '}
              <span className="font-mono font-semibold tabular-nums text-[var(--trae-text-default)]">
                254
              </span>{' '}
              次
            </span>
            <span className="text-[10px] text-[var(--trae-text-secondary)]">
              成功率{' '}
              <span className="font-mono font-semibold tabular-nums text-[var(--trae-status-success-default)]">
                94.3%
              </span>
            </span>
            <span className="text-[10px] text-[var(--trae-text-secondary)]">
              平均耗时{' '}
              <span className="font-mono font-semibold tabular-nums text-[var(--trae-text-default)]">
                2.1s
              </span>
            </span>
          </div>
        </SettingsCard>

        {/* Section 6: 对话记录 */}
        <SettingsCard icon={ListOrdered} title="对话记录" tag="conversation.history" className="p-5">
          {/* 工具栏 */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--trae-text-tertiary)]" />
              <input
                type="text"
                placeholder="搜索对话..."
                aria-label="搜索对话"
                className="h-8 w-44 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-overlay-l1)] py-0 pl-8 pr-3 text-[10px] text-[var(--trae-text-default)] outline-none transition-colors focus:border-[var(--trae-bg-brand)]"
              />
            </div>
            <button
              type="button"
              onClick={handleCycleStatusFilter}
              aria-label="切换状态筛选"
              title="点击切换状态筛选"
              className="inline-flex h-8 items-center gap-1.5 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] px-3 text-[10px] font-medium text-[var(--trae-text-secondary)] transition-colors hover:bg-[var(--trae-bg-overlay-l2)] active:scale-[0.97]"
            >
              <span>{statusFilter}</span>
              <ChevronDown className="size-3.5" />
            </button>
          </div>

          {/* 表格 */}
          <div className="overflow-hidden rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l1)]">
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr className="border-b border-[var(--trae-border-neutral-l1)]">
                  <th className="px-2 py-2 text-left text-[10px] font-normal uppercase tracking-[0.04em] text-[var(--trae-text-tertiary)]">
                    时间
                  </th>
                  <th className="px-2 py-2 text-left text-[10px] font-normal uppercase tracking-[0.04em] text-[var(--trae-text-tertiary)]">
                    用户输入
                  </th>
                  <th className="px-2 py-2 text-left text-[10px] font-normal uppercase tracking-[0.04em] text-[var(--trae-text-tertiary)]">
                    AI模型
                  </th>
                  <th className="px-2 py-2 text-right text-[10px] font-normal uppercase tracking-[0.04em] text-[var(--trae-text-tertiary)]">
                    输入Token
                  </th>
                  <th className="px-2 py-2 text-right text-[10px] font-normal uppercase tracking-[0.04em] text-[var(--trae-text-tertiary)]">
                    输出Token
                  </th>
                  <th className="px-2 py-2 text-left text-[10px] font-normal uppercase tracking-[0.04em] text-[var(--trae-text-tertiary)]">
                    状态
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredConversations.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-2 py-6 text-center text-[10px] text-[var(--trae-text-tertiary)]">
                      没有匹配 "{statusFilter}" 的记录
                    </td>
                  </tr>
                ) : (
                  filteredConversations.map((row, idx) => (
                  <tr
                    key={`${row.time}-${idx}`}
                    className="border-b border-[var(--trae-border-neutral-l1)] last:border-0"
                  >
                    <td className="px-2 py-2 font-mono tabular-nums text-[var(--trae-text-secondary)]">
                      {row.time}
                    </td>
                    <td className="px-2 py-2 font-medium text-[var(--trae-text-default)]">
                      {row.input}
                    </td>
                    <td className="px-2 py-2">
                      <span
                        className={
                          'inline-flex h-[18px] items-center rounded-[var(--trae-radius-2)] px-1.5 text-[10px] ' +
                          (row.modelTagType === 'brand'
                            ? 'bg-[var(--trae-bg-brand-popup)] text-[var(--trae-text-brand)]'
                            : 'bg-[var(--trae-bg-overlay-l4)] font-medium text-[var(--trae-text-default)]')
                        }
                      >
                        {row.model}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--trae-text-default)]">
                      {row.inputTokens}
                    </td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--trae-text-default)]">
                      {row.outputTokens}
                    </td>
                    <td className="px-2 py-2">
                      <span
                        className={
                          'inline-flex h-[18px] items-center rounded-[var(--trae-radius-2)] px-1.5 text-[10px] ' +
                          (row.statusType === 'success'
                            ? 'bg-[var(--trae-status-success-surface-l1)] text-[var(--trae-status-success-default)]'
                            : row.statusType === 'warning'
                              ? 'bg-[var(--trae-status-warning-surface-l1)] text-[var(--trae-status-warning-default)]'
                              : 'bg-[var(--trae-status-error-surface-l1)] text-[var(--trae-status-error-default)]')
                        }
                      >
                        {row.status}
                      </span>
                    </td>
                  </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* 分页栏 */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <span className="font-mono text-[10px] tabular-nums text-[var(--trae-text-tertiary)]">
              共 {filteredConversations.length} 条
              {statusFilter !== '全部状态' && (
                <span className="ml-1 text-[var(--trae-text-secondary)]">
                  (筛选: {statusFilter})
                </span>
              )}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                aria-label="上一页"
                className="inline-flex size-7 items-center justify-center rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l2)] text-[var(--trae-text-secondary)] transition-colors hover:bg-[var(--trae-bg-overlay-l2)] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ChevronLeft className="size-3.5" />
              </button>
              {[1, 2, 3].map((page) => (
                <button
                  key={page}
                  type="button"
                  onClick={() => setCurrentPage(page)}
                  aria-label={`第 ${page} 页`}
                  className={
                    'inline-flex size-7 items-center justify-center rounded-[var(--trae-radius-4)] text-[10px] tabular-nums transition-colors active:scale-[0.97] ' +
                    (currentPage === page
                      ? 'bg-[var(--trae-bg-brand)] font-medium text-[var(--trae-text-onbrand)]'
                      : 'border border-[var(--trae-border-neutral-l2)] text-[var(--trae-text-secondary)] hover:bg-[var(--trae-bg-overlay-l2)]')
                  }
                >
                  {page}
                </button>
              ))}
              <span className="px-1 text-[10px] text-[var(--trae-text-tertiary)]">...</span>
              <button
                type="button"
                onClick={() => setCurrentPage(13)}
                aria-label="第 13 页"
                className={
                  'inline-flex size-7 items-center justify-center rounded-[var(--trae-radius-4)] text-[10px] tabular-nums transition-colors active:scale-[0.97] ' +
                  (currentPage === 13
                    ? 'bg-[var(--trae-bg-brand)] font-medium text-[var(--trae-text-onbrand)]'
                    : 'border border-[var(--trae-border-neutral-l2)] text-[var(--trae-text-secondary)] hover:bg-[var(--trae-bg-overlay-l2)]')
                }
              >
                13
              </button>
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(13, p + 1))}
                disabled={currentPage === 13}
                aria-label="下一页"
                className="inline-flex size-7 items-center justify-center rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l2)] text-[var(--trae-text-secondary)] transition-colors hover:bg-[var(--trae-bg-overlay-l2)] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ChevronRight className="size-3.5" />
              </button>
            </div>
          </div>
        </SettingsCard>

        {/* Section 7: 预算与告警 */}
        <SettingsCard icon={AlertCircle} title="预算与告警" tag="budget" className="p-5">
          {/* 月度预算设置 */}
          <div className="flex flex-col gap-3 border-b border-[var(--trae-border-neutral-l1)] py-3">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <span className="text-[11px] font-medium text-[var(--trae-text-default)]">
                月度预算
              </span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-[var(--trae-text-tertiary)]">$</span>
                <input
                  type="number"
                  value={monthlyBudget}
                  step={0.01}
                  onChange={(e) => setMonthlyBudget(Number(e.target.value))}
                  aria-label="月度预算"
                  className="h-7 w-20 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-overlay-l1)] px-2 text-right font-mono text-[11px] tabular-nums text-[var(--trae-text-default)] outline-none transition-colors focus:border-[var(--trae-bg-brand)]"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-2 flex-1 rounded-full bg-[var(--trae-bg-overlay-l2)]">
                <div
                  className="h-full rounded-full bg-[var(--trae-bg-brand)]"
                  style={{ width: '34%' }}
                />
              </div>
              <span className="whitespace-nowrap font-mono text-[10px] tabular-nums text-[var(--trae-text-secondary)]">
                已用{' '}
                <span className="font-medium text-[var(--trae-bg-brand)]">$0.68</span> · 剩余{' '}
                <span className="font-medium text-[var(--trae-status-success-default)]">
                  $1.32
                </span>
              </span>
            </div>
          </div>

          {/* 告警阈值设置 */}
          <div className="flex flex-col gap-3 border-b border-[var(--trae-border-neutral-l1)] py-3">
            <div className="flex items-center justify-between gap-4">
              <span className="text-[11px] font-medium text-[var(--trae-text-default)]">
                告警阈值
              </span>
              <span className="text-[10px] text-[var(--trae-text-secondary)]">
                当消耗达{' '}
                <span className="font-mono font-semibold tabular-nums text-[var(--trae-status-alert-default)]">
                  {alertThreshold}%
                </span>{' '}
                时告警
              </span>
            </div>
            <Slider
              value={[alertThreshold]}
              min={0}
              max={100}
              step={5}
              onValueChange={(arr) => setAlertThreshold(arr[0] ?? 0)}
              className="w-full"
            />
            <div className="flex items-center justify-between gap-4">
              <span className="text-[10px] text-[var(--trae-text-secondary)]">邮件通知</span>
              <Switch checked={emailNotify} onCheckedChange={setEmailNotify} />
            </div>
          </div>

          {/* 告警历史 */}
          <div className="pt-3">
            <span className="text-[10px] font-medium uppercase tracking-[0.04em] text-[var(--trae-text-tertiary)]">
              告警历史
            </span>
            <div className="mt-2 flex flex-col gap-2">
              {ALERT_HISTORY.map((h, idx) => (
                <div
                  key={`${h.text}-${idx}`}
                  className="flex items-center justify-between gap-3 rounded-[var(--trae-radius-4)] bg-[var(--trae-bg-overlay-l1)] p-2.5"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={
                        'inline-block size-1.5 shrink-0 rounded-full ' +
                        (h.level === 'error'
                          ? 'bg-[var(--trae-status-error-default)]'
                          : 'bg-[var(--trae-status-alert-default)]')
                      }
                    />
                    <span className="text-[11px] text-[var(--trae-text-default)]">
                      {h.text}
                    </span>
                  </div>
                  <span className="shrink-0 font-mono text-[10px] tabular-nums text-[var(--trae-text-tertiary)]">
                    {h.time}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </SettingsCard>

        {/* ActionBar: 恢复默认 / 导出统计 / 保存所有配置（设计稿：sticky 底部操作栏） */}
        <footer
          className="sticky bottom-0 z-10 mt-2 flex items-center justify-end gap-3 pb-6 pt-3"
          style={{
            background: 'linear-gradient(to top, var(--trae-bg-base-default) 70%, transparent)',
          }}
        >
          <button
            type="button"
            onClick={handleResetDefaults}
            aria-label="恢复默认"
            className="inline-flex h-9 items-center gap-1.5 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] bg-transparent px-4 text-[12px] font-medium text-[var(--trae-text-secondary)] transition-colors hover:border-[var(--trae-border-neutral-l3)] hover:bg-[var(--trae-bg-overlay-l1)] active:scale-[0.97]"
          >
            <RotateCcw className="size-3.5" />
            恢复默认
          </button>
          <button
            type="button"
            onClick={handleExportStats}
            aria-label="导出统计"
            className="inline-flex h-9 items-center gap-1.5 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] bg-transparent px-4 text-[12px] font-medium text-[var(--trae-text-secondary)] transition-colors hover:border-[var(--trae-border-neutral-l3)] hover:bg-[var(--trae-bg-overlay-l1)] active:scale-[0.97]"
          >
            <FileText className="size-3.5" />
            导出统计
          </button>
          <button
            type="button"
            onClick={handleSaveAll}
            aria-label="保存所有配置"
            className="inline-flex h-9 items-center gap-1.5 rounded-[var(--trae-radius-6)] border border-[var(--trae-bg-brand)] bg-[var(--trae-bg-brand)] px-5 text-[12px] font-medium text-[var(--trae-text-onbrand)] transition-colors hover:bg-[var(--trae-bg-brand-hover)] hover:border-[var(--trae-bg-brand-hover)] active:scale-[0.97]"
          >
            <Check className="size-3.5" />
            保存所有配置
          </button>
          {saveFeedback && (
            <span
              className={
                'text-[10px] ' +
                (saveFeedback === '配置已保存'
                  ? 'text-[var(--trae-status-success-default)]'
                  : 'text-[var(--trae-status-error-default)]')
              }
            >
              {saveFeedback}
            </span>
          )}
          {exportFeedback && (
            <span className="text-[10px] text-[var(--trae-status-success-default)]">
              {exportFeedback}
            </span>
          )}
        </footer>
      </div>
    </div>
  )
}
