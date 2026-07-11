/**
 * 证据链可视化组件 - EvidenceChain
 *
 * 职责：
 * - 展示 DecisionCard 的 evidences 数组
 * - 每条证据显示：来源图标 / 来源标签 / 内容 / 置信度进度条
 * - 置信度颜色编码（绿色≥0.7 / 黄色≥0.5 / 红色<0.5）
 * - 证据支持展开/收起详情
 * - Ground-Check 验证状态可视化（✓ 已验证 / ⚠ 未验证）
 *
 * 苹果极简风格：细线条卡片，大量留白
 */
import { useState } from 'react'
import { Tag, Tooltip, Progress } from 'antd'
import {
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  DownOutlined,
  UpOutlined,
  FileTextOutlined,
  BarChartOutlined,
  CodeOutlined,
  SettingOutlined,
  BookOutlined,
} from '@ant-design/icons'
import type { Evidence, EvidenceSource } from '@shared/models'
import './EvidenceChain.css'

/** EvidenceChain 组件 Props */
interface EvidenceChainProps {
  /** 证据列表 */
  evidences: Evidence[]
}

/** 证据来源中文标签 */
const SOURCE_LABELS: Record<EvidenceSource, string> = {
  log: '日志',
  metric: '指标',
  command: '命令',
  config: '配置',
  knowledge: '知识库',
}

/** 证据来源颜色 */
const SOURCE_COLORS: Record<EvidenceSource, string> = {
  log: 'blue',
  metric: 'cyan',
  command: 'green',
  config: 'orange',
  knowledge: 'purple',
}

/** 证据来源图标 */
const SOURCE_ICONS: Record<EvidenceSource, React.ReactNode> = {
  log: <FileTextOutlined />,
  metric: <BarChartOutlined />,
  command: <CodeOutlined />,
  config: <SettingOutlined />,
  knowledge: <BookOutlined />,
}

/**
 * 根据置信度获取颜色
 * - 绿色 ≥ 0.7
 * - 黄色 ≥ 0.5
 * - 红色 < 0.5
 */
const getConfidenceColor = (confidence: number): string => {
  if (confidence >= 0.7) return '#34c759'
  if (confidence >= 0.5) return '#ff9500'
  return '#ff3b30'
}

/** 根据置信度获取进度条状态 */
const getConfidenceStatus = (confidence: number): 'success' | 'normal' | 'exception' => {
  if (confidence >= 0.7) return 'success'
  if (confidence >= 0.5) return 'normal'
  return 'exception'
}

/** EvidenceChain 证据链可视化 */
const EvidenceChain: React.FC<EvidenceChainProps> = ({ evidences }) => {
  /** 当前展开的证据 ID */
  const [expandedId, setExpandedId] = useState<string | null>(null)

  /** 切换展开/折叠 */
  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id)
  }

  if (evidences.length === 0) {
    return (
      <div className="evidence-chain-empty">
        <ExclamationCircleOutlined style={{ color: '#86868b' }} />
        <span>暂无证据</span>
      </div>
    )
  }

  return (
    <div className="evidence-chain">
      {evidences.map((evidence, index) => {
        const isExpanded = expandedId === evidence.id
        const confidenceColor = getConfidenceColor(evidence.confidence)
        const confidencePercent = Math.round(evidence.confidence * 100)
        return (
          <div
            key={evidence.id}
            className={`evidence-item ${isExpanded ? 'expanded' : ''} ${
              evidence.verified ? 'verified' : 'unverified'
            }`}
            onClick={() => toggleExpand(evidence.id)}
          >
            {/* 证据头部 */}
            <div className="evidence-header">
              {/* 序号 */}
              <span className="evidence-index">{index + 1}</span>

              {/* 来源图标 */}
              <span className="evidence-source-icon" title={SOURCE_LABELS[evidence.source]}>
                {SOURCE_ICONS[evidence.source]}
              </span>

              {/* 来源标签 */}
              <Tag color={SOURCE_COLORS[evidence.source]} className="evidence-source-tag">
                {SOURCE_LABELS[evidence.source]}
              </Tag>

              {/* 来源详情 */}
              <span className="evidence-source-detail text-ellipsis">
                {evidence.sourceDetail}
              </span>

              {/* Ground-Check 状态 */}
              <Tooltip title={evidence.verified ? '已通过 Ground-Check' : '未通过 Ground-Check'}>
                <span
                  className={`evidence-verify-badge ${evidence.verified ? 'verified' : 'unverified'}`}
                >
                  {evidence.verified ? (
                    <>
                      <CheckCircleOutlined /> 已验证
                    </>
                  ) : (
                    <>
                      <ExclamationCircleOutlined /> 未验证
                    </>
                  )}
                </span>
              </Tooltip>

              {/* 展开/折叠图标 */}
              {isExpanded ? (
                <UpOutlined className="evidence-expand-icon" />
              ) : (
                <DownOutlined className="evidence-expand-icon" />
              )}
            </div>

            {/* 证据内容预览 */}
            <div className="evidence-content-preview text-ellipsis">
              {evidence.content}
            </div>

            {/* 置信度进度条 */}
            <div className="evidence-confidence-bar">
              <div className="evidence-confidence-label">
                <span>置信度</span>
                <span style={{ color: confidenceColor, fontWeight: 600 }}>
                  {confidencePercent}%
                </span>
              </div>
              <Progress
                percent={confidencePercent}
                size="small"
                showInfo={false}
                strokeColor={confidenceColor}
                status={getConfidenceStatus(evidence.confidence)}
              />
            </div>

            {/* 展开后的详情 */}
            {isExpanded && (
              <div className="evidence-detail">
                <div className="evidence-detail-row">
                  <span className="evidence-detail-label">完整内容</span>
                  <pre className="evidence-detail-content">{evidence.content}</pre>
                </div>
                <div className="evidence-detail-row">
                  <span className="evidence-detail-label">Drain3 模板匹配度</span>
                  <span className="evidence-detail-value">
                    {(evidence.drainMatch * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="evidence-detail-row">
                  <span className="evidence-detail-label">来源先验可信度</span>
                  <span className="evidence-detail-value">
                    {(evidence.sourcePrior * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="evidence-detail-row">
                  <span className="evidence-detail-label">综合置信度</span>
                  <span className="evidence-detail-value" style={{ color: confidenceColor }}>
                    {(evidence.confidence * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="evidence-detail-row">
                  <span className="evidence-detail-label">Ground-Check</span>
                  <span
                    className="evidence-detail-value"
                    style={{ color: evidence.verified ? '#34c759' : '#ff3b30' }}
                  >
                    {evidence.verified ? '✓ 已验证' : '⚠ 未验证'}
                  </span>
                </div>
                <div className="evidence-detail-row">
                  <span className="evidence-detail-label">时间戳</span>
                  <span className="evidence-detail-value">
                    {new Date(evidence.timestamp).toLocaleString('zh-CN')}
                  </span>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default EvidenceChain
