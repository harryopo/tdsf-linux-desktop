/**
 * ModelConfigSection 的上下文窗口行（#91）
 *
 * 只量这一行的两件事：显示的是传进来的生效值（不是页面上另抄的一份），
 * 以及"未知"时不许显示 0 冒充一个真实窗口。
 */
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ModelConfigSection, type ModelConfigSectionProps } from '@renderer/components/settings/model/ModelConfigSection'

// 原先是 Record<string, unknown> 再 {...(props as never)} 摊进 JSX：
// 组件的 props 换名或加必填项，这份夹具不会红，测试照旧画出一截界面而已。
function renderSection(overrides: Partial<ModelConfigSectionProps> = {}) {
  const props: ModelConfigSectionProps = {
    selectedModel: 'deepseek-chat',
    onSelectModel: vi.fn(),
    temperature: 0.3,
    onTemperatureChange: vi.fn(),
    thinkingLevel: 'auto',
    onThinkingLevelChange: vi.fn(),
    maxToken: 4096,
    onMaxTokenChange: vi.fn(),
    requestTimeout: 30,
    onRequestTimeoutChange: vi.fn(),
    contextWindow: 64_000,
    onContextWindowChange: vi.fn(),
    ...overrides,
  }
  render(<ModelConfigSection {...props} />)
  return props
}

describe('上下文窗口行', () => {
  it('显示传进来的生效窗口', () => {
    renderSection({ contextWindow: 64_000 })
    expect(screen.getByLabelText('上下文窗口 token 数')).toHaveValue(64000)
  })

  it('改数字就把解析后的值交给页面', () => {
    const props = renderSection({ contextWindow: 64_000 })
    fireEvent.change(screen.getByLabelText('上下文窗口 token 数'), { target: { value: '131072' } })
    expect(props.onContextWindowChange).toHaveBeenCalledWith(131072)
  })

  it('窗口未知时输入框留空并写清后果，不显示 0 冒充真值', () => {
    renderSection({ contextWindow: 0 })
    const input = screen.getByLabelText('上下文窗口 token 数')
    // type=number 空值时 jest-dom 的 toHaveValue 返回 null，直接看 DOM 值更准
    expect((input as HTMLInputElement).value).toBe('')
    expect(input).toHaveAttribute('placeholder', '未知')
    expect(screen.getByText(/自部署端点或代理可以在这里填真实值/)).toBeInTheDocument()
  })

  it('已有真实窗口时说明"填了就是固定住"，不假装还能自动跟随', () => {
    renderSection({ contextWindow: 200_000 })
    expect(screen.getByText(/以后内置能力表更新，这条也不会跟着变/)).toBeInTheDocument()
  })
})
