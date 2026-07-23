/**
 * ModelConfigSection — 模型配置 Section（M5 Task 6 拆分）
 *
 * 从 ModelSettings.tsx 抽取，负责模型 Provider 选择 + 温度/思考强度/Token 等参数配置。
 *
 * 原 Section 2：当前模型展示行 + 可选模型卡片网格 + 参数配置区（温度/思考强度/数字输入组）。
 */
import { Cpu, ChevronDown, CheckCircle2, Info } from 'lucide-react'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { Slider } from '@/components/trae/Slider'
import {
  TEMP_PRESETS,
  THINKING_LEVELS,
  type ModelOption,
} from './constants'

export interface ModelConfigSectionProps {
  /** 当前选中的模型名 */
  selectedModel: string
  /** 切换模型回调（循环切换到下一个） */
  onSwitchModel: () => void
  /** 是否正在加载 Provider 列表（禁用切换按钮） */
  loadingProviders: boolean
  /** 可选模型卡片列表（父组件派生，优先用真实 Provider，降级用 MODELS） */
  modelOptions: ModelOption[]
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
    onSwitchModel,
    loadingProviders,
    modelOptions,
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

  return (
    <SettingsCard icon={Cpu} title="模型配置" tag="model.config" className="p-5">
      {/* 当前模型展示行 */}
      <div className="set-model-current">
        <div className="set-model-current__info">
          <span className="set-model-current__name">
            {selectedModel}
          </span>
          <span className="set-model-current__ver">
            v1.0
          </span>
          <span className="set-model-current__status">
            <CheckCircle2 className="size-3.5" />
            已连接
          </span>
        </div>
        <button
          type="button"
          onClick={onSwitchModel}
          disabled={loadingProviders}
          aria-label="切换模型"
          className="set-model-switch-btn btn-press"
        >
          <span>切换模型</span>
          <ChevronDown className="size-3.5" />
        </button>
      </div>

      {/* 可选模型列表 */}
      <div className="set-model-grid">
        {modelOptions.map((m) => {
          const isSelected = m.name === selectedModel
          return (
            <button
              key={m.name}
              type="button"
              onClick={() => onSelectModel(m.name)}
              className={
                'set-model-card btn-press' +
                (isSelected ? ' is-selected' : '')
              }
            >
              <div className="set-model-card__head">
                <span className="set-model-card__name">
                  {m.name}
                </span>
                <span
                  className={
                    'set-model-card__tag ' +
                    (m.tagType === 'brand'
                      ? 'set-model-card__tag--brand'
                      : 'set-model-card__tag--default')
                  }
                >
                  {m.tag}
                </span>
              </div>
              <p className="set-model-card__desc">
                {m.desc}
              </p>
            </button>
          )
        })}
      </div>

      {/* 参数配置区 */}
      <div className="set-model-params">
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
    </SettingsCard>
  )
}
