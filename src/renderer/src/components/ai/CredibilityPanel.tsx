/**
 * CredibilityPanel - 可信度 DAG 可视化面板
 *
 * 职责：
 * - 6 源证据输入面板：log / kb / ai-param / human / history / best-practice
 * - 评估按钮：调用 credibilityAssess + credibilityDag
 * - DAG 渲染：使用 React Flow 渲染主进程返回的 DagData
 *   - 节点类型：source（圆形）/ fusion（菱形）/ result（大圆）
 *   - 边：箭头 + 标签（冲突系数 k）
 *   - 自动布局：手写层次布局（source 左 / fusion 中 / result 右）
 * - 公式展示区：Dempster + PCR5（用文本 + sub/sup 实现）
 * - 冲突警告：conflictLevel > 0.3 显示警告 Tag
 * - 结果展示：belief / plausibility / confidence / uncertainty 四个数值卡片
 *
 * 暗系风格（深渊暗系）
 *
 * 方案书依据：v0.9 §可信度算法升级（D-S + PCR5 + 6 源证据融合）
 */
import { useState, useCallback, useMemo, useEffect } from 'react'
import { Button, Collapse, Tag, Slider, Switch, message, Tooltip, Empty } from 'antd'
import {
  ApartmentOutlined,
  PlayCircleOutlined,
  WarningOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import ReactFlow, {
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeTypes,
  Position,
  MarkerType,
} from 'reactflow'
import 'reactflow/dist/style.css'
import type {
  CredibilityEvidenceInput,
  CredibilitySourceId,
  ConfidenceAssessment,
  DagData,
  DagNodeData,
} from '@shared/agent-types'
import { isElectronAPIAvailable } from '../../utils/electron-api'
import './CredibilityPanel.css'

/**
 * React Flow 自定义节点的渲染数据类型
 *
 * 说明：DagNodeData.data 是 IPC 传输的附加数据（sourceId/confidence/...），
 * 但 React Flow 节点的 `data` prop 还需要 label 用于渲染显示。
 * 因此在 layoutDag 中将 label 合并到 data 字段中，渲染时通过此类型访问。
 */
type NodeRenderData = DagNodeData['data'] & { label?: string }

/** 6 源证据输入字段配置 */
interface SourceFieldConfig {
  key: string
  label: string
  type: 'number' | 'boolean'
  min?: number
  max?: number
  step?: number
  defaultValue: number | boolean
}

/** 单个证据源配置 */
interface SourceConfig {
  id: CredibilitySourceId
  label: string
  fields: SourceFieldConfig[]
}

/** 6 源证据字段配置（与方案书一致） */
const SOURCE_CONFIGS: SourceConfig[] = [
  {
    id: 'log',
    label: '日志证据',
    fields: [
      { key: 'drainMatch', label: 'Drain3 匹配度', type: 'number', min: 0, max: 1, step: 0.05, defaultValue: 0.6 },
      { key: 'sourcePrior', label: '来源先验', type: 'number', min: 0, max: 1, step: 0.05, defaultValue: 0.6 },
    ],
  },
  {
    id: 'kb',
    label: '知识库证据',
    fields: [
      { key: 'hasResults', label: '有匹配结果', type: 'boolean', defaultValue: true },
      { key: 'topScore', label: 'Top 分数', type: 'number', min: 0, max: 1, step: 0.05, defaultValue: 0.7 },
      { key: 'avgScore', label: '平均分数', type: 'number', min: 0, max: 1, step: 0.05, defaultValue: 0.55 },
    ],
  },
  {
    id: 'ai-param',
    label: 'AI 参数证据',
    fields: [
      { key: 'verbalizedConfidence', label: '自述置信度', type: 'number', min: 0, max: 1, step: 0.05, defaultValue: 0.7 },
      { key: 'logprobConfidence', label: 'Logprob 置信度', type: 'number', min: 0, max: 1, step: 0.05, defaultValue: 0.65 },
      { key: 'consistency', label: '一致性', type: 'number', min: 0, max: 1, step: 0.05, defaultValue: 0.8 },
    ],
  },
  {
    id: 'human',
    label: '人工证据',
    fields: [
      { key: 'hasAnnotations', label: '有标注', type: 'boolean', defaultValue: false },
      { key: 'positiveRate', label: '正向率', type: 'number', min: 0, max: 1, step: 0.05, defaultValue: 0.5 },
      { key: 'agreement', label: '一致度', type: 'number', min: 0, max: 1, step: 0.05, defaultValue: 0.7 },
    ],
  },
  {
    id: 'history',
    label: '历史证据',
    fields: [
      { key: 'hasCases', label: '有历史案例', type: 'boolean', defaultValue: true },
      { key: 'weightedSuccessRate', label: '加权成功率', type: 'number', min: 0, max: 1, step: 0.05, defaultValue: 0.75 },
    ],
  },
  {
    id: 'best-practice',
    label: '最佳实践证据',
    fields: [
      { key: 'hasMatches', label: '有规则匹配', type: 'boolean', defaultValue: true },
      { key: 'positiveRate', label: '正向率', type: 'number', min: 0, max: 1, step: 0.05, defaultValue: 0.7 },
      { key: 'negativeRate', label: '负向率', type: 'number', min: 0, max: 1, step: 0.05, defaultValue: 0.2 },
    ],
  },
]

/** Source 节点颜色（按 sourceId 区分） */
const SOURCE_COLORS: Record<CredibilitySourceId, string> = {
  log: '#3b82f6',
  kb: '#8b5cf6',
  'ai-param': '#ec4899',
  human: '#10b981',
  history: '#f59e0b',
  'best-practice': '#06b6d4',
}

/** 格式化百分比 */
function formatPercent(n: number | undefined): string {
  if (n === undefined || Number.isNaN(n)) return '--'
  return `${(n * 100).toFixed(1)}%`
}

/** ===== 自定义节点：source（圆形） ===== */
const SourceNode: React.FC<{ data: NodeRenderData }> = ({ data }) => {
  const color = data.sourceId ? SOURCE_COLORS[data.sourceId as CredibilitySourceId] ?? '#3b82f6' : '#3b82f6'
  return (
    <div
      className="cred-dag-node cred-dag-source-node"
      style={{ borderColor: color, color }}
      title={data.label}
    >
      <span className="cred-dag-source-label">{data.label}</span>
      {data.confidence !== undefined && (
        <span className="cred-dag-source-confidence">{formatPercent(data.confidence)}</span>
      )}
    </div>
  )
}

/** ===== 自定义节点：fusion（菱形） ===== */
const FusionNode: React.FC<{ data: NodeRenderData }> = ({ data }) => {
  return (
    <div className="cred-dag-node cred-dag-fusion-node" title={data.label}>
      <span className="cred-dag-fusion-rule">{data.ruleUsed ?? 'fusion'}</span>
      {data.conflict !== undefined && (
        <span className="cred-dag-fusion-conflict">k={data.conflict.toFixed(2)}</span>
      )}
    </div>
  )
}

/** ===== 自定义节点：result（大圆） ===== */
const ResultNode: React.FC<{ data: NodeRenderData }> = ({ data }) => {
  return (
    <div className="cred-dag-node cred-dag-result-node" title={data.label}>
      <span className="cred-dag-result-label">{data.label}</span>
      {data.belief !== undefined && (
        <span className="cred-dag-result-row">Bel {formatPercent(data.belief)}</span>
      )}
      {data.plausibility !== undefined && (
        <span className="cred-dag-result-row">Pl {formatPercent(data.plausibility)}</span>
      )}
      {data.finalConfidence !== undefined && (
        <span className="cred-dag-result-row cred-dag-result-confidence">
          {formatPercent(data.finalConfidence)}
        </span>
      )}
    </div>
  )
}

/** 节点类型映射 */
const nodeTypes: NodeTypes = {
  source: SourceNode,
  fusion: FusionNode,
  result: ResultNode,
}

/** 手写层次布局：source 左 / fusion 中 / result 右
 * @returns 节点位置 Map（id → { x, y }）
 */
function layoutDag(dag: DagData): { nodes: Node[]; edges: Edge[] } {
  const sources = dag.nodes.filter((n) => n.type === 'source')
  const fusions = dag.nodes.filter((n) => n.type === 'fusion')
  const results = dag.nodes.filter((n) => n.type === 'result')

  // 列 x 坐标
  const SOURCE_X = 0
  const FUSION_X = 240
  const RESULT_X = 480

  // source 垂直分布
  const sourceSpacing = 90
  const sourceStartY = -((sources.length - 1) * sourceSpacing) / 2

  const nodes: Node[] = []

  sources.forEach((n, idx) => {
    nodes.push({
      id: n.id,
      type: 'source',
      position: { x: SOURCE_X, y: sourceStartY + idx * sourceSpacing },
      data: { ...n.data, label: n.label },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    })
  })

  // fusion 垂直分布
  const fusionSpacing = 110
  const fusionStartY = -((fusions.length - 1) * fusionSpacing) / 2
  fusions.forEach((n, idx) => {
    nodes.push({
      id: n.id,
      type: 'fusion',
      position: { x: FUSION_X, y: fusionStartY + idx * fusionSpacing },
      data: { ...n.data, label: n.label },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    })
  })

  // result（居中）
  results.forEach((n, idx) => {
    nodes.push({
      id: n.id,
      type: 'result',
      position: { x: RESULT_X, y: idx * 160 - 80 },
      data: { ...n.data, label: n.label },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    })
  })

  // 边
  const edges: Edge[] = dag.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    type: 'smoothstep',
    markerEnd: { type: MarkerType.ArrowClosed },
    labelStyle: { fontSize: 10, fill: 'var(--color-text-tertiary)' },
    style: { stroke: 'var(--color-border-strong)', strokeWidth: 1.5 },
  }))

  return { nodes, edges }
}

/** CredibilityPanel Props */
export interface CredibilityPanelProps {
  /** 默认是否折叠 */
  defaultCollapsed?: boolean
  /** 初始证据输入（外部传入，如 ChatPanel 的决策上下文） */
  initialInputs?: CredibilityEvidenceInput[]
}

/** CredibilityPanel 组件 */
const CredibilityPanel: React.FC<CredibilityPanelProps> = ({
  defaultCollapsed = true,
  initialInputs,
}) => {
  /** 证据输入字段状态：sourceId → fieldKey → value */
  const [fieldValues, setFieldValues] = useState<Record<string, Record<string, number | boolean | number[]>>>(
    () => {
      const initial: Record<string, Record<string, number | boolean | number[]>> = {}
      for (const cfg of SOURCE_CONFIGS) {
        initial[cfg.id] = {}
        for (const f of cfg.fields) {
          initial[cfg.id][f.key] = f.defaultValue
        }
      }
      return initial
    }
  )

  /** 评估结果 */
  const [assessment, setAssessment] = useState<ConfidenceAssessment | null>(null)
  /** DAG 数据 */
  const [dagData, setDagData] = useState<DagData | null>(null)
  /** 评估中 */
  const [assessing, setAssessing] = useState(false)
  /** 错误信息 */
  const [error, setError] = useState<string | null>(null)
  /** Collapse 活动项 */
  const [activeKeys, setActiveKeys] = useState<string[]>(defaultCollapsed ? [] : ['cred-panel'])

  /** 接收外部 initialInputs */
  useEffect(() => {
    if (initialInputs && initialInputs.length > 0) {
      setFieldValues((prev) => {
        const next = { ...prev }
        for (const input of initialInputs) {
          if (!next[input.sourceId]) next[input.sourceId] = {}
          next[input.sourceId] = { ...next[input.sourceId], ...input.fields }
        }
        return next
      })
    }
  }, [initialInputs])

  /** 构造 CredibilityEvidenceInput[] */
  const buildInputs = useCallback((): CredibilityEvidenceInput[] => {
    return SOURCE_CONFIGS.map((cfg) => ({
      sourceId: cfg.id,
      fields: fieldValues[cfg.id] ?? {},
    }))
  }, [fieldValues])

  /** 评估 */
  const handleAssess = useCallback(async () => {
    if (!isElectronAPIAvailable()) {
      setError('electronAPI 不可用')
      return
    }
    setAssessing(true)
    setError(null)
    try {
      const inputs = buildInputs()
      const [a, dag] = await Promise.all([
        window.electronAPI.credibilityAssess(inputs),
        window.electronAPI.credibilityDag(inputs),
      ])
      setAssessment(a)
      setDagData(dag)
      message.success('评估完成')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`评估失败: ${msg}`)
    } finally {
      setAssessing(false)
    }
  }, [buildInputs])

  /** 重置为默认值 */
  const handleReset = useCallback(() => {
    const initial: Record<string, Record<string, number | boolean>> = {}
    for (const cfg of SOURCE_CONFIGS) {
      initial[cfg.id] = {}
      for (const f of cfg.fields) {
        initial[cfg.id][f.key] = f.defaultValue
      }
    }
    setFieldValues(initial)
    setAssessment(null)
    setDagData(null)
    setError(null)
  }, [])

  /** React Flow 节点和边（layout 后） */
  const flowNodes = useMemo(() => {
    if (!dagData) return []
    return layoutDag(dagData).nodes
  }, [dagData])

  const flowEdges = useMemo(() => {
    if (!dagData) return []
    return layoutDag(dagData).edges
  }, [dagData])

  /** 冲突告警 */
  const conflictWarning = useMemo(() => {
    if (!assessment) return null
    if (assessment.conflictLevel > 0.3) {
      return `冲突系数 k=${assessment.conflictLevel.toFixed(3)}，已超 0.3 阈值，结果可信度受限`
    }
    return null
  }, [assessment])

  return (
    <div className="credibility-panel">
      <Collapse
        activeKey={activeKeys}
        onChange={(keys) => setActiveKeys(keys as string[])}
        className="credibility-collapse"
        items={[
          {
            key: 'cred-panel',
            label: (
              <div className="credibility-header">
                <ApartmentOutlined className="credibility-header-icon" />
                <span className="credibility-header-title">可信度评估</span>
                {assessment && (
                  <span className="credibility-header-summary">
                    可信度 <strong>{formatPercent(assessment.confidence)}</strong>
                  </span>
                )}
                {conflictWarning && (
                  <Tag color="warning" className="credibility-conflict-tag">
                    <WarningOutlined /> 冲突 {assessment?.conflictLevel.toFixed(2)}
                  </Tag>
                )}
              </div>
            ),
            children: (
              <div className="credibility-body">
                {error && <div className="credibility-error">{error}</div>}

                {/* ===== 6 源证据输入面板 ===== */}
                <div className="credibility-sources">
                  <div className="credibility-section-title">6 源证据输入</div>
                  <div className="credibility-sources-grid">
                    {SOURCE_CONFIGS.map((cfg) => (
                      <div key={cfg.id} className="credibility-source-card">
                        <div className="credibility-source-card-header">
                          <span
                            className="credibility-source-dot"
                            style={{ background: SOURCE_COLORS[cfg.id] }}
                          />
                          <span className="credibility-source-card-title">{cfg.label}</span>
                          <span className="credibility-source-card-id">{cfg.id}</span>
                        </div>
                        <div className="credibility-source-fields">
                          {cfg.fields.map((f) => (
                            <div key={f.key} className="credibility-field">
                              <div className="credibility-field-label">
                                <span>{f.label}</span>
                                {f.type === 'number' && (
                                  <span className="credibility-field-value">
                                    {Number(fieldValues[cfg.id]?.[f.key] ?? 0).toFixed(2)}
                                  </span>
                                )}
                              </div>
                              {f.type === 'number' ? (
                                <Slider
                                  min={f.min}
                                  max={f.max}
                                  step={f.step}
                                  value={fieldValues[cfg.id]?.[f.key] as number}
                                  onChange={(v) =>
                                    setFieldValues((prev) => ({
                                      ...prev,
                                      [cfg.id]: { ...prev[cfg.id], [f.key]: v },
                                    }))
                                  }
                                  className="credibility-slider"
                                />
                              ) : (
                                <Switch
                                  size="small"
                                  checked={fieldValues[cfg.id]?.[f.key] as boolean}
                                  onChange={(v) =>
                                    setFieldValues((prev) => ({
                                      ...prev,
                                      [cfg.id]: { ...prev[cfg.id], [f.key]: v },
                                    }))
                                  }
                                />
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* ===== 评估按钮 ===== */}
                <div className="credibility-actions">
                  <Button
                    type="primary"
                    icon={<PlayCircleOutlined />}
                    onClick={handleAssess}
                    loading={assessing}
                    size="small"
                  >
                    评估可信度
                  </Button>
                  <Tooltip title="重置为默认值">
                    <Button
                      type="text"
                      size="small"
                      icon={<ReloadOutlined />}
                      onClick={handleReset}
                      aria-label="重置证据输入"
                    />
                  </Tooltip>
                </div>

                {/* ===== 冲突警告 ===== */}
                {conflictWarning && (
                  <div className="credibility-warning">
                    <WarningOutlined /> {conflictWarning}
                  </div>
                )}

                {/* ===== 结果展示：4 个数值卡片 ===== */}
                {assessment && (
                  <div className="credibility-results">
                    <div className="credibility-result-card">
                      <span className="credibility-result-label">Belief</span>
                      <span className="credibility-result-value">
                        {formatPercent(assessment.belief)}
                      </span>
                    </div>
                    <div className="credibility-result-card">
                      <span className="credibility-result-label">Plausibility</span>
                      <span className="credibility-result-value">
                        {formatPercent(assessment.plausibility)}
                      </span>
                    </div>
                    <div className="credibility-result-card credibility-result-highlight">
                      <span className="credibility-result-label">Confidence</span>
                      <span className="credibility-result-value">
                        {formatPercent(assessment.confidence)}
                      </span>
                    </div>
                    <div className="credibility-result-card">
                      <span className="credibility-result-label">Uncertainty</span>
                      <span className="credibility-result-value">
                        {formatPercent(assessment.uncertainty)}
                      </span>
                    </div>
                  </div>
                )}

                {/* ===== DAG 可视化 ===== */}
                <div className="credibility-dag">
                  <div className="credibility-section-title">融合 DAG</div>
                  {!dagData && (
                    <div className="credibility-dag-empty">
                      <Empty
                        description="点击评估后展示 DAG"
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                      />
                    </div>
                  )}
                  {dagData && (
                    <div className="credibility-dag-flow">
                      <ReactFlow
                        nodes={flowNodes}
                        edges={flowEdges}
                        nodeTypes={nodeTypes}
                        fitView
                        attributionPosition="bottom-right"
                        proOptions={{ hideAttribution: true }}
                        nodesDraggable
                        panOnScroll
                        zoomOnScroll={false}
                      >
                        <Background color="var(--color-border)" gap={16} size={1} />
                        <Controls showInteractive={false} />
                      </ReactFlow>
                    </div>
                  )}
                </div>

                {/* ===== 公式展示区 ===== */}
                <div className="credibility-formulas">
                  <div className="credibility-section-title">融合规则公式</div>
                  <div className="credibility-formula">
                    <div className="credibility-formula-name">Dempster 规则</div>
                    <div className="credibility-formula-expr">
                      m<sub>1⊕2</sub>(A) = Σ<sub>B∩C=A</sub> m<sub>1</sub>(B)·m<sub>2</sub>(C) / (1−K)
                    </div>
                  </div>
                  <div className="credibility-formula">
                    <div className="credibility-formula-name">PCR5 规则</div>
                    <div className="credibility-formula-expr">
                      m<sub>PCR5</sub>(X) = m<sub>Conj</sub>(X) + Σ<sub>Y∩X=∅</sub>{' '}
                      [m<sub>1</sub>(X)<sup>2</sup>·m<sub>2</sub>(Y)/(m<sub>1</sub>(X)+m<sub>2</sub>(Y)) +{' '}
                      m<sub>2</sub>(X)<sup>2</sup>·m<sub>1</sub>(Y)/(m<sub>2</sub>(X)+m<sub>1</sub>(Y))]
                    </div>
                  </div>
                </div>
              </div>
            ),
          },
        ]}
      />
    </div>
  )
}

export default CredibilityPanel
