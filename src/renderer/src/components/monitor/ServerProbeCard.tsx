/**
 * ServerProbeCard — 监控页里的「体检这台服务器」（#212）
 *
 * 这条引擎一直都在：主进程 profiler:run 跑 27 项探查、列出风险、渲染 md 报告，
 * AI 在对话里也能调（services/llm/tools/profiler-run.ts）。缺的只是人按得到的那一下——
 * 界面从来没有入口，四把键在渲染层零调用。这一格把它接成看得见的功能。
 *
 * 导出落点由主进程定（userData/reports），渲染层只把 profiler:run 回来的那份 md 递回去，
 * 再把主进程回的 filePath 原样显示。理由写在 src/main/ipc/profiler.ts 头部。
 *
 * 三态规矩（DESIGN §10）：没会话不装忙、跑失败说原因，
 * 任何情况下都不许在没跑过的时候摆出一个数字或"已导出"。
 */
import { useCallback, useState } from 'react'
import { Download, FileText, Loader2, Stethoscope } from 'lucide-react'
import type { ProfilerRiskLevel, ProfilerRunResponse } from '@shared/models'
import { Button, Chip, Notice } from '@/ui'

const LEVEL_LABEL: Record<ProfilerRiskLevel, string> = {
  critical: '严重',
  high: '高',
  medium: '中',
  low: '低',
  info: '参考',
}

const LEVEL_TONE: Record<ProfilerRiskLevel, 'error' | 'warning' | 'neutral'> = {
  critical: 'error',
  high: 'error',
  medium: 'warning',
  low: 'neutral',
  info: 'neutral',
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * 摘要那一行：主进程给的计数原样念，一个数都不自己算。
 * 低/参考为 0 时不写——那两档平时都是 0，长期挂两个「0」反而像漏了统计。
 */
function summaryLine(resp: ProfilerRunResponse): string {
  const { total, critical, high, medium, low, info } = resp.summary
  const tail =
    low + info > 0 ? ` · 低 ${low} · 参考 ${info}` : ''
  return `共 ${total} 条风险 · 严重 ${critical} · 高 ${high} · 中 ${medium}${tail}`
}

export interface ServerProbeCardProps {
  /** 当前 SSH 会话 ID；没连上时为 null */
  sessionId: string | null
  /** 会话对应的主机名；会话有了但主机名还没读到时为 null */
  host: string | null
}

export function ServerProbeCard({ sessionId, host }: ServerProbeCardProps) {
  const [resp, setResp] = useState<ProfilerRunResponse | null>(null)
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [exporting, setExporting] = useState<'md' | 'pdf' | null>(null)
  const [exportedPath, setExportedPath] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)

  // 会话切换后上一台的报告不算这一台的，整块清掉
  const [boundSession, setBoundSession] = useState<string | null>(null)
  if (boundSession !== sessionId) {
    setBoundSession(sessionId)
    setResp(null)
    setRunError(null)
    setExportedPath(null)
    setExportError(null)
  }

  const ready = sessionId !== null && host !== null

  const run = useCallback(async () => {
    const api = window.electronAPI
    if (!api?.profilerRun || sessionId === null || host === null) return
    setRunning(true)
    setRunError(null)
    setExportedPath(null)
    setExportError(null)
    try {
      setResp(await api.profilerRun(sessionId, host))
    } catch (err) {
      // 跑砸了就把上一轮的结果一起丢掉：留着旧报告会让"这次失败"读起来像成功
      setResp(null)
      setRunError(messageOf(err))
    } finally {
      setRunning(false)
    }
  }, [sessionId, host])

  const exportReport = useCallback(
    async (kind: 'md' | 'pdf') => {
      const api = window.electronAPI
      if (!resp || sessionId === null || host === null) return
      setExporting(kind)
      setExportError(null)
      try {
        // 递回去的只有正文与主机名：落点由主进程定
        const res =
          kind === 'md'
            ? await api.profilerExportMd(resp.md, host)
            : await api.profilerExportPdf(resp.md, host)
        setExportedPath(res.filePath)
      } catch (err) {
        setExportedPath(null)
        setExportError(messageOf(err))
      } finally {
        setExporting(null)
      }
    },
    [resp, host, sessionId]
  )

  return (
    <section
      aria-label="服务器体检"
      className="rounded-(--ui-radius-card) border border-line bg-panel p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Stethoscope aria-hidden className="size-4 shrink-0 text-ink-dim" />
        <h2 className="min-w-0 flex-1 truncate text-md font-medium">服务器体检</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void run()}
          disabled={!ready || running}
        >
          {running ? (
            <Loader2 aria-hidden className="mr-1 size-3.5 animate-spin" />
          ) : (
            <Stethoscope aria-hidden className="mr-1 size-3.5" />
          )}
          {running ? '体检中…' : '开始体检'}
        </Button>
      </div>

      <p className="mt-1.5 text-caption leading-relaxed text-ink-mute">
        连上这台服务器后跑一次，27 项探查覆盖系统信息、服务、端口、磁盘、日志与配置，
        再把发现的安全与稳定性风险列出来。报告可以导出 md 或 PDF，文件放在应用数据目录的
        reports 子目录里。
      </p>

      {!ready && (
        <p className="mt-2 text-sm text-ink-dim">
          {sessionId === null
            ? '没连上服务器 · 先在终端连上一台，这一格才有体检的对象。'
            : '正在读取这台机器的主机名，读到之后就能开始体检。'}
        </p>
      )}

      {ready && runError && (
        <Notice
          className="mt-2"
          tone="error"
          title="体检没做成"
          action={
            <Button variant="ghost" size="sm" onClick={() => void run()} aria-label="重新体检">
              重试
            </Button>
          }
        >
          {runError}
        </Notice>
      )}

      {ready && !running && !runError && !resp && (
        <p className="mt-2 text-sm text-ink-dim">还没跑过。点右上角「开始体检」跑一次。</p>
      )}

      {running && !resp && (
        <p className="mt-2 flex items-center gap-2 text-sm text-ink-dim">
          <Loader2 aria-hidden className="size-4 animate-spin" />
          正在探查，一般要几秒
        </p>
      )}

      {resp && (
        <>
          <p className="mt-3 text-caption text-ink-mute">{`目标主机：${resp.result.host}`}</p>
          <p className="mt-1 text-sm font-medium">{summaryLine(resp)}</p>
          <ul className="mt-2 space-y-2">
            {resp.risks.map((risk, i) => (
              <li
                // 风险项没有稳定 id，同一份报告内 level+category+title 足够唯一
                key={`${risk.level}-${risk.category}-${risk.title}-${i}`}
                className="rounded-(--ui-radius-control) border border-line px-2.5 py-2"
              >
                <div className="flex items-center gap-2">
                  <Chip tone={LEVEL_TONE[risk.level]}>{LEVEL_LABEL[risk.level]}</Chip>
                  <span className="min-w-0 flex-1 truncate text-sm">{risk.title}</span>
                  <span className="shrink-0 text-caption text-ink-mute">{risk.category}</span>
                </div>
                <p className="mt-1 break-words text-caption leading-relaxed text-ink-dim">
                  {risk.suggestion}
                </p>
              </li>
            ))}
          </ul>

          {resp.risks.length === 0 && (
            <p className="mt-2 text-sm text-ink-dim">
              这次没有命中任何风险项——报告正文里仍有全部 27 项探查的原始读数。
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void exportReport('md')}
              disabled={exporting !== null}
            >
              <FileText aria-hidden className="mr-1 size-3.5" />
              导出 md
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void exportReport('pdf')}
              disabled={exporting !== null}
            >
              <Download aria-hidden className="mr-1 size-3.5" />
              导出 PDF
            </Button>
            {exporting !== null && (
              <span className="flex items-center gap-1.5 text-caption text-ink-mute">
                <Loader2 aria-hidden className="size-3.5 animate-spin" />
                正在写文件
              </span>
            )}
          </div>

          {exportedPath && (
            <p className="mt-2 break-all text-caption leading-relaxed text-ink-dim">
              {`已导出：${exportedPath}`}
            </p>
          )}
          {exportError && (
            <Notice className="mt-2" tone="error" title="导出失败">
              {exportError}
            </Notice>
          )}
        </>
      )}
    </section>
  )
}
