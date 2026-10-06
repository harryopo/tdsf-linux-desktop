/**
 * ModelConfigSection — 模型参数卡片
 *
 * 只用设计系统里的原语（SettingsRow / TextInput / Button / Segmented / Chip），
 * 不再自带 set-model-* 那套私有样式。
 *
 * 两处修正：
 * - 上下文窗口原来是本页可编辑、但全仓零消费者的假设置。真实值由主进程按
 *   Provider 能力表（provider-capabilities.ts）给出，所以这里删掉输入框。
 * - 思考强度以前给的是"低/中/高"三档，运行时用的是 auto/fast/standard/deep，
 *   用户选的"中"对应不到任何真实档位；现在直接用运行时那四档的词。
 */
import { useState } from 'react'
import { Cpu } from 'lucide-react'
import type { RequestedThinkingStrength } from '@shared/agent-types'
import { Button, Chip, Segmented, TextInput } from '@/ui'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { Slider } from '@/components/trae/Slider'
import { TEMP_PRESETS, THINKING_LEVELS } from './constants'

export interface ModelConfigSectionProps {
  /** 当前生效的模型名 */
  selectedModel: string
  /** 应用新模型名 */
  onSelectModel: (name: string) => void
  /** 温度（0.0–1.0） */
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
    requestTimeout,
    onRequestTimeoutChange,
  } = props

  const [draft, setDraft] = useState('')
  const applyDraft = () => {
    const name = draft.trim()
    if (!name) return
    onSelectModel(name)
    setDraft('')
  }

  return (
    <SettingsCard icon={Cpu} title="模型" hideTag noHeadBorder>
      <SettingsRow
        label="当前模型"
        desc="工作台的 AI 助手、命令分析与日志诊断都走这一个模型"
        control={
          selectedModel ? (
            <span className="font-mono text-md text-ink">{selectedModel}</span>
          ) : (
            <Chip tone="warning">未设置</Chip>
          )
        }
      />

      <SettingsRow
        label="换成其它模型"
        desc="填任意 OpenAI 兼容的模型 ID，Endpoint 与 Key 在下方「API 接入」里配"
        control={
          <div className="flex items-center gap-2">
            <TextInput
              aria-label="模型 ID"
              value={draft}
              spellCheck={false}
              placeholder="如 deepseek-chat"
              className="w-[220px] font-mono"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyDraft()}
            />
            <Button variant="outline" size="md" disabled={!draft.trim()} onClick={applyDraft}>
              使用
            </Button>
          </div>
        }
      />

      <SettingsRow
        label="温度"
        desc="运维分析建议 0.2–0.4：太低回答死板，太高容易编造命令"
        control={
          <div className="flex w-[280px] items-center gap-3">
            <Slider
              value={[temperature]}
              min={0}
              max={1}
              step={0.1}
              aria-label="温度"
              onValueChange={(arr) => onTemperatureChange(arr[0] ?? 0)}
              className="flex-1"
            />
            <span className="w-8 text-right font-mono text-md tabular-nums text-ink">
              {temperature.toFixed(1)}
            </span>
          </div>
        }
      />

      <SettingsRow
        label="快速预设"
        desc="点一下直接填进上面的温度"
        control={
          <div className="flex items-center gap-2">
            {TEMP_PRESETS.map((p) => (
              <Button
                key={p.label}
                size="sm"
                variant={Math.abs(temperature - p.value) < 0.001 ? 'selected' : 'outline'}
                onClick={() => onTemperatureChange(p.value)}
              >
                {p.label} {p.value}
              </Button>
            ))}
          </div>
        }
      />

      <SettingsRow
        label="思考强度"
        desc="自动=按问题复杂度决定；深度=强制思考链，更慢也更贵"
        control={
          <Segmented
            ariaLabel="思考强度"
            value={thinkingLevel}
            onValueChange={onThinkingLevelChange}
            items={THINKING_LEVELS.map((t) => ({ value: t.value, label: t.label }))}
          />
        }
      />

      <SettingsRow
        label="最大输出 Token"
        desc="单次响应的长度上限"
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
        isLast
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
    </SettingsCard>
  )
}
