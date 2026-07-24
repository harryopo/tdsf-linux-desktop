/**
 * 系统架构感知对话框 - ProfilerDialog
 *
 * 职责：
 * - 用户右键"感知系统"后弹出
 * - 异步调用 profiler:run 拉取 27 项探查 + 风险检测结果
 * - 展示风险概览（按等级分组的卡片）
 * - 展示 md 报告（可编辑、滚动）
 * - 一键导出 md / pdf 文件
 *
 * 视觉风格：
 * - 顶部风险状态条（绿色=安全 / 黄色=有低中危 / 红色=有高危）
 * - 中部风险卡片（按等级色彩区分）
 * - 底部 md 报告（等宽字体）
 * - 底部固定操作栏（复制 / 导出 md / 导出 pdf）
 */
import { useEffect, useState, useCallback, useRef } from 'react'
import { Modal, Button, Tag, message, Space, Spin, Alert } from 'antd'
import {
  ReloadOutlined,
  FileTextOutlined,
  FilePdfOutlined,
  CopyOutlined,
  DownloadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  WarningOutlined,
  WarningFilled,
  ExclamationCircleOutlined,
  InfoCircleOutlined,
  BulbOutlined,
  BarChartOutlined,
  ClockCircleOutlined,
  RocketOutlined,
} from '@ant-design/icons'
import { isElectronAPIAvailable } from '../../utils/electron-api'
import { StaggerList } from '../common'
import type { ProfilerRunResponse, ProfilerRiskLevel, RiskItem } from '@shared/models'
import './ProfilerDialog.css'

// ==================================================================
// 常量
// ==================================================================

/** 风险等级颜色映射（与 risk-detector 保持视觉一致） */
const RISK_COLORS: Record<
  ProfilerRiskLevel,
  { bg: string; border: string; text: string; icon: React.ReactNode }
> = {
  critical: { bg: 'var(--trae-status-error-surface-l1)', border: 'var(--trae-status-error-default)', text: 'var(--trae-status-error-default)', icon: <WarningFilled /> },
  high:     { bg: 'var(--trae-status-warning-surface-l1)', border: 'var(--trae-status-alert-default)', text: 'var(--trae-status-alert-default)', icon: <WarningOutlined /> },
  medium:   { bg: 'var(--trae-status-alert-surface-l1)', border: 'var(--trae-status-alert-default)', text: 'var(--trae-status-alert-default)', icon: <ExclamationCircleOutlined /> },
  low:      { bg: 'var(--trae-status-success-surface-l1)', border: 'var(--trae-status-success-default)', text: 'var(--trae-status-success-default)', icon: <BulbOutlined /> },
  info:     { bg: 'var(--trae-status-primary-surface-l1)', border: 'var(--trae-bg-brand)', text: 'var(--trae-bg-brand)', icon: <InfoCircleOutlined /> }
}

/** 风险等级中文标签 */
const RISK_LABELS: Record<ProfilerRiskLevel, string> = {
  critical: '严重',
  high: '高',
  medium: '中',
  low: '低',
  info: '提示'
}

// ==================================================================
// 类型
// ==================================================================

export interface ProfilerDialogProps {
  /** 是否显示 */
  open: boolean
  /** SSH 会话 ID（必须已连接） */
  sessionId: string | null
  /** 主机标识（用于展示与生成文件名） */
  host: string
  /** 关闭回调 */
  onClose: () => void
}

// ==================================================================
// 组件
// ==================================================================

const ProfilerDialog: React.FC<ProfilerDialogProps> = ({ open, sessionId, host, onClose }) => {
  // ===== 状态 =====
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<ProfilerRunResponse | null>(null)
  const [editedMd, setEditedMd] = useState<string>('')
  const [exportingMd, setExportingMd] = useState(false)
  const [exportingPdf, setExportingPdf] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  /** 拉取一次完整探查 */
  const runProbe = useCallback(async () => {
    if (!sessionId) {
      message.error('会话未建立，无法探查')
      return
    }
    if (!isElectronAPIAvailable()) {
      message.error('electronAPI 不可用')
      return
    }
    setLoading(true)
    setData(null)
    try {
      const result = await window.electronAPI.profilerRun(sessionId, host)
      setData(result)
      setEditedMd(result.md)
      const s = result.summary
      if (s.total === 0) {
        message.success('系统探查完成，未发现风险')
      } else if (s.critical + s.high === 0) {
        message.warning(`探查完成，发现 ${s.total} 项风险（含 ${s.medium} 项中危）`)
      } else {
        message.error(`探查完成，发现 ${s.critical} 项严重 / ${s.high} 项高危风险`)
      }
    } catch (err) {
      message.error(`探查失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }, [sessionId, host])

  /** 打开对话框时自动触发一次探查 */
  useEffect(() => {
    if (open && sessionId) {
      void runProbe()
    }
    // 关闭时清空数据
    if (!open) {
      setData(null)
      setEditedMd('')
    }
  }, [open, sessionId, runProbe])

  /** 复制 md 到剪贴板 */
  const handleCopy = useCallback(async () => {
    if (!editedMd) return
    try {
      await navigator.clipboard.writeText(editedMd)
      message.success('已复制到剪贴板')
    } catch {
      // 后备方案：使用 textarea + execCommand
      const ta = document.createElement('textarea')
      ta.value = editedMd
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      message.success('已复制到剪贴板')
    }
  }, [editedMd])

  /** 导出 md 文件 */
  const handleExportMd = useCallback(async () => {
    if (!editedMd || !isElectronAPIAvailable()) return
    setExportingMd(true)
    try {
      const fileName = await window.electronAPI.profilerDefaultFileName(host, 'md')
      // 通过 a 标签下载（简单方案，无需 dialog）
      const blob = new Blob([editedMd], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      message.success(`已导出 ${fileName}`)
    } catch (err) {
      message.error(`导出失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setExportingMd(false)
    }
  }, [editedMd, host])

  /** 导出 PDF 文件 */
  const handleExportPdf = useCallback(async () => {
    if (!editedMd || !isElectronAPIAvailable()) return
    setExportingPdf(true)
    try {
      const fileName = await window.electronAPI.profilerDefaultFileName(host, 'pdf')
      // 下载到用户下载目录
      const result = await window.electronAPI.profilerExportPdf(editedMd, fileName)
      message.success(`已导出 PDF: ${result.filePath}（${(result.size / 1024).toFixed(1)} KB）`)
    } catch (err) {
      message.error(`导出 PDF 失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setExportingPdf(false)
    }
  }, [editedMd, host])

  /** 风险状态条 */
  const renderRiskBanner = () => {
    if (!data) return null
    const s = data.summary
    if (s.total === 0) {
      return (
        <Alert
          className="profiler-banner-safe"
          type="success"
          showIcon
          icon={<CheckCircleOutlined />}
          message="系统探查完成 — 未发现风险"
          description={`共 ${data.result.items.length} 项探查 · 耗时 ${(data.result.totalDurationMs / 1000).toFixed(2)} 秒 · 数据来源 ${data.result.host}`}
        />
      )
    }
    const dangerCount = s.critical + s.high
    if (dangerCount > 0) {
      return (
        <Alert
          className="profiler-banner-danger"
          type="error"
          showIcon
          icon={<WarningOutlined />}
          message={`发现 ${dangerCount} 项严重 / 高危风险`}
          description={`共 ${s.total} 项风险（严重 ${s.critical} / 高 ${s.high} / 中 ${s.medium} / 低 ${s.low} / 提示 ${s.info}），请查看下方详情`}
        />
      )
    }
    return (
      <Alert
        className="profiler-banner-warn"
        type="warning"
        showIcon
        icon={<WarningOutlined />}
        message={`发现 ${s.total} 项中低风险`}
        description={`严重 0 / 高 0 / 中 ${s.medium} / 低 ${s.low} / 提示 ${s.info}，建议关注但暂不阻塞`}
      />
    )
  }

  /** 风险卡片列表 */
  const renderRiskCards = () => {
    if (!data || data.risks.length === 0) return null
    return (
      <StaggerList
        className="profiler-risks"
        stagger={60}
        duration={220}
      >
        {data.risks.map((risk: RiskItem, idx: number) => {
          const c = RISK_COLORS[risk.level]
          return (
            <div
              key={idx}
              className="profiler-risk-card"
              style={{ background: c.bg, borderLeft: `4px solid ${c.border}` }}
            >
              <div className="profiler-risk-card-head">
                <span className="profiler-risk-icon" style={{ color: c.border }}>{c.icon}</span>
                <Tag color={c.border}>{RISK_LABELS[risk.level]}</Tag>
                <span className="profiler-risk-title">{risk.title}</span>
                <span className="profiler-risk-category">· {risk.category}</span>
              </div>
              <div className="profiler-risk-desc">{risk.description}</div>
              <div className="profiler-risk-section">
                <div className="profiler-risk-section-label">
                  <FileTextOutlined style={{ marginRight: 4 }} />
                  证据：
                </div>
                <pre className="profiler-risk-evidence">{risk.evidence}</pre>
              </div>
              <div className="profiler-risk-section">
                <div className="profiler-risk-section-label">
                  <BulbOutlined style={{ marginRight: 4 }} />
                  建议：
                </div>
                <div className="profiler-risk-suggestion">{risk.suggestion}</div>
              </div>
            </div>
          )
        })}
      </StaggerList>
    )
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={960}
      destroyOnClose
      title={
        <Space>
          <RocketOutlined style={{ color: 'var(--trae-bg-brand)' }} />
          <span>系统架构感知 — {host}</span>
        </Space>
      }
      footer={
        <div className="profiler-footer">
          <Space>
            <Button
              icon={<ReloadOutlined />}
              onClick={runProbe}
              loading={loading}
              disabled={!sessionId}
            >
              重新探查
            </Button>
          </Space>
          <Space>
            <Button
              icon={<CopyOutlined />}
              onClick={handleCopy}
              disabled={!editedMd}
            >
              复制
            </Button>
            <Button
              icon={<FileTextOutlined />}
              onClick={handleExportMd}
              loading={exportingMd}
              disabled={!editedMd}
            >
              导出 md
            </Button>
            <Button
              icon={<FilePdfOutlined />}
              onClick={handleExportPdf}
              loading={exportingPdf}
              disabled={!editedMd}
              type="primary"
            >
              导出 PDF
            </Button>
            <Button onClick={onClose}>关闭</Button>
          </Space>
        </div>
      }
      className="profiler-dialog"
    >
      {loading && (
        <div className="profiler-loading">
          <Spin size="large" />
          <p>正在执行 27 项系统探查（约 3-5 秒）...</p>
        </div>
      )}

      {!loading && data && (
        <>
          {renderRiskBanner()}

          {/* 风险卡片（仅在有风险时显示） */}
          {data.risks.length > 0 && (
            <div className="profiler-section">
              <h3 className="profiler-section-title">
                <BarChartOutlined style={{ marginRight: 8 }} />
                风险详情（{data.risks.length}）
              </h3>
              {renderRiskCards()}
            </div>
          )}

          {/* md 报告（可编辑） */}
          <div className="profiler-section">
            <h3 className="profiler-section-title">
              <FileTextOutlined style={{ marginRight: 8 }} />
              Markdown 报告（可编辑）
              <Tag color="blue" style={{ marginLeft: 8 }}>
                {editedMd.length} 字符
              </Tag>
            </h3>
            <textarea
              ref={textareaRef}
              className="profiler-md-editor"
              value={editedMd}
              onChange={(e) => setEditedMd(e.target.value)}
              spellCheck={false}
            />
          </div>

          {/* 探查统计 */}
          <div className="profiler-stats">
            <Space size="large">
              <span>
                <DownloadOutlined /> 共 <b>{data.result.items.length}</b> 项探查
              </span>
              <span style={{ color: 'var(--trae-status-success-default)' }}>
                <CheckCircleOutlined /> 成功 <b>{data.result.items.length - data.result.errors.length}</b>
              </span>
              {data.result.errors.length > 0 && (
                <span style={{ color: 'var(--trae-status-error-default)' }}>
                  <CloseCircleOutlined /> 失败 <b>{data.result.errors.length}</b>
                </span>
              )}
              <span>
                <ClockCircleOutlined /> 耗时 <b>{(data.result.totalDurationMs / 1000).toFixed(2)}s</b>
              </span>
            </Space>
          </div>
        </>
      )}

      {!loading && !data && (
        <Alert
          type="info"
          message="点击「重新探查」开始采集系统信息"
          showIcon
        />
      )}
    </Modal>
  )
}

export default ProfilerDialog
