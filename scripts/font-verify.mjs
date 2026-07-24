// font-verify.mjs
// 字体修复验证脚本：截取 3 个关键页面 + 收集控制台日志
// 运行: node scripts/font-verify.mjs

import { chromium } from '@playwright/test'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// ============================================================
// 配置
// ============================================================

const APP_BASE_URL = 'http://127.0.0.1:9876/'
const SCREENSHOT_DIR = join(__dirname, '..', 'docs', 'audit-screenshots')
const LOG_PATH = join(SCREENSHOT_DIR, 'font-verify-console.log')

const VIEWPORT_WIDTH = 1440
const VIEWPORT_HEIGHT = 900
const WAIT_AFTER_LOAD_MS = 3000 // 让 Web 字体加载完成

const PAGES = [
  { idx: 1, name: 'boot',      route: '/boot',      file: 'app-font-1-boot.png' },
  { idx: 2, name: 'workbench', route: '/workbench', file: 'app-font-2-workbench.png' },
  { idx: 3, name: 'monitor',   route: '/monitor',   file: 'app-font-3-monitor.png' },
]

function now() {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

function log(...args) {
  console.log(`[${now()}]`, ...args)
}

function bytesToKB(bytes) {
  return (bytes / 1024).toFixed(2)
}

// ============================================================
// 主流程
// ============================================================

async function main() {
  log('=== 字体修复验证脚本启动 ===')
  log(`应用 URL:   ${APP_BASE_URL}`)
  log(`截图输出:    ${SCREENSHOT_DIR}`)
  log(`截图尺寸:    ${VIEWPORT_WIDTH}x${VIEWPORT_HEIGHT}`)
  log(`等待时间:    ${WAIT_AFTER_LOAD_MS}ms`)
  log(`总页面数:    ${PAGES.length}`)

  if (!existsSync(SCREENSHOT_DIR)) {
    mkdirSync(SCREENSHOT_DIR, { recursive: true })
  }

  const browser = await chromium.launch({ headless: true })
  const allLogs = []
  const results = []

  try {
    for (const p of PAGES) {
      log(`--- 处理 #${p.idx}: ${p.name} (${p.route}) ---`)

      const ctx = await browser.newContext({
        viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
      })
      const page = await ctx.newPage()

      // 收集控制台消息
      const consoleMessages = []
      const pageErrors = []
      const requestFailed = []

      page.on('console', (msg) => {
        const type = msg.type()
        const text = msg.text()
        consoleMessages.push({ type, text, time: now() })
      })
      page.on('pageerror', (err) => {
        pageErrors.push({ message: err.message, stack: err.stack, time: now() })
      })
      page.on('requestfailed', (req) => {
        requestFailed.push({
          url: req.url(),
          failure: req.failure()?.errorText || 'unknown',
          time: now(),
        })
      })

      const url = `${APP_BASE_URL}#${p.route}`
      const pageLog = {
        page: p.name,
        url,
        consoleMessages,
        pageErrors,
        requestFailed,
      }
      allLogs.push(pageLog)

      try {
        // 用 domcontentloaded 避免 React 应用 networkidle 超时
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
        // 等待 Web 字体加载
        await page.waitForTimeout(WAIT_AFTER_LOAD_MS)
        // 等待字体加载完毕（document.fonts.ready）
        try {
          await page.evaluate(() => {
            if (document.fonts && document.fonts.ready) {
              return document.fonts.ready
            }
            return Promise.resolve()
          })
        } catch {
          // 忽略字体 ready 等待失败
        }

        const outPath = join(SCREENSHOT_DIR, p.file)
        await page.screenshot({ path: outPath, fullPage: false })

        const stats = statSync(outPath)
        const sizeKB = bytesToKB(stats.size)
        log(`✓ #${p.idx} ${p.name} -> ${outPath} (${sizeKB} KB)`)

        results.push({
          idx: p.idx,
          name: p.name,
          route: p.route,
          file: p.file,
          path: outPath,
          sizeBytes: stats.size,
          sizeKB,
          ok: true,
        })
      } catch (e) {
        log(`✗ #${p.idx} ${p.name} 失败: ${e.message}`)
        results.push({
          idx: p.idx,
          name: p.name,
          route: p.route,
          file: p.file,
          ok: false,
          error: e.message,
        })
      } finally {
        await ctx.close()
      }
    }
  } finally {
    await browser.close()
  }

  // 保存控制台日志
  const logContent = allLogs.map((l) => {
    const lines = []
    lines.push(`========== ${l.page} (${l.url}) ==========`)
    lines.push(`时间: ${now()}`)
    lines.push('')
    lines.push('--- 控制台消息 ---')
    if (l.consoleMessages.length === 0) {
      lines.push('(无)')
    } else {
      l.consoleMessages.forEach((m) => {
        lines.push(`[${m.type.toUpperCase()}] ${m.text}`)
      })
    }
    lines.push('')
    lines.push('--- 页面错误 ---')
    if (l.pageErrors.length === 0) {
      lines.push('(无)')
    } else {
      l.pageErrors.forEach((e) => {
        lines.push(`[ERROR] ${e.message}`)
        if (e.stack) lines.push(`  stack: ${e.stack}`)
      })
    }
    lines.push('')
    lines.push('--- 请求失败 ---')
    if (l.requestFailed.length === 0) {
      lines.push('(无)')
    } else {
      l.requestFailed.forEach((r) => {
        lines.push(`[FAIL] ${r.url} - ${r.failure}`)
      })
    }
    lines.push('')
    return lines.join('\n')
  }).join('\n')

  writeFileSync(LOG_PATH, logContent, 'utf-8')
  log(`控制台日志已保存: ${LOG_PATH}`)

  // 汇总
  log('=== 任务汇总 ===')
  const okCount = results.filter((r) => r.ok).length
  log(`截图成功: ${okCount}/${results.length}`)

  // 字体加载相关检查
  log('=== 字体加载检查 ===')
  const fontKeywords = ['font', 'Inter', 'JetBrains', 'woff', 'ttf']
  let fontErrors = 0
  let fontSuccess = 0

  for (const l of allLogs) {
    // 检查控制台消息
    l.consoleMessages.forEach((m) => {
      const lower = m.text.toLowerCase()
      if (fontKeywords.some((k) => lower.includes(k.toLowerCase()))) {
        if (m.type === 'error') {
          fontErrors++
          log(`  [字体错误] ${l.page}: ${m.text}`)
        } else {
          fontSuccess++
        }
      }
    })
    // 检查请求失败
    l.requestFailed.forEach((r) => {
      if (fontKeywords.some((k) => r.url.toLowerCase().includes(k.toLowerCase()))) {
        fontErrors++
        log(`  [字体请求失败] ${l.page}: ${r.url} - ${r.failure}`)
      }
    })
    // 检查页面错误
    l.pageErrors.forEach((e) => {
      const lower = (e.message || '').toLowerCase()
      if (fontKeywords.some((k) => lower.includes(k.toLowerCase()))) {
        fontErrors++
        log(`  [字体页面错误] ${l.page}: ${e.message}`)
      }
    })
  }

  log(`字体相关错误: ${fontErrors}`)
  log(`字体相关消息: ${fontSuccess}`)

  // 文件大小列表
  log('=== 截图文件大小 ===')
  for (const r of results) {
    if (r.ok) {
      log(`  ${r.file}: ${r.sizeKB} KB`)
    } else {
      log(`  ${r.file}: 失败 (${r.error})`)
    }
  }

  // 总结
  log('=== 总结 ===')
  const success = okCount === results.length && fontErrors === 0
  if (success) {
    log(`✓ 验证成功：${okCount}/${results.length} 截图完成，无字体加载错误`)
  } else {
    log(`✗ 验证有问题：截图 ${okCount}/${results.length}，字体错误 ${fontErrors}`)
  }

  log('=== 完成 ===')
}

main().catch((err) => {
  console.error('脚本异常:', err)
  process.exit(1)
})
