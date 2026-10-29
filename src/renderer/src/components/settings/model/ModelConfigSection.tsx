/**
 * ModelConfigSection — 模型参数卡片
 *
 * 只用设计系统里的原语（SettingsRow / TextInput / Button），不再自带
 * set-model-* 那套私有样式，也不再出现可拖动滑块。
 *
 * 2026-10-29 按用户口径重排：
 * - 默认只露「模型」；温度、思考强度、输出长度、超时、上下文窗口收进默认收起的
 *   「高级设置」，展开才见（功能一个没删，只改层级）。
 * - 模型输入框就是当前配置的模型本身，不再有"另填一个 ID 再点使用"的第二套值，
 *   也没有 `placeholder="如 deepseek-chat"` 那种示例占位。
 * - 温度从 Radix Slider 改成数字输入 + 精确/均衡/发散三个预设按钮；
 *   用户明确要求「不要有拖动的进度条」。
 * - 思考强度按模型能力给：判据在 thinking-capabilities.ts（纯函数，可单测），
 *   不支持的模型隐藏选择器并显示一行「该模型不支持思考强度设置」。
 */
import { useState } from 'react'
import { ChevronDown, Cpu } from 'lucide-react'
import type { ProviderType, RequestedThinkingStrength } from '@shared/agent-types'
import { Button, TextInput } from '@/ui'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { TEMP_PRESETS } from './constants'
import { resolveThinkingCapability } from './thinking-capabilities'

export interface ModelConfigSectionProps {
  /** 当前配置的模型名（就是主进程实际调用的那一个） */
  selectedModel: string
  /** 直接修改当前配置的模型名 */
  onSelectModel: (name: string) => void
  /**
   * 当前服务商的类型（来自主进程 provider:list）。
   * 思考能力判定要用它：运行时只对 deepseek 注入 thinking 开关。
   * 不传 = 未知，按"不支持思考"处理。
   */
  providerType?: ProviderType | null
  /** 温度（0.0–2.0，运维分析建议 0.1–0.4） */
  temperature: number
  onTemperatureChange: (value: number) => void
  /** 思考强度：与运行时同一套取值 */
  thinkingLevel: RequestedThinkingStrength
  onThinkingLevelChange: (value: RequestedThinkingStrength) => void
  /** 单次响应最大长度 */
  maxToken: number
  onMaxTokenChange: (value: number) => void
  /** 请求超时（秒） */
  requestTimeout: number
  onRequestTimeoutChange: (value: number) => void
  /**
   * 上下文窗口（token）：0 表示该模型没声明窗口。
   * #91 放回来的前提——它现在有真实消费者（AI 面板的上下文徽章按这个数算分母）。
   */
  contextWindow: number
  onContextWindowChange: (value: number) => void
}

export function ModelConfigSection(props: ModelConfigSectionProps) {
  const {
    selectedModel,
    onSelectModel,
    providerType,
    temperature,
    onTemperatureChange,
    thinkingLevel,
    onThinkingLevelChange,
    maxToken,
    onMaxTokenChange,
    requestTimeout,
    onRequestTimeoutChange,
    contextWindow,
    onContextWindowChange,
  } = props

  const [advancedOpen, setAdvancedOpen] = useState(false)
  const capability = resolveThinkingCapability({ providerType, model: selectedModel })
  const thinkingValueListed = capability.options.some((o) => o.value === thinkingLevel)

  return (
    <SettingsCard icon={Cpu} title="模型" hideTag noHeadBorder>
      <SettingsRow
        label="模型"
        desc="工作台的 AI 对话、命令分析与日志诊断都走这一个模型"
        isLast={!advancedOpen}
        control={
          <div className="set-model-field">
            <TextInput
              aria-label="模型 ID"
              value={selectedModel}
              spellCheck={false}
              className="w-[260px] font-mono"
              onChange={(e) => onSelectModel(e.target.value)}
            />
            <p className="set-api-hint">填服务商控制台里的模型 ID（不带引号，区分大小写）</p>
            {capability.supported ? (
              <p className="set-api-hint">这个模型有思考档位，可在下方「高级设置」里调整</p>
            ) : (
              <p className="set-model-note">{capability.notice}</p>
            )}
          </div>
        }
      />

      <div className="set-model-advanced">
        <button
          type="button"
          className="set-model-advanced__toggle btn-press"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((v) => !v)}
        >
          <ChevronDown aria-hidden className="set-model-advanced__chevron" />
          <span>高级设置</span>
          <span className="set-model-advanced__summary">
            温度、思考强度、输出长度、超时、上下文窗口
          </span>
        </button>

        {advancedOpen && (
          <div className="set-model-advanced__body">
            {capability.supported && (
              <SettingsRow
                label="思考强度"
                desc="只列出该模型真正支持的档位，每一档都会原样发给主进程"
                control={
                  <div className="set-think-block">
                    {!thinkingValueListed && (
                      <p className="set-model-note">
                        当前保存的档位不在这个模型的可用档位里，选择下面任一项即可更新
                      </p>
                    )}
                    <div role="radiogroup" aria-label="思考强度" className="set-think-options">
                      {capability.options.map((option) => (
                        <label
                          key={option.value}
                          className={
                            'set-think-option' +
                            (thinkingLevel === option.value ? ' is-active' : '')
                          }
                        >
                          <input
                            type="radio"
                            name="thinking-strength"
                            value={option.value}
                            checked={thinkingLevel === option.value}
                            onChange={() => onThinkingLevelChange(option.value)}
                            className="set-think-option__radio"
                          />
                          <span className="set-think-option__text">
                            <span className="set-think-option__label">{option.label}</span>
                            <span className="set-think-option__desc">{option.desc}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                }
              />
            )}

            <SettingsRow
              label="温度"
              desc="越低越严谨、越高越发散；运维分析建议 0.2–0.4"
              control={
                <div className="set-temp-control">
                  <TextInput
                    aria-label="温度"
                    type="number"
                    min={0}
                    max={2}
                    step={0.1}
                    value={temperature}
                    className="w-[88px] text-right font-mono tabular-nums"
                    onChange={(e) => {
                      const next = Number(e.target.value)
                      if (!Number.isFinite(next)) return
                      // 只保留一位小数：运行时按 0.1 步进理解这个值
                      onTemperatureChange(Math.min(2, Math.max(0, Math.round(next * 10) / 10)))
                    }}
                  />
                  <div className="set-temp-presets">
                    {TEMP_PRESETS.map((preset) => (
                      <Button
                        key={preset.label}
                        size="sm"
                        variant={
                          Math.abs(temperature - preset.value) < 0.001 ? 'selected' : 'outline'
                        }
                        onClick={() => onTemperatureChange(preset.value)}
                      >
                        {preset.label} {preset.value}
                      </Button>
                    ))}
                  </div>
                </div>
              }
            />

            <SettingsRow
              label="最大输出 Token"
              desc="单次响应的长度上限；深度思考会额外占用预算"
              control={
                <TextInput
                  aria-label="最大 Token"
                  type="number"
                  min={256}
                  step={256}
                  value={maxToken}
                  className="w-[120px] text-right font-mono tabular-nums"
                  onChange={(e) => onMaxTokenChange(Number(e.target.value))}
                />
              }
            />

            <SettingsRow
              label="请求超时"
              desc="超过这个秒数就判定本次调用失败"
              control={
                <div className="flex items-center gap-2">
                  <TextInput
                    aria-label="请求超时秒数"
                    type="number"
                    min={5}
                    step={5}
                    value={requestTimeout}
                    className="w-[120px] text-right font-mono tabular-nums"
                    onChange={(e) => onRequestTimeoutChange(Number(e.target.value))}
                  />
                  <span className="text-caption text-ink-mute">秒</span>
                </div>
              }
            />

            <SettingsRow
              label="上下文窗口"
              desc={
                contextWindow > 0
                  ? '工作台 AI 面板那个百分比就按这个数算。填了等于把这个值固定住：以后内置能力表更新，这条也不会跟着变'
                  : '这个模型没声明窗口，所以面板里显示"未知"、也不算百分比。自部署端点或代理可以在这里填真实值；留空或 0 表示不覆盖'
              }
              isLast
              control={
                <div className="flex items-center gap-2">
                  <TextInput
                    aria-label="上下文窗口 token 数"
                    type="number"
                    min={1024}
                    step={1024}
                    value={contextWindow > 0 ? contextWindow : ''}
                    className="w-[140px] text-right font-mono tabular-nums"
                    onChange={(e) => onContextWindowChange(Number(e.target.value))}
                  />
                  <span className="text-caption text-ink-mute">tokens</span>
                </div>
              }
            />
          </div>
        )}
      </div>
    </SettingsCard>
  )
}
