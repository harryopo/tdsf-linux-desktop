/**
 * ModelConfigSection — 模型配置 Section（M5 Task 6 拆分）
 *
 * 从 ModelSettings.tsx 抽取，负责模型名配置 + 温度/思考强度/Token 等参数配置。
 *
 * 当前模型展示行 + 通用模型名输入（任意 OpenAI 兼容模型）+ 参数配置区。
 * 不再展示预设模型卡片：模型名完全由用户输入，Endpoint 在 API 接入区配置。
 *
 * v2.3.4 改造：高级参数（温度/思考强度/Max Tokens/Context Window/Timeout）
 *                 折叠为 `<details>`，默认收起。普通用户只需要"当前模型" +
 *                 "模型名输入"两行即可使用，进阶参数按需展开。
 */
import { useState } from 'react'
import { Cpu, CheckCircle2, Info, Settings2 } from 'lucide-react'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { Slider } from '@/components/trae/Slider'
import { TEMP_PRESETS, THINKING_LEVELS } from './constants'

export interface ModelConfigSectionProps {
  /** 当前选中的模型名 */
  selectedModel: string
  /** 选中指定模型回调 */
  onSelectModel: (name: string) => void
  /** 温度参数（0.0-1.0） */
  temperature: number
  /** 修改温度回调 */
  onTemperatureChange: (value: number) => void
  /** 思考强度 */
  thinkingLevel: 'low' | 'medium' | 'high'
  /** 修改思考强度回调 */
  onThinkingLevelChange: (value: 'low' | 'medium' | 'high') => void
  /** 最大 Token 数 */
  maxToken: number
  /** 修改最大 Token 回调 */
  onMaxTokenChange: (value: number) => void
  /** 上下文窗口大小 */
  contextWindow: number
  /** 修改上下文窗口回调 */
  onContextWindowChange: (value: number) => void
  /** 请求超时（秒） */
  requestTimeout: number
  /** 修改请求超时回调 */
  onRequestTimeoutChange: (value: number) => void
}

export function ModelConfigSection(props: ModelConfigSectionProps) {
  const {
    selectedModel,
    onSelectModel,
    temperature,
    onTemperatureChange,
    thinkingLevel,
    onThinkingLevelChange,
    maxToken,
    onMaxTokenChange,
    contextWindow,
    onContextWindowChange,
    requestTimeout,
    onRequestTimeoutChange,
  } = props

  const [customModel, setCustomModel] = useState('')

  const applyCustomModel = () => {
    const name = customModel.trim()
    if (!name) return
    onSelectModel(name)
    setCustomModel('')
  }

  return (
    <SettingsCard
      icon={Cpu}
      title="模型配置"
      tag="model.config"
      className="p-5"
      hideTag
      noHeadBorder
      headMb="lg"
    >
      {/* 当前模型展示行 */}
      <div className="set-model-current">
        <div className="set-model-current__info">
          <span className="set-model-current__name">
            {selectedModel || '未设置模型'}
          </span>
          <span className="set-model-current__status">
            <CheckCircle2 className="size-3.5" />
            当前模型
          </span>
        </div>
      </div>

      {/* 模型名输入：任意 OpenAI 兼容模型（配合 API 接入区的 Endpoint） */}
      <div className="set-model-custom" style={{ marginTop: 12 }}>
        <div className="set-model-num-item" style={{ flex: 1 }}>
          <label className="set-model-num-item__label" htmlFor="custom-model-input">
            模型名 Model
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              id="custom-model-input"
              type="text"
              value={customModel}
              placeholder="输入模型名，如 deepseek-v4-flash / doubao-seed-1-6-250615"
              onChange={(e) => setCustomModel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyCustomModel()
              }}
              spellCheck={false}
              className="set-model-num-item__input"
              style={{ flex: 1 }}
            />
            <button
              type="button"
              onClick={applyCustomModel}
              disabled={!customModel.trim()}
              className="set-model-switch-btn btn-press"
            >
              使用
            </button>
          </div>
          <span className="set-model-num-item__hint">
            输入任意 OpenAI 兼容模型名，Endpoint / API Key 在下方 API 接入区配置
          </span>
        </div>
      </div>

      {/* 参数配置区（v2.3.4 折叠为 details，默认收起） */}
      <details
        className="set-model-params-details"
        style={{ marginTop: 12 }}
      >
        <summary
          className="set-model-params-details__summary"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            cursor: 'pointer',
            padding: '8px 0',
            color: 'var(--trae-text-secondary)',
            fontSize: 13,
            listStyle: 'none',
            userSelect: 'none',
          }}
        >
          <Settings2 className="size-3.5" />
          <span>高级参数（温度 / 思考强度 / Token 限制）</span>
        </summary>
        <div className="set-model-params" style={{ marginTop: 8 }}>
          {/* a. 温度参数 */}
          <div className="set-model-param">
            <div className="set-model-param__head">
              <div className="set-model-param__head-left">
                <span className="set-model-param__label">
                  温度参数 Temperature
                </span>
                <span className="set-model-param__range">
                  0.0 – 1.0
                </span>
              </div>
              <span className="set-model-param__val">
                {temperature.toFixed(1)}
              </span>
            </div>
            <Slider
              value={[temperature]}
              min={0}
              max={1}
              step={0.1}
              onValueChange={(arr) => onTemperatureChange(arr[0] ?? 0)}
              className="w-full"
            />
            <div className="set-model-param__info">
              <Info className="size-3.5" />
              <p className="set-model-param__info-text">
                推荐：运维分析场景建议 0.2-0.4，平衡准确性与创造性。过低(0-0.2)回复过于保守，过高(0.6-1.0)可能产生幻觉。
              </p>
            </div>
            <div className="set-model-presets">
              {TEMP_PRESETS.map((p) => {
                const active = Math.abs(temperature - p.value) < 0.001
                return (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => onTemperatureChange(p.value)}
                    className={
                      'set-model-preset btn-press' +
                      (active ? ' is-active' : '')
                    }
                  >
                    {p.label} {p.value}
                  </button>
                )
              })}
            </div>
          </div>

          {/* b. 思考强度 */}
          <div className="set-model-param">
            <div className="set-model-param__head">
              <span className="set-model-param__label">
                思考强度 Thinking Effort
              </span>
            </div>
            <div className="set-model-segment">
              {THINKING_LEVELS.map((t) => {
                const active = thinkingLevel === t.value
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => onThinkingLevelChange(t.value)}
                    className={
                      'set-model-segment__btn' +
                      (active ? ' is-active' : '')
                    }
                  >
                    {t.label}
                  </button>
                )
              })}
            </div>
            <p className="set-model-param__range">
              低=快速响应 · 中=平衡 · 高=深度推理（消耗更多token）
            </p>
          </div>

          {/* c/d/e. 数字输入组 */}
          <div className="set-model-num-grid">
            <div className="set-model-num-item">
              <label className="set-model-num-item__label">
                最大Token Max Tokens
              </label>
              <input
                type="number"
                value={maxToken}
                onChange={(e) => onMaxTokenChange(Number(e.target.value))}
                aria-label="最大Token"
                className="set-model-num-item__input"
              />
              <span className="set-model-num-item__hint">
                单次响应最大长度
              </span>
            </div>
            <div className="set-model-num-item">
              <label className="set-model-num-item__label">
                上下文窗口 Context Window
              </label>
              <input
                type="number"
                value={contextWindow}
                onChange={(e) => onContextWindowChange(Number(e.target.value))}
                aria-label="上下文窗口"
                className="set-model-num-item__input"
              />
              <span className="set-model-num-item__hint">
                对话历史保留长度
              </span>
            </div>
            <div className="set-model-num-item">
              <label className="set-model-num-item__label">
                请求超时 Timeout
              </label>
              <input
                type="number"
                value={requestTimeout}
                onChange={(e) => onRequestTimeoutChange(Number(e.target.value))}
                aria-label="请求超时"
                className="set-model-num-item__input"
              />
              <span className="set-model-num-item__hint">秒</span>
            </div>
          </div>
        </div>
      </details>
    </SettingsCard>
  )
}
