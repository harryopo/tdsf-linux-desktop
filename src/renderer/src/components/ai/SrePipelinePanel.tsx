/**
 * SRE Pipeline 面板（v1.5 LLM 增强版）
 *
 * 端到端 SRE 诊断：日志输入 → Drain3 解析 → OpenDerisk 诊断 → 可视化展示
 *
 * v1.5 升级：
 * - 可选启用 LLM 增强诊断（基于用户 LLM 配置 + 规则匹配融合）
 * - 显示 source 详情（rule-based / llm-enhanced / rule-based-llm-failed）
 * - 显示 related_risks（LLM 增强时填充）
 * - 显示 rule_confidence / llm_confidence（融合时记录）
 *
 * 使用场景：
 * - 学生在学习日志分析时，粘贴异常日志 → 1 次调用拿到根因 + 置信度 + 建议
 * - 运维人员排查服务故障 → 快速获取结构化诊断（替代人工 grep + 经验判断）
 *
 * 设计原则：
 * - 最小可用版本：3 个步骤 UI（输入 → 加载中 → 结果）
 * - Ant Design 组件 + 项目 token（不引入新依赖）
 * - 结果展示按 5 区：根因 / 置信度 / 建议 / 关联风险 / Top 模板 / 推理链
 */

import { useState, useCallback } from 'react'
import {
  Modal,
  Input,
  Button,
  Space,
  Tag,
  Alert,
  Spin,
  Tooltip,
  message,
  Typography,
  Collapse,
  Switch,
} from 'antd'
import {
  ExperimentOutlined,
  ThunderboltOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  CloseCircleOutlined,
  RocketOutlined,
  RobotOutlined,
  BulbOutlined,
} from '@ant-design/icons'
import { useSettingsStore } from '../../stores/settings-store'
import './SrePipelinePanel.css'

const { TextArea } = Input
const { Text, Paragraph } = Typography

/** 严重度颜色映射 */
const SEVERITY_COLOR: Record<string, string> = {
  critical: 'red',
  high: 'volcano',
  medium: 'orange',
  low: 'blue',
}

/** 严重度图标 */
const SEVERITY_ICON: Record<string, React.ReactNode> = {
  critical: <CloseCircleOutlined />,
  high: <WarningOutlined />,
  medium: <WarningOutlined />,
  low: <CheckCircleOutlined />,
}

/** 诊断来源标签映射（v1.5 新增） */
const SOURCE_TAG: Record<
  string,
  { color: string; icon: React.ReactNode; label: string }
> = {
  'open-derisk-llm-enhanced': {
    color: 'purple',
    icon: <RobotOutlined />,
    label: 'LLM 增强',
  },
  'rule-based': {
    color: 'blue',
    icon: <ExperimentOutlined />,
    label: '纯规则',
  },
  'rule-based-llm-failed': {
    color: 'orange',
    icon: <WarningOutlined />,
    label: '规则（LLM 降级）',
  },
  'rule-fallback': {
    color: 'default',
    icon: <WarningOutlined />,
    label: '无匹配',
  },
}

/** 默认示例日志（让用户快速体验） */
const SAMPLE_LOGS = `2026-07-20 10:23:45 ERROR Connection timeout to db-master:5432 after 30000ms
2026-07-20 10:23:46 ERROR Connection timeout to db-master:5432 after 30000ms
2026-07-20 10:23:47 WARN  Connection pool exhausted, 0/20 available
2026-07-20 10:23:48 ERROR Failed to execute query: deadlock detected
2026-07-20 10:23:50 ERROR OutOfMemoryError: Java heap space
2026-07-20 10:23:51 FATAL Application shutting down due to OOM`

interface PipelineResult {
  parse: {
    templates: Array<{
      template_id: string
      template: string
      count: number
      examples: string[]
    }>
    total_lines: number
    unique_templates: number
  }
  diagnose: {
    root_cause: string
    confidence: number
    severity: string
    recommendations: string[]
    reasoning: string[]
    source: string
    // v1.5 新增字段（与 main/sidecar-manager.ts 的 PipelineResponse.diagnose 对齐）
    related_risks?: string[]
    rule_confidence?: number | null
    llm_confidence?: number | null
  }
}

interface SrePipelinePanelProps {
  open: boolean
  onClose: () => void
}

const SrePipelinePanel: React.FC<SrePipelinePanelProps> = ({ open, onClose }) => {
  const [logText, setLogText] = useState('')
  const [serviceName, setServiceName] = useState('unknown')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<PipelineResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sidecarStatus, setSidecarStatus] = useState<string>('unknown')
  // v1.5 新增：LLM 增强开关（默认从 settings 读）
  const llmConfig = useSettingsStore((s) => s.llmConfig)
  const [llmEnabled, setLlmEnabled] = useState(false)

  /** LLM 是否可用（API Key 存在） */
  const llmAvailable = !!(llmConfig.apiKey && llmConfig.baseUrl && llmConfig.model)

  /** 加载 Sidecar 状态 */
  const refreshSidecarStatus = useCallback(async () => {
    try {
      const status = await window.electronAPI.sidecarStatus()
      setSidecarStatus(status.status)
    } catch (e) {
      setSidecarStatus('error')
    }
  }, [])

  /** 启动 Sidecar */
  const ensureSidecarReady = useCallback(async (): Promise<boolean> => {
    if (!window.electronAPI) {
      setError('Electron API 不可用（非 Electron 环境？）')
      return false
    }
    try {
      const status = await window.electronAPI.sidecarStatus()
      if (status.status === 'ready') return true

      setSidecarStatus('starting')
      const start = await window.electronAPI.sidecarStart()
      if (!start.ok) {
        setError(`Sidecar 启动失败：${start.error || '未知错误'}`)
        setSidecarStatus('crashed')
        return false
      }
      setSidecarStatus('ready')
      return true
    } catch (e) {
      setError(`Sidecar 调用失败：${e instanceof Error ? e.message : String(e)}`)
      return false
    }
  }, [])

  /** 运行 Pipeline */
  const handleRun = useCallback(async () => {
    if (!logText.trim()) {
      message.warning('请先粘贴或输入日志内容')
      return
    }

    setError(null)
    setResult(null)
    setLoading(true)

    try {
      // 1. 确保 Sidecar 就绪
      const ready = await ensureSidecarReady()
      if (!ready) {
        setLoading(false)
        return
      }

      // 2. 切分日志（按行）
      const lines = logText
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)

      if (lines.length === 0) {
        setError('日志内容为空')
        setLoading(false)
        return
      }

      // 3. 调用端到端 Pipeline
      // v1.5：若 LLM 增强开关开启且 API Key 可用，则透传 LLM config
      let resp
      if (llmEnabled && llmAvailable) {
        resp = await window.electronAPI.sidecarPipeline(lines, serviceName, {
          apiKey: llmConfig.apiKey,
          baseUrl: llmConfig.baseUrl,
          model: llmConfig.model,
        })
      } else {
        resp = await window.electronAPI.sidecarPipeline(lines, serviceName)
      }

      if (!resp.ok) {
        setError(resp.error)
        setLoading(false)
        return
      }

      setResult(resp.data)
      message.success(`诊断完成：${resp.data.diagnose.root_cause}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [logText, serviceName, ensureSidecarReady, llmEnabled, llmAvailable, llmConfig])

  /** 加载示例日志 */
  const loadSample = useCallback(() => {
    setLogText(SAMPLE_LOGS)
    setServiceName('order-service')
  }, [])

  /** 重置 */
  const handleReset = useCallback(() => {
    setLogText('')
    setResult(null)
    setError(null)
    setServiceName('unknown')
  }, [])

  /** 关闭时重置 */
  const handleClose = useCallback(() => {
    handleReset()
    onClose()
  }, [handleReset, onClose])

  return (
    <Modal
      title={
        <Space>
          <ExperimentOutlined style={{ color: 'var(--color-primary, #4f46e5)' }} />
          <span>SRE 智能诊断（Sidecar-A Pipeline）</span>
          <Tag
            color={sidecarStatus === 'ready' ? 'green' : sidecarStatus === 'starting' ? 'blue' : 'default'}
            onClick={refreshSidecarStatus}
            style={{ cursor: 'pointer' }}
          >
            Sidecar: {sidecarStatus}
          </Tag>
        </Space>
      }
      open={open}
      onCancel={handleClose}
      width={900}
      footer={null}
      destroyOnClose
    >
      <Spin spinning={loading} tip="Drain3 解析中 → OpenDerisk 诊断...">
        {!result && !error && (
          <div className="sre-pipeline__input-area">
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <div>
                <Text strong>服务名（可选）</Text>
                <Input
                  value={serviceName}
                  onChange={(e) => setServiceName(e.target.value)}
                  placeholder="如 order-service / nginx / mysql"
                  style={{ marginTop: 4 }}
                  allowClear
                />
              </div>

              <div>
                <Space style={{ marginBottom: 4 }}>
                  <Text strong>日志内容（每行一条）</Text>
                  <Button size="small" type="link" onClick={loadSample} icon={<ThunderboltOutlined />}>
                    加载示例日志
                  </Button>
                </Space>
                <TextArea
                  value={logText}
                  onChange={(e) => setLogText(e.target.value)}
                  placeholder="粘贴服务异常日志，例如：&#10;2026-07-20 ERROR Connection timeout to db:5432&#10;2026-07-20 ERROR Connection timeout to db:5432&#10;2026-07-20 FATAL OutOfMemoryError"
                  autoSize={{ minRows: 8, maxRows: 16 }}
                  style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}
                />
                <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
                  已输入 {logText.split('\n').filter((l) => l.trim()).length} 行
                </Text>
              </div>

              {/* v1.5 新增：LLM 增强开关 */}
              <div className="sre-pipeline__llm-toggle">
                <Space>
                  <Switch
                    checked={llmEnabled}
                    onChange={setLlmEnabled}
                    disabled={!llmAvailable}
                    checkedChildren={<><RobotOutlined /> LLM 增强</>}
                    unCheckedChildren="纯规则"
                  />
                  {!llmAvailable ? (
                    <Tooltip title="请先在设置页配置 LLM API Key、Base URL 和 Model">
                      <Tag color="warning" icon={<WarningOutlined />}>未配置 LLM</Tag>
                    </Tooltip>
                  ) : (
                    <Tag color="purple" icon={<RobotOutlined />}>
                      {llmConfig.model || '未指定模型'}
                    </Tag>
                  )}
                  {llmEnabled && llmAvailable && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      LLM 增强：基于 {llmConfig.model} 深度推理（10s 超时）
                    </Text>
                  )}
                </Space>
              </div>

              <Space>
                <Button
                  type="primary"
                  icon={<RocketOutlined />}
                  onClick={handleRun}
                  loading={loading}
                  disabled={!logText.trim()}
                >
                  运行端到端诊断
                </Button>
                <Button onClick={handleReset}>清空</Button>
              </Space>
            </Space>
          </div>
        )}

        {error && (
          <Alert
            type="error"
            message="诊断失败"
            description={error}
            showIcon
            closable
            onClose={() => setError(null)}
            action={
              <Button size="small" onClick={() => setError(null)}>
                重试
              </Button>
            }
          />
        )}

        {result && (
          <div className="sre-pipeline__result-area">
            {/* 1. 根因诊断卡片 */}
            <div className="sre-pipeline__card sre-pipeline__card--primary">
              <div className="sre-pipeline__card-header">
                <Tag
                  color={SEVERITY_COLOR[result.diagnose.severity] || 'default'}
                  icon={SEVERITY_ICON[result.diagnose.severity]}
                  style={{ fontSize: 13, padding: '2px 10px' }}
                >
                  {result.diagnose.severity.toUpperCase()}
                </Tag>
                <Tag color="purple">置信度 {(result.diagnose.confidence * 100).toFixed(0)}%</Tag>
                {/* v1.5 新增：诊断来源详细标签 */}
                <Tag
                  color={SOURCE_TAG[result.diagnose.source]?.color || 'default'}
                  icon={SOURCE_TAG[result.diagnose.source]?.icon}
                >
                  {SOURCE_TAG[result.diagnose.source]?.label || result.diagnose.source}
                </Tag>
                {/* v1.5 新增：规则/LLM 置信度对比（仅 LLM 增强时显示） */}
                {result.diagnose.llm_confidence != null && result.diagnose.rule_confidence != null && (
                  <Tooltip
                    title={
                      <div>
                        <div>规则置信度：{(result.diagnose.rule_confidence * 100).toFixed(0)}%</div>
                        <div>LLM 置信度：{(result.diagnose.llm_confidence * 100).toFixed(0)}%</div>
                        <div>融合策略：算术平均</div>
                      </div>
                    }
                  >
                    <Tag color="cyan" style={{ cursor: 'help' }}>
                      规则 {(result.diagnose.rule_confidence * 100).toFixed(0)}% + LLM {(result.diagnose.llm_confidence * 100).toFixed(0)}%
                    </Tag>
                  </Tooltip>
                )}
              </div>
              <div className="sre-pipeline__root-cause">
                <Text type="secondary" style={{ fontSize: 12 }}>根因诊断</Text>
                <Paragraph style={{ fontSize: 18, fontWeight: 600, marginTop: 4, marginBottom: 0 }}>
                  {result.diagnose.root_cause}
                </Paragraph>
              </div>
            </div>

            {/* 2. 建议措施 */}
            {result.diagnose.recommendations.length > 0 && (
              <div className="sre-pipeline__card">
                <Text strong>💡 建议措施</Text>
                <ul style={{ marginTop: 8, paddingLeft: 20 }}>
                  {result.diagnose.recommendations.map((r, i) => (
                    <li key={i} style={{ marginBottom: 4 }}>{r}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* v1.5 新增：关联风险（仅 LLM 增强时显示） */}
            {result.diagnose.related_risks && result.diagnose.related_risks.length > 0 && (
              <div className="sre-pipeline__card">
                <Space>
                  <BulbOutlined style={{ color: 'var(--color-warning, #faad14)' }} />
                  <Text strong>关联风险（LLM 推理）</Text>
                </Space>
                <ul style={{ marginTop: 8, paddingLeft: 20 }}>
                  {result.diagnose.related_risks.map((r, i) => (
                    <li key={i} style={{ marginBottom: 4 }}>{r}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* 3. Top 模板（Drain3 输出） */}
            <div className="sre-pipeline__card">
              <Space style={{ marginBottom: 8 }}>
                <Text strong>🔍 Top 日志模板（Drain3）</Text>
                <Tag>{result.parse.total_lines} 行 → {result.parse.unique_templates} 个模板</Tag>
              </Space>
              <Collapse
                size="small"
                items={result.parse.templates.slice(0, 5).map((t, i) => ({
                  key: String(i),
                  label: (
                    <Space>
                      <Tag color="blue">#{i + 1}</Tag>
                      <Text code style={{ fontSize: 12 }}>{t.template}</Text>
                      <Tag color="default">×{t.count}</Tag>
                    </Space>
                  ),
                  children: (
                    <div style={{ fontSize: 12 }}>
                      <Text type="secondary">样例：</Text>
                      <ul style={{ marginTop: 4 }}>
                        {t.examples.map((ex, j) => (
                          <li key={j} style={{ fontFamily: 'JetBrains Mono, monospace' }}>{ex}</li>
                        ))}
                      </ul>
                    </div>
                  ),
                }))}
              />
            </div>

            {/* 4. 推理链 */}
            {result.diagnose.reasoning.length > 0 && (
              <div className="sre-pipeline__card">
                <Text strong>🧠 推理链</Text>
                <ol style={{ marginTop: 8, paddingLeft: 20, fontSize: 13 }}>
                  {result.diagnose.reasoning.map((r, i) => (
                    <li key={i} style={{ marginBottom: 4 }}>{r}</li>
                  ))}
                </ol>
              </div>
            )}

            <Space style={{ marginTop: 16 }}>
              <Button onClick={handleReset} type="primary" ghost>
                诊断新日志
              </Button>
              <Button onClick={handleClose}>关闭</Button>
            </Space>
          </div>
        )}
      </Spin>
    </Modal>
  )
}

export default SrePipelinePanel
