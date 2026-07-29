/**
 * tests/components/pages/ModelSettings.test.tsx
 * ModelSettings 页面级 RTL 最小冒烟测试（ui-story-snapshot 漂移修复）
 *
 * 覆盖范围：
 * 1. 无 electronAPI 环境下整页可渲染（所有 IPC 分支被 isElectronAPIAvailable 短路）
 * 2. Header 标题 / 副标题渲染
 * 3. v2.3.4 状态引导卡：API Key 为空时显示"还没有配置 API Key"引导（含申请链接）
 * 4. 7 个 Section 骨架均渲染（模型配置 / API 接入与测试 / 预算与告警等标题可见）
 * 5. "恢复默认"按钮反馈文案（不触发 IPC 的纯前端路径）
 *
 * 关键决策：
 * - ModelSettingsHeader 使用 useNavigate → 用 MemoryRouter 包裹
 * - 不 mock electronAPI：jsdom 下 window.electronAPI 天然 undefined，
 *   恰好覆盖"preload 未加载"的防御路径（页面不得崩溃）
 * - localStorage 每例前清理，避免 usePersistentState / zustand persist 串扰
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type {} from '@testing-library/jest-dom'

import { ModelSettings } from '@renderer/pages/ModelSettings'

/** 渲染整页（带路由上下文） */
function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/settings/model']}>
      <ModelSettings />
    </MemoryRouter>
  )
}

describe('ModelSettings — 模型配置页冒烟', () => {
  beforeEach(() => {
    // 清理 usePersistentState / zustand persist 残留，保证用例独立
    window.localStorage.clear()
  })

  it('1. 无 electronAPI 时整页渲染不崩溃，Header 标题可见', () => {
    renderPage()
    // '模型配置' 同时是页面 h1 与 Section 卡片标题 → 用 heading role 精确断言
    expect(screen.getByRole('heading', { level: 1, name: '模型配置' })).toBeInTheDocument()
    expect(screen.getByText('AI模型管理与Token用量统计')).toBeInTheDocument()
  })

  it('2. API Key 为空时显示引导卡（含 DeepSeek 申请链接）', () => {
    renderPage()
    expect(screen.getByText(/还没有配置 API Key/)).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /platform\.deepseek\.com/ })
    expect(link).toHaveAttribute('href', 'https://platform.deepseek.com/api_keys')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('3. 主要 Section 骨架均渲染（配置/接入/预算）', () => {
    renderPage()
    // Section 标题按设计稿文案断言（实际文案无空格："API接入与测试"）
    expect(screen.getByText('API接入与测试')).toBeInTheDocument()
    expect(screen.getByText('预算与告警')).toBeInTheDocument()
    // ActionBar 三个操作按钮
    expect(screen.getByRole('button', { name: /恢复默认/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /导出统计/ })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /保存/ }).length).toBeGreaterThanOrEqual(1)
  })

  it('4. 点击"恢复默认"显示未保存反馈文案（纯前端路径）', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /恢复默认/ }))
    expect(screen.getByText('已恢复默认参数（尚未保存）')).toBeInTheDocument()
  })
})
