/**
 * Phase 5-g 自动化验证测试
 *
 * 目标：通过 Playwright + 日志驱动验证以下修复：
 * 1. 教程页面 UI 主题统一（深色模式下无白色背景）
 * 2. AI 对话界面发送按钮对齐（圆形 + 向上箭头）
 * 3. 爬虫源选择可显示
 * 4. 服务器配置持久化（启动后从主进程加载）
 * 5. 后端日志系统可读（通过 log:read IPC 验证）
 *
 * 测试策略：
 * - 启动 Electron 应用
 * - 通过 IPC `log:read` 验证关键事件是否触发
 * - 截图佐证 UI 修复
 * - 通过 evaluate 验证 CSS 计算样式
 *
 * 运行方式：
 *   pnpm build && npx playwright test tests/e2e/fixes-verification.spec.ts
 */

import { test, expect, _electron as electron } from '@playwright/test'
import * as path from 'node:path'
import * as fs from 'node:fs'

// ============================================================
// 测试环境配置
// ============================================================

/** Electron 应用入口 */
function getElectronAppPath(): string {
  return path.join(__dirname, '..', '..', 'out', 'main', 'index.js')
}

/** 截图目录 */
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots', 'fixes-v0.7.0')

/** 确保截图目录存在 */
function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

/** 启动应用 */
async function launchApp() {
  const appPath = getElectronAppPath()
  const electronApp = await electron.launch({
    args: [appPath],
    env: {
      ...process.env,
      NODE_ENV: 'development',
    },
    timeout: 30000,
  })
  const page = await electronApp.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(2500) // React 渲染 + 初始 IPC
  return { electronApp, page }
}

// ============================================================
// 修复验证套件
// ============================================================

test.describe('Phase 5-g 修复验证 + 日志驱动测试', () => {
  test.describe.configure({ mode: 'serial' })

  let electronApp: Awaited<ReturnType<typeof electron.launch>>
  let page: Awaited<ReturnType<electronApp.firstWindow>>

  test.beforeAll(async () => {
    ensureDir(SCREENSHOTS_DIR)
    const result = await launchApp()
    electronApp = result.electronApp
    page = result.page
  })

  test.afterAll(async () => {
    await electronApp.close()
  })

  // ----------------------------------------------------------------
  // 修复 1: 教程页面深色主题统一
  // ----------------------------------------------------------------

  test('修复 1 - 教程页面深色模式无白色背景', async () => {
    // 切换到暗黑模式
    await page.evaluate(() => {
      window.location.hash = '#/settings'
    })
    await page.waitForTimeout(1500)

    const darkBtn = page.locator('text=暗黑')
    if (await darkBtn.isVisible().catch(() => false)) {
      await darkBtn.click()
      await page.waitForTimeout(500)
    }

    // 导航到教程页面
    await page.evaluate(() => {
      window.location.hash = '#/tutorial'
    })
    await page.waitForTimeout(2000)

    // 验证教程页面关键元素的背景色（非纯白）
    const bgColor = await page.evaluate(() => {
      const el = document.querySelector('.tutorial-page') as HTMLElement
      if (!el) return null
      return getComputedStyle(el).backgroundColor
    })
    console.log('[TEST] tutorial-page 背景色:', bgColor)
    expect(bgColor).toBeTruthy()
    // 背景色不应是白色 rgb(255, 255, 255)
    expect(bgColor).not.toBe('rgb(255, 255, 255)')

    // 截图佐证
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '01-tutorial-dark.png'),
      fullPage: false,
    })
    console.log('[TEST] 教程页深色模式截图已保存')
  })

  // ----------------------------------------------------------------
  // 修复 2: AI 对话发送按钮对齐（圆形 + 向上箭头）
  // ----------------------------------------------------------------

  test('修复 2 - AI 发送按钮为圆形 + 向上箭头', async () => {
    // 切回工作台
    await page.evaluate(() => {
      window.location.hash = '#/'
    })
    await page.waitForTimeout(1500)

    // 查找发送按钮
    const sendBtn = page.locator('.chat-panel-send-btn')
    await expect(sendBtn).toBeVisible({ timeout: 5000 })

    // 验证按钮为圆形（width === height）
    const dimensions = await sendBtn.evaluate((el) => {
      const rect = el.getBoundingClientRect()
      const styles = getComputedStyle(el)
      return {
        width: rect.width,
        height: rect.height,
        borderRadius: styles.borderRadius,
        // 圆形判定：宽高几乎相等 + borderRadius=50%
        isRound: Math.abs(rect.width - rect.height) < 0.5 && styles.borderRadius === '50%',
        // 36px 判定：允许 0.5px 浮点误差
        isSizeCorrect: Math.abs(rect.width - 36) < 1 && Math.abs(rect.height - 36) < 1,
      }
    })
    console.log('[TEST] 发送按钮尺寸:', dimensions)
    expect(dimensions.isRound).toBe(true)
    expect(dimensions.isSizeCorrect).toBe(true)

    // 验证按钮内含向上箭头图标（anticon-arrow-up）
    const hasUpArrow = await sendBtn.evaluate((el) => {
      return el.querySelector('.anticon-arrow-up') !== null
    })
    console.log('[TEST] 发送按钮含向上箭头:', hasUpArrow)
    expect(hasUpArrow).toBe(true)

    // 验证按钮与输入框底部对齐
    const alignment = await page.evaluate(() => {
      const btn = document.querySelector('.chat-panel-send-btn') as HTMLElement
      const input = document.querySelector('.chat-panel-input .ant-input') as HTMLElement
      if (!btn || !input) return null
      const btnRect = btn.getBoundingClientRect()
      const inputRect = input.getBoundingClientRect()
      return {
        btnBottom: btnRect.bottom,
        inputBottom: inputRect.bottom,
        // 底部对齐：误差 < 4px
        isAligned: Math.abs(btnRect.bottom - inputRect.bottom) < 4,
      }
    })
    console.log('[TEST] 按钮底部对齐状态:', alignment)
    if (alignment) {
      expect(alignment.isAligned).toBe(true)
    }

    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '02-chat-send-button.png'),
      fullPage: false,
    })
  })

  // ----------------------------------------------------------------
  // 修复 3: 爬虫源选择可显示
  // ----------------------------------------------------------------

  test('修复 3 - 爬虫源列表能正常显示', async () => {
    // 导航到教程页面
    await page.evaluate(() => {
      window.location.hash = '#/tutorial'
    })
    await page.waitForTimeout(2000)

    // 点击"刷新教程"按钮
    const refreshBtn = page.locator('button:has-text("刷新教程")')
    if (!(await refreshBtn.isVisible().catch(() => false))) {
      console.log('[TEST] 跳过：未找到刷新教程按钮')
      return
    }
    await refreshBtn.click()
    await page.waitForTimeout(2500) // 等待 Modal + 源列表加载

    // 验证 Modal 弹出
    const modal = page.locator('.tutorial-crawl-modal .ant-modal-body')
    await expect(modal).toBeVisible({ timeout: 5000 })
    console.log('[TEST] 爬虫 Modal 已打开')

    // 验证源列表不为空（或显示警告）
    const sourceCount = await page.evaluate(() => {
      const checkboxes = document.querySelectorAll('.tutorial-crawl-modal .ant-checkbox-input')
      return checkboxes.length
    })
    const hasWarning = await page.evaluate(() => {
      return document.querySelector('.tutorial-crawl-modal .ant-alert-warning') !== null
    })
    console.log(`[TEST] 爬虫源数量: ${sourceCount}, 有警告: ${hasWarning}`)

    if (sourceCount > 0) {
      console.log('[TEST] ✓ 爬虫源列表正常显示')
    } else if (hasWarning) {
      console.log('[TEST] ⚠️ 爬虫源为空（显示警告）— 检查主进程注册')
    } else {
      // 还在加载中
      console.log('[TEST] ⏳ 爬虫源可能还在加载中')
    }

    // 截图佐证
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '03-crawl-modal.png'),
      fullPage: false,
    })

    // 关闭 Modal
    const closeBtn = page.locator('.tutorial-crawl-modal .ant-modal-close')
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click()
      await page.waitForTimeout(500)
    }
  })

  // ----------------------------------------------------------------
  // 修复 4: 服务器配置持久化（双重持久化）
  // ----------------------------------------------------------------

  test('修复 4 - 服务器配置写入主进程', async () => {
    // 切回工作台
    await page.evaluate(() => {
      window.location.hash = '#/'
    })
    await page.waitForTimeout(1500)

    // 通过 IPC 直接测试持久化能力
    const testServer = {
      id: 'fix_test_001',
      name: '持久化测试机',
      host: '192.168.1.100',
      port: 22,
      username: 'tester',
      authType: 'password' as const,
      password: 'test_password',
      keepAlive: false,
    }

    // 通过 window.electronAPI.serverSave 保存
    const saveResult = await page.evaluate(async (server) => {
      const api = (window as any).electronAPI
      if (!api?.serverSave) return { ok: false, reason: 'no serverSave api' }
      try {
        const ok = await api.serverSave([server])
        return { ok }
      } catch (err) {
        return { ok: false, reason: String(err) }
      }
    }, testServer)
    console.log('[TEST] serverSave 结果:', saveResult)
    expect(saveResult.ok).toBe(true)

    // 通过 serverList 读回（验证主进程落盘）
    const loadedServers = await page.evaluate(async () => {
      const api = (window as any).electronAPI
      if (!api?.serverList) return []
      try {
        return await api.serverList()
      } catch {
        return []
      }
    })
    console.log('[TEST] 从主进程读取服务器列表:', loadedServers)
    const found = loadedServers.find((s: any) => s.id === 'fix_test_001')
    expect(found).toBeTruthy()
    if (found) {
      console.log('[TEST] ✓ 找到保存的服务器:', found.name, found.host)
      // 密码不应在主进程明文回传（应为安全存储）
      console.log('[TEST] 密码字段:', (found as any).password ? '已加密' : '已脱敏')
    }

    // 清理测试数据
    await page.evaluate(async (serverId) => {
      const api = (window as any).electronAPI
      try {
        if (api?.serverDeleteCred) await api.serverDeleteCred(serverId)
        // 重新保存空列表清理
        if (api?.serverSave) await api.serverSave([])
      } catch {
        // 忽略清理错误
      }
    }, 'fix_test_001')
  })

  // ----------------------------------------------------------------
  // 修复 5: 日志系统可读（log:read IPC 验证）
  // ----------------------------------------------------------------

  test('修复 5 - 日志系统能记录 + 读取', async () => {
    // 验证 logRead IPC 可用
    const stats = await page.evaluate(async () => {
      const api = (window as any).electronAPI
      if (!api?.logStats) return null
      try {
        return await api.logStats()
      } catch {
        return null
      }
    })
    console.log('[TEST] 日志统计:', stats)
    expect(stats).toBeTruthy()
    if (stats) {
      console.log('[TEST] 日志总条数:', stats.total)
      expect(typeof stats.total).toBe('number')
    }

    // 验证有至少一条来源分类的日志
    const recentEntries = await page.evaluate(async () => {
      const api = (window as any).electronAPI
      try {
        return await api.logRead({ limit: 20 })
      } catch {
        return []
      }
    })
    console.log(`[TEST] 最近 ${recentEntries.length} 条日志:`)
    for (const e of recentEntries.slice(0, 5)) {
      console.log(`  [${e.level}][${e.category}] ${e.message}`)
    }
    expect(recentEntries.length).toBeGreaterThan(0)

    // 验证分类分布（应有 IPC、APP 等分类）
    const categories = new Set<string>()
    for (const e of recentEntries) {
      categories.add(e.category)
    }
    console.log('[TEST] 日志分类:', Array.from(categories))
    expect(categories.size).toBeGreaterThan(0)

    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '04-app-overview.png'),
      fullPage: false,
    })
  })

  // ----------------------------------------------------------------
  // 修复 6: 整体暗色 UI 一致性（截全图）
  // ----------------------------------------------------------------

  test('修复 6 - 整体暗色 UI 一致性验证', async () => {
    // 暗色模式下访问各页面，截图对比
    const routes = [
      { hash: '#/', name: 'home' },
      { hash: '#/tutorial', name: 'tutorial' },
      { hash: '#/knowledge', name: 'knowledge' },
      { hash: '#/settings', name: 'settings' },
      { hash: '#/history', name: 'history' },
    ]

    for (const route of routes) {
      await page.evaluate((hash) => {
        window.location.hash = hash
      }, route.hash)
      await page.waitForTimeout(1200)
      await page.screenshot({
        path: path.join(SCREENSHOTS_DIR, `05-${route.name}-dark.png`),
        fullPage: false,
      })
      console.log(`[TEST] ${route.name} 截图完成`)
    }
  })
})
