/**
 * ApiTestSection — API 接入与测试 Section（M5 Task 6 拆分）
 *
 * 从 ModelSettings.tsx 抽取，负责 Endpoint/API Key/组织ID 表单 + 测试连接 + 结果卡 + 测试日志。
 *
 * 原 Section 3：API 配置表单 + 连接测试区（按钮 + 结果卡 + 日志）。
 */
import {
  KeyRound,
  Eye,
  EyeOff,
  Zap,
  CheckCircle2,
  Loader2,
  Terminal as TerminalIcon,
} from 'lucide-react'
import { SettingsCard } from '@/components/settings/SettingsCard'
import type { TestLogLine } from './constants'

export interface ApiTestSectionProps {
  /** API Endpoint */
  endpoint: string
  /** 修改 Endpoint 回调 */
  onEndpointChange: (value: string) => void
  /** API Key */
  apiKey: string
  /** 修改 API Key 回调 */
  onApiKeyChange: (value: string) => void
  /** 是否显示 API Key 明文 */
  showApiKey: boolean
  /** 切换 API Key 显示/隐藏 */
  onToggleShowApiKey: () => void
  /** 组织 ID（可选） */
  organization: string
  /** 修改组织 ID 回调 */
  onOrganizationChange: (value: string) => void
  /** 点击测试连接回调 */
  onTestConnection: () => void
  /** 是否正在测试中（禁用按钮 + 显示 loading） */
  isTesting: boolean
  /** 最近一次测试时间字符串 */
  lastTestTime: string
  /** 测试结果状态 */
  testResult: 'idle' | 'success' | 'error'
  /** 测试延迟（毫秒，可能为 null） */
  testLatency: number | null
  /** 测试日志行 */
  testLogs: TestLogLine[]
  /** 当前选中模型（用于显示模型版本） */
  selectedModel: string
}

export function ApiTestSection(props: ApiTestSectionProps) {
  const {
    endpoint,
    onEndpointChange,
    apiKey,
    onApiKeyChange,
    showApiKey,
    onToggleShowApiKey,
    organization,
    onOrganizationChange,
    onTestConnection,
    isTesting,
    lastTestTime,
    testResult,
    testLatency,
    testLogs,
    selectedModel,
  } = props

  return (
    <SettingsCard icon={KeyRound} title="API接入与测试" tag="api.config" className="p-5">
      {/* API 配置表单 */}
      <div className="set-api-form">
        <div className="set-api-row">
          <label className="set-api-row__label">
            API Endpoint
          </label>
          <input
            type="text"
            value={endpoint}
            onChange={(e) => onEndpointChange(e.target.value)}
            aria-label="API Endpoint"
            className="set-api-input"
          />
        </div>
        <div className="set-api-row">
          <label className="set-api-row__label">
            API Key
          </label>
          <div className="set-api-key-row">
            <input
              type={showApiKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => onApiKeyChange(e.target.value)}
              aria-label="API Key"
              className="set-api-key-input"
            />
            <button
              type="button"
              onClick={onToggleShowApiKey}
              aria-label="显示/隐藏API Key"
              className="set-api-eye-btn btn-press"
            >
              {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>
        <div className="set-api-row">
          <label className="set-api-row__label">
            组织ID Organization{' '}
            <span className="set-api-row__label-hint">(可选)</span>
          </label>
          <input
            type="text"
            value={organization}
            onChange={(e) => onOrganizationChange(e.target.value)}
            placeholder="输入组织ID（可选）"
            aria-label="组织ID"
            className="set-api-input"
          />
        </div>
      </div>

      {/* 连接测试区 */}
      <div className="set-api-test">
        <div className="set-api-test__head">
          <button
            type="button"
            onClick={onTestConnection}
            disabled={isTesting}
            aria-label="测试连接"
            className="set-api-test__btn btn-press"
          >
            {isTesting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Zap className="size-3.5" />
            )}
            <span>{isTesting ? '测试中...' : '测试连接'}</span>
          </button>
          <span className="set-api-test__time">
            最近测试 {lastTestTime}
          </span>
        </div>

        {/* 测试结果卡片 */}
        {testResult !== 'idle' && (
          <div
            className={
              'set-api-result ' +
              (testResult === 'success'
                ? 'set-api-result--success'
                : 'set-api-result--error')
            }
          >
            <span
              className={
                'set-api-result__status ' +
                (testResult === 'success'
                  ? 'set-api-result__status--success'
                  : 'set-api-result__status--error')
              }
            >
              <CheckCircle2 className="size-4" />
              {testResult === 'success' ? '连接成功' : '连接失败'}
            </span>
            {testResult === 'success' && (
              <>
                <span className="set-api-result__meta">
                  响应时间{' '}
                  <span className="set-api-result__meta-val">
                    {testLatency != null ? `${testLatency}ms` : '--'}
                  </span>
                </span>
                <span className="set-api-result__meta">
                  模型版本{' '}
                  <span className="set-api-result__meta-val">
                    {selectedModel}
                  </span>
                </span>
                <svg
                  width="100"
                  height="28"
                  viewBox="0 0 100 28"
                  className="set-api-result__chart"
                  aria-hidden="true"
                >
                  <polyline
                    points="0,18 20,14 40,16 60,10 80,12 100,8"
                    fill="none"
                    stroke="var(--trae-status-success-default)"
                    strokeWidth="1.5"
                  />
                  <circle cx="100" cy="8" r="2" fill="var(--trae-status-success-default)" />
                </svg>
              </>
            )}
          </div>
        )}

        {/* 测试日志 */}
        <div className="set-api-logs">
          <div className="set-api-logs__head">
            <TerminalIcon className="size-3" />
            <span className="set-api-logs__head-title">
              测试日志
            </span>
          </div>
          <pre className="set-api-logs__body">
            {testLogs.length === 0 ? (
              <span className="set-api-logs__placeholder">
                点击「测试连接」开始验证 API 配置...
              </span>
            ) : (
              testLogs.map((line, idx) => (
                <span key={`${line.time}-${idx}`}>
                  {idx > 0 && '\n'}
                  <span className="set-api-logs__time">{line.time}</span>{' '}
                  <span
                    className={
                      line.tone === 'success'
                        ? 'set-api-logs__line--success'
                        : line.tone === 'error'
                          ? 'set-api-logs__line--error'
                          : ''
                    }
                  >
                    {line.text}
                  </span>
                </span>
              ))
            )}
          </pre>
        </div>
      </div>
    </SettingsCard>
  )
}
