/**
 * tests/components/pages/BootPage.test.tsx - BootPage 组件级 RTL 测试（Task-2.1 P1-5）
 *
 * 覆盖范围：
 * 1. WebGL 不支持时降级到 webglFailed=true（jsdom 自然不支持 WebGL，触发 catch 分支）
 * 2. prefers-reduced-motion 时直接 loaded=true（跳过 3s 进度动画）
 * 3. loaded=false 时按钮 disabled（初始态不可点击）
 * 4. loaded=true 时点击跳转 /workbench（mock useNavigate）
 *
 * 关键决策：
 * - 用 jsdom 环境（文件头指令）— React 组件需要 DOM
 * - 不 mock three：jsdom 自然无法创建 WebGLRenderer，会触发 BootPage 的 catch 分支
 *   这恰好测试了 P1-1 / P1-2 的 webglFailed 降级路径
 * - mock react-router-dom 的 useNavigate：验证跳转调用
 * - mock window.matchMedia：分别测试 reducedMotion=true / false 两种路径
 *
 * 调研依据：Task-2.1 P1-5 单元测试要求
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import type {} from '@testing-library/jest-dom'

// ============================================================================
// Mock react-router-dom：拦截 useNavigate 验证跳转调用
// ============================================================================
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

import { BootPage } from '@renderer/pages/BootPage'

// ============================================================================
// 工具：matchMedia mock 工厂
// ============================================================================
/**
 * 创建 matchMedia mock，可控制 matches 返回值
 * @param matchesByQuery 按 query 字符串返回 matches 值的映射；未命中默认 false
 */
function createMatchMedia(matchesByQuery: Record<string, boolean> = {}) {
  return (query: string) => ({
    matches: matchesByQuery[query] ?? false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  })
}

// ============================================================================
// 测试用例
// ============================================================================

describe('BootPage — WebGL 降级与可访问性', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // 默认 matchMedia：所有 query 返回 false（即 reducedMotion=false）
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(createMatchMedia()),
    })
    // 静默 BootPage 在 jsdom 下 WebGL 失败的预期 error 日志（避免测试输出噪声）
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockNavigate.mockClear()
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('1. WebGL 不支持时降级到 webglFailed=true（渲染径向渐变 fallback 层）', async () => {
    // jsdom 不支持 WebGL，THREE.WebGLRenderer 构造会抛错
    // BootPage 的 catch 块设置 webglFailed=true，渲染 fallback div（含 radial-gradient）
    const { container } = render(
      <BootPage />
    )

    // 等待 useEffect 触发 + setState 完成渲染
    // 注：jsdom 不解析 CSS 变量，inline style 的 radial-gradient 可能被丢弃
    // 改用 class 选择器：fallback div 的 z-[1] 类是唯一的（CSS 转义 \[ \]）
    await waitFor(() => {
      const fallback = container.querySelector('.pointer-events-none.z-\\[1\\]')
      expect(fallback).not.toBeNull()
      expect(fallback).toBeInTheDocument()
    })

    // 同时验证 catch 块的 console.error 被调用（带 BootPage 标识）
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[BootPage] WebGL shader 初始化失败'),
      expect.any(Error)
    )
  })

  it('2. prefers-reduced-motion 时直接 loaded=true + progress=100', async () => {
    // mock matchMedia：prefers-reduced-motion: reduce 命中
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(
        createMatchMedia({ '(prefers-reduced-motion: reduce)': true })
      ),
    })

    render(<BootPage />)

    // 按钮应立即可点击（loaded=true）
    const button = await screen.findByRole('button', { name: /进入工作台/ })
    await waitFor(() => {
      expect(button).not.toBeDisabled()
    })

    // progressbar 应报告 100%
    const progressbar = screen.getByRole('progressbar', { name: /加载进度/ })
    expect(progressbar).toHaveAttribute('aria-valuenow', '100')
    expect(progressbar).toHaveAttribute('aria-valuemin', '0')
    expect(progressbar).toHaveAttribute('aria-valuemax', '100')

    // 状态文字应为「就绪」态
    // 注：P1-3 修复后，sr-only span 和可见 .boot-progress-label 都有该文本
    // 用 getAllByText 处理多匹配
    const statusTexts = screen.getAllByText(/就绪 · 点击进入工作台/)
    expect(statusTexts.length).toBeGreaterThanOrEqual(1)
    expect(statusTexts[0]).toBeInTheDocument()
  })

  it('3. loaded=false 时按钮 disabled（初始态不可点击）', () => {
    // 默认 matchMedia: reducedMotion=false → RAF 启动但 3.5s 内 loaded=false
    render(<BootPage />)

    const button = screen.getByRole('button', { name: /进入工作台/ })
    expect(button).toBeDisabled()
  })

  it('4. loaded=true 时点击按钮跳转 /workbench', async () => {
    // 用 reducedMotion=true 让 loaded 立即为 true，避免等 3.5s 动画
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(
        createMatchMedia({ '(prefers-reduced-motion: reduce)': true })
      ),
    })

    render(<BootPage />)

    const button = await screen.findByRole('button', { name: /进入工作台/ })
    await waitFor(() => expect(button).not.toBeDisabled())

    fireEvent.click(button)

    expect(mockNavigate).toHaveBeenCalledTimes(1)
    expect(mockNavigate).toHaveBeenCalledWith('/workbench', { replace: true })
  })

  it('5. progressbar 拥有正确的 a11y 属性（role + aria-value*）', () => {
    render(<BootPage />)

    const progressbar = screen.getByRole('progressbar')
    expect(progressbar).toHaveAttribute('aria-valuenow')
    expect(progressbar).toHaveAttribute('aria-valuemin', '0')
    expect(progressbar).toHaveAttribute('aria-valuemax', '100')
    expect(progressbar).toHaveAttribute('aria-label', '加载进度')
  })

  it('6. 进入工作台按钮带 data-dom-id="boot-enter"（交互契约）', () => {
    render(<BootPage />)

    const button = screen.getByRole('button', { name: /进入工作台/ })
    expect(button).toHaveAttribute('data-dom-id', 'boot-enter')
  })
})
