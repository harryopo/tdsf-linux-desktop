/**
 * Web 部署助手对话框 - DeployDialog
 *
 * 职责：
 * - 左栏：模板选择卡片（LAMP / WordPress / Nginx / Docker）
 * - 右栏：变量填写 → 计划预览 → 实时执行日志
 * - 支持按风险等级二次确认（high/critical）
 * - 实时展示每步命令的 stdout / stderr 输出
 *
 * 状态机：
 *   closed → selectTemplate → fillVariables → planPreview → running → done
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import { Modal, Button, Input, InputNumber, Tag, Space, Alert, message, Spin, Tooltip, Empty } from 'antd'
import {
  RocketOutlined,
  CheckCircleOutlined,
  CheckCircleFilled,
  CloseCircleOutlined,
  CloseCircleFilled,
  LoadingOutlined,
  WarningOutlined,
  ExclamationCircleOutlined,
  MinusCircleOutlined,
  CopyOutlined,
  PlayCircleOutlined,
  StopOutlined,
  RightOutlined,
  CodeOutlined,
  ClockCircleOutlined,
  FileTextOutlined,
  SettingOutlined,
  DatabaseOutlined,
  DesktopOutlined,
  StarFilled,
  ApiOutlined,
} from '@ant-design/icons'
import { isElectronAPIAvailable } from '../../utils/electron-api'
import { StaggerList } from '../common'
import type {
  DeployTemplate as DeployTemplateModel,
  DeployPlan,
  DeployStepResult,
  DeployResult,
  DeployLogEvent,
} from '@shared/deploy-types'
import { DEPLOY_RISK_LABELS, DEPLOY_RISK_COLORS, DEPLOY_RISK_ICON_NAMES } from '@shared/deploy-types'
import './DeployDialog.css'

/** 部署风险等级 → Ant Design 图标组件（统一图标语言） */
const RISK_ICON_MAP: Record<string, React.ReactNode> = {
  'check-circle': <CheckCircleFilled />,
  'minus-circle': <MinusCircleOutlined />,
  'exclamation-circle': <ExclamationCircleOutlined />,
  'warning': <WarningOutlined />,
  'close-circle': <CloseCircleFilled />,
}

/** 部署模板分类 → Ant Design 图标（v0.7.0：去 emoji 统一图标语言） */
const CATEGORY_ICON_MAP: Record<string, React.ReactNode> = {
  'web-server': <DesktopOutlined />,
  'database': <DatabaseOutlined />,
  'containers': <ApiOutlined />,
  'proxy': <ApiOutlined />,
}

/** 获取模板分类对应的图标 */
function getTemplateIcon(category: string): React.ReactNode {
  return CATEGORY_ICON_MAP[category] ?? <RocketOutlined />
}

/** DeployDialog Props */
export interface DeployDialogProps {
  open: boolean
  sessionId: string | null
  host: string
  onClose: () => void
}

// ==================================================================
// 组件
// ==================================================================

const DeployDialog: React.FC<DeployDialogProps> = ({ open, sessionId, host, onClose }) => {
  // ===== 模板列表 =====
  const [templates, setTemplates] = useState<DeployTemplateModel[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<DeployTemplateModel | null>(null)
  const [loadingTemplates, setLoadingTemplates] = useState(false)

  // ===== 变量 =====
  const [values, setValues] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<string[]>([])

  // ===== 计划 + 执行 =====
  const [plan, setPlan] = useState<DeployPlan | null>(null)
  const [stepResults, setStepResults] = useState<DeployStepResult[]>([])
  const [running, setRunning] = useState(false)
  const [logs, setLogs] = useState<Array<{ stepId: string; stream: string; data: string }>>([])
  const [finalResult, setFinalResult] = useState<DeployResult | null>(null)

  const logRef = useRef<HTMLDivElement>(null)

  /** 加载模板列表 */
  const loadTemplates = useCallback(async () => {
    if (!isElectronAPIAvailable()) return
    setLoadingTemplates(true)
    try {
      const list = await window.electronAPI.deployListTemplates()
      setTemplates(list)
    } catch (err) {
      message.error(`加载模板失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoadingTemplates(false)
    }
  }, [])

  /** 打开时加载模板 */
  useEffect(() => {
    if (open) {
      void loadTemplates()
    } else {
      // 关闭时清理状态
      setSelectedTemplate(null)
      setValues({})
      setErrors([])
      setPlan(null)
      setStepResults([])
      setRunning(false)
      setLogs([])
      setFinalResult(null)
    }
  }, [open, loadTemplates])

  /** 选中模板时初始化变量默认值 */
  useEffect(() => {
    if (selectedTemplate) {
      const init: Record<string, string> = {}
      for (const v of selectedTemplate.variables) {
        init[v.name] = v.defaultValue
      }
      setValues(init)
      setErrors([])
    }
  }, [selectedTemplate])

  // ===== 事件订阅 =====
  useEffect(() => {
    if (!open || !isElectronAPIAvailable()) return

    const offLog = window.electronAPI.onDeployLog((event: DeployLogEvent) => {
      // 仅追加当前计划的日志
      if (plan && event.planId !== plan.id) return
      setLogs((prev) => [...prev, { stepId: event.stepId, stream: event.stream, data: event.data }])
    })
    const offStep = window.electronAPI.onDeployStepUpdate((payload) => {
      if (plan && payload.planId !== plan.id) return
      setStepResults((prev) => {
        const idx = prev.findIndex((r) => r.stepId === payload.step.stepId)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = payload.step
          return next
        }
        return [...prev, payload.step]
      })
    })
    const offDone = window.electronAPI.onDeployDone((result: DeployResult) => {
      if (plan && result.planId !== plan.id) return
      setFinalResult(result)
      setRunning(false)
      if (result.status === 'success') {
        message.success(`部署成功！耗时 ${(result.totalDurationMs / 1000).toFixed(1)} 秒`)
      } else if (result.status === 'cancelled') {
        message.warning('部署已取消')
      } else {
        message.error('部署失败，请查看日志')
      }
    })

    return () => {
      offLog()
      offStep()
      offDone()
    }
  }, [open, plan])

  /** 自动滚动日志到底部 */
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs])

  /** 构建计划 */
  const handleBuild = useCallback(async () => {
    if (!selectedTemplate) return
    if (!isElectronAPIAvailable()) {
      message.error('electronAPI 不可用')
      return
    }
    try {
      const result = await window.electronAPI.deployBuild(
        selectedTemplate.id,
        values,
        host
      )
      if (result.errors.length > 0) {
        setErrors(result.errors)
        message.error('请修正变量后再继续')
        return
      }
      setErrors([])
      if (result.plan) {
        setPlan(result.plan)
        setStepResults([])
        setLogs([])
        setFinalResult(null)
        message.success('部署计划已生成')
      }
    } catch (err) {
      message.error(`生成计划失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [selectedTemplate, values, host])

  /** 执行计划 */
  const handleExecute = useCallback(async () => {
    if (!plan || !sessionId) return
    if (!isElectronAPIAvailable()) return
    setRunning(true)
    setFinalResult(null)
    try {
      // execute 返回完整结果（事件同时推送）
      await window.electronAPI.deployExecute(plan, sessionId)
      // 状态由 deploy:done 事件更新
    } catch (err) {
      setRunning(false)
      message.error(`部署失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [plan, sessionId])

  /** 取消执行 */
  const handleCancel = useCallback(async () => {
    if (!plan) return
    try {
      const ok = await window.electronAPI.deployCancel(plan.id)
      if (ok) {
        message.warning('已请求取消，等待当前步骤完成...')
      }
    } catch (err) {
      message.error(`取消失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [plan])

  /** 复制命令到剪贴板 */
  const copyCommands = useCallback(() => {
    if (!plan) return
    const text = plan.steps.map((s) => `# ${s.description}\n${s.command}`).join('\n\n')
    navigator.clipboard.writeText(text).then(
      () => message.success('已复制全部命令'),
      () => message.error('复制失败')
    )
  }, [plan])

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={1080}
      destroyOnClose
      title={
        <Space>
          <RocketOutlined style={{ color: 'var(--trae-bg-brand)' }} />
          <span>Web 部署助手 — {host}</span>
        </Space>
      }
      footer={
        <div className="deploy-footer">
          <Space>
            <Button onClick={onClose}>关闭</Button>
          </Space>
          <Space>
            {!plan && (
              <Button
                type="primary"
                icon={<RightOutlined />}
                onClick={handleBuild}
                disabled={!selectedTemplate}
              >
                生成部署计划
              </Button>
            )}
            {plan && !running && !finalResult && (
              <>
                <Button icon={<CopyOutlined />} onClick={copyCommands}>
                  复制全部命令
                </Button>
                <Button onClick={() => setPlan(null)}>返回修改</Button>
                <Button
                  type="primary"
                  danger
                  icon={<PlayCircleOutlined />}
                  onClick={handleExecute}
                  disabled={!sessionId}
                >
                  一键部署
                </Button>
              </>
            )}
            {running && (
              <Button danger icon={<StopOutlined />} onClick={handleCancel}>
                停止
              </Button>
            )}
            {finalResult && (
              <Button
                icon={<RocketOutlined />}
                onClick={() => {
                  setPlan(null)
                  setStepResults([])
                  setLogs([])
                  setFinalResult(null)
                }}
              >
                重新部署
              </Button>
            )}
          </Space>
        </div>
      }
      className="deploy-dialog"
    >
      {!sessionId && (
        <Alert
          type="error"
          message="请先连接服务器"
          description="Web 部署助手需要有效的 SSH 会话"
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}

      <div className="deploy-body">
        {/* ===== 左栏：模板列表 ===== */}
        <div className="deploy-templates">
          <div className="deploy-templates-header">
            <span>
              <RocketOutlined style={{ marginRight: 6 }} />
              部署模板
            </span>
            <Tag color="blue">{templates.length}</Tag>
          </div>
          {loadingTemplates ? (
            <div className="deploy-templates-loading">
              <Spin size="small" />
            </div>
          ) : (
            <StaggerList
              className="deploy-templates-list"
              stagger={50}
              duration={220}
            >
              {templates.map((t) => (
                <div
                  key={t.id}
                  className={`deploy-template-card ${selectedTemplate?.id === t.id ? 'active' : ''}`}
                  onClick={() => !running && setSelectedTemplate(t)}
                >
                  <div className="deploy-template-card-head">
                    <span className="deploy-template-icon">{getTemplateIcon(t.category)}</span>
                    <span className="deploy-template-name">{t.name}</span>
                    <Tag color="orange">
                      {Array.from({ length: t.difficulty }).map((_, i) => (
                        <StarFilled key={i} style={{ marginRight: 2 }} />
                      ))}
                    </Tag>
                  </div>
                  <div className="deploy-template-summary">{t.summary}</div>
                  <div className="deploy-template-meta">
                    <span><CodeOutlined /> {t.steps.length} 步</span>
                    <span><ClockCircleOutlined /> ~{t.estimatedMinutes} 分</span>
                  </div>
                </div>
              ))}
            </StaggerList>
          )}
        </div>

        {/* ===== 右栏：详情区 ===== */}
        <div className="deploy-detail">
          {!selectedTemplate && (
            <div className="deploy-detail-empty">
              <Empty description="请在左侧选择部署模板" />
            </div>
          )}

          {selectedTemplate && !plan && (
            <div className="deploy-variables">
              <div className="deploy-variables-header">
                <h3>
                  <SettingOutlined style={{ marginRight: 6 }} />
                  配置参数
                </h3>
                <Tag color="blue">{selectedTemplate.variables.length} 项</Tag>
              </div>

              {errors.length > 0 && (
                <Alert
                  type="error"
                  message="变量校验失败"
                  description={
                    <ul style={{ margin: 0, paddingLeft: 20 }}>
                      {errors.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  }
                  showIcon
                  style={{ marginBottom: 12 }}
                />
              )}

              <div className="deploy-variables-form">
                {selectedTemplate.variables.map((v) => (
                  <div key={v.name} className="deploy-variable-item">
                    <label className="deploy-variable-label">
                      {v.label}
                      {v.required && <span className="deploy-required">*</span>}
                    </label>
                    {v.type === 'password' ? (
                      <Input.Password
                        value={values[v.name] ?? ''}
                        onChange={(e) => setValues({ ...values, [v.name]: e.target.value })}
                        placeholder={v.placeholder}
                        disabled={running}
                      />
                    ) : v.type === 'number' || v.type === 'port' ? (
                      <InputNumber
                        value={parseInt(values[v.name] ?? '0', 10)}
                        onChange={(val) => setValues({ ...values, [v.name]: String(val ?? 0) })}
                        disabled={running}
                        style={{ width: '100%' }}
                      />
                    ) : (
                      <Input
                        value={values[v.name] ?? ''}
                        onChange={(e) => setValues({ ...values, [v.name]: e.target.value })}
                        placeholder={v.placeholder}
                        disabled={running}
                      />
                    )}
                    {v.helpText && <div className="deploy-variable-help">{v.helpText}</div>}
                  </div>
                ))}
              </div>

              <div className="deploy-steps-preview">
                <h4>
                  <ApiOutlined style={{ marginRight: 6 }} />
                  即将执行 {selectedTemplate.steps.length} 个步骤
                </h4>
                <div className="deploy-steps-list">
                  {selectedTemplate.steps.map((s, i) => (
                    <div key={s.id} className="deploy-step-row">
                      <span className="deploy-step-num">{i + 1}</span>
                      <div className="deploy-step-info">
                        <div className="deploy-step-desc">{s.description}</div>
                        <div className="deploy-step-cmd">{s.command}</div>
                      </div>
                      <Tag color={DEPLOY_RISK_COLORS[s.risk]}>
                        {RISK_ICON_MAP[DEPLOY_RISK_ICON_NAMES[s.risk]]} {DEPLOY_RISK_LABELS[s.risk]}
                      </Tag>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {plan && (
            <div className="deploy-plan">
              <div className="deploy-plan-header">
                <h3>
                  <FileTextOutlined style={{ marginRight: 6 }} />
                  {plan.templateName} — 执行计划
                </h3>
                <Space>
                  <Tag color="blue">{plan.steps.length} 步</Tag>
                  {finalResult && (
                    <Tag
                      icon={finalResult.status === 'success' ? <CheckCircleFilled /> : <CloseCircleFilled />}
                      color={finalResult.status === 'success' ? 'green' : 'red'}
                    >
                      {finalResult.status === 'success' ? '成功' : '失败'}
                    </Tag>
                  )}
                  {running && <Tag color="processing" icon={<LoadingOutlined />}>执行中</Tag>}
                </Space>
              </div>

              {/* 步骤结果列表 */}
              <div className="deploy-plan-steps">
                {plan.steps.map((s, i) => {
                  const result = stepResults.find((r) => r.stepId === s.id)
                  return (
                    <div key={s.id} className="deploy-plan-step">
                      <div className="deploy-plan-step-head">
                        <span className="deploy-step-num">{i + 1}</span>
                        <span className="deploy-step-desc">{s.description}</span>
                        {result ? (
                          result.status === 'success' ? (
                            <CheckCircleOutlined style={{ color: 'var(--trae-status-success-default)' }} />
                          ) : result.status === 'failed' ? (
                            <CloseCircleOutlined style={{ color: 'var(--trae-status-error-default)' }} />
                          ) : result.status === 'running' ? (
                            <LoadingOutlined style={{ color: 'var(--trae-bg-brand)' }} />
                          ) : (
                            <ClockCircleOutlined style={{ color: 'var(--trae-text-tertiary)' }} />
                          )
                        ) : running && i === stepResults.length ? (
                          <LoadingOutlined style={{ color: 'var(--trae-bg-brand)' }} />
                        ) : (
                          <ClockCircleOutlined style={{ color: 'var(--trae-text-tertiary)' }} />
                        )}
                        <Tag color={DEPLOY_RISK_COLORS[s.risk]}>
                          {RISK_ICON_MAP[DEPLOY_RISK_ICON_NAMES[s.risk]]} {DEPLOY_RISK_LABELS[s.risk]}
                        </Tag>
                      </div>
                      <div className="deploy-plan-step-cmd">
                        <code>{s.command}</code>
                      </div>
                      {result && result.status === 'failed' && result.error && (
                        <div className="deploy-plan-step-error">
                          <WarningOutlined /> {result.error}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* 实时日志 */}
              {logs.length > 0 && (
                <div className="deploy-logs">
                  <div className="deploy-logs-header">
                    <h4>
                      <PlayCircleOutlined style={{ marginRight: 6 }} />
                      实时日志
                    </h4>
                    <Tooltip title="复制日志">
                      <Button
                        size="small"
                        icon={<CopyOutlined />}
                        onClick={() => {
                          const text = logs.map((l) => l.data).join('')
                          navigator.clipboard.writeText(text)
                          message.success('已复制日志')
                        }}
                      />
                    </Tooltip>
                  </div>
                  <div ref={logRef} className="deploy-logs-body">
                    {logs.map((l, i) => (
                      <pre
                        key={i}
                        className={`deploy-log-line deploy-log-${l.stream}`}
                      >
                        {l.data}
                      </pre>
                    ))}
                  </div>
                </div>
              )}

              {/* 最终结果 */}
              {finalResult && (
                <Alert
                  className="deploy-result"
                  type={finalResult.status === 'success' ? 'success' : 'error'}
                  showIcon
                  icon={finalResult.status === 'success' ? <CheckCircleFilled /> : <CloseCircleFilled />}
                  message={
                    finalResult.status === 'success'
                      ? '部署完成！'
                      : finalResult.status === 'cancelled'
                      ? '部署已取消'
                      : '部署失败'
                  }
                  description={
                    <Space size="large" wrap>
                      <span>
                        <CheckCircleFilled style={{ color: 'var(--trae-status-success-default)', marginRight: 4 }} />
                        成功 <b>{finalResult.successCount}</b> 步
                      </span>
                      <span>
                        <CloseCircleFilled style={{ color: 'var(--trae-status-error-default)', marginRight: 4 }} />
                        失败 <b>{finalResult.failedCount}</b> 步
                      </span>
                      <span>
                        <ClockCircleOutlined style={{ marginRight: 4 }} />
                        总耗时 <b>{(finalResult.totalDurationMs / 1000).toFixed(1)}s</b>
                      </span>
                    </Space>
                  }
                />
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

export default DeployDialog
