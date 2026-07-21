/**
 * CalibrationPanel - Provider 校准面板（v0.9.6 P1 新增 + v0.9.6 P2 扩展）
 *
 * 职责：
 * - 展示全局校准状态（defaultT / Provider 数 / 累计样本数 / 整体 ECE）
 * - 切换 Provider，查看每个 Provider 的：
 *   - 当前 optimalT（大字号 + Slider 实时调整）
 *   - 上次校准时间 / 累计样本数 / 校准前后的 ECE
 *   - 10 桶分桶校准误差柱状图（BucketStats）
 *   - T 搜索轨迹折线图（searchTrace，T vs ECE）
 * - 触发校准 / 重置校准 / 注入测试样本
 * - v0.9.6 P2：导出 EU AI Act 合规审计报告（JSON / Markdown / HTML）
 *
 * 论文支撑：
 * - Guo, Pleiss, Sun, Weinberger 2017, "On Calibration of Modern Neural Networks"
 *   ICML 2017, arXiv:1706.04599
 *   - 核心结论：现代神经网络系统性过度自信 → T > 1 校准
 *   - ECE 分桶评估校准质量
 *   - Temperature Scaling：单参数后处理，不改 argmax
 * - Kadavath et al. 2022 (Anthropic), arXiv:2207.05221
 *   - LLM 自我评估的 calibration 与模型规模正相关
 * - Shrivastava et al. 2023 (Stanford), arXiv:2311.08877
 *   - 不同领域需要不同 T，按 Provider 分类校准
 *
 * 法规支撑（v0.9.6 P2）：
 * - EU AI Act 2024/1689 Art.11/12/13/14/15 + Annex IV
 * - NIST AI RMF 1.0
 * - NIST AI 600-1 GenAI Profile（12 类 GAI 风险）
 *
 * 设计原则（与 ConfidenceBreakdown 一致）：
 * - 暗系风格（深渊暗系）
 * - 公式可追溯：每个数值旁标注来源（calibrate 前后 / bucket / search trace）
 * - 安全降级：IPC 不可用时显示空状态
 *
 * 调研文档：d:\ai\linux教学一体\idea-to-dev-output\22-可信度算法论文支撑调研.md §4
 * 方案书依据：v0.9.6 P1 §ECE 校准器（CalibrationTuner）+ v0.9.6 P2 §EU AI Act 审计报告
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import {
  Button,
  Empty,
  Form,
  Input,
  message,
  Modal,
  Radio,
  Result,
  Select,
  Slider,
  Spin,
  Switch,
  Tag,
  Tooltip,
  Tabs,
} from 'antd'
import {
  ReloadOutlined,
  ThunderboltOutlined,
  DeleteOutlined,
  ExperimentOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  BulbOutlined,
  FileTextOutlined,
  DownloadOutlined,
} from '@ant-design/icons'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as ChartTooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  ReferenceDot,
  ReferenceLine,
} from 'recharts'
import type {
  CalibrationState,
  EceResult,
  ProviderCalibration,
  ProviderId,
  TemperatureScalingResult,
} from '@shared/agent-types'
import { isElectronAPIAvailable } from '../../utils/electron-api'
import './CalibrationPanel.css'

/** CalibrationPanel 组件 Props */
export interface CalibrationPanelProps {
  /** 可选：默认选中的 Provider ID */
  initialProviderId?: ProviderId
  /** 可选：是否允许注入测试样本（开发模式） */
  enableTestSample?: boolean
}

// ============================================================================
// 工具函数
// ============================================================================

/** 格式化百分比 */
function fmtPct(n: number | undefined, digits = 1): string {
  if (n === undefined || Number.isNaN(n)) return '--'
  return `${(n * 100).toFixed(digits)}%`
}

/** 格式化 T 值 */
function fmtT(t: number | undefined, digits = 3): string {
  if (t === undefined || Number.isNaN(t)) return '--'
  return t.toFixed(digits)
}

/** ECE 颜色（按数值） */
function eceColor(ece: number | undefined): string {
  if (ece === undefined || Number.isNaN(ece)) return 'var(--color-text-tertiary)'
  if (ece <= 0.05) return 'var(--color-success)'
  if (ece <= 0.15) return 'var(--color-warning)'
  return 'var(--color-error)'
}

/** 校准改进幅度颜色 */
function improvementColor(imp: number | undefined): string {
  if (imp === undefined || Number.isNaN(imp)) return 'var(--color-text-tertiary)'
  if (imp >= 0.5) return 'var(--color-success)'
  if (imp >= 0.2) return 'var(--color-warning)'
  return 'var(--color-error)'
}

/** T 解读标签（基于 Guo 2017：T>1 = 过度自信，T<1 = 自信不足） */
function tInterpret(t: number | undefined): string {
  if (t === undefined) return ''
  if (t === 1.0) return '（无校准）'
  if (t > 1.0) return `（过度自信 → 平滑 ${t.toFixed(2)}×）`
  if (t < 1.0) return `（自信不足 → 锐化 ${(1 / t).toFixed(2)}×）`
  return ''
}

/** 时间格式化 */
function fmtTime(ts: number | undefined): string {
  if (!ts) return '从未校准'
  return new Date(ts).toLocaleString('zh-CN', { hour12: false })
}

// ============================================================================
// IPC 包装（带降级）
// ============================================================================

/**
 * 安全调用 IPC，校准类 API 不可用时返回 null
 */
async function callIpc<T>(fn: () => Promise<T> | undefined): Promise<T | null> {
  if (!isElectronAPIAvailable()) return null
  try {
    return (await fn()) ?? null
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[CalibrationPanel] IPC 调用失败', msg)
    return null
  }
}

// ============================================================================
// 子组件：全局摘要
// ============================================================================

/**
 * 全局校准状态摘要卡
 */
const GlobalSummary: React.FC<{ state: CalibrationState | null }> = ({ state }) => {
  const providerCount = state ? Object.keys(state.providers).length : 0
  const defaultT = state?.defaultT ?? 1.0

  // 计算全局累计样本数（从各 Provider 中汇总）
  const totalSamples = useMemo(() => {
    if (!state) return 0
    return Object.values(state.providers).reduce(
      (acc, p) => acc + (p.totalSamplesEver ?? 0),
      0
    )
  }, [state])

  return (
    <div className="calibration-panel-summary">
      <div className="calibration-panel-summary-cell">
        <div className="calibration-panel-summary-label">默认 T</div>
        <div className="calibration-panel-summary-value">
          {fmtT(defaultT)}
        </div>
        <div className="calibration-panel-summary-hint">未校准 Provider 用此值</div>
      </div>
      <div className="calibration-panel-summary-cell">
        <div className="calibration-panel-summary-label">Provider 数</div>
        <div className="calibration-panel-summary-value">{providerCount}</div>
        <div className="calibration-panel-summary-hint">已记录校准的 LLM</div>
      </div>
      <div className="calibration-panel-summary-cell">
        <div className="calibration-panel-summary-label">累计样本</div>
        <div className="calibration-panel-summary-value">{totalSamples}</div>
        <div className="calibration-panel-summary-hint">历史 verified 决策</div>
      </div>
      <div className="calibration-panel-summary-cell">
        <div className="calibration-panel-summary-label">最后更新</div>
        <div className="calibration-panel-summary-value-sm">
          {state ? fmtTime(state.updatedAt) : '--'}
        </div>
        <div className="calibration-panel-summary-hint">持久化时间</div>
      </div>
    </div>
  )
}

// ============================================================================
// 子组件：当前 Provider 详情
// ============================================================================

/**
 * Provider 校准详情（核心区域）
 */
const ProviderDetail: React.FC<{
  providerId: ProviderId
  calibration: ProviderCalibration | null
  ece: EceResult | null
  trace: TemperatureScalingResult | null
  loading: boolean
  onCalibrate: () => void
  onReset: () => void
  onAddTestSample: () => void
  onExportAudit: () => void
  tPreview: number
  onTPreviewChange: (t: number) => void
  enableTestSample: boolean
}> = ({
  providerId,
  calibration,
  ece,
  trace,
  loading,
  onCalibrate,
  onReset,
  onAddTestSample,
  onExportAudit,
  tPreview,
  onTPreviewChange,
  enableTestSample,
}) => {
  /** 当前 T = preview > 0 时用 preview，否则用 calibration.optimalT */
  const currentT = tPreview > 0 ? tPreview : calibration?.optimalT ?? 1.0
  const isCalibrated = (calibration?.lastCalibratedAt ?? 0) > 0
  const isModified = tPreview > 0 && Math.abs(tPreview - (calibration?.optimalT ?? 1.0)) > 0.001

  // 桶状图数据
  const bucketData = useMemo(
    () =>
      (ece?.bucketStats ?? []).map((b) => ({
        range: `${(b.bucketLower * 100).toFixed(0)}-${(b.bucketUpper * 100).toFixed(0)}%`,
        gap: b.count > 0 ? +(b.calibrationGap * 100).toFixed(2) : 0,
        conf: b.count > 0 ? +(b.avgConfidence * 100).toFixed(1) : 0,
        acc: b.count > 0 ? +(b.accuracy * 100).toFixed(1) : 0,
        count: b.count,
      })),
    [ece]
  )

  // 搜索轨迹数据
  const traceData = useMemo(
    () =>
      (trace?.searchTrace ?? []).map((p) => ({
        t: +p.t.toFixed(3),
        ece: +(p.ece * 100).toFixed(2),
        nll: +p.nll.toFixed(3),
      })),
    [trace]
  )

  return (
    <div className="calibration-panel-detail">
      {/* 头部：Provider 名 + T 大字号 + Slider */}
      <div className="calibration-panel-detail-header">
        <div className="calibration-panel-detail-id">
          <span className="calibration-panel-detail-id-label">Provider</span>
          <span className="calibration-panel-detail-id-value">{providerId}</span>
          {isCalibrated ? (
            <Tag color="success" icon={<CheckCircleOutlined />}>
              已校准
            </Tag>
          ) : (
            <Tag color="default" icon={<ClockCircleOutlined />}>
              未校准
            </Tag>
          )}
          {isModified && (
            <Tag color="warning" icon={<BulbOutlined />}>
              T 已修改（未应用）
            </Tag>
          )}
        </div>
        <div className="calibration-panel-detail-t">
          <div className="calibration-panel-detail-t-label">当前 T</div>
          <div className="calibration-panel-detail-t-value">{fmtT(currentT)}</div>
          <div className="calibration-panel-detail-t-hint">{tInterpret(currentT)}</div>
        </div>
      </div>

      {/* T 滑块 */}
      <div className="calibration-panel-detail-slider">
        <div className="calibration-panel-detail-slider-label">
          <span>Temperature T</span>
          <span className="calibration-panel-detail-slider-range">[0.1, 5.0]</span>
        </div>
        <Slider
          min={0.1}
          max={5.0}
          step={0.05}
          value={currentT}
          onChange={onTPreviewChange}
          tooltip={{ formatter: (v) => `T = ${(v ?? 0).toFixed(2)}` }}
          marks={{
            0.5: '0.5',
            1.0: '1.0',
            2.0: '2.0',
            3.0: '3.0',
            5.0: '5.0',
          }}
        />
      </div>

      {/* 关键指标 4 卡 */}
      <div className="calibration-panel-detail-grid">
        <div className="calibration-panel-detail-cell">
          <div className="calibration-panel-detail-cell-label">最优 T</div>
          <div className="calibration-panel-detail-cell-value">
            {fmtT(calibration?.optimalT)}
          </div>
        </div>
        <div className="calibration-panel-detail-cell">
          <div className="calibration-panel-detail-cell-label">样本数</div>
          <div className="calibration-panel-detail-cell-value">
            {calibration?.totalSamplesEver ?? 0}
          </div>
        </div>
        <div className="calibration-panel-detail-cell">
          <div className="calibration-panel-detail-cell-label">校准前 ECE</div>
          <div
            className="calibration-panel-detail-cell-value"
            style={{ color: eceColor(calibration?.eceBefore) }}
          >
            {fmtPct(calibration?.eceBefore, 2)}
          </div>
        </div>
        <div className="calibration-panel-detail-cell">
          <div className="calibration-panel-detail-cell-label">校准后 ECE</div>
          <div
            className="calibration-panel-detail-cell-value"
            style={{ color: eceColor(calibration?.eceAfter) }}
          >
            {fmtPct(calibration?.eceAfter, 2)}
          </div>
        </div>
        <div className="calibration-panel-detail-cell">
          <div className="calibration-panel-detail-cell-label">改善</div>
          <div
            className="calibration-panel-detail-cell-value"
            style={{
              color: improvementColor(
                calibration
                  ? (calibration.eceBefore - calibration.eceAfter) /
                      Math.max(0.0001, calibration.eceBefore)
                  : undefined
              ),
            }}
          >
            {calibration
              ? `${(((calibration.eceBefore - calibration.eceAfter) / Math.max(0.0001, calibration.eceBefore)) * 100).toFixed(0)}%`
              : '--'}
          </div>
        </div>
        <div className="calibration-panel-detail-cell">
          <div className="calibration-panel-detail-cell-label">校准时间</div>
          <div className="calibration-panel-detail-cell-value-sm">
            {fmtTime(calibration?.lastCalibratedAt)}
          </div>
        </div>
      </div>

      {/* 操作按钮区 */}
      <div className="calibration-panel-detail-actions">
        <Tooltip title="基于当前样本重新网格搜索最优 T（不修改其他 Provider）">
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            loading={loading}
            onClick={onCalibrate}
            disabled={!isElectronAPIAvailable()}
          >
            触发校准
          </Button>
        </Tooltip>
        <Tooltip title="T 回到 defaultT=1.0，清除该 Provider 校准状态">
          <Button
            icon={<DeleteOutlined />}
            onClick={onReset}
            disabled={!isElectronAPIAvailable() || !isCalibrated}
          >
            重置
          </Button>
        </Tooltip>
        <Tooltip title="刷新 ECE / 校准状态 / search trace">
          <Button
            icon={<ReloadOutlined />}
            onClick={() => {
              // 触发父组件 reload（通过 ref 调用）
              ;(window as unknown as { __calibrationPanelReload?: () => void }).__calibrationPanelReload?.()
            }}
            disabled={!isElectronAPIAvailable()}
          >
            刷新
          </Button>
        </Tooltip>
        {enableTestSample && (
          <Tooltip title="注入 1 条模拟样本（仅开发模式可见）">
            <Button
              icon={<ExperimentOutlined />}
              onClick={onAddTestSample}
              disabled={!isElectronAPIAvailable()}
            >
              测试样本
            </Button>
          </Tooltip>
        )}
        <Tooltip title="基于当前校准数据导出 EU AI Act 合规审计报告（JSON/Markdown/HTML）">
          <Button
            icon={<FileTextOutlined />}
            onClick={onExportAudit}
            disabled={!isElectronAPIAvailable()}
          >
            导出审计报告
          </Button>
        </Tooltip>
      </div>

      {/* 可视化区：分桶校准误差 + 搜索轨迹 */}
      <Tabs
        defaultActiveKey="bucket"
        className="calibration-panel-detail-tabs"
        items={[
          {
            key: 'bucket',
            label: '分桶校准误差',
            children: (
              <div className="calibration-panel-chart">
                {bucketData.length === 0 ? (
                  <Empty description="暂无样本数据" />
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={bucketData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                      <XAxis
                        dataKey="range"
                        tick={{ fontSize: 10, fill: 'var(--color-text-secondary)' }}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: 'var(--color-text-secondary)' }}
                        label={{
                          value: '校准误差 %',
                          angle: -90,
                          position: 'insideLeft',
                          style: { fontSize: 10, fill: 'var(--color-text-secondary)' },
                        }}
                      />
                      <ChartTooltip
                        contentStyle={{
                          background: 'var(--color-bg-card)',
                          border: '1px solid var(--color-border)',
                          fontSize: 12,
                        }}
                        formatter={(v: number, _: string, item) => {
                          const payload = item.payload as { conf?: number; acc?: number; count?: number }
                          return [
                            `gap=${v}%  conf=${payload.conf ?? '--'}%  acc=${payload.acc ?? '--'}%  n=${payload.count ?? 0}`,
                            '校准',
                          ]
                        }}
                      />
                      <Bar dataKey="gap" fill="var(--color-warning)" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
                <div className="calibration-panel-chart-hint">
                  ECE 总览：<span style={{ color: eceColor(ece?.ece) }}>{fmtPct(ece?.ece, 2)}</span>
                  {ece && `（${ece.totalSamples} 样本 / ${ece.numBuckets} 桶 / MCE=${fmtPct(ece.mce, 2)}）`}
                </div>
              </div>
            ),
          },
          {
            key: 'trace',
            label: 'T 搜索轨迹',
            children: (
              <div className="calibration-panel-chart">
                {traceData.length === 0 ? (
                  <Empty description="触发校准后将显示搜索轨迹" />
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={traceData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                      <XAxis
                        dataKey="t"
                        type="number"
                        domain={[0.1, 5.0]}
                        tick={{ fontSize: 10, fill: 'var(--color-text-secondary)' }}
                        label={{
                          value: 'Temperature T',
                          position: 'insideBottom',
                          offset: -2,
                          style: { fontSize: 10, fill: 'var(--color-text-secondary)' },
                        }}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: 'var(--color-text-secondary)' }}
                        label={{
                          value: 'ECE %',
                          angle: -90,
                          position: 'insideLeft',
                          style: { fontSize: 10, fill: 'var(--color-text-secondary)' },
                        }}
                      />
                      <ChartTooltip
                        contentStyle={{
                          background: 'var(--color-bg-card)',
                          border: '1px solid var(--color-border)',
                          fontSize: 12,
                        }}
                        formatter={(v: number, n: string) => {
                          if (n === 'ece') return [`${v}%`, 'ECE']
                          if (n === 'nll') return [v.toFixed(3), 'NLL']
                          return [v, n]
                        }}
                      />
                      <ReferenceLine
                        x={calibration?.optimalT ?? 1.0}
                        stroke="var(--color-success)"
                        strokeDasharray="3 3"
                        label={{
                          value: `最优 T=${fmtT(calibration?.optimalT)}`,
                          position: 'top',
                          style: { fontSize: 10, fill: 'var(--color-success)' },
                        }}
                      />
                      <ReferenceDot
                        x={calibration?.optimalT ?? 1.0}
                        y={trace ? (() => {
                          const pt = trace.searchTrace.find(
                            (p) => Math.abs(p.t - (calibration?.optimalT ?? 1.0)) < 0.001
                          )
                          return pt ? pt.ece * 100 : 0
                        })() : 0}
                        r={6}
                        fill="var(--color-success)"
                        stroke="var(--color-bg-card)"
                      />
                      <Line
                        type="monotone"
                        dataKey="ece"
                        stroke="var(--color-warning)"
                        strokeWidth={2}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="nll"
                        stroke="var(--color-link)"
                        strokeWidth={1}
                        strokeDasharray="2 2"
                        dot={false}
                        yAxisId={0}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
                <div className="calibration-panel-chart-hint">
                  搜索范围 [0.1, 5.0] · 步数 50 · 目标最小化 ECE
                </div>
              </div>
            ),
          },
        ]}
      />
    </div>
  )
}

// ============================================================================
// 主组件
// ============================================================================

/**
 * CalibrationPanel 校准面板
 */
const CalibrationPanel: React.FC<CalibrationPanelProps> = ({
  initialProviderId,
  enableTestSample = false,
}) => {
  /** 全局校准状态 */
  const [globalState, setGlobalState] = useState<CalibrationState | null>(null)
  /** 当前选中的 Provider */
  const [selectedProvider, setSelectedProvider] = useState<ProviderId | null>(
    initialProviderId ?? null
  )
  /** 当前 Provider 的校准详情 */
  const [calibration, setCalibration] = useState<ProviderCalibration | null>(null)
  /** 当前 Provider 的实时 ECE */
  const [ece, setEce] = useState<EceResult | null>(null)
  /** 当前 Provider 上次校准的 search trace */
  const [trace, setTrace] = useState<TemperatureScalingResult | null>(null)
  /** 加载中 */
  const [loading, setLoading] = useState(false)
  /** T 预览值（> 0 表示用户拖动 slider 还未应用） */
  const [tPreview, setTPreview] = useState(0)
  /** 整体加载 */
  const [globalLoading, setGlobalLoading] = useState(true)

  /** 防止卸载后 setState */
  const isMountedRef = useRef(true)
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  // 暴露给子组件的全局 reload 函数
  useEffect(() => {
    ;(window as unknown as { __calibrationPanelReload?: () => void }).__calibrationPanelReload =
      () => {
        void loadAll()
      }
    return () => {
      delete (window as unknown as { __calibrationPanelReload?: () => void }).__calibrationPanelReload
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProvider])

  /** 加载全局状态 */
  const loadGlobalState = useCallback(async () => {
    const state = await callIpc(() =>
      isElectronAPIAvailable() ? window.electronAPI.credibilityGetCalibrationState() : undefined
    )
    if (!isMountedRef.current) return
    setGlobalState(state as CalibrationState | null)
    // 自动选中第一个 Provider
    if (state && !selectedProvider) {
      const firstId = Object.keys(state.providers)[0] ?? null
      if (firstId) setSelectedProvider(firstId)
    }
  }, [selectedProvider])

  /** 加载指定 Provider 的详情 */
  const loadProviderDetail = useCallback(async (providerId: ProviderId) => {
    const [cal, e] = await Promise.all([
      callIpc(() =>
        isElectronAPIAvailable() ? window.electronAPI.credibilityGetCalibration(providerId) : undefined
      ),
      callIpc(() =>
        isElectronAPIAvailable() ? window.electronAPI.credibilityComputeEce(providerId) : undefined
      ),
    ])
    if (!isMountedRef.current) return
    setCalibration(cal as ProviderCalibration | null)
    setEce(e as EceResult | null)
  }, [])

  /** 加载所有数据 */
  const loadAll = useCallback(async () => {
    if (!isElectronAPIAvailable()) {
      setGlobalLoading(false)
      return
    }
    setGlobalLoading(true)
    await loadGlobalState()
    if (selectedProvider) {
      await loadProviderDetail(selectedProvider)
    }
    if (isMountedRef.current) setGlobalLoading(false)
  }, [loadGlobalState, loadProviderDetail, selectedProvider])

  // 初始加载
  useEffect(() => {
    void loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 选中 Provider 变化时加载详情
  useEffect(() => {
    if (selectedProvider) {
      void loadProviderDetail(selectedProvider)
      setTPreview(0) // 重置 T 预览
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProvider])

  // 当 calibration 变化时，更新 trace（用上次校准的 searchTrace）
  useEffect(() => {
    if (calibration?.lastCalibratedAt) {
      // 通过 calibrate 重新获取 search trace（不会修改 T，因为样本不变）
      // 实际简化：trace 仅在 calibrate 完成后设置
    } else {
      setTrace(null)
    }
  }, [calibration])

  // ============================================================================
  // 操作回调
  // ============================================================================

  const handleCalibrate = useCallback(async () => {
    if (!selectedProvider) return
    setLoading(true)
    const result = await callIpc(() =>
      isElectronAPIAvailable()
        ? window.electronAPI.credibilityCalibrate(selectedProvider)
        : undefined
    )
    if (!isMountedRef.current) return
    setLoading(false)
    if (result) {
      const r = result as TemperatureScalingResult
      setTrace(r)
      setTPreview(0) // 重置 slider
      message.success(
        `校准完成：T = ${r.optimalT.toFixed(3)}，ECE ${(r.eceBefore * 100).toFixed(2)}% → ${(r.eceAfter * 100).toFixed(2)}%`
      )
      await loadAll()
    } else {
      message.error('校准失败，请检查 IPC 连接')
    }
  }, [selectedProvider, loadAll])

  const handleReset = useCallback(async () => {
    if (!selectedProvider) return
    setLoading(true)
    const ok = await callIpc(() =>
      isElectronAPIAvailable()
        ? window.electronAPI.credibilityResetCalibration(selectedProvider)
        : undefined
    )
    if (!isMountedRef.current) return
    setLoading(false)
    if (ok) {
      message.success(`已重置 ${selectedProvider} 的校准状态`)
      setTrace(null)
      setTPreview(0)
      await loadAll()
    } else {
      message.error('重置失败')
    }
  }, [selectedProvider, loadAll])

  const handleAddTestSample = useCallback(async () => {
    if (!selectedProvider) return
    // 注入 1 条带噪声的测试样本（仅开发模式）
    const conf = 0.5 + Math.random() * 0.5
    const wasCorrect = Math.random() < conf * 0.85 + 0.1 // 略带噪声
    const sample = {
      decisionId: `test-${Date.now()}`,
      reportedConfidence: +conf.toFixed(3),
      wasCorrect,
      providerId: selectedProvider,
      timestamp: Date.now(),
    }
    const ok = await callIpc(() =>
      isElectronAPIAvailable()
        ? window.electronAPI.credibilityAddCalibrationSample(sample)
        : undefined
    )
    if (!isMountedRef.current) return
    if (ok) {
      message.success(`已添加测试样本：conf=${sample.reportedConfidence} correct=${sample.wasCorrect}`)
      await loadAll()
    } else {
      message.error('添加失败')
    }
  }, [selectedProvider, loadAll])

  const handleProviderChange = useCallback((id: ProviderId) => {
    setSelectedProvider(id)
  }, [])

  const handleTPreviewChange = useCallback((t: number) => {
    setTPreview(t)
  }, [])

  // ============================================================================
  // v0.9.6 P2：EU AI Act 合规审计报告导出
  // ============================================================================

  /** 审计导出 Modal 是否打开 */
  const [auditModalOpen, setAuditModalOpen] = useState(false)
  /** 审计导出 loading */
  const [auditLoading, setAuditLoading] = useState(false)
  /** 审计导出结果 */
  interface AuditResult {
    reportId: string
    fingerprint: string
    decisionId: string
    complianceScore: number
    euAiActCompliant: boolean
    files: Array<{ format: string; filepath: string; bytes: number }>
  }
  const [auditResult, setAuditResult] = useState<AuditResult | null>(null)
  /** 审计导出 form */
  const [auditForm] = Form.useForm<{
    decisionTitle: string
    decisionId: string
    intendedPurpose: string
    deployer: string
    deployerContact: string
    isHighRisk: boolean
    actionDescription: string
    actionType: 'command' | 'config-change' | 'rollback' | 'no-op' | 'escalation'
    command: string
    oversightMode: 'human-in-the-loop' | 'human-on-the-loop' | 'human-in-command'
    approvalStatus: 'auto-approved' | 'pending' | 'approved' | 'rejected' | 'timeout'
    approver: string
    outputFormat: 'json' | 'markdown' | 'html'
    writeAllFormats: boolean
  }>()

  /** 打开审计导出 Modal */
  const handleOpenExportAudit = useCallback(() => {
    if (!selectedProvider) {
      message.warning('请先选择 Provider')
      return
    }
    // 用 Provider + 时间戳生成默认 decisionId
    const ts = Date.now()
    const defaultDecisionId = `calib-${selectedProvider}-${ts}`
    auditForm.setFieldsValue({
      decisionTitle: `${selectedProvider} 校准数据合规审计`,
      decisionId: defaultDecisionId,
      intendedPurpose: `基于 ${selectedProvider} Provider 的可信度校准状态生成 EU AI Act 合规审计报告（用于 CI / 内部归档）`,
      deployer: 'TDSF-Linux 运维团队',
      deployerContact: 'admin@tdsf.dev',
      isHighRisk: true,
      actionDescription: `导出 ${selectedProvider} 校准数据的合规审计快照`,
      actionType: 'no-op',
      command: '',
      oversightMode: 'human-on-the-loop',
      approvalStatus: 'auto-approved',
      approver: 'system',
      outputFormat: 'json',
      writeAllFormats: true,
    })
    setAuditResult(null)
    setAuditModalOpen(true)
  }, [selectedProvider, auditForm])

  /** 关闭审计导出 Modal */
  const handleCloseExportAudit = useCallback(() => {
    if (auditLoading) return
    setAuditModalOpen(false)
    setAuditResult(null)
  }, [auditLoading])

  /**
   * 构造 AuditReportInput
   * - 决策上下文：来自 Modal 表单
   * - 6 源证据：用校准后的 T 作为占位（满足字段要求，标记为校准快照源）
   * - 校准状态：来自当前 Provider 的 ProviderCalibration
   * - 人工监督：来自 Modal 表单
   * - 决策动作：来自 Modal 表单
   */
  const buildAuditInput = useCallback(
    (vals: {
      decisionTitle: string
      decisionId: string
      intendedPurpose: string
      deployer: string
      deployerContact: string
      isHighRisk: boolean
      actionDescription: string
      actionType: 'command' | 'config-change' | 'rollback' | 'no-op' | 'escalation'
      command: string
      oversightMode: 'human-in-the-loop' | 'human-on-the-loop' | 'human-in-command'
      approvalStatus: 'auto-approved' | 'pending' | 'approved' | 'rejected' | 'timeout'
      approver: string
    }) => {
      const now = Date.now()
      const tVal = calibration?.optimalT ?? 1.0
      // 用校准后的 T 作为 6 源 mass 函数的"校准"标记
      // 校准前 = 0.5（中性），校准后 = 1 - eceAfter
      const calibratedConf = calibration?.eceAfter != null
        ? Math.max(0, Math.min(1, 1 - calibration.eceAfter))
        : 0.5
      return {
        decisionContext: {
          decisionId: vals.decisionId,
          decisionTitle: vals.decisionTitle,
          decisionTime: now,
          provider: String(selectedProvider ?? 'unknown'),
          modelVersion: 'v0.9.6-p2',
          deployer: vals.deployer,
          intendedPurpose: vals.intendedPurpose,
          knownLimitations: [
            '仅基于当前校准快照生成（未包含真实决策证据链）',
            'EU AI Act 12 类风险为模板默认值，需人工 review',
          ],
          deployerContact: vals.deployerContact,
          domain: 'Linux Operations / AIOps',
          isHighRisk: vals.isHighRisk,
        },
        sourceEvidences: [
          {
            sourceId: 'S1-log' as const,
            sourceName: '日志证据（快照占位）',
            focalElements: { T: calibratedConf, '¬T': 1 - calibratedConf },
            rawConfidence: 0.5,
            calibratedConfidence: calibratedConf,
            calibrationTemperature: tVal,
            weight: 0.16,
            inputData: { snapshotOnly: true, eceAfter: calibration?.eceAfter ?? null },
            dataProvenance: 'Calibration Snapshot',
            dataTimestamp: now,
          },
          {
            sourceId: 'S2-knowledge' as const,
            sourceName: '知识库（快照占位）',
            focalElements: { T: calibratedConf, '¬T': 1 - calibratedConf },
            rawConfidence: 0.5,
            calibratedConfidence: calibratedConf,
            calibrationTemperature: tVal,
            weight: 0.16,
            inputData: { snapshotOnly: true },
            dataProvenance: 'Calibration Snapshot',
            dataTimestamp: now,
          },
          {
            sourceId: 'S3-ai-param' as const,
            sourceName: 'AI 参数（快照占位）',
            focalElements: { T: calibratedConf, '¬T': 1 - calibratedConf },
            rawConfidence: 0.5,
            calibratedConfidence: calibratedConf,
            calibrationTemperature: tVal,
            weight: 0.2,
            inputData: { snapshotOnly: true, optimalT: tVal, provider: selectedProvider },
            dataProvenance: 'Calibration Snapshot',
            dataTimestamp: now,
          },
          {
            sourceId: 'S4-human' as const,
            sourceName: '人工证据（快照占位）',
            focalElements: { T: calibratedConf, '¬T': 1 - calibratedConf },
            rawConfidence: 0.5,
            calibratedConfidence: calibratedConf,
            calibrationTemperature: tVal,
            weight: 0.16,
            inputData: { snapshotOnly: true },
            dataProvenance: 'Calibration Snapshot',
            dataTimestamp: now,
          },
          {
            sourceId: 'S5-history' as const,
            sourceName: '历史证据（快照占位）',
            focalElements: { T: calibratedConf, '¬T': 1 - calibratedConf },
            rawConfidence: 0.5,
            calibratedConfidence: calibratedConf,
            calibrationTemperature: tVal,
            weight: 0.16,
            inputData: { snapshotOnly: true },
            dataProvenance: 'Calibration Snapshot',
            dataTimestamp: now,
          },
          {
            sourceId: 'S6-best-practice' as const,
            sourceName: '最佳实践（快照占位）',
            focalElements: { T: calibratedConf, '¬T': 1 - calibratedConf },
            rawConfidence: 0.5,
            calibratedConfidence: calibratedConf,
            calibrationTemperature: tVal,
            weight: 0.16,
            inputData: { snapshotOnly: true },
            dataProvenance: 'Calibration Snapshot',
            dataTimestamp: now,
          },
        ],
        confidenceAssessment: {
          belief: calibratedConf,
          plausibility: Math.min(1, calibratedConf + 0.1),
          confidence: calibratedConf,
          uncertainty: 0.1,
          // eceAfter < 0.1 → low；< 0.3 → medium；否则 high
          conflictLevel: (calibration?.eceAfter ?? 0) < 0.1 ? 0.05 : (calibration?.eceAfter ?? 0) < 0.3 ? 0.2 : 0.5,
          ruleUsed: 'dempster' as const,
          fusionSteps: [
            {
              step: 1,
              ruleUsed: 'dempster' as const,
              leftSourceId: 'S1-log',
              rightSourceId: 'S2-knowledge',
              conflict: 0.0,
              resultBelief: calibratedConf,
              resultPlausibility: Math.min(1, calibratedConf + 0.1),
            },
          ],
        },
        calibration: calibration
          ? {
              providerId: String(selectedProvider ?? 'unknown'),
              optimalT: calibration.optimalT ?? 1.0,
              eceBefore: calibration.eceBefore ?? 0,
              eceAfter: calibration.eceAfter ?? 0,
              improvement: calibration.eceBefore
                ? (calibration.eceBefore - (calibration.eceAfter ?? 0)) / calibration.eceBefore
                : 0,
              sampleCount: calibration.totalSamplesEver ?? 0,
              calibratedAtIso: calibration.lastCalibratedAt
                ? new Date(calibration.lastCalibratedAt).toISOString()
                : new Date().toISOString(),
              isCalibrationFresh:
                calibration.lastCalibratedAt > 0 &&
                Date.now() - calibration.lastCalibratedAt < 7 * 24 * 60 * 60 * 1000,
              daysSinceCalibration: calibration.lastCalibratedAt
                ? Math.floor((Date.now() - calibration.lastCalibratedAt) / (24 * 60 * 60 * 1000))
                : 999,
              topCandidates: (trace?.searchTrace ?? []).slice(0, 5).map((p) => ({
                t: p.t,
                ece: p.ece,
              })),
            }
          : null,
        humanOversight: {
          oversightMode: vals.oversightMode,
          approvalStatus: vals.approvalStatus,
          approver: vals.approver || null,
          approvedAtIso: vals.approvalStatus === 'approved' || vals.approvalStatus === 'auto-approved'
            ? new Date().toISOString()
            : null,
          approverComment: '由 CalibrationPanel 自动导出（合规快照）',
          triggeredHighRiskInterception: false,
          interceptedCommandCount: 0,
        },
        decisionAction: {
          actionType: vals.actionType,
          description: vals.actionDescription,
          command: vals.command || null,
          sandboxResult: 'not-run',
          executionResult: 'not-executed',
          executedAtIso: null,
          affectedResources: [],
          isRollbackable: false,
        },
        deployerContact: vals.deployerContact,
        domain: 'Linux Operations / AIOps',
        isHighRisk: vals.isHighRisk,
      }
    },
    [calibration, trace, selectedProvider]
  )

  /** 提交审计导出 */
  const handleSubmitExportAudit = useCallback(async () => {
    try {
      const vals = await auditForm.validateFields()
      setAuditLoading(true)
      const input = buildAuditInput(vals)
      const writeAllFormats = vals.writeAllFormats
      const result = (await callIpc(() =>
        isElectronAPIAvailable()
          ? window.electronAPI.credibilityExportAuditReport(input, {
              format: vals.outputFormat,
              writeAllFormats,
            })
          : undefined
      )) as
        | {
            reportId: string
            fingerprint: string
            decisionId: string
            formats: string[]
            written: Array<{ format: string; filepath: string; bytes: number }>
          }
        | null

      if (!isMountedRef.current) return
      if (!result) {
        message.error('审计导出失败：IPC 不可用')
        setAuditLoading(false)
        return
      }

      // 加载已落盘报告，获取 complianceScore
      const loaded = (await callIpc(() =>
        isElectronAPIAvailable()
          ? window.electronAPI.credibilityLoadAuditReport(result.written[0]?.filepath ?? '')
          : undefined
      )) as
        | {
            overallCompliance?: { complianceScore?: number; euAiActCompliant?: boolean }
          }
        | null

      setAuditResult({
        reportId: result.reportId,
        fingerprint: result.fingerprint,
        decisionId: result.decisionId,
        complianceScore: loaded?.overallCompliance?.complianceScore ?? 0,
        euAiActCompliant: loaded?.overallCompliance?.euAiActCompliant ?? false,
        files: result.written,
      })
      message.success(
        `审计报告已导出：${result.written.length} 个文件，fingerprint=${result.fingerprint}`
      )
    } catch (err) {
      if (!isMountedRef.current) return
      const msg = err instanceof Error ? err.message : String(err)
      message.error(`审计导出失败: ${msg}`)
    } finally {
      if (isMountedRef.current) setAuditLoading(false)
    }
  }, [auditForm, buildAuditInput])

  /** 复制 fingerprint 到剪贴板 */
  const handleCopyFingerprint = useCallback((fp: string) => {
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(fp)
      message.success('指纹已复制')
    } else {
      message.warning('剪贴板不可用')
    }
  }, [])

  // ============================================================================
  // 派生
  // ============================================================================

  const providerIds = useMemo(
    () => (globalState ? Object.keys(globalState.providers) : []),
    [globalState]
  )

  // ============================================================================
  // 渲染
  // ============================================================================

  if (globalLoading) {
    return (
      <div className="calibration-panel calibration-panel-loading">
        <Spin tip="加载校准状态..." />
      </div>
    )
  }

  if (!isElectronAPIAvailable()) {
    return (
      <div className="calibration-panel calibration-panel-empty">
        <Empty
          description="IPC 不可用，校准面板仅在 Electron 环境中可用"
        />
      </div>
    )
  }

  if (providerIds.length === 0) {
    return (
      <div className="calibration-panel">
        <GlobalSummary state={globalState} />
        <div className="calibration-panel-empty">
          <Empty
            description={
              <div>
                <div>暂无已校准的 Provider</div>
                <div style={{ fontSize: 12, marginTop: 8, color: 'var(--color-text-tertiary)' }}>
                  当决策卡状态变为 <code>verified</code> 时会回灌 ground truth 样本，
                  <br />
                  积累 ≥ 10 条样本后可触发校准。
                </div>
              </div>
            }
          />
        </div>
      </div>
    )
  }

  return (
    <div className="calibration-panel">
      {/* 顶部：全局摘要 */}
      <GlobalSummary state={globalState} />

      {/* Provider 切换 */}
      <div className="calibration-panel-toolbar">
        <span className="calibration-panel-toolbar-label">Provider：</span>
        <Select
          value={selectedProvider ?? undefined}
          onChange={handleProviderChange}
          className="calibration-panel-toolbar-select"
          options={providerIds.map((id) => ({ value: id, label: id }))}
          placeholder="选择 Provider"
        />
        {selectedProvider && (
          <span className="calibration-panel-toolbar-hint">
            已选 {providerIds.indexOf(selectedProvider) + 1} / {providerIds.length}
          </span>
        )}
      </div>

      {/* 当前 Provider 详情 */}
      {selectedProvider && (
        <ProviderDetail
          providerId={selectedProvider}
          calibration={calibration}
          ece={ece}
          trace={trace}
          loading={loading}
          onCalibrate={handleCalibrate}
          onReset={handleReset}
          onAddTestSample={handleAddTestSample}
          onExportAudit={handleOpenExportAudit}
          tPreview={tPreview}
          onTPreviewChange={handleTPreviewChange}
          enableTestSample={enableTestSample}
        />
      )}

      {/* v0.9.6 P2：审计导出 Modal */}
      <Modal
        title={
          <span>
            <FileTextOutlined style={{ marginRight: 8 }} />
            导出 EU AI Act 合规审计报告
          </span>
        }
        open={auditModalOpen}
        onCancel={handleCloseExportAudit}
        width={720}
        destroyOnClose
        footer={null}
        maskClosable={!auditLoading}
      >
        {!auditResult ? (
          <Form
            form={auditForm}
            layout="vertical"
            onFinish={handleSubmitExportAudit}
            disabled={auditLoading}
          >
            <Form.Item
              name="decisionTitle"
              label="决策标题"
              rules={[{ required: true, message: '请输入决策标题' }]}
            >
              <Input placeholder="例如：Nginx 502 故障排查" />
            </Form.Item>
            <Form.Item
              name="decisionId"
              label="决策 ID"
              tooltip="审计报告文件名以 decisionId 命名；同一 ID 重复导出需要 force=true"
              rules={[
                { required: true, message: '请输入决策 ID' },
                { pattern: /^[A-Za-z0-9_.\-]+$/, message: '仅允许字母数字下划线' },
              ]}
            >
              <Input placeholder="calib-deepseek-1700000000000" />
            </Form.Item>
            <Form.Item
              name="intendedPurpose"
              label="预期用途（intended purpose，EU AI Act Art.13(3)(b)(i)）"
              rules={[{ required: true, message: '请输入预期用途' }]}
            >
              <Input.TextArea rows={2} placeholder="描述该决策的预期应用场景" />
            </Form.Item>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <Form.Item
                name="deployer"
                label="部署方"
                rules={[{ required: true, message: '请输入部署方' }]}
              >
                <Input placeholder="TDSF-Linux 运维团队" />
              </Form.Item>
              <Form.Item
                name="deployerContact"
                label="部署方联系（email）"
                rules={[{ required: true, type: 'email', message: '请输入合法邮箱' }]}
              >
                <Input placeholder="admin@tdsf.dev" />
              </Form.Item>
            </div>
            <Form.Item
              name="isHighRisk"
              label="是否高风险（EU AI Act Annex III）"
              valuePropName="checked"
            >
              <Switch checkedChildren="是" unCheckedChildren="否" />
            </Form.Item>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <Form.Item name="oversightMode" label="人工监督模式（Art.14）">
                <Radio.Group>
                  <Radio value="human-in-the-loop">In-the-loop</Radio>
                  <Radio value="human-on-the-loop">On-the-loop</Radio>
                  <Radio value="human-in-command">In-command</Radio>
                </Radio.Group>
              </Form.Item>
              <Form.Item name="approvalStatus" label="审批状态">
                <Radio.Group>
                  <Radio value="auto-approved">自动通过</Radio>
                  <Radio value="approved">人工通过</Radio>
                  <Radio value="pending">待审批</Radio>
                  <Radio value="rejected">驳回</Radio>
                </Radio.Group>
              </Form.Item>
            </div>
            <Form.Item name="approver" label="审批人（用户名）">
              <Input placeholder="engineer-zhang" />
            </Form.Item>
            <Form.Item name="actionDescription" label="决策动作描述" rules={[{ required: true }]}>
              <Input placeholder="导出校准数据合规审计快照" />
            </Form.Item>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16 }}>
              <Form.Item name="actionType" label="动作类型">
                <Select
                  options={[
                    { value: 'command', label: '命令执行' },
                    { value: 'config-change', label: '配置变更' },
                    { value: 'rollback', label: '回滚' },
                    { value: 'no-op', label: '无操作' },
                    { value: 'escalation', label: '升级' },
                  ]}
                />
              </Form.Item>
              <Form.Item name="command" label="关联命令（可选）">
                <Input placeholder="systemctl restart nginx" />
              </Form.Item>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <Form.Item name="outputFormat" label="输出格式（writeAllFormats=false 时生效）">
                <Radio.Group>
                  <Radio value="json">JSON</Radio>
                  <Radio value="markdown">Markdown</Radio>
                  <Radio value="html">HTML</Radio>
                </Radio.Group>
              </Form.Item>
              <Form.Item name="writeAllFormats" label="一次导出三种格式" valuePropName="checked">
                <Switch checkedChildren="全部" unCheckedChildren="单格式" />
              </Form.Item>
            </div>
            <Form.Item style={{ marginTop: 16, marginBottom: 0, textAlign: 'right' }}>
              <Button onClick={handleCloseExportAudit} style={{ marginRight: 8 }} disabled={auditLoading}>
                取消
              </Button>
              <Button type="primary" htmlType="submit" icon={<DownloadOutlined />} loading={auditLoading}>
                导出审计报告
              </Button>
            </Form.Item>
          </Form>
        ) : (
          <Result
            status={auditResult.euAiActCompliant ? 'success' : 'warning'}
            title={auditResult.euAiActCompliant ? 'EU AI Act 合规' : 'EU AI Act 部分合规'}
            subTitle={
              <div>
                <div style={{ marginBottom: 8 }}>
                  <strong>报告 ID：</strong>
                  <code style={{ fontSize: 11 }}>{auditResult.reportId}</code>
                </div>
                <div style={{ marginBottom: 8 }}>
                  <strong>SHA-256 指纹：</strong>
                  <Tag
                    color="blue"
                    style={{ cursor: 'pointer' }}
                    onClick={() => handleCopyFingerprint(auditResult.fingerprint)}
                  >
                    {auditResult.fingerprint}
                  </Tag>
                  <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                    （点击复制）
                  </span>
                </div>
                <div style={{ marginBottom: 8 }}>
                  <strong>合规评分：</strong>
                  <Tag color={auditResult.complianceScore >= 80 ? 'success' : auditResult.complianceScore >= 60 ? 'warning' : 'error'}>
                    {auditResult.complianceScore} / 100
                  </Tag>
                </div>
                <div style={{ marginBottom: 8 }}>
                  <strong>已写入文件（{auditResult.files.length} 个）：</strong>
                </div>
                <ul style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                  {auditResult.files.map((f) => (
                    <li key={f.filepath} style={{ marginBottom: 4 }}>
                      <Tag color="default">{f.format.toUpperCase()}</Tag>
                      <code style={{ fontSize: 10, wordBreak: 'break-all' }}>{f.filepath}</code>
                      <span style={{ marginLeft: 8, color: 'var(--color-text-tertiary)' }}>
                        ({f.bytes} bytes)
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            }
            extra={[
              <Button key="close" onClick={handleCloseExportAudit}>
                关闭
              </Button>,
              <Button
                key="again"
                type="primary"
                onClick={() => {
                  setAuditResult(null)
                }}
              >
                再次导出
              </Button>,
            ]}
          />
        )}
      </Modal>

      {/* 论文溯源 footer */}
      <div className="calibration-panel-footer">
        <div className="calibration-panel-footer-title">理论支撑</div>
        <ul className="calibration-panel-footer-list">
          <li>
            <strong>Guo et al. 2017</strong> (ICML, arXiv:1706.04599) —
            Temperature Scaling 单参数校准，ECE 分桶评估
          </li>
          <li>
            <strong>Kadavath et al. 2022</strong> (Anthropic, arXiv:2207.05221) —
            LLM 自我评估的 calibration 与规模正相关
          </li>
          <li>
            <strong>Shrivastava et al. 2023</strong> (Stanford, arXiv:2311.08877) —
            不同领域需要不同 T，按 Provider 分类校准
          </li>
        </ul>
      </div>
    </div>
  )
}

export default CalibrationPanel
