/**
 * ConversationSection — 对话记录 Section（M5 Task 6 拆分）
 *
 * 从 ModelSettings.tsx 抽取，负责搜索框 + 状态筛选 + 对话表格 + 分页栏。
 *
 * 原 Section 6：对话记录 SettingsCard。
 */
import {
  ListOrdered,
  Search,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { SettingsCard } from '@/components/settings/SettingsCard'
import type { ConversationRow } from './constants'

export interface ConversationSectionProps {
  /** 当前状态筛选值 */
  statusFilter: '全部状态' | '成功' | '已拦截' | '失败'
  /** 点击切换状态筛选回调 */
  onCycleStatusFilter: () => void
  /** 已过滤的对话记录列表 */
  filteredConversations: ConversationRow[]
  /** 当前页码 */
  currentPage: number
  /** 设置当前页码回调 */
  onCurrentPageChange: (page: number) => void
}

export function ConversationSection(props: ConversationSectionProps) {
  const {
    statusFilter,
    onCycleStatusFilter,
    filteredConversations,
    currentPage,
    onCurrentPageChange,
  } = props

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
            {filteredConversations.length === 0 ? (
              <tr>
                <td colSpan={6} className="set-conv-empty">
                  没有匹配 "{statusFilter}" 的记录
                </td>
              </tr>
            ) : (
              filteredConversations.map((row, idx) => (
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
          共 {filteredConversations.length} 条
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
          {[1, 2, 3].map((page) => (
            <button
              key={page}
              type="button"
              onClick={() => onCurrentPageChange(page)}
              aria-label={`第 ${page} 页`}
              className={
                'set-conv-page-btn btn-press' +
                (currentPage === page ? ' is-active' : '')
              }
            >
              {page}
            </button>
          ))}
          <span className="set-conv-page-ellipsis">...</span>
          <button
            type="button"
            onClick={() => onCurrentPageChange(13)}
            aria-label="第 13 页"
            className={
              'set-conv-page-btn btn-press' +
              (currentPage === 13 ? ' is-active' : '')
            }
          >
            13
          </button>
          <button
            type="button"
            onClick={() => onCurrentPageChange(Math.min(13, currentPage + 1))}
            disabled={currentPage === 13}
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
