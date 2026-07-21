/**
 * tests/test-setup.ts - Vitest 全局测试初始化（v0.9.6 P2 M7）
 *
 * 职责：
 * 1. 引入 jest-dom 扩展（toBeInTheDocument / toHaveTextContent 等语义化匹配器）
 * 2. Polyfill jsdom 缺失的浏览器 API（matchMedia / ResizeObserver / getComputedStyle）
 * 3. 每个测试后自动 cleanup（避免 React 组件残留）
 * 4. 抑制 React 18 act() 警告（仅测试环境）
 *
 * 兼容性：
 * - node 环境：跳过所有 window / ResizeObserver polyfill
 * - jsdom 环境：完整 polyfill
 * 通过检测 typeof window === 'undefined' 自动判断
 *
 * 调研依据：idea-to-dev-output/39-v1.4-RTL组件测试调研报告.md
 *
 * 注意：必须在 vitest.config.ts 的 `test.setupFiles` 中引用本文件。
 *       路径相对 config 文件根目录（项目根），不是 test 文件目录。
 */

import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// ============================================================================
// 浏览器 API Polyfill（仅 jsdom 环境）
// ============================================================================

/**
 * 检测是否在 jsdom 环境（避免 node 环境抛 ReferenceError）
 */
const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined'

if (isBrowser) {
  /**
   * window.matchMedia polyfill
   *
   * Ant Design 5 用 useResponsiveObserver 监听媒体查询断点；
   * jsdom 默认未实现 matchMedia，会导致断点判断失效并抛错。
   */
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(), // 兼容旧 API
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    })),
  })

  /**
   * ResizeObserver polyfill
   *
   * recharts ResponsiveContainer + reactflow 都依赖 ResizeObserver；
   * jsdom 默认未实现，会导致图表容器无法计算尺寸。
   */
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver

  /**
   * IntersectionObserver polyfill（reactflow / 部分 Ant Design 组件依赖）
   */
  globalThis.IntersectionObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return []
    }
    root = null
    rootMargin = ''
    thresholds = []
  } as unknown as typeof IntersectionObserver

  /**
   * scrollTo polyfill（Antd Modal / Drawer 关闭时调用）
   */
  if (!window.scrollTo) {
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
  }
}

// ============================================================================
// React Testing Library 自动 cleanup
// ============================================================================

/**
 * 每个测试后自动 unmount 组件 + 清理 DOM
 * 关键：避免前一个测试的组件残留影响后一个测试（共享 jsdom DOM）
 * 注：cleanup 在 node 环境下也安全（仅对已渲染的 React DOM 生效）
 */
afterEach(() => {
  cleanup()
})

// ============================================================================
// React 18 act() 警告抑制（仅测试环境）
// ============================================================================

// 静默 React 18 关于 not wrapped in act() 的警告
// （仅当确实无法避免时使用；理想是每个 fireEvent / render 都包 act）
// 实际 RTL 已自动包 act，这里保留作为保险
const originalConsoleError = console.error
console.error = (...args: unknown[]) => {
  const msg = String(args[0] ?? '')
  if (msg.includes('not wrapped in act')) return
  originalConsoleError(...args)
}

// ============================================================================
// 抑制 antd CSS import 警告（jsdom 不解析 CSS）
// ============================================================================

// 测试中不加载 CSS（jsdom 不支持），由 vitest.config.ts 的 css: false 兜底
