/**
 * HistoryPage — 历史决策列表
 *
 * 路由：/history
 *
 * 设计稿：history.html
 * - Page header（标题 + 副标题 + 返回工作台按钮）
 * - 统计概览 4 列（总决策数 / 成功率 / 平均置信度 / 平均响应时间）
 * - 筛选栏（时间范围 + 服务器 + 状态 + 关键词搜索）
 * - 决策时间线（卡片）
 * - 分页栏（offset 分页）
 *
 * 数据来源：
 * - 通过 window.electronAPI.historyList(offset, limit) 真实 IPC 分页拉取
 *   返回 @shared/models 的 DecisionCard[]
 * - 关键词搜索为客户端过滤（作用于已加载记录）
 * - 点击"查看详情"跳转 /history/:id（useNavigate）
 * - 返回工作台（useNavigate 跳回 /workbench）
 *
 * 子组件：components/history/*
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Clock } from 'lucide-react'
import type { DecisionCard as DecisionCardModel } from '@shared/models'
import { StatCard } from '@/components/history/StatCard'
import { FilterBar, type FilterState } from '@/components/history/FilterBar'
import { DecisionCard } from '@/components/history/DecisionCard'
import { Pagination, type PaginationData } from '@/components/history/Pagination'
import type {
  ActorType,
  DecisionRecord,
  DecisionStatus,
  RiskLevel,
  StatOverview,
} from '@/components/history/mock-data'

/** 每页拉取条数 */
const PAGE_SIZE = 20

/** 默认筛选状态 */
const DEFAULT_FILTER: FilterState = {
  timeRange: '近7天',
  server: '全部服务器',
  status: '全部状态',
  keyword: '',
}

/** 模型状态 → 展示状态徽章 */
function toDisplayStatus(status: DecisionCardModel['status']): DecisionStatus {
  switch (status) {
    case 'verified':
    case 'executed':
    case 'approved':
      return '成功'
    case 'failed':
      return '失败'
    case 'rejected':
    case 'pending':
      return '已拦截'
  }
}

/** 模型风险等级 → 展示风险徽章 */
function toDisplayRisk(level: DecisionCardModel['risk']['level']): RiskLevel {
  switch (level) {
    case 'SAFE':
    case 'LOW':
      return '低风险'
    case 'MEDIUM':
      return '中风险'
    case 'HIGH':
    case 'CRITICAL':
      return '高风险'
  }
}

/** 展示状态 → 时间线圆点颜色 */
function toDotColor(status: DecisionStatus): string {
  switch (status) {
    case '成功':
      return 'var(--trae-status-success-default)'
    case '失败':
      return 'var(--trae-status-error-default)'
    case '已拦截':
      return 'var(--trae-status-warning-default)'
  }
}

/** 时间戳 → HH:mm 展示 */
function formatTime(timestamp: number): string {
  const d = new Date(timestamp)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

/**
 * 将 IPC 返回的模型 DecisionCard 适配为展示组件所需的 DecisionRecord。
 * 仅做字段映射，不改变任何视觉样式。
 */
function toRecord(card: DecisionCardModel): DecisionRecord {
  const status = toDisplayStatus(card.status)
  const risk = toDisplayRisk(card.risk.level)
  const actor: ActorType = 'ai-agent'
  return {
    id: card.id,
    time: formatTime(card.timestamp),
    title: card.problem,
    status,
    risk,
    server: card.sessionId ?? '—',
    actor,
    confidence: card.confidence,
    command: card.fixCommand,
    isDanger: card.risk.blocked || card.risk.level === 'HIGH' || card.risk.level === 'CRITICAL',
    desc: card.fixDescription || card.hypothesis,
    durationSec: 0,
    dotColor: toDotColor(status),
  }
}

/**
 * 依据已加载记录计算统计概览（保留设计稿 4 列布局与迷你折线装饰）。
 * 总决策数 / 成功率 / 平均置信度来自真实数据；平均响应时间暂无数据源，显示占位。
 */
function buildStats(records: DecisionCardModel[], hasMore: boolean): StatOverview[] {
  const total = records.length
  const successCount = records.filter(
    (r) => r.status === 'verified' || r.status === 'executed',
  ).length
  const successRate = total > 0 ? (successCount / total) * 100 : 0
  const avgConfidence =
    total > 0 ? records.reduce((sum, r) => sum + r.confidence, 0) / total : 0

  return [
    {
      label: '总决策数',
      value: hasMore ? `${total}+` : `${total}`,
      color: 'var(--trae-bg-brand)',
      sparkline: '0,18 14,14 28,16 42,10 56,12 70,7 84,9 100,5',
      sparkColor: 'var(--trae-bg-brand)',
    },
    {
      label: '成功率',
      value: `${successRate.toFixed(1)}%`,
      color: 'var(--trae-status-success-default)',
      sparkline: '0,16 14,18 28,12 42,14 56,9 70,11 84,6 100,8',
      sparkColor: 'var(--trae-status-success-default)',
    },
    {
      label: '平均置信度',
      value: avgConfidence.toFixed(2),
      color: 'var(--trae-bg-brand)',
      sparkline: '0,14 14,12 28,15 42,9 56,11 70,8 84,10 100,6',
      sparkColor: 'var(--trae-bg-brand)',
    },
    {
      label: '平均响应时间',
      value: '—',
      color: 'var(--trae-text-secondary)',
      sparkline: '0,8 14,12 28,10 42,14 56,11 70,16 84,13 100,15',
      sparkColor: 'var(--trae-text-secondary)',
    },
  ]
}

/**
 * HistoryPage 主组件
 */
export function HistoryPage() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState<FilterState>(DEFAULT_FILTER)

  // ===== 真实 IPC 数据状态 =====
  const [records, setRecords] = useState<DecisionCardModel[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)

  /**
   * 拉取指定 offset 的一页数据（替换式分页）。
   * 挂载时与 offset 变化时触发。
   */
  const fetchPage = useCallback(async (pageOffset: number) => {
    setLoading(true)
    setError(null)
    try {
      const list = await window.electronAPI.historyList(pageOffset, PAGE_SIZE)
      setRecords(list)
      setHasMore(list.length === PAGE_SIZE)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载历史决策失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchPage(offset)
  }, [offset, fetchPage])

  /** 关键词过滤（客户端，作用于已加载记录的 problem / fixCommand / sessionId） */
  const keyword = filter.keyword.trim().toLowerCase()
  const visibleRecords = useMemo(() => {
    const mapped = records.map(toRecord)
    if (!keyword) return mapped
    return mapped.filter(
      (r) =>
        r.title.toLowerCase().includes(keyword) ||
        r.command.toLowerCase().includes(keyword) ||
        r.server.toLowerCase().includes(keyword),
    )
  }, [records, keyword])

  /** 统计概览（基于真实数据） */
  const statOverviews = useMemo(() => buildStats(records, hasMore), [records, hasMore])

  /** 查看详情：跳转 /history/:id */
  const handleViewDetail = (id: string) => {
    navigate(`/history/${id}`)
  }

  /** 重试 */
  const handleRetry = () => {
    void fetchPage(offset)
  }

  // ===== 分页（offset 驱动） =====
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1
  const totalPages = currentPage + (hasMore ? 1 : 0)
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1)

  const handlePageChange = (next: number) => {
    const nextOffset = (next - 1) * PAGE_SIZE
    if (nextOffset === offset) return
    setOffset(nextOffset)
  }

  const pagination: PaginationData = {
    total: offset + records.length,
    currentPage,
    pages,
    showEllipsis: totalPages > 3,
  }

  // ===== 守卫：electronAPI 不可用（非 Electron 环境） =====
  if (!window.electronAPI) {
    return (
      <main className="min-h-full flex items-center justify-center bg-[var(--trae-bg-base-default)]">
        <span className="text-[12px] text-[var(--trae-text-tertiary)]">
          当前环境不可用，请在桌面客户端中打开
        </span>
      </main>
    )
  }

  const showEmpty = !loading && !error && visibleRecords.length === 0

  return (
    <main className="min-h-full flex flex-col bg-[var(--trae-bg-base-default)]">
      {/* 1. Page header */}
      <header
        className="flex items-center justify-between gap-4 p-4"
        style={{ padding: '16px 24px', gap: '16px' }}
      >
        <div className="flex flex-row items-center gap-3 min-w-0">
          <Clock
            className="shrink-0 w-[22px] h-[22px]"
            style={{ color: 'var(--trae-bg-brand)' }}
          />
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[28px] leading-[36px] font-semibold text-[var(--trae-text-default)]">
              历史决策
            </span>
            <span className="text-[11px] text-[var(--trae-text-secondary)]">
              AI运维决策的完整审计追溯
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigate('/workbench')}
          className="inline-flex items-center gap-1.5 h-7 px-3 text-[11px] font-medium text-[var(--trae-text-default)] bg-[var(--trae-bg-overlay-l2)] border border-[var(--trae-border-neutral-l1)] rounded-[var(--trae-radius-4)] cursor-pointer hover:bg-[var(--trae-bg-overlay-l3)] transition-colors duration-150"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          返回工作台
        </button>
      </header>

      {/* 2. 统计概览（设计稿：纵向堆叠） */}
      <section
        className="flex flex-col"
        style={{ gap: '12px', padding: '24px 24px 0' }}
      >
        {statOverviews.map((stat) => (
          <StatCard key={stat.label} stat={stat} />
        ))}
      </section>

      {/* 3. 筛选栏 */}
      <section style={{ padding: '24px' }}>
        <FilterBar value={filter} onChange={setFilter} />
      </section>

      {/* 4. 决策时间线 */}
      <section className="flex-1" style={{ padding: '0 24px 24px' }}>
        <div className="flex flex-col">
          {/* 加载中（首页） */}
          {loading && records.length === 0 && (
            <div className="flex items-center justify-center h-32">
              <span
                className="w-5 h-5 rounded-full border-2 border-[var(--trae-border-neutral-l1)] animate-spin"
                style={{ borderTopColor: 'var(--trae-bg-brand)' }}
              />
            </div>
          )}

          {/* 错误状态（含重试） */}
          {!loading && error && (
            <div className="flex flex-col items-center justify-center gap-3 h-32">
              <span className="text-[11px] text-[var(--trae-status-error-default)]">
                {error}
              </span>
              <button
                type="button"
                onClick={handleRetry}
                className="inline-flex items-center h-7 px-3 text-[11px] font-medium text-[var(--trae-text-onbrand)] bg-[var(--trae-bg-brand)] border-none rounded-[var(--trae-radius-4)] cursor-pointer hover:opacity-90 transition-opacity duration-150"
              >
                重试
              </button>
            </div>
          )}

          {/* 记录列表 */}
          {!error &&
            visibleRecords.map((record, idx) => (
              <DecisionCard
                key={record.id}
                record={record}
                isLast={idx === visibleRecords.length - 1}
                onViewDetail={handleViewDetail}
              />
            ))}

          {/* 空状态 */}
          {showEmpty && (
            <div className="flex items-center justify-center h-32 text-[11px] text-[var(--trae-text-tertiary)]">
              未匹配到任何决策记录
            </div>
          )}

          {/* 加载更多（换页时显示行内加载态） */}
          {!error && loading && records.length > 0 && (
            <div className="flex items-center justify-center h-12">
              <span
                className="w-4 h-4 rounded-full border-2 border-[var(--trae-border-neutral-l1)] animate-spin"
                style={{ borderTopColor: 'var(--trae-bg-brand)' }}
              />
            </div>
          )}
        </div>
      </section>

      {/* 5. 分页栏 */}
      <Pagination data={pagination} onPageChange={handlePageChange} />
    </main>
  )
}
