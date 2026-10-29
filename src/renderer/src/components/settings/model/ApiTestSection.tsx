/**
 * ApiTestSection — 接入配置与连接测试
 *
 * 2026-10-29 按用户口径重排：
 * - 默认层只保留四件事：服务商 / 接口地址 / API 密钥 / 模型（模型在 ModelConfigSection）。
 * - 标签全部中文：Endpoint → 接口地址、API Key → API 密钥；URL / API Key 这类纯技术
 *   名词只放在括号里当补充。
 * - 输入框不再用 `例如 https://...` 或 `sk-xxxx` 这类示例占位，改成标签下方的一行小字说明。
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
import type { PersistedProviderConfig } from '@shared/agent-types'
import { SettingsCard } from '@/components/settings/SettingsCard'
import type { TestLogLine } from './constants'

export interface ApiTestSectionProps {
  /** 主进程 provider:list 返回的服务商实例 */
  providers: PersistedProviderConfig[]
  /** 当前正在编辑的服务商 ID（保存后成为默认服务商） */
  providerId: string | null
  /** 切换服务商：会用它已保存的地址与模型预填表单 */
  onProviderChange: (id: string) => void
  /** 接口地址（URL） */
  endpoint: string
  /** 修改接口地址回调 */
  onEndpointChange: (value: string) => void
  /** API 密钥（只承载用户这一屏输入的内容，主进程存过的密钥不会回填进来） */
  apiKey: string
  /** 修改 API 密钥回调 */
  onApiKeyChange: (value: string) => void
  /**
   * 主进程是否已存有 API 密钥（provider:list 的 hasApiKey 或 storage:hasApiKey）
   *
   * true 时提示改成"已保存（留空则不修改）"：留空 = 保持不动，不是清空；
   * 界面上永远看不到那串密钥原文。
   */
  hasSavedKey: boolean
  /** 显式清除主进程已保存的密钥（需用户确认；与"输入框留空"是两件事） */
  onDeleteSavedKey: () => void
  /** 是否显示 API 密钥明文 */
  showApiKey: boolean
  /** 切换 API 密钥显示/隐藏 */
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
  /** 当前选中模型（用于显示实际测试的模型） */
  selectedModel: string
}

export function ApiTestSection(props: ApiTestSectionProps) {
  const {
    providers,
    providerId,
    onProviderChange,
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
      title="API 接入与测试"
      className="p-5"
      hideTag
      noHeadBorder
      headMb="lg"
    >
      {/* 接入配置：服务商 / 接口地址 / API 密钥 */}
      <div className="set-api-form">
        <div className="set-api-row">
          <label className="set-api-row__label" htmlFor="set-api-provider">
            服务商
          </label>
          <div className="min-w-0">
            {providers.length > 0 ? (
              <select
                id="set-api-provider"
                aria-label="服务商"
                className="set-api-input set-api-select"
                value={providerId ?? ''}
                onChange={(e) => onProviderChange(e.target.value)}
              >
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name || provider.id}
                    {provider.model ? `（${provider.model}）` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <span className="set-model-note">未读取到服务商列表，主进程可能未连接</span>
            )}
            <p className="set-api-hint">选择要使用的服务商；保存后它成为默认服务商，AI 对话从它取模型和密钥</p>
          </div>
        </div>

        <div className="set-api-row">
          <label className="set-api-row__label" htmlFor="set-api-endpoint">
            接口地址（URL）
          </label>
          <div className="min-w-0">
            <input
              id="set-api-endpoint"
              type="text"
              value={endpoint}
              onChange={(e) => onEndpointChange(e.target.value)}
              aria-label="接口地址"
              spellCheck={false}
              className="set-api-input"
            />
            <p className="set-api-hint">
              服务商提供的兼容接口根地址，一般以版本号结尾（如 /v1）。保存前会校验：只接受 https，或本机回环的 http
            </p>
          </div>
        </div>

        <div className="set-api-row">
          <label className="set-api-row__label" htmlFor="set-api-key">
            API 密钥（API Key）
          </label>
          {/* 控件列：输入框和提示必须在同一个格子里。
              原来提示是 .set-api-row 的第三个 grid 子项，两列网格把它挤到第二行第一列
              （180px 宽的标签列）——一大段灰底说明竖着堵在"API Key"下面，
              就是用户说的"注释太丑，而且布局有问题"。 */}
          <div className="min-w-0">
            <div className="set-api-key-row">
              <input
                id="set-api-key"
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => onApiKeyChange(e.target.value)}
                aria-label="API 密钥"
                autoComplete="off"
                spellCheck={false}
                // 不再用 placeholder 展示"已保存/示例"：状态放到下面那行小字里，
                // 密钥原文永不回填（storage:getApiKey 通道已删，2026-10-09 P0-3）。
                className="set-api-key-input"
              />
              <button
                type="button"
                onClick={onToggleShowApiKey}
                aria-label={showApiKey ? '隐藏 API 密钥' : '显示 API 密钥'}
                className="set-api-eye-btn btn-press"
              >
                {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <p role="status" className="set-api-hint">
              {hasSavedKey
                ? apiKey
                  ? '保存后会替换本机已加密的那一份密钥。'
                  : '已加密保存在本机，界面不回显。留空表示不修改，粘贴新值即替换。'
                : apiKey
                  ? '保存时会加密存在本机，界面上只显示这一份输入。'
                  : '还没填 API 密钥，大模型连不上。到服务商控制台建一个粘进来，再点下面「测试连接」。'}
              {hasSavedKey && (
                <button
                  type="button"
                  data-dom-id="delete-llm-key"
                  onClick={onDeleteSavedKey}
                  className="set-api-hint__action btn-press"
                >
                  清除已保存的密钥
                </button>
              )}
            </p>
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
          <span className="set-api-test__time">最近测试 {lastTestTime}</span>
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
                  模型 <span className="set-api-result__meta-val">{selectedModel}</span>
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
            <span className="set-api-logs__head-title">测试日志</span>
          </div>
          <pre className="set-api-logs__body">
            {testLogs.length === 0 ? (
              <span className="set-api-logs__placeholder">
                点击「测试连接」检查接口地址、API 密钥和模型是否可用
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
