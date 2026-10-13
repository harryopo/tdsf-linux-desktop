/**
 * AiLogAnalysisPanel — AI 日志分析抽屉（LogsPage 子组件）
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
 *   - electronAPI 不可用 → 抽屉内提示「主进程 IPC 不可用」，按钮禁用
 *   - sidecar 进程未启动或调用失败 → 显示错误 + 重试按钮，不崩溃
 *   - 日志数量 < 5 → 提示「日志数量不足，至少需要 5 条」
 *
 * 2026-10-07：抽屉从 antd Drawer 换成 ui 层 Sheet，Tag/Alert/Spin/Typography
 * 换成 Chip / Notice / Spinner + 令牌排版。原来满文件的内联 style 与 --trae-*
 * 色值在浅色主题下会带出深色块，现在颜色只来自语义令牌。
 */
import { useState, type ReactNode } from 'react'
import { Bot, Loader2 } from 'lucide-react'
import { Button, Chip, Notice, Sheet, SheetContent, Spinner, Tooltip, type ChipProps } from '@/ui'
import type { LogEntry } from './v1/logs-data'

interface AiLogAnalysisPanelProps {
  open: boolean
  logs: LogEntry[]
  onClose: () => void
}

/**
 * Sidecar pipeline 返回结构（与 src/renderer/src/types/electron.d.ts 的 pipeline 返回对齐）。
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

/** 严重度 -> 中文标签 + Chip 色调（与告警抽屉、风险控制页同一套说法） */
const SEVERITY_VIEW: Record<
  PipelineResult['diagnose']['severity'],
  { label: string; tone: ChipProps['tone'] }
> = {
  critical: { label: '严重', tone: 'error' },
  high: { label: '高', tone: 'warning' },
  medium: { label: '中', tone: 'warning' },
  low: { label: '低', tone: 'accent' },
}

/** 诊断来源 -> 标签文案（与 SrePipelinePanel SOURCE_TAG 对齐，简化版） */
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

/** 置信度百分比文案（0-1 -> 0-100%） */
function describeConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`
}

function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-md font-medium text-ink">{title}</h3>
      {children}
    </section>
  )
}

function OrderedList({ items }: { items: string[] }) {
  return (
    <ol className="flex flex-col gap-1.5 pl-5 text-md leading-relaxed text-ink-dim">
      {items.map((item, i) => (
        <li key={i} className="list-decimal">
          {item}
        </li>
      ))}
    </ol>
  )
}

/**
 * AI 日志分析面板
 *
 * 调用 sidecar:pipeline IPC 执行 Drain3 模板聚类 + AI 根因分析。
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
   * - spawn ENOENT / 启动失败：这台机器没有分析引擎 → 说清改用内置规则，再给开发环境的搭建步骤
   * - 启动超时：依赖未安装 / 端口冲突
   *
   * 这三行以前会原样出现在装好的包里，等于让普通用户去跑 pip。现在第一句先讲"你现在
   * 得到的是什么"，搭建步骤明确标成开发环境才做的事；缺在哪一步由「设置 → 关于 →
   * 本机分析引擎（实测）」给出具体原因（那一栏是主进程现场量的，不是文案）。
   */
  const friendlyError = (raw: string): string => {
    if (/ENOENT|启动失败|启动超时|crashed|未就绪/i.test(raw)) {
      return (
        `${raw}\n\n这条分析改用内置规则了（这台机器上没有本地 Python 分析引擎），` +
        `模板会更粗，但结论照给。\n开发环境要补齐引擎：在项目根目录建 .venv-sidecar-a 虚拟环境，` +
        `在其中执行 pip install -r sidecar-a/requirements.txt，并保证端口 19000 空闲。`
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
      // v2.6：先查引擎状态 —— 非 ready 时展示「启动中」提示（主进程 pipeline 已带懒启动）
      try {
        const st = await window.electronAPI.sidecarStatus?.()
        setPhase(st && st.status !== 'ready' ? 'starting' : 'analyzing')
      } catch {
        setPhase('analyzing')
      }
      // 将 IpcLogEntry[] 转换为纯文本日志行（便于 sidecar 按上下文诊断）
      const logLines = logs.map((l) => l.message)
      const resp = await window.electronAPI.sidecarPipeline(logLines)
      if (!resp.ok) {
        setError(friendlyError(resp.error || 'AI 日志分析失败（sidecar 可能未启动）'))
        return
      }
      setResult(resp.data)
    } catch (err) {
      setError(
        friendlyError(err instanceof Error ? err.message : 'AI 日志分析失败（sidecar 可能未启动）')
      )
    } finally {
      setAnalyzing(false)
      setPhase('idle')
    }
  }

  /** 关闭抽屉时清理状态 */
  const handleClose = () => {
    setResult(null)
    setError(null)
    onClose()
  }

  const canAnalyze = electronApiAvailable && logs.length >= 5

  return (
    <Sheet open={open} onOpenChange={(next) => !next && handleClose()}>
      <SheetContent
        title="AI 日志分析"
        width={520}
        actions={
          <Tooltip
            content={
              !electronApiAvailable
                ? '主进程 IPC 不可用，无法执行 AI 分析'
                : logs.length < 5
                  ? '日志数量不足，至少需要 5 条'
                  : ''
            }
          >
            {/* 禁用按钮不派发 hover，提示要挂在包一层的 span 上才看得到 */}
            <span className="inline-flex">
              <Button variant="solid" size="sm" disabled={!canAnalyze || analyzing} onClick={handleAnalyze}>
                {analyzing ? (
                  <Loader2 aria-hidden className="size-3.5 animate-spin" />
                ) : (
                  <Bot aria-hidden className="size-3.5" />
                )}
                {analyzing ? '分析中…' : error ? '重新分析' : '开始分析'}
              </Button>
            </span>
          </Tooltip>
        }
      >
        <div className="flex flex-col gap-3 px-4 py-3">
          {logs.length < 5 ? (
            <Notice tone="info" title={`当前日志 ${logs.length} 条，至少需要 5 条才能进行 AI 分析`} />
          ) : null}

          {!electronApiAvailable ? (
            <Notice tone="warning" title="主进程 IPC 不可用">
              当前不在 Electron 环境，无法调用 sidecar:pipeline。请在桌面端运行。
            </Notice>
          ) : null}

          {error ? (
            <Notice
              tone="error"
              title="分析失败"
              action={
                <Button variant="outline" size="sm" disabled={analyzing} onClick={handleAnalyze}>
                  重试
                </Button>
              }
            >
              {error}
            </Notice>
          ) : null}

          {analyzing ? (
            <div className="flex justify-center py-10">
              <Spinner
                label={
                  phase === 'starting'
                    ? '正在启动 AI 分析引擎（首次约 5-10 秒），随后自动分析…'
                    : '正在执行 Drain3 模板聚类 + AI 根因分析…'
                }
              />
            </div>
          ) : null}

          {result && !analyzing ? (
            <>
              <Section title="分析摘要">
                <div className="mb-2 flex flex-wrap gap-1.5">
                  <Chip tone="neutral">日志总数 {result.parse.total_lines}</Chip>
                  <Chip tone="neutral">唯一模板 {result.parse.unique_templates}</Chip>
                  <Chip tone={SEVERITY_VIEW[result.diagnose.severity].tone}>
                    严重度 {SEVERITY_VIEW[result.diagnose.severity].label}
                  </Chip>
                  <Chip tone="accent">置信度 {describeConfidence(result.diagnose.confidence)}</Chip>
                  <Chip tone="outline">{describeSource(result.diagnose.source)}</Chip>
                </div>
                <p className="text-md leading-relaxed text-ink">{result.diagnose.root_cause}</p>
              </Section>

              {result.parse.templates.length > 0 ? (
                <Section title={`异常模板聚类（${result.parse.templates.length}）`}>
                  <div className="flex flex-col gap-2">
                    {result.parse.templates.map((t) => (
                      <div key={t.template_id} className="rounded-(--ui-radius-control) bg-sunken p-2">
                        <div className="flex items-center gap-2">
                          <code className="min-w-0 flex-1 truncate font-mono text-caption text-ink">
                            {t.template}
                          </code>
                          <Chip tone="neutral">× {t.count}</Chip>
                        </div>
                        {t.examples.length > 0 ? (
                          <p className="mt-1 truncate text-caption text-ink-mute">示例：{t.examples[0]}</p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </Section>
              ) : null}

              {result.diagnose.reasoning.length > 0 ? (
                <Section title="推理链">
                  <OrderedList items={result.diagnose.reasoning} />
                </Section>
              ) : null}

              {result.diagnose.recommendations.length > 0 ? (
                <Section title="处置建议">
                  <OrderedList items={result.diagnose.recommendations} />
                </Section>
              ) : null}

              {result.diagnose.related_risks?.length ? (
                <Section title="关联风险">
                  <ul className="flex flex-col gap-1.5 pl-5 text-md leading-relaxed">
                    {result.diagnose.related_risks.map((r, i) => (
                      <li key={i} className="list-disc text-(--status-warning-text)">
                        {r}
                      </li>
                    ))}
                  </ul>
                </Section>
              ) : null}
            </>
          ) : null}

          {/* 空态：还没分析、没报错、条件也够 */}
          {!result && !analyzing && !error && canAnalyze ? (
            <p className="py-10 text-center text-caption text-ink-mute">
              点击右上角「开始分析」按钮启动 AI 日志分析
            </p>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}
