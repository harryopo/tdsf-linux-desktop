import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright 配置 - Electron E2E 测试
 *
 * 依据：方案书 §5.1
 * - Electron 必须串行（fullyParallel=false, workers=1）
 * - Electron 单实例，retries 仅 CI 开启
 * - trace/screenshot/video 失败时保留，便于排查
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // Electron 必须串行
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Electron 单实例
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['list'],
  ],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'electron',
      use: { ...devices['Desktop Electron'] },
    },
  ],
})
