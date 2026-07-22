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
import type { PersistedProviderConfig, TokenUsageRecord } from '@shared/agent-types'
import type { ToolCallStat, BudgetAlert } from '@shared/models'
import { SettingsPageHeader } from '@/components/settings/SettingsPageHeader'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { ModelKpiBar } from '@/components/settings/ModelKpiBar'
import { TokenUsageChart } from '@/components/settings/TokenUsageChart'
import { Slider } from '@/components/trae/Slider'
import { Switch } from '@/components/trae/Switch'
import { useSettingsStore } from '@/stores/settings-store'
import { isElectronAPIAvailable } from '@/utils/electron-api'
import './Settings.css'

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

// 注：ToolCallStat 类型已从 @shared/models 导入（v2.3.2 改为真实 IPC 数据）

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

// 注：BudgetAlert 类型已从 @shared/models 导入（v2.3.2 改为真实 IPC 数据）
// 旧的 AlertHistoryRow 接口已移除，统一使用 BudgetAlert

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

// v2.3.2：TOOL_CALL_STATS 和 ALERT_HISTORY 静态数据已移除，
// 改为通过 modelToolCalls() / budgetAlerts() IPC 加载真实数据

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

// v2.3.2：ALERT_HISTORY 静态数据已移除，改为通过 budgetAlerts() IPC 加载真实数据

export function ModelSettings() {
  const { llmConfig, setLlmConfig, loadSettings, saveSettings } = useSettingsStore()

  // Provider 列表
  const [providers, setProviders] = useState<PersistedProviderConfig[]>([])
  const [loadingProviders, setLoadingProviders] = useState(false)
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null)

  // Section 2: 模型配置
  const [selectedModel, setSelectedModel] = useState(llmConfig.model || 'deepseek-v4-flash')
  const [temperature, setTemperature] = useState(llmConfig.temperature ?? 0.3)
  const [thinkingLevel, setThinkingLevel] = useState<'low' | 'medium' | 'high'>('medium')
  const [maxToken, setMaxToken] = useState(llmConfig.maxTokens ?? 4096)
  const [contextWindow, setContextWindow] = useState(32768)
  const [requestTimeout, setRequestTimeout] = useState((llmConfig.timeout ?? 30000) / 1000)

  // Section 3: API 接入
  const [endpoint, setEndpoint] = useState(llmConfig.baseUrl || 'https://api.deepseek.com')
  const [apiKey, setApiKey] = useState(llmConfig.apiKey || '')
  const [showApiKey, setShowApiKey] = useState(false)
  const [organization, setOrganization] = useState('')

  // Section 7: 预算与告警
  const [monthlyBudget, setMonthlyBudget] = useState(2.0)
  const [alertThreshold, setAlertThreshold] = useState(80)
  const [emailNotify, setEmailNotify] = useState(true)

  // v2.3.2 新增：工具调用统计 + 预算告警（真实 IPC 数据，表为空时返回空数组）
  const [toolCallStats, setToolCallStats] = useState<ToolCallStat[]>([])
  const [budgetAlerts, setBudgetAlerts] = useState<BudgetAlert[]>([])

  // Section 3: API 测试连接
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<'idle' | 'success' | 'error'>('idle')
  const [testLatency, setTestLatency] = useState<number | null>(null)
  const [testLogs, setTestLogs] = useState<TestLogLine[]>([])
  const [lastTestTime, setLastTestTime] = useState<string>('')

  // Section 6: 对话记录
  const [statusFilter, setStatusFilter] = useState<'全部状态' | '成功' | '已拦截' | '失败'>('全部状态')
  const [currentPage, setCurrentPage] = useState(1)
  // 对话记录行：优先使用真实 tokenRecords，IPC 不可用或返回空时回退到静态 CONVERSATIONS
  const [conversationRows, setConversationRows] = useState<ConversationRow[]>(CONVERSATIONS)

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

  // 加载真实 token 使用记录，映射为对话表格行
  // - IPC 不可用 / 返回空数组 / 调用异常时，保持使用静态 CONVERSATIONS（fallback）
  // - token:records 只记录成功调用，status 始终映射为 '成功'
  useEffect(() => {
    if (!isElectronAPIAvailable()) return
    let cancelled = false

    const loadRecords = async () => {
      try {
        const records: TokenUsageRecord[] = await window.electronAPI.tokenRecords(100)
        if (cancelled) return
        if (!Array.isArray(records) || records.length === 0) return

        const rows: ConversationRow[] = records.map((r) => ({
          time: new Date(r.timestamp).toLocaleString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
            month: '2-digit',
            day: '2-digit',
          }),
          input: r.subagent || 'direct',
          model: r.model,
          modelTagType: 'brand' as const,
          inputTokens: r.inputTokens.toLocaleString('en-US'),
          outputTokens: r.outputTokens.toLocaleString('en-US'),
          status: '成功',
          statusType: 'success' as const,
        }))
        if (cancelled) return
        setConversationRows(rows)
      } catch (err) {
        console.error('[ModelSettings] 加载 tokenRecords 失败，回退到静态数据:', err)
      }
    }

    void loadRecords()
    return () => {
      cancelled = true
    }
  }, [])

  // v2.3.2 新增：加载工具调用统计 + 预算告警（真实 IPC 数据）
  // - IPC 不可用 / 调用异常时，保持空数组（显示"暂无数据"而非 mock 数据）
  // - 表为空时 IPC 返回空数组，前端显示空状态
  useEffect(() => {
    if (!isElectronAPIAvailable()) return
    let cancelled = false

    const loadStats = async () => {
      try {
        const [stats, alerts] = await Promise.all([
          window.electronAPI.modelToolCalls(),
          window.electronAPI.budgetAlerts(20),
        ])
        if (cancelled) return
        if (Array.isArray(stats)) setToolCallStats(stats)
        if (Array.isArray(alerts)) setBudgetAlerts(alerts)
      } catch (err) {
        console.error('[ModelSettings] 加载 modelToolCalls / budgetAlerts 失败:', err)
      }
    }

    void loadStats()
    return () => {
      cancelled = true
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

  // 导出统计：真实导出当前模型配置与预算信息（v2.3 活功能转换）
  const handleExportStats = async () => {
    setExportFeedback('正在导出统计数据...')
    if (exportTimerRef.current != null) clearTimeout(exportTimerRef.current)

    const stats = {
      model: {
        selectedModel,
        endpoint,
        temperature,
        maxToken,
        thinkingLevel,
        requestTimeout,
        hasApiKey: apiKey.length > 0,
      },
      budget: {
        monthlyBudget,
        alertThreshold,
        emailNotify,
      },
      test: {
        result: testResult,
        lastTestTime,
        latencyMs: testLatency,
      },
      exportedAt: new Date().toISOString(),
    }

    try {
      if (isElectronAPIAvailable() && window.electronAPI?.appExportModelStats) {
        const { filePath, size } = await window.electronAPI.appExportModelStats(stats)
        setExportFeedback(`已导出到 ${filePath} (${size} 字节)`)
      } else {
        // 非 Electron 环境：通过浏览器下载 JSON 文件
        const blob = new Blob([JSON.stringify(stats, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `model-stats-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
        setExportFeedback('已开始下载 JSON 文件')
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      setExportFeedback(`导出失败：${reason}`)
    }

    exportTimerRef.current = setTimeout(() => {
      setExportFeedback(null)
    }, 4000)
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
  const filteredConversations = conversationRows.filter((row) => {
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

      <div className="set-panel-content">
        {/* Section 1: KPI 统计行 */}
        <ModelKpiBar />

        {/* Section 2: 模型配置 */}
        <SettingsCard icon={Cpu} title="模型配置" tag="model.config" className="p-5">
          {/* 当前模型展示行 */}
          <div className="set-model-current">
            <div className="set-model-current__info">
              <span className="set-model-current__name">
                {selectedModel}
              </span>
              <span className="set-model-current__ver">
                v1.0
              </span>
              <span className="set-model-current__status">
                <CheckCircle2 className="size-3.5" />
                已连接
              </span>
            </div>
            <button
              type="button"
              onClick={handleSwitchModel}
              disabled={loadingProviders}
              aria-label="切换模型"
              className="set-model-switch-btn btn-press"
            >
              <span>切换模型</span>
              <ChevronDown className="size-3.5" />
            </button>
          </div>

          {/* 可选模型列表 */}
          <div className="set-model-grid">
            {modelOptions.map((m) => {
              const isSelected = m.name === selectedModel
              return (
                <button
                  key={m.name}
                  type="button"
                  onClick={() => setSelectedModel(m.name)}
                  className={
                    'set-model-card btn-press' +
                    (isSelected ? ' is-selected' : '')
                  }
                >
                  <div className="set-model-card__head">
                    <span className="set-model-card__name">
                      {m.name}
                    </span>
                    <span
                      className={
                        'set-model-card__tag ' +
                        (m.tagType === 'brand'
                          ? 'set-model-card__tag--brand'
                          : 'set-model-card__tag--default')
                      }
                    >
                      {m.tag}
                    </span>
                  </div>
                  <p className="set-model-card__desc">
                    {m.desc}
                  </p>
                </button>
              )
            })}
          </div>

          {/* 参数配置区 */}
          <div className="set-model-params">
            {/* a. 温度参数 */}
            <div className="set-model-param">
              <div className="set-model-param__head">
                <div className="set-model-param__head-left">
                  <span className="set-model-param__label">
                    温度参数 Temperature
                  </span>
                  <span className="set-model-param__range">
                    0.0 – 1.0
                  </span>
                </div>
                <span className="set-model-param__val">
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
              <div className="set-model-param__info">
                <Info className="size-3.5" />
                <p className="set-model-param__info-text">
                  推荐：运维分析场景建议 0.2-0.4，平衡准确性与创造性。过低(0-0.2)回复过于保守，过高(0.6-1.0)可能产生幻觉。
                </p>
              </div>
              <div className="set-model-presets">
                {TEMP_PRESETS.map((p) => {
                  const active = Math.abs(temperature - p.value) < 0.001
                  return (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => setTemperature(p.value)}
                      className={
                        'set-model-preset btn-press' +
                        (active ? ' is-active' : '')
                      }
                    >
                      {p.label} {p.value}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* b. 思考强度 */}
            <div className="set-model-param">
              <div className="set-model-param__head">
                <span className="set-model-param__label">
                  思考强度 Thinking Effort
                </span>
              </div>
              <div className="set-model-segment">
                {THINKING_LEVELS.map((t) => {
                  const active = thinkingLevel === t.value
                  return (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setThinkingLevel(t.value)}
                      className={
                        'set-model-segment__btn' +
                        (active ? ' is-active' : '')
                      }
                    >
                      {t.label}
                    </button>
                  )
                })}
              </div>
              <p className="set-model-param__range">
                低=快速响应 · 中=平衡 · 高=深度推理（消耗更多token）
              </p>
            </div>

            {/* c/d/e. 数字输入组 */}
            <div className="set-model-num-grid">
              <div className="set-model-num-item">
                <label className="set-model-num-item__label">
                  最大Token Max Tokens
                </label>
                <input
                  type="number"
                  value={maxToken}
                  onChange={(e) => setMaxToken(Number(e.target.value))}
                  aria-label="最大Token"
                  className="set-model-num-item__input"
                />
                <span className="set-model-num-item__hint">
                  单次响应最大长度
                </span>
              </div>
              <div className="set-model-num-item">
                <label className="set-model-num-item__label">
                  上下文窗口 Context Window
                </label>
                <input
                  type="number"
                  value={contextWindow}
                  onChange={(e) => setContextWindow(Number(e.target.value))}
                  aria-label="上下文窗口"
                  className="set-model-num-item__input"
                />
                <span className="set-model-num-item__hint">
                  对话历史保留长度
                </span>
              </div>
              <div className="set-model-num-item">
                <label className="set-model-num-item__label">
                  请求超时 Timeout
                </label>
                <input
                  type="number"
                  value={requestTimeout}
                  onChange={(e) => setRequestTimeout(Number(e.target.value))}
                  aria-label="请求超时"
                  className="set-model-num-item__input"
                />
                <span className="set-model-num-item__hint">秒</span>
              </div>
            </div>
          </div>
        </SettingsCard>

        {/* Section 3: API 接入与测试 */}
        <SettingsCard icon={KeyRound} title="API接入与测试" tag="api.config" className="p-5">
          {/* API 配置表单 */}
          <div className="set-api-form">
            <div className="set-api-row">
              <label className="set-api-row__label">
                API Endpoint
              </label>
              <input
                type="text"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                aria-label="API Endpoint"
                className="set-api-input"
              />
            </div>
            <div className="set-api-row">
              <label className="set-api-row__label">
                API Key
              </label>
              <div className="set-api-key-row">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  aria-label="API Key"
                  className="set-api-key-input"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey((v) => !v)}
                  aria-label="显示/隐藏API Key"
                  className="set-api-eye-btn btn-press"
                >
                  {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
            <div className="set-api-row">
              <label className="set-api-row__label">
                组织ID Organization{' '}
                <span className="set-api-row__label-hint">(可选)</span>
              </label>
              <input
                type="text"
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
                placeholder="输入组织ID（可选）"
                aria-label="组织ID"
                className="set-api-input"
              />
            </div>
          </div>

          {/* 连接测试区 */}
          <div className="set-api-test">
            <div className="set-api-test__head">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={isTesting}
                aria-label="测试连接"
                className="set-api-test__btn btn-press"
              >
                {isTesting ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Zap className="size-3.5" />
                )}
                <span>{isTesting ? '测试中...' : '测试连接'}</span>
              </button>
              <span className="set-api-test__time">
                最近测试 {lastTestTime}
              </span>
            </div>

            {/* 测试结果卡片 */}
            {testResult !== 'idle' && (
              <div
                className={
                  'set-api-result ' +
                  (testResult === 'success'
                    ? 'set-api-result--success'
                    : 'set-api-result--error')
                }
              >
                <span
                  className={
                    'set-api-result__status ' +
                    (testResult === 'success'
                      ? 'set-api-result__status--success'
                      : 'set-api-result__status--error')
                  }
                >
                  <CheckCircle2 className="size-4" />
                  {testResult === 'success' ? '连接成功' : '连接失败'}
                </span>
                {testResult === 'success' && (
                  <>
                    <span className="set-api-result__meta">
                      响应时间{' '}
                      <span className="set-api-result__meta-val">
                        {testLatency != null ? `${testLatency}ms` : '--'}
                      </span>
                    </span>
                    <span className="set-api-result__meta">
                      模型版本{' '}
                      <span className="set-api-result__meta-val">
                        {selectedModel}
                      </span>
                    </span>
                    <svg
                      width="100"
                      height="28"
                      viewBox="0 0 100 28"
                      className="set-api-result__chart"
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
            <div className="set-api-logs">
              <div className="set-api-logs__head">
                <TerminalIcon className="size-3" />
                <span className="set-api-logs__head-title">
                  测试日志
                </span>
              </div>
              <pre className="set-api-logs__body">
                {testLogs.length === 0 ? (
                  <span className="set-api-logs__placeholder">
                    点击「测试连接」开始验证 API 配置...
                  </span>
                ) : (
                  testLogs.map((line, idx) => (
                    <span key={`${line.time}-${idx}`}>
                      {idx > 0 && '\n'}
                      <span className="set-api-logs__time">{line.time}</span>{' '}
                      <span
                        className={
                          line.tone === 'success'
                            ? 'set-api-logs__line--success'
                            : line.tone === 'error'
                              ? 'set-api-logs__line--error'
                              : ''
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
          <div className="set-tool-stats">
            {toolCallStats.length === 0 ? (
              <div className="set-tool-stats__empty">
                暂无工具调用数据
              </div>
            ) : (
              toolCallStats.map((s) => (
              <div key={s.name} className="set-tool-row">
                <span className="set-tool-row__name">
                  {s.name}
                </span>
                <div className="set-tool-row__bar">
                  <div
                    className="set-tool-row__fill"
                    style={{ width: `${s.percent}%` }}
                  >
                    <span className="set-tool-row__count">
                      {s.count}
                    </span>
                  </div>
                </div>
                <span className="set-tool-row__percent">
                  {s.percent}%
                </span>
              </div>
            ))
            )}
          </div>

          {/* 底部统计行 */}
          <div className="set-tool-summary">
            <span className="set-tool-summary__item">
              总调用{' '}
              <span className="set-tool-summary__val set-tool-summary__val--default">
                {toolCallStats.reduce((sum, s) => sum + s.count, 0)}
              </span>{' '}
              次
            </span>
            <span className="set-tool-summary__item">
              成功率{' '}
              <span className="set-tool-summary__val set-tool-summary__val--success">
                94.3%
              </span>
            </span>
            <span className="set-tool-summary__item">
              平均耗时{' '}
              <span className="set-tool-summary__val set-tool-summary__val--default">
                2.1s
              </span>
            </span>
          </div>
        </SettingsCard>

        {/* Section 6: 对话记录 */}
        <SettingsCard icon={ListOrdered} title="对话记录" tag="conversation.history" className="p-5">
          {/* 工具栏 */}
          <div className="set-conv-toolbar">
            <div className="set-conv-search">
              <Search className="size-3.5" />
              <input
                type="text"
                placeholder="搜索对话..."
                aria-label="搜索对话"
                className="set-conv-search__input"
              />
            </div>
            <button
              type="button"
              onClick={handleCycleStatusFilter}
              aria-label="切换状态筛选"
              title="点击切换状态筛选"
              className="set-conv-filter-btn btn-press"
            >
              <span>{statusFilter}</span>
              <ChevronDown className="size-3.5" />
            </button>
          </div>

          {/* 表格 */}
          <div className="set-conv-table-wrap">
            <table className="set-conv-table">
              <thead>
                <tr>
                  <th>
                    时间
                  </th>
                  <th>
                    用户输入
                  </th>
                  <th>
                    AI模型
                  </th>
                  <th className="col-right">
                    输入Token
                  </th>
                  <th className="col-right">
                    输出Token
                  </th>
                  <th>
                    状态
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredConversations.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="set-conv-empty">
                      没有匹配 "{statusFilter}" 的记录
                    </td>
                  </tr>
                ) : (
                  filteredConversations.map((row, idx) => (
                  <tr key={`${row.time}-${idx}`}>
                    <td className="col-mono col-secondary">
                      {row.time}
                    </td>
                    <td className="col-default">
                      {row.input}
                    </td>
                    <td>
                      <span
                        className={
                          'set-conv-tag ' +
                          (row.modelTagType === 'brand'
                            ? 'set-conv-tag--brand'
                            : 'set-conv-tag--neutral')
                        }
                      >
                        {row.model}
                      </span>
                    </td>
                    <td className="col-mono col-right">
                      {row.inputTokens}
                    </td>
                    <td className="col-mono col-right">
                      {row.outputTokens}
                    </td>
                    <td>
                      <span
                        className={
                          'set-conv-status ' +
                          (row.statusType === 'success'
                            ? 'set-conv-status--success'
                            : row.statusType === 'warning'
                              ? 'set-conv-status--warning'
                              : 'set-conv-status--danger')
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
          <div className="set-conv-pagination">
            <span className="set-conv-pagination__count">
              共 {filteredConversations.length} 条
              {statusFilter !== '全部状态' && (
                <span className="set-conv-pagination__count-hint">
                  (筛选: {statusFilter})
                </span>
              )}
            </span>
            <div className="set-conv-pages">
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                aria-label="上一页"
                className="set-conv-page-btn btn-press"
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
                    'set-conv-page-btn btn-press' +
                    (currentPage === page ? ' is-active' : '')
                  }
                >
                  {page}
                </button>
              ))}
              <span className="set-conv-page-ellipsis">...</span>
              <button
                type="button"
                onClick={() => setCurrentPage(13)}
                aria-label="第 13 页"
                className={
                  'set-conv-page-btn btn-press' +
                  (currentPage === 13 ? ' is-active' : '')
                }
              >
                13
              </button>
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(13, p + 1))}
                disabled={currentPage === 13}
                aria-label="下一页"
                className="set-conv-page-btn btn-press"
              >
                <ChevronRight className="size-3.5" />
              </button>
            </div>
          </div>
        </SettingsCard>

        {/* Section 7: 预算与告警 */}
        <SettingsCard icon={AlertCircle} title="预算与告警" tag="budget" className="p-5">
          {/* 月度预算设置 */}
          <div className="set-budget-row">
            <div className="set-budget-row__head">
              <span className="set-budget-row__label">
                月度预算
              </span>
              <div className="set-budget-input-wrap">
                <span className="set-budget-input-wrap__prefix">$</span>
                <input
                  type="number"
                  value={monthlyBudget}
                  step={0.01}
                  onChange={(e) => setMonthlyBudget(Number(e.target.value))}
                  aria-label="月度预算"
                  className="set-budget-input"
                />
              </div>
            </div>
            <div className="set-budget-bar">
              <div className="set-budget-bar__track">
                <div
                  className="set-budget-bar__fill"
                  style={{ width: '34%' }}
                />
              </div>
              <span className="set-budget-meta">
                已用{' '}
                <span className="set-budget-meta__used">$0.68</span> · 剩余{' '}
                <span className="set-budget-meta__remaining">
                  $1.32
                </span>
              </span>
            </div>
          </div>

          {/* 告警阈值设置 */}
          <div className="set-alert-row">
            <div className="set-alert-row__head">
              <span className="set-alert-row__label">
                告警阈值
              </span>
              <span className="set-alert-row__meta">
                当消耗达{' '}
                <span className="set-alert-row__meta-val">
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
            <div className="set-alert-notify">
              <span className="set-alert-notify__label">邮件通知</span>
              <Switch checked={emailNotify} onCheckedChange={setEmailNotify} />
            </div>
          </div>

          {/* 告警历史 */}
          <div className="set-alert-history">
            <span className="set-alert-history__head">
              告警历史
            </span>
            <div className="set-alert-history__list">
              {budgetAlerts.length === 0 ? (
                <div className="set-alert-history__empty">
                  暂无告警历史
                </div>
              ) : (
                budgetAlerts.map((h, idx) => (
                <div
                  key={`${h.text}-${idx}`}
                  className="set-alert-history__item"
                >
                  <div className="set-alert-history__item-info">
                    <span
                      className={
                        'set-alert-history__dot ' +
                        (h.level === 'error'
                          ? 'set-alert-history__dot--error'
                          : 'set-alert-history__dot--alert')
                      }
                    />
                    <span className="set-alert-history__text">
                      {h.text}
                    </span>
                  </div>
                  <span className="set-alert-history__time">
                    {new Date(h.timestamp).toLocaleString('zh-CN', {
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              ))
              )}
            </div>
          </div>
        </SettingsCard>

        {/* ActionBar: 恢复默认 / 导出统计 / 保存所有配置（设计稿：sticky 底部操作栏） */}
        <footer className="set-model-actionbar">
          <button
            type="button"
            onClick={handleResetDefaults}
            aria-label="恢复默认"
            className="set-btn-secondary btn-press"
          >
            <RotateCcw className="size-3.5" />
            恢复默认
          </button>
          <button
            type="button"
            onClick={handleExportStats}
            aria-label="导出统计"
            className="set-btn-secondary btn-press"
          >
            <FileText className="size-3.5" />
            导出统计
          </button>
          <button
            type="button"
            onClick={handleSaveAll}
            aria-label="保存所有配置"
            className="set-btn-primary btn-press"
          >
            <Check className="size-3.5" />
            保存所有配置
          </button>
          {saveFeedback && (
            <span
              className={
                'set-model-actionbar__feedback ' +
                (saveFeedback === '配置已保存'
                  ? 'set-model-actionbar__feedback--success'
                  : 'set-model-actionbar__feedback--error')
              }
            >
              {saveFeedback}
            </span>
          )}
          {exportFeedback && (
            <span className="set-model-actionbar__feedback set-model-actionbar__feedback--success">
              {exportFeedback}
            </span>
          )}
        </footer>
      </div>
    </div>
  )
}
