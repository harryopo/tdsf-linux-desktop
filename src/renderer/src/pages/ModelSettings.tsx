/**
 * ModelSettings — 模型配置（P0 关键页面）
 *
 * 路由：/settings/model
 *
 * 设计稿：settings-model.html（1:1 迁移）
 * - Header: 三列布局（左返回 + 中居中标题+副标题 + 右保存配置按钮）→ ModelSettingsHeader
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
 * v2.3.3 视觉重构：替换 SettingsPageHeader 为 ModelSettingsHeader（三列布局对齐设计稿），
 *                  所有 Section 卡片头部移除 tag + border-bottom（hideTag + noHeadBorder + headMb='lg'），
 *                  ModelKpiBar 改为 grid 布局对齐设计稿 lg:grid-cols-4。
 */
import { useState, useEffect, useRef } from 'react'
import { CheckCircle2, AlertCircle, Info, KeyRound } from 'lucide-react'
import type { PersistedProviderConfig } from '@shared/agent-types'
import type { ToolCallStat, BudgetAlert } from '@shared/models'
import { ModelSettingsHeader } from '@/components/settings/model/ModelSettingsHeader'
import { ModelKpiBar } from '@/components/settings/ModelKpiBar'
import { ModelConfigSection } from '@/components/settings/model/ModelConfigSection'
import { ApiTestSection } from '@/components/settings/model/ApiTestSection'
import { TokenStatsSection } from '@/components/settings/model/TokenStatsSection'
import { ToolCallSection } from '@/components/settings/model/ToolCallSection'
import { ConversationSection } from '@/components/settings/model/ConversationSection'
import { BudgetSection } from '@/components/settings/model/BudgetSection'
import { ModelActionBar } from '@/components/settings/model/ModelActionBar'
import { usePersistentState } from '@/hooks/usePersistentState'
import type { TestLogLine } from '@/components/settings/model/constants'
import { useSettingsStore } from '@/stores/settings-store'
import { isElectronAPIAvailable } from '@/utils/electron-api'
import './Settings.css'

/** 对话表格行类型（v2.3.3 删掉 CONVERSATIONS 后单独定义） */
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

export function ModelSettings() {
  const { llmConfig, setLlmConfig, loadSettings, saveSettings } = useSettingsStore()

  // Provider 列表
  const [providers, setProviders] = useState<PersistedProviderConfig[]>([])
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null)

  // Section 2: 模型配置
  const [selectedModel, setSelectedModel] = useState(llmConfig.model || 'deepseek-v4-flash')
  const [temperature, setTemperature] = useState(llmConfig.temperature ?? 0.3)
  const [thinkingLevel, setThinkingLevel] = usePersistentState<'low' | 'medium' | 'high'>('model.thinkingLevel', 'medium')
  const [maxToken, setMaxToken] = useState(llmConfig.maxTokens ?? 4096)
  const [contextWindow, setContextWindow] = usePersistentState<number>('model.contextWindow', 32768)
  const [requestTimeout, setRequestTimeout] = useState((llmConfig.timeout ?? 30000) / 1000)

  // Section 3: API 接入
  const [endpoint, setEndpoint] = useState(llmConfig.baseUrl || 'https://api.deepseek.com')
  const [apiKey, setApiKey] = useState(llmConfig.apiKey || '')
  const [showApiKey, setShowApiKey] = useState(false)
  const [organization, setOrganization] = usePersistentState<string>('model.organization', '')

  // Section 7: 预算与告警 (P1-2: 改用 usePersistentState 持久化)
  const [monthlyBudget, setMonthlyBudget] = usePersistentState<number>('model.monthlyBudget', 2.0)
  const [alertThreshold, setAlertThreshold] = usePersistentState<number>('model.alertThreshold', 80)
  const [emailNotify, setEmailNotify] = usePersistentState<boolean>('model.emailNotify', true)

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
  // 对话记录行：默认空数组，真实 tokenRecords 加载后填充
  // v2.3.3 修复：删除静态 CONVERSATIONS fallback，避免无数据时显示假数据误导用户
  const [conversationRows, setConversationRows] = useState<ConversationRow[]>([])
  const [isLoadingRecords, setIsLoadingRecords] = useState(false)

  // 预算已用金额（来自 tokenCostStats IPC，无数据时为 0）
  const [usedAmount, setUsedAmount] = useState(0)

  // 导出统计反馈
  const [exportFeedback, setExportFeedback] = useState<string | null>(null)
  const exportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 加载 Provider 列表（仅用于保存时回写默认 Provider）
  useEffect(() => {
    const loadProviders = async () => {
      if (!isElectronAPIAvailable()) return
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
  // - v2.3.3 修复：删掉 "if (records.length === 0) return" — 真实数据应总是接管，无数据时 isLoading 状态用于显示空状态
  // - token:records 只记录成功调用，status 始终映射为 '成功'
  useEffect(() => {
    if (!isElectronAPIAvailable()) return
    let cancelled = false

    const loadRecords = async () => {
      setIsLoadingRecords(true)
      try {
        const [records, costStats] = await Promise.all([
          window.electronAPI.tokenRecords(100),
          window.electronAPI.tokenCostStats().catch(() => null),
        ])
        if (cancelled) return

        if (costStats && typeof costStats.monthCost === 'number') {
          setUsedAmount(costStats.monthCost)
        }

        if (Array.isArray(records) && records.length > 0) {
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
          setConversationRows(rows)
        } else {
          setConversationRows([])
        }
      } catch (err) {
        if (cancelled) return
        console.error('[ModelSettings] 加载 tokenRecords 失败:', err)
        setConversationRows([])
      } finally {
        if (!cancelled) setIsLoadingRecords(false)
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

  // 测试连接：调用真实 llmTest IPC（llm:test 通道），测量往返延迟
  //
  // v2.3.4 改造：使用 LlmTestResult 而非 boolean，能拿到具体失败原因（401/404/网络/超时等）
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
      const result = await window.electronAPI.llmTest({
        baseUrl: endpoint,
        apiKey,
        model: selectedModel,
        temperature,
        maxTokens: maxToken,
        timeout: requestTimeout * 1000,
      })
      // 用主进程返回的 latency 优先，更精确
      const latency = result.latency > 0 ? result.latency : Math.round(performance.now() - startedAt)
      setTestLatency(latency)
      setLastTestTime(timestamp())
      if (result.ok) {
        setTestResult('success')
        setTestLogs((prev) => [
          ...prev,
          { time: timestamp(), text: `收到响应 (${latency}ms)`, tone: 'default' },
          { time: timestamp(), text: '连接验证通过', tone: 'success' },
        ])

        // v2.3.9 修复：测试连接成功后，自动把当前配置同步到 Provider 系统。
        // 旧 LLM 设置页的"测试连接"只验证 llmTest 通道，Key 存到旧的 'llm' key；
        // 而 AI 对话走 Provider 系统（SecureStore key='provider:${id}'）。如果不同步，
        // 用户测试通过但 AI 对话仍因无 Key 而报"Agent 调用失败"。
        if (isElectronAPIAvailable() && providers.length > 0) {
          const defaultProvider = providers[0]
          try {
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
            setTestLogs((prev) => [
              ...prev,
              { time: timestamp(), text: '已自动保存到 Provider 配置', tone: 'success' },
            ])
          } catch (saveErr) {
            console.error('[ModelSettings] 测试通过后自动保存 Provider 失败:', saveErr)
            setTestLogs((prev) => [
              ...prev,
              { time: timestamp(), text: '自动保存 Provider 失败，请手动点击"保存所有配置"', tone: 'error' },
            ])
          }
        }
      } else {
        setTestResult('error')
        // 把后端提供的具体原因写到日志里
        const code = result.code ? `[${result.code}] ` : ''
        const reason = result.error ?? '请检查 API Key / Endpoint / 模型名配置'
        setTestLogs((prev) => [
          ...prev,
          { time: timestamp(), text: `连接失败 (${latency}ms)`, tone: 'error' },
          { time: timestamp(), text: `${code}${reason}`, tone: 'error' },
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

  return (
    <div className="set-page" style={{ height: '100%', overflowY: 'auto' }}>
      <ModelSettingsHeader
        title="模型配置"
        desc="AI模型管理与Token用量统计"
        onSave={handleSaveAll}
      />

      <div className="set-panel-content">
        {/* v2.3.4 新增：状态/引导卡
            - API Key 为空时显示详细引导（"如何让模型连上"）
            - 已配置时显示简洁状态（已就绪 / 待测试 / 最近测试结果） */}
        <div
          className={
            'set-status-banner ' +
            (apiKey
              ? testResult === 'success'
                ? 'set-status-banner--ok'
                : testResult === 'error'
                  ? 'set-status-banner--error'
                  : 'set-status-banner--pending'
              : 'set-status-banner--warn')
          }
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
            padding: '12px 16px',
            borderRadius: 8,
            fontSize: 13,
            lineHeight: 1.6,
          }}
        >
          {apiKey ? (
            testResult === 'success' ? (
              <>
                <CheckCircle2 className="size-4 mt-0.5" style={{ flexShrink: 0, color: 'var(--trae-status-success-default)' }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>
                    模型已就绪 · {selectedModel || '未命名模型'}
                  </div>
                  <div style={{ color: 'var(--trae-text-secondary)' }}>
                    Endpoint: {endpoint || '(未配置)'} · 最近测试: {lastTestTime || '未测试'} ({testLatency ?? '--'}ms)
                  </div>
                </div>
              </>
            ) : testResult === 'error' ? (
              <>
                <AlertCircle className="size-4 mt-0.5" style={{ flexShrink: 0, color: 'var(--trae-status-alert-default)' }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>
                    最近测试失败 · 请检查下方配置
                  </div>
                  <div style={{ color: 'var(--trae-text-secondary)' }}>
                    在下方「API 接入与测试」区查看失败原因，重新填入 API Key 后再次「测试连接」。
                  </div>
                </div>
              </>
            ) : (
              <>
                <Info className="size-4 mt-0.5" style={{ flexShrink: 0, color: 'var(--trae-bg-brand)' }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>
                    API Key 已配置 · 尚未测试
                  </div>
                  <div style={{ color: 'var(--trae-text-secondary)' }}>
                    在下方「API 接入与测试」区点击「测试连接」验证配置。
                  </div>
                </div>
              </>
            )
          ) : (
            <>
              <KeyRound className="size-4 mt-0.5" style={{ flexShrink: 0, color: 'var(--trae-status-alert-default)' }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  还没有配置 API Key · 大模型无法连接
                </div>
                <div style={{ color: 'var(--trae-text-secondary)', marginBottom: 6 }}>
                  填入 API Key 即可让 AI 助手、命令分析、日志诊断等所有 LLM 功能正常工作。
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, color: 'var(--trae-text-secondary)' }}>
                  <div>
                    <strong>推荐：DeepSeek V4 Flash</strong> ·
                    国内直连 · 100 万 Token 上下文 · 价格亲民
                  </div>
                  <div>
                    申请 API Key：<a
                      href="https://platform.deepseek.com/api_keys"
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: 'var(--trae-bg-brand)', textDecoration: 'underline' }}
                    >
                      platform.deepseek.com/api_keys
                    </a>
                    {' '}（注册后「API Keys」→「Create new secret key」）
                  </div>
                  <div>
                    默认 Endpoint 已配置为 <code style={{ background: 'var(--trae-bg-surface-secondary)', padding: '1px 6px', borderRadius: 4 }}>https://api.deepseek.com</code>，
                    填入 Key 后点击「测试连接」即可。
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Section 1: KPI 统计行 */}
        <ModelKpiBar />

        {/* Section 2: 模型配置 */}
        <ModelConfigSection
          selectedModel={selectedModel}
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
          isLoading={isLoadingRecords}
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
          usedAmount={usedAmount}
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
