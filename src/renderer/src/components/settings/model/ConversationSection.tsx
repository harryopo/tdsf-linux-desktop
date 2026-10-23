/**
 * ConversationSection — 对话记录 Section（M5 Task 6 拆分）
 *
 * 从 ModelSettings.tsx 抽取，负责搜索框 + 状态筛选 + 对话表格 + 分页栏。
 *
 * v2.3.3 修复：
 * - 删除"未匹配筛选"和"暂无对话记录"混用同一文案（无数据时显示真实提示）
 * - isLoading 时显示 skeleton 而非空表格
 */
import {
  ListOrdered,
  Search,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { pageWindow } from './conversation-paging'
import type { ConversationRow } from './constants'

export interface ConversationSectionProps {
  /** 当前状态筛选值 */
  statusFilter: '全部状态' | '成功' | '已拦截' | '失败'
  /** 点击切换状态筛选回调 */
  onCycleStatusFilter: () => void
  /** 搜索词（受控：输入即过滤，不再是一个装饰输入框） */
  query: string
  /** 搜索词变化回调 */
  onQueryChange: (query: string) => void
  /** **当前页**的数据（已按页切片，不是全量） */
  rows: ConversationRow[]
  /** 过滤后的总条数（分页栏显示"共 N 条"用） */
  totalRows: number
  /** 当前页码（已收敛） */
  currentPage: number
  /** 总页数 */
  totalPages: number
  /** 设置当前页码回调 */
  onCurrentPageChange: (page: number) => void
  /** 是否正在加载 */
  isLoading: boolean
}

export function ConversationSection(props: ConversationSectionProps) {
  const {
    statusFilter,
    onCycleStatusFilter,
    query,
    onQueryChange,
    rows,
    totalRows,
    currentPage,
    totalPages,
    onCurrentPageChange,
    isLoading,
  } = props

  // 空状态文案：未匹配筛选 vs 真实无数据 vs 加载中
  const renderEmptyState = () => {
    if (isLoading) {
      return (
        <tr>
          <td colSpan={6} className="set-conv-empty">
            正在加载对话记录...
          </td>
        </tr>
      )
    }
    if (rows.length === 0) {
      const conditions = [
        statusFilter !== '全部状态' ? `状态「${statusFilter}」` : '',
        query.trim() ? `搜索词「${query.trim()}」` : '',
      ].filter(Boolean)
      return (
        <tr>
          <td colSpan={6} className="set-conv-empty">
            {conditions.length > 0
              ? `没有匹配${conditions.join(' + ')}的记录`
              : '暂无对话记录，请先在 AI 面板发送消息后再来查看'}
          </td>
        </tr>
      )
    }
    return null
  }

  return (
    <SettingsCard
      icon={ListOrdered}
      title="对话记录"
      tag="conversation.history"
      className="p-5"
      hideTag
      noHeadBorder
      headMb="lg"
    >
      {/* 工具栏 */}
      <div className="set-conv-toolbar">
        <div className="set-conv-search">
          <Search className="size-3.5" />
          <input
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="搜索对话..."
            aria-label="搜索对话"
            className="set-conv-search__input"
          />
        </div>
        <button
          type="button"
          onClick={onCycleStatusFilter}
          aria-label="切换状态筛选"
          title="点击切换状态筛选"
          className="set-conv-filter-btn btn-press"
        >
          <span>{statusFilter}</span>
          <ChevronDown className="size-3.5" />
        </button>
      </div>

      {/* 表格 */}
      <div className="set-conv-table-wrap">
        <table className="set-conv-table">
          <thead>
            <tr>
              <th>
                时间
              </th>
              <th>
                用户输入
              </th>
              <th>
                AI模型
              </th>
              <th className="col-right">
                输入Token
              </th>
              <th className="col-right">
                输出Token
              </th>
              <th>
                状态
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              renderEmptyState()
            ) : (
              rows.map((row, idx) => (
              <tr key={`${row.time}-${idx}`}>
                <td className="col-mono col-secondary">
                  {row.time}
                </td>
                <td className="col-default">
                  {row.input}
                </td>
                <td>
                  <span
                    className={
                      'set-conv-tag ' +
                      (row.modelTagType === 'brand'
                        ? 'set-conv-tag--brand'
                        : 'set-conv-tag--neutral')
                    }
                  >
                    {row.model}
                  </span>
                </td>
                <td className="col-mono col-right">
                  {row.inputTokens}
                </td>
                <td className="col-mono col-right">
                  {row.outputTokens}
                </td>
                <td>
                  <span
                    className={
                      'set-conv-status ' +
                      (row.statusType === 'success'
                        ? 'set-conv-status--success'
                        : row.statusType === 'warning'
                          ? 'set-conv-status--warning'
                          : 'set-conv-status--danger')
                    }
                  >
                    {row.status}
                  </span>
                </td>
              </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 分页栏 */}
      <div className="set-conv-pagination">
        <span className="set-conv-pagination__count">
          共 {totalRows} 条
          {statusFilter !== '全部状态' && (
            <span className="set-conv-pagination__count-hint">
              (筛选: {statusFilter})
            </span>
          )}
        </span>
        <div className="set-conv-pages">
          <button
            type="button"
            onClick={() => onCurrentPageChange(Math.max(1, currentPage - 1))}
            disabled={currentPage === 1}
            aria-label="上一页"
            className="set-conv-page-btn btn-press"
          >
            <ChevronLeft className="size-3.5" />
          </button>
          {pageWindow(currentPage, totalPages).map((page, index) =>
            page === null ? (
              <span key={`gap-${index}`} className="set-conv-page-ellipsis">
                …
              </span>
            ) : (
              <button
                key={page}
                type="button"
                onClick={() => onCurrentPageChange(page)}
                aria-label={`第 ${page} 页`}
                aria-current={currentPage === page ? 'page' : undefined}
                className={
                  'set-conv-page-btn btn-press' +
                  (currentPage === page ? ' is-active' : '')
                }
              >
                {page}
              </button>
            )
          )}
          <button
            type="button"
            onClick={() => onCurrentPageChange(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage >= totalPages}
            aria-label="下一页"
            className="set-conv-page-btn btn-press"
          >
            <ChevronRight className="size-3.5" />
          </button>
        </div>
      </div>
    </SettingsCard>
  )
}
