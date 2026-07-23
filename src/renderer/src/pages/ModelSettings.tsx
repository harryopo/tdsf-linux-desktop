/**
 * ModelSettings — 模型配置（P0 关键页面）
 *
 * 路由：/settings/model
 *
 * 设计稿：settings-model.html（1:1 迁移）
 * - PageHeader: 模型配置 / AI 模型管理与 Token 用量统计
 * - Section 1: KPI 统计行（Token 总量 / 成本 / 对话次数 / 成功率）→ ModelKpiBar
 * - Section 2: 模型配置（当前模型 + 可选模型列表 + 温度滑块+预设 + 思考强度分段 + 3 列数字输入）→ ModelConfigSection
 * - Section 3: API 接入与测试（Endpoint + API Key + 组织 ID + 测试连接 + 结果卡 + 日志）→ ApiTestSection
 * - Section 4: Token 使用统计 → TokenStatsSection（内含 TokenUsageChart）
 * - Section 5: 功能调用统计（5 条水平条形图 + 总览行）→ ToolCallSection
 * - Section 6: 对话记录（搜索 + 表格 + 分页）→ ConversationSection
 * - Section 7: 预算与告警（月度预算 + 告警阈值 + 邮件通知 + 告警历史）→ BudgetSection
 * - ActionBar: 恢复默认 / 导出统计 / 保存所有配置
 *
 * v1.5 改造：接入真实 IPC 存储（providerList / providerSave / providerSetDefault）
 * v2.3.2 改造：toolCallStats / budgetAlerts 接入真实 IPC 数据
 * M5 Task 6：拆分为 7 Section 组件，本文件仅负责状态管理 + Section 组合（≤500 行）。
 */
import { useState, useEffect, useRef } from 'react'
import {
  Cpu,
  type LucideIcon,
} from 'lucide-react'
import type { PersistedProviderConfig, TokenUsageRecord } from '@shared/agent-types'
import type { ToolCallStat, BudgetAlert } from '@shared/models'
import { SettingsPageHeader } from '@/components/settings/SettingsPageHeader'
import { ModelKpiBar } from '@/components/settings/ModelKpiBar'
import { ModelConfigSection } from '@/components/settings/model/ModelConfigSection'
import { ApiTestSection } from '@/components/settings/model/ApiTestSection'
import { TokenStatsSection } from '@/components/settings/model/TokenStatsSection'
import { ToolCallSection } from '@/components/settings/model/ToolCallSection'
import { ConversationSection } from '@/components/settings/model/ConversationSection'
import { BudgetSection } from '@/components/settings/model/BudgetSection'
import { ModelActionBar } from '@/components/settings/model/ModelActionBar'
import {
  CONVERSATIONS,
  MODELS,
  type ConversationRow,
  type ModelOption,
  type TestLogLine,
} from '@/components/settings/model/constants'
import { useSettingsStore } from '@/stores/settings-store'
import { isElectronAPIAvailable } from '@/utils/electron-api'
import './Settings.css'

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
      if (isElectronAPIAvailable() && window.electronAPI?.exportModelStats) {
        const { filePath, size } = await window.electronAPI.exportModelStats(stats)
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
        <ModelConfigSection
          selectedModel={selectedModel}
          onSwitchModel={handleSwitchModel}
          loadingProviders={loadingProviders}
          modelOptions={modelOptions}
          onSelectModel={setSelectedModel}
          temperature={temperature}
          onTemperatureChange={setTemperature}
          thinkingLevel={thinkingLevel}
          onThinkingLevelChange={setThinkingLevel}
          maxToken={maxToken}
          onMaxTokenChange={setMaxToken}
          contextWindow={contextWindow}
          onContextWindowChange={setContextWindow}
          requestTimeout={requestTimeout}
          onRequestTimeoutChange={setRequestTimeout}
        />

        {/* Section 3: API 接入与测试 */}
        <ApiTestSection
          endpoint={endpoint}
          onEndpointChange={setEndpoint}
          apiKey={apiKey}
          onApiKeyChange={setApiKey}
          showApiKey={showApiKey}
          onToggleShowApiKey={() => setShowApiKey((v) => !v)}
          organization={organization}
          onOrganizationChange={setOrganization}
          onTestConnection={handleTestConnection}
          isTesting={isTesting}
          lastTestTime={lastTestTime}
          testResult={testResult}
          testLatency={testLatency}
          testLogs={testLogs}
          selectedModel={selectedModel}
        />

        {/* Section 4: Token 使用统计 */}
        <TokenStatsSection />

        {/* Section 5: 功能调用统计 */}
        <ToolCallSection toolCallStats={toolCallStats} />

        {/* Section 6: 对话记录 */}
        <ConversationSection
          statusFilter={statusFilter}
          onCycleStatusFilter={handleCycleStatusFilter}
          filteredConversations={filteredConversations}
          currentPage={currentPage}
          onCurrentPageChange={setCurrentPage}
        />

        {/* Section 7: 预算与告警 */}
        <BudgetSection
          monthlyBudget={monthlyBudget}
          onMonthlyBudgetChange={setMonthlyBudget}
          alertThreshold={alertThreshold}
          onAlertThresholdChange={setAlertThreshold}
          emailNotify={emailNotify}
          onEmailNotifyChange={setEmailNotify}
          budgetAlerts={budgetAlerts}
        />

        {/* ActionBar: 恢复默认 / 导出统计 / 保存所有配置（设计稿：sticky 底部操作栏） */}
        <ModelActionBar
          onResetDefaults={handleResetDefaults}
          onExportStats={handleExportStats}
          onSaveAll={handleSaveAll}
          saveFeedback={saveFeedback}
          exportFeedback={exportFeedback}
        />
      </div>
    </div>
  )
}
