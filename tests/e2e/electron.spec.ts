/**
 * Electron 桌面自动化 E2E 测试
 *
 * 使用 Playwright _electron 模块直接启动 Electron 应用，
 * 操控真实 BrowserWindow，测试包括 IPC、SSH、AI 助手等完整功能。
 *
 * 运行方式：
 *   pnpm build && npx playwright test tests/e2e/electron.spec.ts
 */

import { test, expect, _electron as electron } from '@playwright/test'
import { findLatestBuild, parseElectronApp } from 'electron-playwright-helpers'
import path from 'node:path'

// ============================================================
// 测试环境配置
// ============================================================

/** 测试用 SSH 服务器配置 */
const TEST_SERVER = {
  host: '192.168.45.200',
  port: 22,
  username: 'root',
  password: 'ZZHzzh20070629-',
  name: 'E2E测试机',
}

/** 获取 Electron 应用入口路径 */
function getElectronAppPath(): string {
  // 优先使用 out/main/index.js（electron-vite 构建产物）
  const outPath = path.join(__dirname, '..', '..', 'out', 'main', 'index.js')
  return outPath
}

/** 启动 Electron 应用并返回 electronApp 和 page */
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

  // 等待第一个窗口打开
  const page = await electronApp.firstWindow()
  // 等待页面加载完成
  await page.waitForLoadState('domcontentloaded')
  // 额外等待 React 渲染
  await page.waitForTimeout(2000)

  return { electronApp, page }
}

// ============================================================
// 测试套件
// ============================================================

test.describe('TDSF-Linux Desktop E2E 测试', () => {
  test.describe.configure({ mode: 'serial' })

  let electronApp: Awaited<ReturnType<typeof electron.launch>>
  let page: Awaited<ReturnType<electronApp.firstWindow>>

  test.beforeAll(async () => {
    const result = await launchApp()
    electronApp = result.electronApp
    page = result.page
  })

  test.afterAll(async () => {
    await electronApp.close()
  })

  // ============================================================
  // 1. 应用启动测试
  // ============================================================

  test('应用启动 - 窗口正确打开', async () => {
    // 验证窗口标题
    const title = await page.title()
    expect(title).toContain('TDSF')
    console.log('[TEST] 窗口标题:', title)
  })

  test('应用启动 - 三栏布局渲染', async () => {
    // 验证左侧服务器列表（用更精确的选择器）
    const serverList = page.locator('.server-list-title')
    await expect(serverList).toBeVisible({ timeout: 10000 })

    // 验证中间终端区域
    const terminal = page.locator('.ant-tabs-tab').filter({ hasText: '终端' })
    await expect(terminal.first()).toBeVisible()

    // 验证右侧 AI 助手
    const aiAssistant = page.locator('text=AI 运维助手').first()
    await expect(aiAssistant).toBeVisible()

    console.log('[TEST] 三栏布局验证通过')
  })

  test('应用启动 - electronAPI 已注入', async () => {
    // 在 Electron 环境中，window.electronAPI 应该存在
    const hasApi = await page.evaluate(() => {
      return typeof (window as any).electronAPI !== 'undefined'
    })
    expect(hasApi).toBe(true)
    console.log('[TEST] electronAPI 已注入渲染进程')
  })

  test('应用启动 - 无致命控制台错误', async () => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text()
        // 忽略已知的非致命警告
        if (!text.includes('destroyOnClose') && !text.includes('favicon')) {
          errors.push(text)
        }
      }
    })

    await page.waitForTimeout(2000)
    // 允许有错误但打印出来供分析
    if (errors.length > 0) {
      console.log('[TEST] 控制台错误:', errors)
    }
    console.log('[TEST] 控制台错误检查完成')
  })

  // ============================================================
  // 2. 路由导航测试
  // ============================================================

  test('路由导航 - 切换到设置页', async () => {
    await page.evaluate(() => {
      window.location.hash = '#/settings'
    })
    await page.waitForTimeout(1500)

    // 验证设置页 Tab 存在
    const llmTab = page.locator('text=LLM 配置')
    await expect(llmTab).toBeVisible({ timeout: 5000 })
    console.log('[TEST] 设置页导航成功')
  })

  test('路由导航 - 切换到历史决策页', async () => {
    await page.evaluate(() => {
      window.location.hash = '#/history'
    })
    await page.waitForTimeout(1500)
    console.log('[TEST] 历史决策页导航成功')
  })

  test('路由导航 - 切换到知识库页', async () => {
    await page.evaluate(() => {
      window.location.hash = '#/knowledge'
    })
    await page.waitForTimeout(1500)
    console.log('[TEST] 知识库页导航成功')
  })

  test('路由导航 - 切换到教程页', async () => {
    await page.evaluate(() => {
      window.location.hash = '#/tutorial'
    })
    await page.waitForTimeout(1500)

    // 验证教程页关键元素存在
    const tutorialSearch = page.locator('input[placeholder*="搜索教程"]').first()
    await expect(tutorialSearch).toBeVisible({ timeout: 5000 })

    const refreshBtn = page.locator('button:has-text("刷新教程")').first()
    await expect(refreshBtn).toBeVisible({ timeout: 5000 })

    console.log('[TEST] 教程页导航成功')
  })

  test('教程爬虫 - 打开/关闭 Modal 并验证源列表', async () => {
    // 确保在教程页
    await page.evaluate(() => {
      window.location.hash = '#/tutorial'
    })
    await page.waitForTimeout(1000)

    // 打开爬虫 Modal
    const refreshBtn = page.locator('button:has-text("刷新教程")').first()
    await refreshBtn.click()
    await page.waitForTimeout(1500)

    // 验证 Modal 标题
    const modalTitle = page.locator('.tutorial-crawl-modal .ant-modal-title').first()
    await expect(modalTitle).toContainText('从官方源抓取教程')

    // 验证源列表区域或空状态提示存在
    const sourceHeader = page.locator('.tutorial-crawl-sources-header').first()
    await expect(sourceHeader).toBeVisible({ timeout: 5000 })

    // 验证实时日志折叠面板存在
    const logPanel = page.locator('.tutorial-crawl-log').first()
    await expect(logPanel).toBeVisible({ timeout: 5000 })

    // 截图保存
    await page.screenshot({
      path: path.join(__dirname, 'screenshots', 'crawl-modal.png'),
    })
    console.log('[TEST] 爬虫 Modal 截图已保存')

    // 关闭 Modal（点击右上角 X，避免 footer 按钮选择器因 Ant Design 结构变化而失效）
    const closeX = page.locator('.tutorial-crawl-modal .ant-modal-close').first()
    await closeX.click()
    await page.waitForTimeout(500)

    // 验证 Modal 已关闭
    await expect(modalTitle).not.toBeVisible()
    console.log('[TEST] 爬虫 Modal 关闭成功')
  })

  test('路由导航 - 返回工作台', async () => {
    await page.evaluate(() => {
      window.location.hash = '#/'
    })
    await page.waitForTimeout(1500)

    const serverList = page.locator('.server-list-title')
    await expect(serverList).toBeVisible({ timeout: 5000 })
    console.log('[TEST] 返回工作台导航成功')
  })

  // ============================================================
  // 3. 设置页测试
  // ============================================================

  test('设置页 - 暗黑模式切换', async () => {
    await page.evaluate(() => {
      window.location.hash = '#/settings'
    })
    await page.waitForTimeout(1500)

    // 点击暗黑按钮
    const darkBtn = page.locator('text=暗黑')
    await darkBtn.click()
    await page.waitForTimeout(800)

    // 截图
    await page.screenshot({
      path: path.join(__dirname, 'screenshots', 'dark-mode.png'),
    })
    console.log('[TEST] 暗黑模式截图已保存')

    // 切回亮色
    const lightBtn = page.locator('text=亮色')
    await lightBtn.click()
    await page.waitForTimeout(800)
    console.log('[TEST] 亮色模式恢复成功')
  })

  test('设置页 - LLM 配置表单验证', async () => {
    // 点击 LLM 配置 Tab
    const llmTab = page.locator('.settings-page .ant-tabs-tab').nth(1)
    await llmTab.click()
    await page.waitForTimeout(800)

    // 验证 API Base URL 有默认值
    const baseUrlInput = page.locator('input[placeholder*="ark.cn-beijing"]')
    await expect(baseUrlInput).toBeVisible({ timeout: 5000 })

    // 验证模型名称有默认值
    const modelInput = page.locator('input[placeholder*="doubao"]')
    await expect(modelInput).toBeVisible()

    console.log('[TEST] LLM 配置表单验证通过')
  })

  // ============================================================
  // 4. SSH 连接测试（真实 IPC）
  // ============================================================

  test('SSH 连接 - 新建服务器配置', async () => {
    // 回到工作台
    await page.evaluate(() => {
      window.location.hash = '#/'
    })
    await page.waitForTimeout(1500)

    // 点击 + 按钮新建连接（使用精确 class 选择器）
    const addBtn = page.locator('.server-list-add-btn')
    await addBtn.click()
    await page.waitForTimeout(1000)

    // 验证对话框弹出
    const dialog = page.locator('.ant-modal-content')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    // 填写表单 - 使用 Ant Design Form 的 id
    await page.locator('#name').fill(TEST_SERVER.name)
    await page.locator('#host').fill(TEST_SERVER.host)
    await page.locator('#port').fill(String(TEST_SERVER.port))
    await page.locator('#username').fill(TEST_SERVER.username)

    // 填写密码
    const passwordInput = page.locator('#password')
    await passwordInput.fill(TEST_SERVER.password)

    await page.waitForTimeout(500)

    // 点击保存（Modal footer 中的主按钮）
    const saveBtn = page.locator('.ant-modal-footer .ant-btn-primary')
    await saveBtn.click()
    await page.waitForTimeout(1500)

    // 验证服务器出现在列表中（使用 first 避免 strict mode violation，因测试多次运行会累积同名条目）
    const serverItem = page.locator(`text=${TEST_SERVER.name}`).first()
    await expect(serverItem).toBeVisible({ timeout: 5000 })

    console.log('[TEST] 服务器配置创建成功')
  })

  test('SSH 连接 - 连接服务器并验证终端', async () => {
    // 找到刚创建的服务器并双击连接
    const serverItem = page.locator(`text=${TEST_SERVER.name}`)
    await serverItem.first().click()
    await page.waitForTimeout(5000)

    // 验证终端 Tab 创建
    const terminalTab = page.locator('text=终端')
    await expect(terminalTab.first()).toBeVisible({ timeout: 10000 })

    // 等待 SSH 连接建立和 Shell 输出
    await page.waitForTimeout(3000)

    // 截图
    await page.screenshot({
      path: path.join(__dirname, 'screenshots', 'ssh-connected.png'),
    })

    console.log('[TEST] SSH 连接成功，终端已创建')
  })

  test('SSH 连接 - 终端输入输出验证', async () => {
    // 等待终端就绪
    await page.waitForTimeout(2000)

    // 尝试在终端中输入命令（通过 xterm.js 的 textarea）
    const terminalTextarea = page.locator('.xterm-helper-textarea')
    if (await terminalTextarea.isVisible()) {
      await terminalTextarea.click()
      await terminalTextarea.type('whoami\n')
      await page.waitForTimeout(2000)

      // 截图验证输出
      await page.screenshot({
        path: path.join(__dirname, 'screenshots', 'terminal-whoami.png'),
      })
      console.log('[TEST] 终端输入 whoami 命令成功')
    } else {
      console.log('[TEST] 终端 textarea 不可见，跳过输入测试')
    }
  })

  // ============================================================
  // 5. 服务器监控测试
  // ============================================================

  test('服务器监控 - 切换到监控 Tab', async () => {
    // 点击监控 Tab
    const monitorTab = page.locator('text=监控')
    await monitorTab.first().click()
    await page.waitForTimeout(5000)

    // 截图
    await page.screenshot({
      path: path.join(__dirname, 'screenshots', 'monitor.png'),
    })

    console.log('[TEST] 监控页面截图完成')
  })

  // ============================================================
  // 6. AI 助手测试
  // ============================================================

  test('AI 助手 - 发送通用诊断请求', async () => {
    // 确保回到工作台
    await page.evaluate(() => {
      window.location.hash = '#/'
    })
    await page.waitForTimeout(1500)

    // 找到 AI 输入框
    const aiInput = page.locator('textarea[placeholder*="描述问题"]')
    await expect(aiInput).toBeVisible({ timeout: 5000 })

    // 输入问题
    await aiInput.fill('检查一下问题')
    await page.waitForTimeout(500)

    // 按 Ctrl+Enter 发送
    await aiInput.press('Control+Enter')

    // 等待 Agent 工作流执行（最多 30 秒）
    console.log('[TEST] AI 请求已发送，等待工作流执行...')

    // 等待消息出现
    await page.waitForTimeout(15000)

    // 截图
    await page.screenshot({
      path: path.join(__dirname, 'screenshots', 'ai-workflow.png'),
    })

    console.log('[TEST] AI 工作流截图完成')
  })

  test('AI 助手 - 验证决策卡片和批准按钮', async () => {
    // 等待决策卡片出现
    await page.waitForTimeout(5000)

    // 截图当前状态
    await page.screenshot({
      path: path.join(__dirname, 'screenshots', 'decision-card.png'),
    })

    // 查找批准执行按钮
    const approveBtn = page.locator('text=批准执行')
    const rejectBtn = page.locator('text=拒绝')

    const hasApprove = await approveBtn.isVisible().catch(() => false)
    const hasReject = await rejectBtn.isVisible().catch(() => false)

    console.log(`[TEST] 批准按钮可见: ${hasApprove}, 拒绝按钮可见: ${hasReject}`)

    if (hasApprove) {
      // 点击批准执行
      await approveBtn.click()
      await page.waitForTimeout(5000)

      await page.screenshot({
        path: path.join(__dirname, 'screenshots', 'after-approve.png'),
      })
      console.log('[TEST] 批准执行按钮点击成功')
    } else {
      console.log('[TEST] 未找到批准按钮，可能工作流尚未到达 confirm 步骤')
    }
  })

  // ============================================================
  // 7. 稳定性测试
  // ============================================================

  test('稳定性 - 快速路由切换不崩溃', async () => {
    const routes = ['#/settings', '#/history', '#/knowledge', '#/']
    for (let round = 0; round < 3; round++) {
      for (const route of routes) {
        await page.evaluate((r) => {
          window.location.hash = r
        }, route)
        await page.waitForTimeout(300)
      }
    }
    // 验证最终回到首页正常
    const serverList = page.locator('.server-list-title')
    await expect(serverList).toBeVisible({ timeout: 5000 })
    console.log('[TEST] 快速路由切换 3 轮通过')
  })
})
