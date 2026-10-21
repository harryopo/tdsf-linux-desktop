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
  /** API Key（只承载用户这一屏输入的内容，主进程存过的 Key 不会回填进来） */
  apiKey: string
  /** 修改 API Key 回调 */
  onApiKeyChange: (value: string) => void
  /**
   * 主进程是否已存有 API Key（storage:hasApiKey 的布尔量，P0-3）
   *
   * true 时输入框提示改成"已保存（留空则不修改）"：
   * 留空 = 保持不动，不是清空；界面上永远看不到那串 Key。
   */
  hasSavedKey: boolean
  /** 显式清除主进程已保存的 Key（需用户确认；与"输入框留空"是两件事） */
  onDeleteSavedKey: () => void
  /** 是否显示 API Key 明文 */
  showApiKey: boolean
  /** 切换 API Key 显示/隐藏 */
  onToggleShowApiKey: () => void
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
    hasSavedKey,
    onDeleteSavedKey,
    showApiKey,
    onToggleShowApiKey,
    onTestConnection,
    isTesting,
    lastTestTime,
    testResult,
    testLatency,
    testLogs,
    selectedModel,
  } = props

  return (
    <SettingsCard
      icon={KeyRound}
      title="API接入与测试"
      tag="api.config"
      className="p-5"
      hideTag
      noHeadBorder
      headMb="lg"
    >
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
          {/* 控件列：输入框和提示必须在同一个格子里。
              原来提示是 .set-api-row 的第三个 grid 子项，两列网格把它挤到第二行第一列
              （180px 宽的标签列）——一大段灰底说明竖着堵在"API Key"下面，
              就是用户说的"注释太丑，而且布局有问题"。 */}
          <div className="min-w-0">
            <div className="set-api-key-row">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => onApiKeyChange(e.target.value)}
                aria-label="API Key"
                // 已存过 Key 就把框明示成"留空不改"；没存过时保持原样（空框 + 下面那句提示）。
                // Key 原文永不回填进输入框：storage:getApiKey 通道已删（2026-10-09 P0-3）。
                placeholder={hasSavedKey ? '已保存（留空则不修改）' : undefined}
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
            {!apiKey && (
              <p role="status" className="set-api-hint">
                {hasSavedKey
                  ? '已加密存在本机，界面上不显示这串字符。留空＝不改，粘贴新的即替换。'
                  : '还没填 Key，大模型连不上。到服务商控制台建一个粘进来，再点下面「测试连接」。'}
                {hasSavedKey && (
                  <button
                    type="button"
                    data-dom-id="delete-llm-key"
                    onClick={onDeleteSavedKey}
                    className="set-api-hint__action btn-press"
                  >
                    清除已保存的 Key
                  </button>
                )}
              </p>
            )}
          </div>
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
                {/*
                  这里原来画了一条"响应时间趋势"折线，points 是写死的六个坐标。
                  一次测试只有一个延迟数，没有任何历史序列可画——那条线每次都在讲
                  一件没发生过的事（用户 2026-10-16："假的UI都检查一下"）。
                */}
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
