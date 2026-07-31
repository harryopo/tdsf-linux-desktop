/**
 * Vitest 配置（v0.9.6 P2 M7 升级：支持 React 组件测试）
 *
 * 配置要点：
 * 1. 别名：@main / @shared（credibility IPC 测试需要）
 * 2. environment: 'node'（默认，兼容所有现有 1004+ 单元测试）
 * 3. setupFiles: tests/test-setup.ts（jest-dom 扩展 + 浏览器 polyfill）
 *    注意：test-setup 含 jsdom-only polyfill，仅 .tsx 组件测试用 jsdom
 * 4. include: tests/**\/*.test.{ts,tsx}（同时支持 .ts 和 .tsx）
 * 5. server.deps.external: 跳过原生模块（electron / better-sqlite3 / electron-store）
 *
 * 关键决策（调研 39 §3.2）：
 * - 不全局 environment: 'jsdom'，避免破坏 1004+ 现有测试
 * - 组件测试文件加 `// @vitest-environment jsdom` 指令单独切到 jsdom
 * - 这样：
 *   ✅ 现有 1004+ 单元测试保持 100% 通过（node 环境）
 *   ✅ 组件测试用 jsdom（DOM + 浏览器 polyfill）
 *   ✅ test-setup 同时兼容两种环境（jest-dom 在 node 下也安全）
 *
 * 调研依据：idea-to-dev-output/39-v1.4-RTL组件测试调研报告.md
 */
import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@main': resolve(__dirname, 'src/main'),
      '@shared': resolve(__dirname, 'src/shared'),
      // 渲染层别名（tsx 组件测试用）
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      // tsconfig.web.json 中定义的 @/ 别名（渲染层组件通用）
      '@': resolve(__dirname, 'src/renderer/src')
    }
  },
  test: {
    /** 包含 .ts（算法/IPC）和 .tsx（React 组件） */
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', 'out', 'tests/e2e/**'],
    /**
     * 环境：node（默认）
     * - 现有 1004+ 单元测试（算法/IPC/工具）保持 node 环境
     * - 组件测试在文件头加 `// @vitest-environment jsdom` 单独切到 jsdom
     *
     * 这样可避免 jsdom 引入的：
     * - AbortSignal 实例类型变化（polite-fetch.test.ts 失败）
     * - vi.mock("child_process") hoist 行为变化（edit-formats.test.ts 失败）
     */
    environment: 'node',
    /**
     * setupFiles：每个测试文件执行前的全局初始化
     * 包含 jest-dom 扩展 + matchMedia / ResizeObserver polyfill + cleanup
     * 注：jsdom-only polyfill 在 node 环境下不生效但也无副作用
     */
    setupFiles: ['./tests/test-setup.ts'],
    /** 启用 vitest globals（describe / it / expect 无需 import） */
    globals: true,
    /** 不解析 CSS（jsdom 不支持，Antd CSS import 会警告） */
    css: false,
    server: {
      deps: {
        /**
         * 跳过预构建的原生/特殊模块
         * - electron：测试环境无 Electron
         * - better-sqlite3：原生模块（NODE_MODULE_VERSION 依赖）
         * - electron-store：依赖 electron
         */
        external: ['electron', 'better-sqlite3', 'electron-store', '@photostructure/sqlite-vec']
      }
    },
    /**
     * 覆盖率（v2.11 harness 修复 #1）：CI 以 `pnpm test -- --coverage` 运行并上传 codecov，
     * 此前缺 provider 导致覆盖率证据不可靠。启用 v8 provider，输出 text + lcov（供 codecov）。
     * 不设 thresholds，避免覆盖率门禁误红；覆盖率作为可观测信号而非硬门禁。
     */
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage',
      exclude: ['tests/**', 'out/**', '**/*.d.ts', '**/*.config.*', 'scripts/**'],
    },
  }
})
