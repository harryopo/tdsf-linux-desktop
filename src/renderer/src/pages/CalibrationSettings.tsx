/**
 * CalibrationSettings — AI 置信度校准设置
 *
 * 路由：/settings/calibration
 *
 * 设计稿：settings-calibration.html（自主设计，未在 tdsf-linux-redesign 设计稿中）
 * - Header: SettingsPageHeader（Activity 图标 + 校准设置 + AI 置信度 Temperature Scaling）
 * - Card 1: 全局默认（默认 T 值滑块 0.1-5.0 + 最小样本数）
 * - Card 2-9: 8 个 ProviderType 逐个校准卡片
 *   - Provider 信息（logprobs 支持徽章 + ProviderType 描述）
 *   - 校准 T 值滑块（0.1-5.0 step 0.1，编辑后调用 calibrate）
 *   - 状态行：最优 T / 上次校准时间 / 样本数 / 改善百分比 / 当前 ECE
 *   - 操作：校准 / 重置 / 计算 ECE
 * - ActionBar: 保存（持久化全局默认）/ 恢复默认
 *
 * 数据流：
 * 1. 挂载：credibilityGetCalibrationState() 拉全局状态 + providerList() 拉 provider 实例
 * 2. 校准：credibilityCalibrate(providerId) → 更新 state
 * 3. 重置：credibilityResetCalibration(providerId) → 更新 state
 * 4. 计算 ECE：credibilityComputeEce(providerId) → 临时展示
 *
 * 设计依据：
 * - v0.9.6 P1 §ECE 校准器（CalibrationTuner）
 * - v0.9.7 P3 M1 引入 PROVIDER_CAPABILITIES.logprobs 字段
 * - 5/8 provider 支持 logprobs（openai-compatible / deepseek / qwen / volcengine-ark / ollama）
 * - 3/8 provider 不支持 logprobs（anthropic / google / claude-sdk）
 *   → 走 thinking-block / text-fallback 兑底（详见 v0.9.7 P3 M1 方案书）
 */
import { useEffect, useState, useCallback, useRef } from 'react'
import {
  Activity, Cpu, RefreshCw, BarChart3, RotateCcw, type LucideIcon,
} from 'lucide-react'
import { usePersistentState } from '@/hooks/usePersistentState'
import { SettingsPageHeader } from '@/components/settings/SettingsPageHeader'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { SettingsSlider } from '@/components/settings/SettingsSlider'
import { SettingsActionBar } from '@/components/settings/SettingsActionBar'
import './Settings.css'
import type { ProviderType, PersistedProviderConfig } from '@shared/agent-types'
import type {
  ProviderCalibration,
  EceResult,
  TemperatureScalingResult,
  CalibrationState,
} from '@main/core/agent/credibility/calibration/types'

// ============================================================================
// 常量与 Provider 描述
// ============================================================================

/** ProviderType 显示元数据（中文名 + 描述 + 协议族分组） */
interface ProviderMeta {
  type: ProviderType
  label: string
  desc: string
  /** 协议族分组：影响 capability 默认值（如 logprobs 支持） */
  family: 'openai-compatible' | 'anthropic-protocol' | 'google-protocol' | 'agent-sdk'
  /** logprobs 支持：与 provider-capabilities.ts 的 PROVIDER_CAPABILITIES 对齐 */
  logprobs: boolean
}

const PROVIDER_META: ProviderMeta[] = [
  { type: 'openai-compatible', label: 'OpenAI 兼容', desc: '通用 OpenAI 兼容协议', family: 'openai-compatible', logprobs: true },
  { type: 'deepseek', label: 'DeepSeek', desc: '深度求索（默认 baseURL 已配置）', family: 'openai-compatible', logprobs: true },
  { type: 'qwen', label: '通义千问 / DashScope', desc: '阿里云百炼（OpenAI 兼容端点）', family: 'openai-compatible', logprobs: true },
  { type: 'volcengine-ark', label: '火山方舟 / 豆包', desc: '字节跳动火山引擎（OpenAI 兼容）', family: 'openai-compatible', logprobs: true },
  { type: 'ollama', label: 'Ollama（本地）', desc: '本地推理（默认 http://localhost:11434/v1）', family: 'openai-compatible', logprobs: true },
  { type: 'anthropic', label: 'Anthropic Claude', desc: '@ai-sdk/anthropic 直连', family: 'anthropic-protocol', logprobs: false },
  { type: 'google', label: 'Google Gemini', desc: '@ai-sdk/google 直连', family: 'google-protocol', logprobs: false },
  { type: 'claude-sdk', label: 'Claude Agent SDK', desc: '@anthropic-ai/claude-agent-sdk（agent loop）', family: 'agent-sdk', logprobs: false },
]

/** 加载状态（per-provider） */
type ProviderLoading = 'idle' | 'calibrating' | 'resetting' | 'computing'

/** Provider 卡片状态聚合 */
interface ProviderCardState {
  loading: ProviderLoading
  lastResult: TemperatureScalingResult | null
  lastEce: EceResult | null
  errorMessage: string | null
}

// ============================================================================
// 工具函数
// ============================================================================

/** 格式化时间戳为 zh-CN 本地时间；0 / null 返回 "未校准" */
function formatCalibratedAt(ts: number | undefined | null): string {
  if (!ts || ts <= 0) return '未校准'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '未校准'
  return d.toLocaleString('zh-CN', { hour12: false })
}

/** 格式化 ECE 为百分比（×100，保留 2 位小数） */
function formatEcePct(ece: number | undefined | null): string {
  if (ece == null) return '—'
  return `${(ece * 100).toFixed(2)}%`
}

/** 计算改善百分比（before - after）/ before；遇 0 时返回 0 */
function calcImprovementPct(before: number, after: number): string {
  if (before <= 0) return '0.00%'
  const pct = ((before - after) / before) * 100
  if (pct < 0) return `-${Math.abs(pct).toFixed(2)}%`
  return `${pct.toFixed(2)}%`
}

// ============================================================================
// 组件
// ============================================================================

export function CalibrationSettings() {
  // 全局默认（持久化）
  const [defaultT, setDefaultT] = usePersistentState<number>('calibration.defaultT', 1.0)
  const [minSamples, setMinSamples] = usePersistentState<number>('calibration.minSamples', 20)

  // 全局校准状态（从主进程拉取）
  const [globalState, setGlobalState] = useState<CalibrationState | null>(null)
  const [providers, setProviders] = useState<PersistedProviderConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Per-provider 操作状态
  const [cardStates, setCardStates] = useState<Record<string, ProviderCardState>>({})
  // 临时 T 滑块值（编辑中未保存）
  const [pendingT, setPendingT] = useState<Record<string, number>>({})
  // 顶部全局提示
  const [topMessage, setTopMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const topMsgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (topMsgTimerRef.current != null) clearTimeout(topMsgTimerRef.current)
    }
  }, [])

  // 显示顶部提示（2.5s 自动消失）
  const showTopMessage = useCallback((kind: 'success' | 'error', text: string) => {
    setTopMessage({ kind, text })
    if (topMsgTimerRef.current != null) clearTimeout(topMsgTimerRef.current)
    topMsgTimerRef.current = setTimeout(() => setTopMessage(null), 2500)
  }, [])

  // 初始化：拉取校准状态 + provider 列表
  useEffect(() => {
    if (typeof window === 'undefined' || !window.electronAPI) {
      setLoadError('当前环境非 Electron，无法连接主进程')
      setLoading(false)
      return
    }
    let cancelled = false

    const load = async () => {
      try {
        const [state, providerList] = await Promise.all([
          window.electronAPI!.credibilityGetCalibrationState(),
          window.electronAPI!.providerList().catch(() => []),
        ])
        if (cancelled) return
        setGlobalState(state)
        setProviders(Array.isArray(providerList) ? providerList : [])
        if (state.defaultT != null && state.defaultT > 0) {
          setDefaultT(state.defaultT)
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        if (!cancelled) {
          setLoadError(reason)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [setDefaultT])

  // 刷新全局状态（操作后调用）
  const refreshState = useCallback(async () => {
    if (!window.electronAPI) return
    try {
      const state = await window.electronAPI.credibilityGetCalibrationState()
      setGlobalState(state)
    } catch (err) {
      console.error('[CalibrationSettings] 刷新校准状态失败:', err)
    }
  }, [])

  // 更新 per-provider 状态
  const updateCardState = useCallback(
    (providerKey: string, patch: Partial<ProviderCardState>) => {
      setCardStates((prev) => {
        const current: ProviderCardState = prev[providerKey] ?? {
          loading: 'idle',
          lastResult: null,
          lastEce: null,
          errorMessage: null,
        }
        return { ...prev, [providerKey]: { ...current, ...patch } }
      })
    },
    [],
  )

  // 校准操作
  const handleCalibrate = useCallback(
    async (providerKey: string) => {
      if (!window.electronAPI) return
      updateCardState(providerKey, { loading: 'calibrating', errorMessage: null })
      try {
        const result = await window.electronAPI.credibilityCalibrate(providerKey, {
          tMin: 0.1,
          tMax: 5.0,
          tSteps: 50,
          minSamples,
        })
        updateCardState(providerKey, { loading: 'idle', lastResult: result, errorMessage: null })
        showTopMessage(
          'success',
          `已校准 ${providerKey}：T=${result.optimalT.toFixed(3)}，ECE 改善 ${calcImprovementPct(result.eceBefore, result.eceAfter)}`,
        )
        await refreshState()
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        updateCardState(providerKey, { loading: 'idle', errorMessage: reason })
        showTopMessage('error', `校准 ${providerKey} 失败：${reason}`)
      }
    },
    [minSamples, refreshState, showTopMessage, updateCardState],
  )

  // 重置操作
  const handleReset = useCallback(
    async (providerKey: string) => {
      if (!window.electronAPI) return
      updateCardState(providerKey, { loading: 'resetting', errorMessage: null })
      try {
        const ok = await window.electronAPI.credibilityResetCalibration(providerKey)
        if (ok) {
          updateCardState(providerKey, {
            loading: 'idle',
            lastResult: null,
            lastEce: null,
            errorMessage: null,
          })
          showTopMessage('success', `已重置 ${providerKey}（T 回到 1.0）`)
          await refreshState()
        } else {
          updateCardState(providerKey, { loading: 'idle', errorMessage: '重置返回 false' })
          showTopMessage('error', `重置 ${providerKey} 失败`)
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        updateCardState(providerKey, { loading: 'resetting', errorMessage: reason })
        showTopMessage('error', `重置 ${providerKey} 失败：${reason}`)
      }
    },
    [refreshState, showTopMessage, updateCardState],
  )

  // 计算 ECE（不修改 T）
  const handleComputeEce = useCallback(
    async (providerKey: string) => {
      if (!window.electronAPI) return
      updateCardState(providerKey, { loading: 'computing', errorMessage: null })
      try {
        const ece = await window.electronAPI.credibilityComputeEce(providerKey, 200)
        updateCardState(providerKey, { loading: 'idle', lastEce: ece, errorMessage: null })
        showTopMessage(
          'success',
          `已计算 ${providerKey} ECE：${formatEcePct(ece.ece)}（样本 ${ece.totalSamples}）`,
        )
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        updateCardState(providerKey, { loading: 'idle', errorMessage: reason })
        showTopMessage('error', `计算 ${providerKey} ECE 失败：${reason}`)
      }
    },
    [showTopMessage, updateCardState],
  )

  // 保存全局默认
  const handleSaveDefaults = useCallback(async () => {
    if (!window.electronAPI) {
      showTopMessage('error', '非 Electron 环境，无法保存')
      return
    }
    try {
      // 通过 configSet 持久化全局默认（与持久化 hook 写入的 key 一致）
      await window.electronAPI.configSet('calibration.defaultT', defaultT)
      await window.electronAPI.configSet('calibration.minSamples', minSamples)
      // 同时刷新主进程 CalibrationState.defaultT
      const state = await window.electronAPI.credibilityGetCalibrationState()
      if (state) {
        // 仅刷新前端 state 以反映新的 defaultT
        setGlobalState({ ...state, defaultT })
      }
      showTopMessage(
        'success',
        `全局默认已保存：T=${defaultT.toFixed(2)}，最小样本数=${minSamples}`,
      )
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      showTopMessage('error', `保存全局默认失败：${reason}`)
    }
  }, [defaultT, minSamples, showTopMessage])

  // 恢复默认
  const handleResetDefaults = useCallback(() => {
    setDefaultT(1.0)
    setMinSamples(20)
    showTopMessage('success', '已恢复默认参数（尚未保存到主进程）')
  }, [setDefaultT, setMinSamples, showTopMessage])

  // 取得 providerKey 关联的 ProviderCalibration（可能为 null）
  const getCalibrationFor = useCallback(
    (providerKey: string): ProviderCalibration | null => {
      if (!globalState) return null
      const p = globalState.providers[providerKey]
      return p ?? null
    },
    [globalState],
  )

  // 取得显示 T（pending 优先；否则已校准的 optimalT；否则 defaultT）
  const getDisplayT = useCallback(
    (providerKey: string): number => {
      if (pendingT[providerKey] != null) return pendingT[providerKey]
      const cal = getCalibrationFor(providerKey)
      if (cal && cal.optimalT > 0) return cal.optimalT
      return defaultT
    },
    [pendingT, getCalibrationFor, defaultT],
  )

  // 渲染 provider 卡片
  const renderProviderCard = (meta: ProviderMeta) => {
    const providerKey = meta.type
    const cal = getCalibrationFor(providerKey)
    const cardState: ProviderCardState = cardStates[providerKey] ?? {
      loading: 'idle',
      lastResult: null,
      lastEce: null,
      errorMessage: null,
    }
    const currentT = getDisplayT(providerKey)
    const isCalibrating = cardState.loading === 'calibrating'
    const isResetting = cardState.loading === 'resetting'
    const isComputing = cardState.loading === 'computing'
    const isBusy = isCalibrating || isResetting || isComputing

    // 已校准展示 lastResult 否则 lastEce
    const displayedEce = cardState.lastResult?.eceAfter ?? cardState.lastEce?.ece
    const displayedEceBefore = cardState.lastResult?.eceBefore
    const sampleCount = cal?.sampleCount ?? 0
    const totalSamplesEver = cal?.totalSamplesEver ?? 0
    const lastCalibratedAt = cal?.lastCalibratedAt ?? 0

    return (
      <SettingsCard
        key={providerKey}
        icon={Cpu}
        title={meta.label}
        tag={meta.family}
      >
        <SettingsRow
          label="Provider Type"
          desc={meta.desc}
          control={
            <div className="flex items-center gap-2">
              <span
                className="set-input set-input--readonly font-mono text-[12px]"
                style={{ minWidth: 200 }}
              >
                {providerKey}
              </span>
              <span
                className={
                  'inline-flex h-5 items-center rounded-[var(--trae-radius-4)] border px-2 text-[10px] font-medium ' +
                  (meta.logprobs
                    ? 'border-[var(--trae-status-success-default)] bg-[var(--trae-status-success-surface-l1)] text-[var(--trae-status-success-default)]'
                    : 'border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-overlay-l1)] text-[var(--trae-text-tertiary)]')
                }
                title={
                  meta.logprobs
                    ? '该 Provider 暴露 token logprobs，可计算真实 token-entropy'
                    : '该 Provider 不暴露 logprobs，走 thinking-block / text-fallback 兑底'
                }
              >
                logprobs: {meta.logprobs ? '✓' : '—'}
              </span>
            </div>
          }
        />
        <SettingsRow
          label="最优 T 值"
          desc="Temperature Scaling 缩放因子（1.0 = 无校准）"
          control={
            <SettingsSlider
              value={currentT}
              min={0.1}
              max={5.0}
              step={0.05}
              precision={2}
              onValueChange={(v) =>
                setPendingT((prev) => ({ ...prev, [providerKey]: v }))
              }
            />
          }
        />
        <SettingsRow
          label="已校准状态"
          desc="基于决策历史样本的 Temperature Scaling 优化结果"
          control={
            <div
              className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-[var(--trae-text-secondary)]"
              style={{ minWidth: 280 }}
            >
              <span>
                最优 T：
                <span className="font-mono text-[var(--trae-text-primary)]">
                  {cal?.optimalT?.toFixed(3) ?? '—'}
                </span>
              </span>
              <span>
                上次校准：
                <span className="font-mono text-[var(--trae-text-primary)]">
                  {formatCalibratedAt(lastCalibratedAt)}
                </span>
              </span>
              <span>
                本次样本：
                <span className="font-mono text-[var(--trae-text-primary)]">
                  {sampleCount}
                </span>
              </span>
              <span>
                累计样本：
                <span className="font-mono text-[var(--trae-text-primary)]">
                  {totalSamplesEver}
                </span>
              </span>
              <span>
                当前 ECE：
                <span className="font-mono text-[var(--trae-text-primary)]">
                  {formatEcePct(displayedEce)}
                </span>
              </span>
              {displayedEceBefore != null && cardState.lastResult && (
                <span>
                  改善：
                  <span className="font-mono text-[var(--trae-status-success-default)]">
                    {calcImprovementPct(
                      cardState.lastResult.eceBefore,
                      cardState.lastResult.eceAfter,
                    )}
                  </span>
                </span>
              )}
            </div>
          }
        />
        <SettingsRow
          label="操作"
          desc="校准需累计样本数 ≥ 最小样本数；少于则返回 T=1.0"
          control={
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleCalibrate(providerKey)}
                disabled={isBusy}
                className="set-btn-primary btn-press"
                aria-label={`校准 ${meta.label}`}
              >
                <Activity className="di-14" />
                {isCalibrating ? '校准中…' : '校准'}
              </button>
              <button
                type="button"
                onClick={() => void handleComputeEce(providerKey)}
                disabled={isBusy}
                className="set-btn-secondary btn-press"
                aria-label={`计算 ${meta.label} 的 ECE`}
              >
                <BarChart3 className="di-14" />
                {isComputing ? '计算中…' : '计算 ECE'}
              </button>
              <button
                type="button"
                onClick={() => void handleReset(providerKey)}
                disabled={isBusy || !cal}
                className="set-btn-secondary btn-press"
                aria-label={`重置 ${meta.label} 校准`}
              >
                <RotateCcw className="di-14" />
                {isResetting ? '重置中…' : '重置'}
              </button>
            </div>
          }
          isLast
        />
        {cardState.errorMessage != null && (
          <div
            role="alert"
            className="mx-4 mb-3 rounded-[var(--trae-radius-4)] border border-[var(--trae-status-error-default)] bg-[var(--trae-status-error-surface-l1)] px-3 py-2 text-[11px] text-[var(--trae-status-error-default)]"
          >
            {cardState.errorMessage}
          </div>
        )}
      </SettingsCard>
    )
  }

  return (
    <div>
      <SettingsPageHeader
        icon={Activity as LucideIcon}
        title="校准设置"
        desc="AI 模型置信度校准与 Temperature Scaling 优化"
      />

      <div className="set-panel-content">
        {/* 顶部消息（2.5s 自动消失） */}
        {topMessage != null && (
          <div
            role="status"
            aria-live="polite"
            className={
              'rounded-[var(--trae-radius-8)] border px-3 py-2 text-[12px] ' +
              (topMessage.kind === 'success'
                ? 'border-[var(--trae-status-success-default)] bg-[var(--trae-status-success-surface-l1)] text-[var(--trae-status-success-default)]'
                : 'border-[var(--trae-status-error-default)] bg-[var(--trae-status-error-surface-l1)] text-[var(--trae-status-error-default)]')
            }
          >
            {topMessage.text}
          </div>
        )}

        {/* Card 1: 全局默认 */}
        <SettingsCard icon={Activity} title="全局默认" tag="calibration.global">
          <SettingsRow
            label="默认 T 值"
            desc="未校准 Provider 使用的默认温度缩放因子（1.0 = 无校准）"
            control={
              <SettingsSlider
                value={defaultT}
                min={0.1}
                max={5.0}
                step={0.05}
                precision={2}
                onValueChange={setDefaultT}
              />
            }
          />
          <SettingsRow
            label="最小样本数"
            desc="触发 Temperature Scaling 优化的最小历史决策样本数"
            control={
              <span
                className="set-input set-input--readonly font-mono text-[12px]"
                style={{ minWidth: 80 }}
              >
                {minSamples}
              </span>
            }
            isLast
          />
        </SettingsCard>

        {/* 加载状态提示 */}
        {loading && (
          <SettingsCard icon={RefreshCw} title="加载中" tag="status">
            <div className="px-4 py-3 text-[12px] text-[var(--trae-text-tertiary)]">
              正在从主进程拉取校准状态与 Provider 列表…
            </div>
          </SettingsCard>
        )}

        {loadError != null && (
          <SettingsCard icon={Activity} title="加载失败" tag="error">
            <div className="px-4 py-3 text-[12px] text-[var(--trae-status-error-default)]">
              {loadError}
            </div>
          </SettingsCard>
        )}

        {/* 实际 Provider 实例数量提示（仅展示，非交互） */}
        {!loading && providers.length > 0 && (
          <SettingsCard icon={Cpu} title="Provider 实例" tag="calibration.instances">
            <div className="px-4 pb-3 text-[11px] text-[var(--trae-text-tertiary)]">
              当前已配置 {providers.length} 个 Provider 实例（ID: {providers.map((p) => p.id).join('、')}）。
              上方 8 个卡片为按 <code>ProviderType</code> 分类校准。
            </div>
          </SettingsCard>
        )}

        {/* Card 2-9: 8 个 ProviderType 逐个校准卡片 */}
        {PROVIDER_META.map(renderProviderCard)}

        <SettingsActionBar
          onSave={handleSaveDefaults}
          onReset={handleResetDefaults}
          saveLabel="保存全局默认"
          resetLabel="恢复默认参数"
        />
      </div>
    </div>
  )
}
