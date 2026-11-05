/**
 * CapabilityPalette — Composer 的 `/` 面板（2026-11-05 A2）
 *
 * 这里列出的 5 项都是**提示词模板**：选中只把话术填进输入框，不执行任何命令、
 * 也不启动任何任务（真实执行入口在 `+` 菜单的 PAOR，且要求先连 SSH）。
 * 因此标题写「提示词模板」、每项带「模板」后缀，并用 description 明说"不会执行动作"，
 * 不允许把只填词的条目写成「一键诊断」这类动作措辞。
 */
import type { FC } from 'react'
import { Dialog, DialogContent } from '@/ui'
import { QUICK_PROMPTS, QUICK_PROMPT_TEMPLATES, type QuickPromptTemplate } from './mock-data'

export interface CapabilityPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 选中某一项：调用方负责填入输入框并关闭面板 */
  onPick: (key: QuickPromptTemplate) => void
}

const CapabilityPalette: FC<CapabilityPaletteProps> = ({ open, onOpenChange, onPick }) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent
      title="提示词模板"
      description="以下都是话术模板：选中只填入输入框，不会执行命令，也不会启动任务。"
    >
      <div className="flex flex-col gap-1">
        {QUICK_PROMPT_TEMPLATES.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => onPick(key)}
            className="flex flex-col items-start gap-0.5 rounded-(--ui-radius-control) px-3 py-2 text-left transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-solid"
          >
            <span className="text-md font-medium text-ink">{key}模板</span>
            <span className="line-clamp-1 text-caption text-ink-mute">{QUICK_PROMPTS[key]}</span>
          </button>
        ))}
      </div>
    </DialogContent>
  </Dialog>
)

export default CapabilityPalette
