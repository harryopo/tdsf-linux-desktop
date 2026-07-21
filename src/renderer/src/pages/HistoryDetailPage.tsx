/**
 * HistoryDetailPage — 历史决策详情
 *
 * 路由：/history/:id
 *
 * 设计稿：history-detail.html
 * - Page header（返回历史决策 + 状态标签 + 时间戳）
 * - Title block（决策记录 + #ID）
 * - 5 张卡片：决策摘要 / 证据溯源链 / 执行结果 / 知识库更新 / 操作日志
 *
 * 数据来源：window.electronAPI.historyGet(id) IPC 调用
 *
 * 子组件：components/history-detail/*
 */
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import type { DecisionCard } from '@shared/models'
import { isElectronAPIAvailable } from '@/utils/electron-api'
import { SummaryCard } from '@/components/history-detail/SummaryCard'
import { EvidenceTimeline } from '@/components/history-detail/EvidenceTimeline'
import { ResultTable } from '@/components/history-detail/ResultTable'
import { KnowledgeUpdate } from '@/components/history-detail/KnowledgeUpdate'
import { ActionLog } from '@/components/history-detail/ActionLog'

/** 状态 → 中文标签映射 */
const STATUS_LABELS: Record<DecisionCard['status'], string> = {
  pending: '待处理',
  approved: '已批准',
  rejected: '已拒绝',
  executed: '已执行',
  verified: '已验证',
  failed: '执行失败',
}

/** 状态 → 颜色变量映射 */
const STATUS_COLORS: Record<DecisionCard['status'], { bg: string; text: string }> = {
  pending: {
    bg: 'var(--trae-status-warning-surface-l1, rgba(255,170,0,0.1))',
    text: 'var(--trae-status-warning-default, #aa8800)',
  },
  approved: {
    bg: 'var(--trae-status-info-surface-l1, rgba(0,120,255,0.1))',
    text: 'var(--trae-status-info-default, #0078ff)',
  },
  rejected: {
    bg: 'var(--trae-status-error-surface-l1, rgba(255,60,60,0.1))',
    text: 'var(--trae-status-error-default, #ff3c3c)',
  },
  executed: {
    bg: 'var(--trae-status-success-surface-l1)',
    text: 'var(--trae-status-success-default)',
  },
  verified: {
    bg: 'var(--trae-status-success-surface-l1)',
    text: 'var(--trae-status-success-default)',
  },
  failed: {
    bg: 'var(--trae-status-error-surface-l1, rgba(255,60,60,0.1))',
    text: 'var(--trae-status-error-default, #ff3c3c)',
  },
}

/** 格式化时间戳（number → "YYYY-MM-DD HH:mm:ss"） */
function formatTimestamp(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/**
 * HistoryDetailPage 主组件
 */
export function HistoryDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [record, setRecord] = useState<DecisionCard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) {
      setError('缺少决策 ID 参数')
      setLoading(false)
      return
    }

    if (!isElectronAPIAvailable()) {
      setError('Electron API 不可用，无法加载决策记录')
      setLoading(false)
      return
    }

    let cancelled = false

    const fetchRecord = async () => {
      setLoading(true)
      setError(null)
      try {
        const result = await window.electronAPI.historyGet(id)
        if (!cancelled) {
          if (result === null) {
            setError('未找到该决策记录')
          } else {
            setRecord(result)
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载决策记录失败')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void fetchRecord()

    return () => {
      cancelled = true
    }
  }, [id])

  // ---- Loading state ----
  if (loading) {
    return (
      <main className="min-h-full flex flex-col items-center justify-center bg-[var(--trae-bg-base-default)]">
        <div className="flex flex-col items-center gap-3">
          <span
            className="inline-block w-6 h-6 border-2 border-t-transparent rounded-full animate-spin"
            style={{ borderColor: 'var(--trae-text-brand)', borderTopColor: 'transparent' }}
          />
          <span className="text-[12px] text-[var(--trae-text-tertiary)]">加载决策记录…</span>
        </div>
      </main>
    )
  }

  // ---- Error / Not-found state ----
  if (error || !record) {
    return (
      <main className="min-h-full flex flex-col bg-[var(--trae-bg-base-default)]">
        <header
          className="flex items-center gap-4"
          style={{ padding: '16px 24px', maxWidth: '900px', margin: '0 auto', width: '100%' }}
        >
          <button
            type="button"
            onClick={() => navigate('/history')}
            aria-label="返回历史决策"
            className="inline-flex items-center gap-1.5 h-7 px-3 text-[11px] font-medium text-[var(--trae-text-default)] bg-[var(--trae-bg-overlay-l2)] border border-[var(--trae-border-neutral-l1)] rounded-[var(--trae-radius-4)] cursor-pointer hover:bg-[var(--trae-bg-overlay-l3)] transition-colors duration-150"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            返回历史决策
          </button>
        </header>
        <div className="flex flex-col items-center justify-center flex-1 gap-3 pb-16">
          <span className="text-[14px] font-medium text-[var(--trae-text-secondary)]">
            {error ?? '未找到该决策记录'}
          </span>
          <button
            type="button"
            onClick={() => navigate('/history')}
            className="inline-flex items-center gap-1.5 h-8 px-4 text-[12px] font-medium text-[var(--trae-text-default)] bg-[var(--trae-bg-overlay-l2)] border border-[var(--trae-border-neutral-l1)] rounded-[var(--trae-radius-4)] cursor-pointer hover:bg-[var(--trae-bg-overlay-l3)] transition-colors duration-150"
          >
            返回历史决策列表
          </button>
        </div>
      </main>
    )
  }

  // ---- Normal render with real data ----
  const statusLabel = STATUS_LABELS[record.status]
  const statusColor = STATUS_COLORS[record.status]

  return (
    <main className="min-h-full flex flex-col bg-[var(--trae-bg-base-default)]">
      {/* 1. Page header */}
      <header
        className="flex items-center justify-between gap-4"
        style={{ padding: '16px 24px', gap: '16px', maxWidth: '900px', margin: '0 auto', width: '100%' }}
      >
        {/* 左侧：返回按钮 */}
        <button
          type="button"
          onClick={() => navigate('/history')}
          aria-label="返回历史决策"
          className="inline-flex items-center gap-1.5 h-7 px-3 text-[11px] font-medium text-[var(--trae-text-default)] bg-[var(--trae-bg-overlay-l2)] border border-[var(--trae-border-neutral-l1)] rounded-[var(--trae-radius-4)] cursor-pointer hover:bg-[var(--trae-bg-overlay-l3)] transition-colors duration-150"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          返回历史决策
        </button>
        {/* 右侧：状态标签 + 时间戳 */}
        <div className="flex items-center justify-end gap-3 flex-1">
          <span
            className="inline-flex items-center px-1.5 h-5 whitespace-nowrap text-[10px] font-medium rounded-[var(--trae-radius-2)]"
            style={{
              background: statusColor.bg,
              color: statusColor.text,
            }}
          >
            {statusLabel}
          </span>
          <span className="inline-flex items-center gap-1.5 text-[10px] text-[var(--trae-text-tertiary)]">
            <ClockIcon className="w-3 h-3 shrink-0" style={{ color: 'var(--trae-text-tertiary)' }} />
            <span className="font-mono">{formatTimestamp(record.timestamp)}</span>
          </span>
        </div>
      </header>

      {/* 2. Title block */}
      <div style={{ maxWidth: '900px', margin: '0 auto', width: '100%', padding: '16px 24px 0' }}>
        <h1 className="text-[24px] leading-[32px] font-semibold text-[var(--trae-text-default)] m-0" style={{ textWrap: 'balance', wordBreak: 'keep-all' }}>
          决策记录{' '}
          <span className="font-mono" style={{ color: 'var(--trae-text-brand)' }}>
            #{record.id}
          </span>
        </h1>
      </div>

      {/* 3. Content cards */}
      <div
        className="flex flex-col gap-4"
        style={{ maxWidth: '900px', margin: '0 auto', width: '100%', padding: '16px 24px 32px' }}
      >
        <SummaryCard card={record} />
        <EvidenceTimeline evidences={record.evidences ?? []} />
        <ResultTable card={record} />
        <KnowledgeUpdate card={record} />
        <ActionLog card={record} />
      </div>
    </main>
  )
}

/** Clock 图标（行内 mask） */
function ClockIcon({
  className,
  style,
}: {
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <span
      className={className}
      style={{
        display: 'inline-block',
        backgroundColor: style?.color ?? 'currentColor',
        maskImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><circle cx='12' cy='12' r='10'/><polyline points='12 6 12 12 16 14'/></svg>\")",
        maskSize: 'contain',
        maskRepeat: 'no-repeat',
        maskPosition: 'center',
        WebkitMaskImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><circle cx='12' cy='12' r='10'/><polyline points='12 6 12 12 16 14'/></svg>\")",
        WebkitMaskSize: 'contain',
        WebkitMaskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        width: '12px',
        height: '12px',
        ...style,
      }}
    />
  )
}
