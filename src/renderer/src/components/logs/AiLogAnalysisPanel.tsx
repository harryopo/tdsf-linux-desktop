/**
 * AiLogAnalysisPanel — AI 日志分析 Drawer（LogsPage 子组件）
 *
 * 调用 sidecar:pipeline IPC 执行 Drain3 模板聚类 + OpenDerisk 根因诊断。
 * 参考实现：src/renderer/src/components/ai/SrePipelinePanel.tsx L218
 *
 * 数据流：
 *   父组件 LogsPage 传入过滤后的 IpcLogEntry[] → 本组件提取 message 行 →
 *   window.electronAPI.sidecarPipeline(logLines) → 返回 { ok, data?, error? } →
 *   渲染：摘要 / 模板聚类 / 根因 / 推理链 / 处置建议 / 关联风险
 *
 * 降级策略：
 *   - electronAPI 不可用 → Drawer 内提示 "主进程 IPC 不可用"
 *   - sidecar 进程未启动或调用失败 → 显示错误 + 重试按钮，不崩溃
 *   - 日志数量 < 5 → 提示 "日志数量不足，至少需要 5 条"
 *
 * 样式：颜色全部 var(--trae-*) token；不引入新依赖。
 */
import { useState } from 'react'
import { Button, Drawer, Spin, Alert, Typography, Tag, Tooltip } from 'antd'
import { RobotOutlined } from '@ant-design/icons'
import type { LogEntry } from './v1/logs-data'

const { Text, Paragraph, Title } = Typography

interface AiLogAnalysisPanelProps {
  open: boolean
  logs: LogEntry[]
  onClose: () => void
}

/**
 * Sidecar pipeline 返回结构（与 src/renderer/src/types/electron.d.ts L1769 对齐）。
 *
 * 注意：IPC 返回 `{ ok: true, data: PipelineResult } | { ok: false, error: string }`，
 *       这里仅描述成功分支的 data 结构。
 */
interface PipelineResult {
  /** Drain3 解析结果 */
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
  /** OpenDerisk 诊断结果 */
  diagnose: {
    root_cause: string
    confidence: number
    severity: 'critical' | 'high' | 'medium' | 'low'
    recommendations: string[]
    reasoning: string[]
    source: string
    /** v1.5 新增字段 */
    related_risks?: string[]
    rule_confidence?: number | null
    llm_confidence?: number | null
  }
}

/** 严重度 → Antd Tag 颜色映射（与 SrePipelinePanel SEVERITY_COLOR 对齐） */
const SEVERITY_TAG_COLOR: Record<PipelineResult['diagnose']['severity'], string> = {
  critical: 'red',
  high: 'volcano',
  medium: 'orange',
  low: 'blue',
}

/** 诊断来源 → 标签文案（与 SrePipelinePanel SOURCE_TAG 对齐，简化版） */
function describeSource(source: string): string {
  switch (source) {
    case 'open-derisk-llm-enhanced':
      return 'LLM 增强'
    case 'rule-based':
      return '纯规则'
    case 'rule-based-llm-failed':
      return '规则（LLM 降级）'
    case 'rule-fallback':
      return '无匹配规则'
    default:
      return source
  }
}

/** 置信度百分比文案（0-1 → 0-100%） */
function describeConfidence(confidence: number): string {
  const pct = Math.round(confidence * 100)
  return `${pct}%`
}

/**
 * AI 日志分析面板
 *
 * 调用 sidecar:pipeline IPC 执行 Drain3 模板聚类 + AI 根因分析。
 * 参考实现：src/renderer/src/components/ai/SrePipelinePanel.tsx L218
 */
export function AiLogAnalysisPanel({ open, logs, onClose }: AiLogAnalysisPanelProps) {
  const [analyzing, setAnalyzing] = useState(false)
  const [result, setResult] = useState<PipelineResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** v2.6：引擎启动阶段提示（sidecar 懒启动首次需 5-10 秒） */
  const [phase, setPhase] = useState<'idle' | 'starting' | 'analyzing'>('idle')

  /** electronAPI 是否可用（非 Electron 环境降级） */
  const electronApiAvailable =
    typeof window !== 'undefined' && !!window.electronAPI?.sidecarPipeline

  /**
   * 把 sidecar 底层错误转成用户可操作的文案（v2.6）
   *
   * - spawn ENOENT / 启动失败：Python 环境缺失 → 给出搭建指引
   * - 启动超时：依赖未安装/端口冲突
   */
  const friendlyError = (raw: string): string => {
    if (/ENOENT|启动失败|启动超时|crashed|未就绪/i.test(raw)) {
      return (
        `${raw}\n\nAI 日志分析依赖本地 Python 分析引擎（Sidecar-A）。请确认：\n` +
        `1. 项目根目录存在 .venv-sidecar-a 虚拟环境（python -m venv .venv-sidecar-a）\n` +
        `2. 已安装依赖：.venv-sidecar-a 环境下 pip install -r sidecar-a/requirements.txt\n` +
        `3. 端口 19000 未被占用`
      )
    }
    return raw
  }

  /** 执行 AI 分析 */
  const handleAnalyze = async () => {
    if (logs.length < 5) {
      setError('日志数量不足，至少需要 5 条日志才能进行 AI 分析')
      return
    }
    if (!electronApiAvailable) {
      setError('主进程 IPC 不可用（非 Electron 环境）')
      return
    }
    setAnalyzing(true)
    setError(null)
    setResult(null)
    try {
      // v2.6：先查引擎状态 —— 非 ready 时展示“启动中”提示（主进程 pipeline 已带懒启动）
      try {
        const st = await window.electronAPI.sidecarStatus?.()
        setPhase(st && st.status !== 'ready' ? 'starting' : 'analyzing')
      } catch {
        setPhase('analyzing')
      }
      // 将 IpcLogEntry[] 转换为纯文本日志行（与服务名一道传递，便于 sidecar 上下文诊断）
      const logLines = logs.map((l) => l.message)
      const resp = await window.electronAPI.sidecarPipeline(logLines)
      if (!resp.ok) {
        setError(friendlyError(resp.error || 'AI 日志分析失败（sidecar 可能未启动）'))
        return
      }
      setResult(resp.data)
    } catch (err) {
      setError(friendlyError(err instanceof Error ? err.message : 'AI 日志分析失败（sidecar 可能未启动）'))
    } finally {
      setAnalyzing(false)
      setPhase('idle')
    }
  }

  /** 关闭 Drawer 时清理状态 */
  const handleClose = () => {
    setResult(null)
    setError(null)
    onClose()
  }

  /** 渲染右上角操作区（开始分析 / 重试按钮） */
  const renderExtra = () => (
    <Tooltip
      title={
        !electronApiAvailable
          ? '主进程 IPC 不可用，无法执行 AI 分析'
          : logs.length < 5
            ? '日志数量不足，至少需要 5 条'
            : ''
      }
    >
      <Button
        type="primary"
        size="small"
        icon={<RobotOutlined />}
        loading={analyzing}
        onClick={handleAnalyze}
        disabled={!electronApiAvailable || logs.length < 5}
      >
        {analyzing ? '分析中...' : error ? '重新分析' : '开始分析'}
      </Button>
    </Tooltip>
  )

  return (
    <Drawer
      title="AI 日志分析"
      open={open}
      onClose={handleClose}
      width={520}
      extra={renderExtra()}
      destroyOnClose
    >
      {/* 日志数量不足提示 */}
      {logs.length < 5 && (
        <Alert
          type="info"
          showIcon
          message={`当前日志 ${logs.length} 条，至少需要 5 条才能进行 AI 分析`}
          style={{ marginBottom: 12 }}
        />
      )}

      {/* IPC 不可用提示 */}
      {!electronApiAvailable && (
        <Alert
          type="warning"
          showIcon
          message="主进程 IPC 不可用"
          description="当前不在 Electron 环境，无法调用 sidecar:pipeline。请在桌面端运行。"
          style={{ marginBottom: 12 }}
        />
      )}

      {/* 错误提示 + 重试按钮 */}
      {error && (
        <Alert
          type="error"
          showIcon
          message="分析失败"
          description={<span style={{ whiteSpace: 'pre-wrap' }}>{error}</span>}
          style={{ marginBottom: 12 }}
          action={
            <Button size="small" onClick={handleAnalyze} loading={analyzing}>
              重试
            </Button>
          }
        />
      )}

      {/* 分析中加载态（v2.6：区分引擎启动/分析两阶段） */}
      {analyzing && (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <Spin
            tip={
              phase === 'starting'
                ? '正在启动 AI 分析引擎（首次约 5-10 秒），随后自动分析...'
                : '正在执行 Drain3 模板聚类 + AI 根因分析...'
            }
          />
        </div>
      )}

      {/* 分析结果渲染 */}
      {result && !analyzing && (
        <div>
          {/* 摘要：总日志数 + 唯一模板数 + 严重度 + 置信度 + 来源 */}
          <div style={{ marginBottom: 16 }}>
            <Title level={5}>分析摘要</Title>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
              <Tag>日志总数 {result.parse.total_lines}</Tag>
              <Tag>唯一模板 {result.parse.unique_templates}</Tag>
              <Tag color={SEVERITY_TAG_COLOR[result.diagnose.severity]}>
                严重度 {result.diagnose.severity}
              </Tag>
              <Tag color="blue">置信度 {describeConfidence(result.diagnose.confidence)}</Tag>
              <Tag>{describeSource(result.diagnose.source)}</Tag>
            </div>
            <Paragraph>{result.diagnose.root_cause}</Paragraph>
          </div>

          {/* 异常模板聚类 */}
          {result.parse.templates.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <Title level={5}>异常模板聚类（{result.parse.templates.length}）</Title>
              {result.parse.templates.map((t) => (
                <div
                  key={t.template_id}
                  style={{
                    marginBottom: 8,
                    padding: 8,
                    background: 'var(--trae-bg-overlay-l1)',
                    borderRadius: 4,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 4,
                      gap: 8,
                    }}
                  >
                    <Text code style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {t.template}
                    </Text>
                    <Tag>× {t.count}</Tag>
                  </div>
                  {t.examples.length > 0 && (
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      示例：{t.examples[0]}
                    </Text>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* 推理链 */}
          {result.diagnose.reasoning.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <Title level={5}>推理链</Title>
              <ol style={{ paddingLeft: 20, margin: 0 }}>
                {result.diagnose.reasoning.map((r, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>
                    <Text>{r}</Text>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* 处置建议 */}
          {result.diagnose.recommendations.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <Title level={5}>处置建议</Title>
              <ol style={{ paddingLeft: 20, margin: 0 }}>
                {result.diagnose.recommendations.map((r, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>
                    <Text>{r}</Text>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* 关联风险（v1.5） */}
          {result.diagnose.related_risks && result.diagnose.related_risks.length > 0 && (
            <div>
              <Title level={5}>关联风险</Title>
              <ul style={{ paddingLeft: 20, margin: 0 }}>
                {result.diagnose.related_risks.map((r, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>
                    <Text type="warning">{r}</Text>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* 空状态：未分析 + 无错误 + 日志数量充足 */}
      {!result && !analyzing && !error && logs.length >= 5 && electronApiAvailable && (
        <div
          style={{
            textAlign: 'center',
            padding: '40px 0',
            color: 'var(--trae-text-tertiary)',
          }}
        >
          <Text type="secondary">点击右上角"开始分析"按钮启动 AI 日志分析</Text>
        </div>
      )}
    </Drawer>
  )
}
