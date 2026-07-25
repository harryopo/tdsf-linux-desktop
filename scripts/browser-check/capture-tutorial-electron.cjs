const { _electron: electron, chromium } = require('@playwright/test')
const path = require('node:path')
const fs = require('node:fs')
const http = require('node:http')

const OUT_DIR = path.join(__dirname, 'screenshots-fresh')
const SCREENSHOT_PATH = path.join(OUT_DIR, 'app-tutorial-electron-real.png')
const CDP_URL = 'http://127.0.0.1:9223'
const PROJECT_ROOT = path.join(__dirname, '..', '..')
const ELECTRON_EXE = path.join(PROJECT_ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function checkCdpAvailable() {
  return new Promise((resolve) => {
    const req = http.get(`${CDP_URL}/json/version`, { timeout: 2000 }, (res) => {
      resolve(res.statusCode === 200)
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
  })
}

async function connectToExisting() {
  const available = await checkCdpAvailable()
  if (!available) return null
  try {
    const browser = await chromium.connectOverCDP(CDP_URL)
    const contexts = browser.contexts()
    if (!contexts.length) return null
    const pages = contexts[0].pages()
    const page = pages.find((p) => p.url().includes('index.html')) || pages[0]
    if (!page) return null
    console.log('[connect] attached to existing Electron via CDP')
    return { page, browser }
  } catch (err) {
    console.log('[connect] CDP attach failed:', err.message)
    return null
  }
}

async function launchFresh() {
  console.log('[launch] starting new Electron instance...')
  const app = await electron.launch({
    executablePath: ELECTRON_EXE,
    args: [PROJECT_ROOT, '--remote-debugging-port=9223'],
    env: {
      ...process.env,
      NODE_ENV: 'development',
    },
    timeout: 60000,
  })
  const page = await app.firstWindow({ timeout: 30000 })
  console.log('[launch] first window ready')
  return { app, page }
}

async function captureConsole(page) {
  const errors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text()
      if (!text.includes('favicon')) errors.push(text)
    }
  })
  page.on('pageerror', (err) => {
    errors.push(`[pageerror] ${err.message}`)
  })
  return errors
}

;(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true })

  let app = null
  let browser = null
  let page = null
  let source = 'unknown'

  const existing = await connectToExisting()
  if (existing) {
    page = existing.page
    browser = existing.browser
    source = 'cdp-existing'
  } else {
    const launched = await launchFresh()
    app = launched.app
    page = launched.page
    source = 'electron-launch'
  }

  const consoleErrors = await captureConsole(page)

  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.waitForLoadState('domcontentloaded')
  await sleep(2500)

  // 处理启动页：等待「进入工作台」按钮出现并点击
  const bootEnter = page.locator('[data-dom-id="boot-enter"]')
  try {
    await bootEnter.waitFor({ state: 'visible', timeout: 10000 })
    // 等待按钮可用（loaded 后 disabled=false）
    await page.waitForFunction(() => {
      const btn = document.querySelector('[data-dom-id="boot-enter"]')
      return btn && !(btn).disabled
    }, { timeout: 10000 })
    await bootEnter.click()
    console.log('[navigate] clicked boot-enter')
    await sleep(1500)
  } catch (e) {
    console.log('[navigate] no boot-enter button, current url:', page.url())
  }

  // 等待工作台左侧导航中的「教程」按钮
  const tutorialNav = page.locator('[data-dom-id="nav-tutorial"]')
  let navClicked = false
  try {
    await tutorialNav.waitFor({ state: 'visible', timeout: 15000 })
    // 点击「教程」
    await tutorialNav.click()
    navClicked = true
    console.log('[navigate] clicked nav-tutorial')
  } catch (e) {
    console.log('[navigate] nav-tutorial not visible, current url:', page.url())
    console.log('[navigate] falling back to direct hash navigation to #/tutorial')
    await page.evaluate(() => {
      window.location.hash = '#/tutorial'
    })
    await sleep(2000)
  }

  if (navClicked) {
    await sleep(1000)
  }

  // 等待 TutorialPage 关键元素出现
  await page.locator('input[placeholder*="搜索教程"]').first().waitFor({ state: 'visible', timeout: 20000 })
  await page.locator('.tut-stats-grid').first().waitFor({ state: 'visible', timeout: 20000 })

  // 等待异步教程数据加载完成（课程卡片至少 1 个或显示空状态）
  try {
    await page.waitForSelector('.tut-course-card, .tut-empty .ant-empty', { timeout: 10000 })
  } catch (e) {
    console.log('[wait] course cards not detected within 10s, continuing...')
  }

  // 额外等待确保分类计数、精选课程等异步数据渲染
  await sleep(3000)

  // 截图（整页）
  await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true })
  console.log('[screenshot] saved to', SCREENSHOT_PATH)

  // 提取页面数据
  const data = await page.evaluate(() => {
    const courseCards = document.querySelectorAll('.tut-course-card')
    const resultCards = document.querySelectorAll('.tut-result-card')
    const courseCount = courseCards.length || resultCards.length

    const statCards = document.querySelectorAll('.tut-stat-card')
    const stats = Array.from(statCards).map((card) => {
      const value = card.querySelector('.tut-stat-value')?.textContent?.trim() || ''
      const unit = card.querySelector('.tut-stat-unit')?.textContent?.trim() || ''
      const hint = card.querySelector('.tut-stat-desc')?.textContent?.trim() || ''
      return { value, unit, hint }
    })

    const catButtons = Array.from(document.querySelectorAll('.tut-cat-label'))
    const categories = catButtons.map((btn) => {
      const countEl = btn.querySelector('.tut-cat-count')
      const label = btn.childNodes[0]?.textContent?.trim() || btn.textContent.replace(/\s*\(\d+\)\s*$/, '').trim()
      return {
        label,
        count: countEl ? countEl.textContent.trim() : null,
        hasCount: !!countEl,
      }
    })

    const pathTitle = document.querySelector('.tut-path-progress-name')?.textContent?.trim() || ''
    const pathCount = document.querySelector('.tut-path-progress-count')?.textContent?.trim() || ''
    const pathPercent = document.querySelector('.tut-path-progress-fill')?.style?.width || ''
    const pathSteps = Array.from(document.querySelectorAll('.tut-path-node-label')).map((el) => el.textContent.trim())
    const pathDescs = Array.from(document.querySelectorAll('.tut-path-node-desc')).map((el) => el.textContent.trim())

    const featuredCount = document.querySelectorAll('.tut-featured-card').length
    const hasHeader = !!document.querySelector('.tut-page-header')
    const hasStats = statCards.length > 0
    const hasCourseList = courseCards.length > 0 || resultCards.length > 0
    const hasLearningPath = !!document.querySelector('.tut-path-timeline-card')
    const hasCategoryNav = catButtons.length > 0

    return {
      courseCount,
      featuredCount,
      stats,
      categories,
      learningPath: {
        title: pathTitle,
        progress: pathCount,
        percent: pathPercent,
        steps: pathSteps,
        descriptions: pathDescs,
      },
      hasHeader,
      hasStats,
      hasCourseList,
      hasLearningPath,
      hasCategoryNav,
    }
  })

  // 收集 UI 异常线索
  const anomalies = []
  if (!data.hasHeader) anomalies.push('缺少页面头部 (tut-header)')
  if (!data.hasStats) anomalies.push('缺少统计区 (tut-stats-grid)')
  if (!data.hasCategoryNav) anomalies.push('缺少分类导航 (tut-cat-nav)')
  if (!data.hasCourseList) anomalies.push('课程列表为空（无 tut-course-card / tut-result-card）')
  if (!data.hasLearningPath) anomalies.push('缺少推荐学习路径 (tut-path-timeline-card)')
  if (consoleErrors.length > 0) anomalies.push(`控制台错误 ${consoleErrors.length} 条`)

  const result = {
    source,
    screenshot: SCREENSHOT_PATH,
    courseCount: data.courseCount,
    featuredCount: data.featuredCount,
    stats: data.stats,
    categories: data.categories,
    learningPath: data.learningPath,
    anomalies: anomalies.length > 0 ? anomalies : ['未发现明显 UI 异常'],
    consoleErrors: consoleErrors.slice(0, 10),
  }

  console.log('\n=== 教程页检查结果 ===')
  console.log(JSON.stringify(result, null, 2))

  if (app) await app.close()
  if (browser) await browser.close()
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
