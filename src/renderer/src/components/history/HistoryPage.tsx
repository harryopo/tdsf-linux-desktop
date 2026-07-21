/**
 * 历史决策页面组件 - HistoryPage
 *
 * 职责：
 * - 决策卡片列表（按时间倒序排列）
 * - 搜索过滤（按问题描述/根因假设关键词）
 * - 风险等级过滤（全部/安全/低/中/高/极高）
 * - 点击卡片打开 Modal 查看完整 DecisionCard 详情
 * - 分页（每页 10 条）
 *
 * 数据流：
 * - 通过 window.electronAPI.historyList(offset, limit) 加载历史
 * - 通过 window.electronAPI.historyGet(id) 获取详情
 *
 * 苹果极简风格：
 * - 卡片列表纵向排列，细线条分割
 * - 搜索栏顶部固定
 * - 分页器底部固定
 */
import { useState, useEffect, useCallback } from 'react'
import { Input, Select, Pagination, Modal, Spin, Empty, Tag, message } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import DecisionCard from '../ai/DecisionCard'
import { StaggerList } from '../common'
import type { DecisionCard as DecisionCardType, RiskLevel } from '@shared/models'
import { isElectronAPIAvailable } from '../../utils/electron-api'
import './HistoryPage.css'

/** 每页条数 */
const PAGE_SIZE = 10

/** 风险等级颜色映射 */
const RISK_COLOR_MAP: Record<RiskLevel, string> = {
  SAFE: '#34c759',
  LOW: '#30b0c7',
  MEDIUM: '#ff9500',
  HIGH: '#ff6b35',
  CRITICAL: '#ff3b30',
}

/** 风险等级中文标签 */
const RISK_LABEL_MAP: Record<RiskLevel, string> = {
  SAFE: '安全',
  LOW: '低风险',
  MEDIUM: '中风险',
  HIGH: '高风险',
  CRITICAL: '极高风险',
}

/** 状态中文标签 */
const STATUS_LABEL_MAP: Record<string, string> = {
  pending: '待确认',
  approved: '已批准',
  rejected: '已拒绝',
  executed: '已执行',
  verified: '已验证',
  failed: '执行失败',
}

/** HistoryPage 历史决策页面 */
const HistoryPage: React.FC = () => {
  // ===== 状态 =====
  /** 原始决策列表 */
  const [decisions, setDecisions] = useState<DecisionCardType[]>([])
  /** 加载中 */
  const [loading, setLoading] = useState(false)
  /** 当前页码（1-based） */
  const [currentPage, setCurrentPage] = useState(1)
  /** 搜索关键词 */
  const [searchKeyword, setSearchKeyword] = useState('')
  /** 风险等级过滤 */
  const [riskFilter, setRiskFilter] = useState<RiskLevel | 'ALL'>('ALL')
  /** 详情弹窗中的决策卡片 */
  const [detailCard, setDetailCard] = useState<DecisionCardType | null>(null)
  /** 详情弹窗是否打开 */
  const [detailOpen, setDetailOpen] = useState(false)

  // ===== 数据加载 =====
  /** 加载历史决策列表 */
  const loadDecisions = useCallback(async () => {
    if (!isElectronAPIAvailable()) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const offset = (currentPage - 1) * PAGE_SIZE
      const list = await window.electronAPI.historyList(offset, PAGE_SIZE * 5)
      setDecisions(list)
    } catch (error) {
      console.error('加载历史决策失败:', error)
      message.error('加载历史决策失败')
    } finally {
      setLoading(false)
    }
  }, [currentPage])

  /** 初始加载和页码变化时重新加载 */
  useEffect(() => {
    void loadDecisions()
  }, [loadDecisions])

  // ===== 过滤逻辑 =====
  /** 过滤后的决策列表 */
  const filteredDecisions = decisions.filter((card) => {
    // 关键词过滤（匹配问题描述或根因假设）
    if (searchKeyword.trim()) {
      const keyword = searchKeyword.toLowerCase()
      const matchProblem = card.problem.toLowerCase().includes(keyword)
      const matchHypothesis = card.hypothesis.toLowerCase().includes(keyword)
      if (!matchProblem && !matchHypothesis) return false
    }
    // 风险等级过滤
    if (riskFilter !== 'ALL' && card.risk.level !== riskFilter) return false
    return true
  })

  // ===== 分页计算 =====
  /** 当前页的数据切片 */
  const pageStart = (currentPage - 1) * PAGE_SIZE
  const pageEnd = pageStart + PAGE_SIZE
  const currentPageData = filteredDecisions.slice(pageStart, pageEnd)
  const totalCount = filteredDecisions.length

  // ===== 事件处理 =====
  /** 点击卡片查看详情 */
  const handleCardClick = useCallback(async (card: DecisionCardType) => {
    setDetailOpen(true)
    setDetailCard(card)
    // 尝试获取最新详情
    if (!isElectronAPIAvailable()) return
    try {
      const fresh = await window.electronAPI.historyGet(card.id)
      if (fresh) {
        setDetailCard(fresh)
      }
    } catch {
      // 获取失败时使用列表中的数据
    }
  }, [])

  /** 搜索框变化 */
  const handleSearchChange = useCallback((value: string) => {
    setSearchKeyword(value)
    setCurrentPage(1)
  }, [])

  /** 风险等级过滤变化 */
  const handleRiskFilterChange = useCallback((value: RiskLevel | 'ALL') => {
    setRiskFilter(value)
    setCurrentPage(1)
  }, [])

  /** 页码变化 */
  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page)
  }, [])

  /** 格式化时间 */
  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp)
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="history-page">
      {/* ===== 搜索栏 ===== */}
      <div className="history-toolbar">
        <Input
          placeholder="搜索问题描述或根因..."
          prefix={<SearchOutlined />}
          value={searchKeyword}
          onChange={(e) => handleSearchChange(e.target.value)}
          allowClear
          className="history-search"
        />
        <Select
          value={riskFilter}
          onChange={handleRiskFilterChange}
          className="history-risk-filter"
          options={[
            { value: 'ALL', label: '全部风险' },
            { value: 'SAFE', label: '安全' },
            { value: 'LOW', label: '低风险' },
            { value: 'MEDIUM', label: '中风险' },
            { value: 'HIGH', label: '高风险' },
            { value: 'CRITICAL', label: '极高风险' },
          ]}
        />
      </div>

      {/* ===== 决策列表 ===== */}
      <div className="history-list">
        {loading ? (
          <div className="history-loading">
            <Spin tip="加载中..." />
          </div>
        ) : currentPageData.length === 0 ? (
          <Empty description="暂无历史决策记录" />
        ) : (
          <StaggerList
            stagger={40}
            duration={220}
            className="history-card-list"
          >
            {currentPageData.map((card) => (
              <div
                key={card.id}
                className="history-card-item"
                onClick={() => void handleCardClick(card)}
              >
              {/* 左侧：问题信息 */}
              <div className="history-card-main">
                <div className="history-card-problem text-ellipsis">{card.problem}</div>
                <div className="history-card-meta">
                  <span className="history-card-time">{formatTime(card.timestamp)}</span>
                  <span className="history-card-status">
                    {STATUS_LABEL_MAP[card.status] ?? card.status}
                  </span>
                </div>
              </div>
              {/* 右侧：标签 */}
              <div className="history-card-tags">
                <Tag color={RISK_COLOR_MAP[card.risk.level]}>
                  {RISK_LABEL_MAP[card.risk.level]}
                </Tag>
                <span className="history-card-confidence">
                  置信度 {(card.confidence * 100).toFixed(0)}%
                </span>
              </div>
            </div>
          ))}
          </StaggerList>
        )}
      </div>

      {/* ===== 分页器 ===== */}
      {totalCount > 0 && (
        <div className="history-pagination">
          <Pagination
            current={currentPage}
            pageSize={PAGE_SIZE}
            total={totalCount}
            onChange={handlePageChange}
            showSizeChanger={false}
            showTotal={(total) => `共 ${total} 条`}
            size="small"
          />
        </div>
      )}

      {/* ===== 详情弹窗 ===== */}
      <Modal
        title="决策详情"
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={640}
        className="history-detail-modal"
      >
        {detailCard && <DecisionCard card={detailCard} />}
      </Modal>
    </div>
  )
}

export default HistoryPage
