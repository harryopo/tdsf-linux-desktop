/**
 * ExpectedOutput 预期回显对比面板（v0.9.4 批次 4 - 任务 5 P2-E）
 *
 * 改进点 25：将主进程 expectation-monitor.ts 的能力暴露给 UI。
 *
 * 设计思路（WHY）：
 * - expectation-monitor.ts 已实现 checkExpectation 纯函数，但主进程 Subagent
 *   尚未自动调用它（需要改 running-subagent，高风险，留给后续迭代）
 * - 本组件作为"交互式检查面板"消费 expectation:check IPC 通道，
 *   让用户手动触发预期对比，先打通 UI 接入闭环
 * - 未来 Subagent 自动调用 checkExpectation 后，可扩展为"被动展示"模式
 *
 * 功能：
 * - 折叠式面板（默认折叠，避免占用 UI 空间）
 * - 表单：命令 / mustContain / mustNotContain / 预期退出码 / 实际输出 / 实际退出码
 * - 一键"运行检查"按钮，调用 expectationCheck IPC
 * - 结果展示：符合预期（绿色）/ 违规（红色）+ 违规详情列表 + 时间戳
 *
 * 方案书依据：v0.9.4 §11 第 7 类（其他 3 项 - 任务 5）+ v0.9.5 §UI接入接线图
 */

import React, { useState, useCallback, useMemo } from 'react'
import { Button, Input, InputNumber, Tag, Tooltip, Collapse, Alert } from 'antd'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExperimentOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { isElectronAPIAvailable } from '../../utils/electron-api'
import type {
  CommandExpectation,
  ExpectationCheckResult,
  ExpectationViolation,
} from '@shared/agent-types'
import './ExpectedOutput.css'

const { TextArea } = Input

/** 违规类型 → 颜色映射 */
const VIOLATION_COLOR: Record<string, string> = {
  'missing-required': 'orange',
  'forbidden-found': 'red',
  'exit-code-mismatch': 'volcano',
  timeout: 'magenta',
}

/** 违规类型 → 中文标签映射 */
const VIOLATION_LABEL: Record<string, string> = {
  'missing-required': '缺失关键词',
  'forbidden-found': '出现禁止词',
  'exit-code-mismatch': '退出码不匹配',
  timeout: '命令超时',
}

/**
 * 将逗号分隔的字符串解析为数组
 *
 * @param input 逗号分隔的字符串（如 "nginx.conf, sites-enabled"）
 * @returns 字符串数组（空字符串被过滤）
 */
function parseKeywords(input: string): string[] {
  if (!input.trim()) return []
  return input
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/**
 * 格式化时间戳为本地时间字符串
 *
 * @param ts 时间戳（ms）
 * @returns 格式化后的时间字符串
 */
function formatTimestamp(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/**
 * 渲染单条违规
 *
 * @param violation 违规详情
 * @param index 索引
 */
function renderViolation(violation: ExpectationViolation, index: number): React.ReactNode {
  const color = VIOLATION_COLOR[violation.type] ?? 'default'
  const label = VIOLATION_LABEL[violation.type] ?? violation.type
  return (
    <div key={`violation-${index}`} className="expected-output-violation">
      <div className="expected-output-violation-header">
        <Tag color={color}>{label}</Tag>
        <span className="expected-output-violation-reason">{violation.reason}</span>
      </div>
      {violation.triggeredKeyword && (
        <div className="expected-output-violation-detail">
          <span className="expected-output-violation-label">触发关键词：</span>
          <code className="expected-output-violation-keyword">{violation.triggeredKeyword}</code>
        </div>
      )}
      {violation.actualExitCode !== undefined && (
        <div className="expected-output-violation-detail">
          <span className="expected-output-violation-label">实际退出码：</span>
          <code className="expected-output-violation-keyword">{violation.actualExitCode}</code>
        </div>
      )}
      {violation.actualOutputSnippet && (
        <div className="expected-output-violation-detail">
          <span className="expected-output-violation-label">输出片段：</span>
          <pre className="expected-output-violation-snippet">{violation.actualOutputSnippet}</pre>
        </div>
      )}
    </div>
  )
}

const ExpectedOutput: React.FC = () => {
  // ===== 表单状态 =====
  const [command, setCommand] = useState('')
  const [mustContain, setMustContain] = useState('')
  const [mustNotContain, setMustNotContain] = useState('')
  const [expectedExitCode, setExpectedExitCode] = useState<number | null>(0)
  const [actualOutput, setActualOutput] = useState('')
  const [actualExitCode, setActualExitCode] = useState<number | null>(0)

  // ===== 检查结果 =====
  const [result, setResult] = useState<ExpectationCheckResult | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ===== 是否可用 =====
  const available = useMemo(() => {
    return isElectronAPIAvailable() && !!window.electronAPI?.expectationCheck
  }, [])

  /**
   * 运行预期检查
   *
   * 调用 expectationCheck IPC，把表单输入组装为 CommandExpectation，
   * 传入实际输出与实际退出码，获取检查结果。
   */
  const handleCheck = useCallback(async () => {
    if (!available) {
      setError('IPC 不可用，无法运行检查')
      return
    }
    if (!command.trim()) {
      setError('请输入命令文本')
      return
    }
    if (actualExitCode === null) {
      setError('请输入实际退出码')
      return
    }

    setChecking(true)
    setError(null)

    try {
      const expectation: CommandExpectation = {
        command: command.trim(),
        mustContain: parseKeywords(mustContain),
        mustNotContain: parseKeywords(mustNotContain),
        expectedExitCode,
      }

      const checkResult = await window.electronAPI.expectationCheck(
        expectation,
        actualOutput,
        actualExitCode
      )

      setResult(checkResult)
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      setError(`检查失败：${reason}`)
      setResult(null)
    } finally {
      setChecking(false)
    }
  }, [available, command, mustContain, mustNotContain, expectedExitCode, actualOutput, actualExitCode])

  /**
   * 清空表单与结果
   */
  const handleReset = useCallback(() => {
    setCommand('')
    setMustContain('')
    setMustNotContain('')
    setExpectedExitCode(0)
    setActualOutput('')
    setActualExitCode(0)
    setResult(null)
    setError(null)
  }, [])

  /**
   * 加载示例（教学用途）
   *
   * 提供一个典型示例：检查 `ls /etc/nginx` 命令的输出是否包含 nginx.conf
   */
  const handleLoadExample = useCallback(() => {
    setCommand('ls /etc/nginx')
    setMustContain('nginx.conf')
    setMustNotContain('Permission denied, No such file or directory')
    setExpectedExitCode(0)
    setActualOutput('nginx.conf\nsites-enabled\nsites-available')
    setActualExitCode(0)
    setResult(null)
    setError(null)
  }, [])

  // 非 Electron 环境或 IPC 不可用时不渲染
  if (!available) return null

  return (
    <div className="expected-output-panel">
      <Collapse
        ghost
        size="small"
        className="expected-output-collapse"
        items={[
          {
            key: 'expected-output',
            label: (
              <span className="expected-output-collapse-label">
                <ExperimentOutlined className="expected-output-collapse-icon" />
                <span>预期回显对比</span>
                {result && (
                  <Tag
                    color={result.met ? 'success' : 'error'}
                    className="expected-output-collapse-tag"
                  >
                    {result.met ? '符合预期' : `${result.violations.length} 项违规`}
                  </Tag>
                )}
              </span>
            ),
            children: (
              <div className="expected-output-body">
                {/* 错误提示 */}
                {error && (
                  <Alert
                    type="error"
                    message={error}
                    showIcon
                    closable
                    onClose={() => setError(null)}
                    className="expected-output-alert"
                  />
                )}

                {/* 表单 */}
                <div className="expected-output-form">
                  <div className="expected-output-form-row">
                    <label className="expected-output-form-label">命令文本</label>
                    <Input
                      value={command}
                      onChange={(e) => setCommand(e.target.value)}
                      placeholder="如：ls /etc/nginx"
                      className="expected-output-form-input"
                    />
                  </div>

                  <div className="expected-output-form-row">
                    <label className="expected-output-form-label">
                      必须包含的关键词
                      <Tooltip title="逗号分隔，任一匹配即视为符合预期">
                        <span className="expected-output-form-hint">（逗号分隔，任一匹配即可）</span>
                      </Tooltip>
                    </label>
                    <Input
                      value={mustContain}
                      onChange={(e) => setMustContain(e.target.value)}
                      placeholder="如：nginx.conf, sites-enabled"
                      className="expected-output-form-input"
                    />
                  </div>

                  <div className="expected-output-form-row">
                    <label className="expected-output-form-label">
                      禁止包含的关键词
                      <Tooltip title="逗号分隔，任一匹配即视为违反预期">
                        <span className="expected-output-form-hint">（逗号分隔，任一匹配即违反）</span>
                      </Tooltip>
                    </label>
                    <Input
                      value={mustNotContain}
                      onChange={(e) => setMustNotContain(e.target.value)}
                      placeholder="如：Permission denied, command not found"
                      className="expected-output-form-input"
                    />
                  </div>

                  <div className="expected-output-form-row expected-output-form-row-inline">
                    <div className="expected-output-form-field">
                      <label className="expected-output-form-label">预期退出码</label>
                      <InputNumber
                        value={expectedExitCode}
                        onChange={(v) => setExpectedExitCode(v)}
                        min={0}
                        max={255}
                        placeholder="0"
                        className="expected-output-form-input-number"
                      />
                    </div>
                    <div className="expected-output-form-field">
                      <label className="expected-output-form-label">实际退出码</label>
                      <InputNumber
                        value={actualExitCode}
                        onChange={(v) => setActualExitCode(v === null ? 0 : v)}
                        min={0}
                        max={255}
                        placeholder="0"
                        className="expected-output-form-input-number"
                      />
                    </div>
                  </div>

                  <div className="expected-output-form-row">
                    <label className="expected-output-form-label">实际输出</label>
                    <TextArea
                      value={actualOutput}
                      onChange={(e) => setActualOutput(e.target.value)}
                      placeholder="粘贴命令的实际输出（可选）"
                      autoSize={{ minRows: 2, maxRows: 6 }}
                      className="expected-output-form-textarea"
                    />
                  </div>

                  <div className="expected-output-form-actions">
                    <Button
                      type="primary"
                      icon={<ExperimentOutlined />}
                      loading={checking}
                      onClick={handleCheck}
                      disabled={!command.trim()}
                    >
                      运行检查
                    </Button>
                    <Button
                      icon={<ReloadOutlined />}
                      onClick={handleLoadExample}
                      disabled={checking}
                    >
                      加载示例
                    </Button>
                    <Button
                      onClick={handleReset}
                      disabled={checking}
                    >
                      清空
                    </Button>
                  </div>
                </div>

                {/* 检查结果 */}
                {result && (
                  <div className="expected-output-result">
                    <div className="expected-output-result-header">
                      {result.met ? (
                        <CheckCircleOutlined className="expected-output-result-icon expected-output-result-icon-met" />
                      ) : (
                        <CloseCircleOutlined className="expected-output-result-icon expected-output-result-icon-violation" />
                      )}
                      <span className="expected-output-result-status">
                        {result.met ? '符合预期' : `发现 ${result.violations.length} 项违规`}
                      </span>
                      <span className="expected-output-result-timestamp">
                        {formatTimestamp(result.timestamp)}
                      </span>
                    </div>

                    <div className="expected-output-result-summary">
                      <Tag>命令：{result.expectation.command}</Tag>
                      <Tag>实际退出码：{result.actualExitCode}</Tag>
                      {result.expectation.mustContain && result.expectation.mustContain.length > 0 && (
                        <Tooltip title={result.expectation.mustContain.join(', ')}>
                          <Tag>必须包含：{result.expectation.mustContain.length} 项</Tag>
                        </Tooltip>
                      )}
                      {result.expectation.mustNotContain && result.expectation.mustNotContain.length > 0 && (
                        <Tooltip title={result.expectation.mustNotContain.join(', ')}>
                          <Tag>禁止包含：{result.expectation.mustNotContain.length} 项</Tag>
                        </Tooltip>
                      )}
                    </div>

                    {!result.met && (
                      <div className="expected-output-result-violations">
                        {result.violations.map((v, i) => renderViolation(v, i))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ),
          },
        ]}
      />
    </div>
  )
}

export default ExpectedOutput
