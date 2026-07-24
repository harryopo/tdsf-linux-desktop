// visual-audit.mjs
// 批量截图 21 个设计稿 HTML 和 21 个应用页面，生成对比 HTML 报告。
// 运行: node scripts/visual-audit.mjs

import { chromium } from '@playwright/test'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// ============================================================
// 配置
// ============================================================

const PROJECT_ROOT = join(__dirname, '..')
const DESIGN_DIR = 'd:\\ai\\linux教学一体\\design-assets\\pages'
const APP_BASE_URL = 'http://127.0.0.1:9876/'
const SCREENSHOT_DIR = join(PROJECT_ROOT, 'docs', 'audit-screenshots')
const REPORT_PATH = join(PROJECT_ROOT, 'docs', 'visual-audit-report.html')

const VIEWPORT_WIDTH = 1440
const VIEWPORT_HEIGHT = 900
const WAIT_AFTER_LOAD_MS = 2000

// ============================================================
// 21 对设计稿 ↔ 应用路由对照表
// ============================================================

const PAGES = [
  { idx: 1,  name: '启动加载',         designFile: '启动加载.html',        route: '/boot' },
  { idx: 2,  name: '工作台',           designFile: '工作台.html',          route: '/workbench' },
  { idx: 3,  name: '工作台-未连接',     designFile: '工作台(未连接).html',   route: '/workbench', note: '未连接状态' },
  { idx: 4,  name: '实时监控',          designFile: '实时监控.html',         route: '/monitor' },
  { idx: 5,  name: '系统日志',          designFile: '系统日志.html',         route: '/logs' },
  { idx: 6,  name: 'AI可信决策',        designFile: 'AI可信决策.html',       route: '/decision/1' },
  { idx: 7,  name: '决策控制',          designFile: '决策控制.html',         route: '/settings/decision' },
  { idx: 8,  name: '历史决策',          designFile: '历史决策.html',         route: '/history' },
  { idx: 9,  name: '历史决策详情',       designFile: '历史决策详情.html',     route: '/history/1' },
  { idx: 10, name: '知识库',            designFile: '知识库.html',           route: '/knowledge' },
  { idx: 11, name: '知识详情',          designFile: '知识详情.html',         route: '/knowledge/1' },
  { idx: 12, name: '运维教程',          designFile: '运维教程.html',         route: '/tutorial' },
  { idx: 13, name: '教程详情',          designFile: '教程详情.html',         route: '/tutorial/1' },
  { idx: 14, name: '设置',             designFile: '设置.html',             route: '/settings' },
  { idx: 15, name: '通用设置',          designFile: '通用设置.html',         route: '/settings/general' },
  { idx: 16, name: '外观设置',          designFile: '外观设置.html',         route: '/settings/appearance' },
  { idx: 17, name: '模型配置',          designFile: '模型配置.html',         route: '/settings/model' },
  { idx: 18, name: '风险控制',          designFile: '风险控制.html',         route: '/settings/risk' },
  { idx: 19, name: 'SSH连接',           designFile: 'SSH 连接.html',         route: '/settings/ssh' },
  { idx: 20, name: '终端设置',          designFile: '终端设置.html',         route: '/settings/terminal' },
  { idx: 21, name: '关于',             designFile: '关于.html',             route: '/settings/about' },
]

// ============================================================
// 工具函数
// ============================================================

function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function fileUrl(absolutePath) {
  // 把 Windows 路径转成 file:/// 形式，中文不进行 encodeURIComponent
  // chromium 能直接接受未编码的 file:// URL
  const normalized = absolutePath.replace(/\\/g, '/')
  return 'file:///' + normalized
}

function safeName(name) {
  // 用于文件名：移除空格和括号
  return name.replace(/[\s()]/g, '_')
}

function designScreenshotPath(p) {
  return join(SCREENSHOT_DIR, `design-${p.idx}-${safeName(p.name)}.png`)
}

function appScreenshotPath(p) {
  return join(SCREENSHOT_DIR, `app-${p.idx}-${safeName(p.name)}.png`)
}

function now() {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

function log(...args) {
  console.log(`[${now()}]`, ...args)
}

// ============================================================
// 截图核心
// ============================================================

async function captureDesign(page, p) {
  const designPath = join(DESIGN_DIR, p.designFile)
  if (!existsSync(designPath)) {
    log(`[design] ✗ 文件不存在: ${designPath}`)
    return { ok: false, error: '文件不存在', path: designPath }
  }
  const url = fileUrl(designPath)
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 15000 })
    // 给设计稿内部 CSS/JS 动画一点时间
    await page.waitForTimeout(WAIT_AFTER_LOAD_MS)
    const out = designScreenshotPath(p)
    await page.screenshot({ path: out, fullPage: false })
    log(`[design] ✓ #${p.idx} ${p.name} -> ${out}`)
    return { ok: true, path: out }
  } catch (e) {
    log(`[design] ✗ #${p.idx} ${p.name} 失败: ${e.message}`)
    return { ok: false, error: e.message, path: designPath }
  }
}

async function captureApp(page, p) {
  const url = `${APP_BASE_URL}#${p.route}`
  try {
    // 用 domcontentloaded 而非 networkidle，避免 React 应用迟迟不空闲导致超时
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await page.waitForTimeout(WAIT_AFTER_LOAD_MS)
    const out = appScreenshotPath(p)
    await page.screenshot({ path: out, fullPage: false })
    log(`[app]    ✓ #${p.idx} ${p.name} -> ${out}`)
    return { ok: true, path: out }
  } catch (e) {
    log(`[app]    ✗ #${p.idx} ${p.name} 失败: ${e.message}`)
    return { ok: false, error: e.message, url }
  }
}

// ============================================================
// HTML 报告生成
// ============================================================

function generateReport(results) {
  const rows = results.map((r) => {
    const designImg = r.design.ok
      ? `<img src="audit-screenshots/design-${r.idx}-${safeName(r.name)}.png" alt="design-${r.name}">`
      : `<div class="error-box">设计稿截图失败<br><small>${escapeHtml(r.design.error || '')}</small></div>`
    const appImg = r.app.ok
      ? `<img src="audit-screenshots/app-${r.idx}-${safeName(r.name)}.png" alt="app-${r.name}">`
      : `<div class="error-box">应用截图失败<br><small>${escapeHtml(r.app.error || '')}</small></div>`
    const status = r.design.ok && r.app.ok ? 'ok' : 'warn'
    const note = r.note ? ` <span class="note">(${escapeHtml(r.note)})</span>` : ''
    return `
      <div class="row ${status}">
        <div class="row-header">
          <span class="idx">#${r.idx}</span>
          <span class="title">${escapeHtml(r.name)}${note}</span>
          <span class="route">路由: <code>${escapeHtml(r.route)}</code></span>
          <span class="badge ${status}">${status === 'ok' ? 'OK' : 'WARN'}</span>
        </div>
        <div class="pair">
          <div class="cell">
            <div class="cell-label">设计稿</div>
            ${designImg}
          </div>
          <div class="cell">
            <div class="cell-label">应用</div>
            ${appImg}
          </div>
        </div>
      </div>`
  }).join('\n')

  const okCount = results.filter(r => r.design.ok && r.app.ok).length
  const warnCount = results.length - okCount

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>TDSF Linux Desktop - 视觉对比审计报告</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
    background: #0f1115; color: #e6e6e6;
  }
  header {
    position: sticky; top: 0; z-index: 10;
    background: #16181d; border-bottom: 1px solid #2a2d35;
    padding: 16px 24px;
    display: flex; align-items: center; justify-content: space-between;
  }
  header h1 { margin: 0; font-size: 18px; font-weight: 600; }
  header .meta { font-size: 12px; color: #888; }
  header .summary { display: flex; gap: 12px; }
  header .summary span {
    padding: 4px 10px; border-radius: 4px; font-size: 12px;
    background: #1f2229; border: 1px solid #2a2d35;
  }
  header .summary .ok { color: #4ade80; }
  header .summary .warn { color: #fbbf24; }
  header .summary .total { color: #60a5fa; }
  main { padding: 24px; max-width: 100%; }
  .row {
    background: #16181d; border: 1px solid #2a2d35;
    border-radius: 8px; padding: 12px 16px; margin-bottom: 16px;
  }
  .row.warn { border-color: #4a3a1a; }
  .row-header {
    display: flex; align-items: center; gap: 12px;
    margin-bottom: 10px; padding-bottom: 8px;
    border-bottom: 1px solid #2a2d35;
  }
  .row-header .idx {
    background: #2a2d35; color: #fff; padding: 2px 8px;
    border-radius: 4px; font-size: 12px; font-weight: 600;
  }
  .row-header .title { font-size: 14px; font-weight: 600; color: #fff; }
  .row-header .route { font-size: 12px; color: #888; margin-left: auto; }
  .row-header .route code { color: #60a5fa; background: #1f2229; padding: 2px 6px; border-radius: 3px; }
  .row-header .badge {
    padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;
  }
  .row-header .badge.ok { background: #14532d; color: #4ade80; }
  .row-header .badge.warn { background: #4a3a1a; color: #fbbf24; }
  .row-header .note { color: #fbbf24; font-size: 12px; font-weight: 400; }
  .pair {
    display: grid; grid-template-columns: 1fr 1fr; gap: 16px;
  }
  .cell { display: flex; flex-direction: column; }
  .cell-label {
    font-size: 12px; color: #888; margin-bottom: 6px;
    text-transform: uppercase; letter-spacing: 1px;
  }
  .cell img {
    width: 100%; height: auto; display: block;
    border: 1px solid #2a2d35; border-radius: 4px;
    background: #fff;
  }
  .error-box {
    background: #2a1a1a; border: 1px solid #5a2a2a; color: #fca5a5;
    padding: 16px; border-radius: 4px; font-size: 13px;
    min-height: 100px; display: flex; align-items: center; justify-content: center;
    text-align: center;
  }
  .error-box small { color: #888; display: block; margin-top: 4px; }
  footer {
    text-align: center; padding: 24px; color: #666; font-size: 12px;
    border-top: 1px solid #2a2d35;
  }
  @media (max-width: 1024px) {
    .pair { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>
<header>
  <div>
    <h1>TDSF Linux Desktop · 视觉对比审计报告</h1>
    <div class="meta">生成时间: ${now()} · 设计稿 vs 应用</div>
  </div>
  <div class="summary">
    <span class="total">共 ${results.length} 对</span>
    <span class="ok">成功 ${okCount}</span>
    <span class="warn">异常 ${warnCount}</span>
  </div>
</header>
<main>
${rows}
</main>
<footer>
  设计稿目录: design-assets/pages · 应用 dev server: http://127.0.0.1:9876 · 截图尺寸: ${VIEWPORT_WIDTH}x${VIEWPORT_HEIGHT}
</footer>
</body>
</html>`

  writeFileSync(REPORT_PATH, html, 'utf-8')
  log(`报告已生成: ${REPORT_PATH}`)
}

function escapeHtml(s) {
  if (!s) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ============================================================
// 主流程
// ============================================================

async function main() {
  log('=== 视觉审计脚本启动 ===')
  log(`设计稿目录: ${DESIGN_DIR}`)
  log(`应用 URL:   ${APP_BASE_URL}`)
  log(`截图输出:    ${SCREENSHOT_DIR}`)
  log(`截图尺寸:    ${VIEWPORT_WIDTH}x${VIEWPORT_HEIGHT}`)
  log(`总页面数:    ${PAGES.length}`)

  // 清空旧截图（只删 png，不删其他文件）
  ensureDir(SCREENSHOT_DIR)
  const oldFiles = readdirSync(SCREENSHOT_DIR).filter(f => f.endsWith('.png'))
  for (const f of oldFiles) {
    const fp = join(SCREENSHOT_DIR, f)
    try {
      // 用 unlinkSync 显式删除，避免引入额外 fs API
      const { unlinkSync } = await import('node:fs')
      unlinkSync(fp)
    } catch {
      // 忽略删除失败
    }
  }
  log(`已清空旧截图 ${oldFiles.length} 张`)

  // 启动浏览器
  const browser = await chromium.launch({ headless: true })

  const results = []

  try {
    for (const p of PAGES) {
      log(`--- 处理 #${p.idx}: ${p.name} ---`)

      // 设计稿截图：每次新建 context 避免上一页残留状态
      const designCtx = await browser.newContext({
        viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
      })
      const designPage = await designCtx.newPage()
      const designResult = await captureDesign(designPage, p)
      await designCtx.close()

      // 应用截图
      const appCtx = await browser.newContext({
        viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
      })
      const appPage = await appCtx.newPage()
      // 监听控制台错误，方便排查白屏
      const appErrors = []
      appPage.on('pageerror', (err) => appErrors.push(err.message))
      const appResult = await captureApp(appPage, p)
      if (appErrors.length > 0 && appResult.ok) {
        // 不影响截图成功，但记录到结果
        appResult.warnings = appErrors.slice(0, 3)
      }
      await appCtx.close()

      results.push({
        idx: p.idx,
        name: p.name,
        route: p.route,
        note: p.note,
        design: designResult,
        app: appResult,
      })
    }
  } finally {
    await browser.close()
  }

  // 生成报告
  generateReport(results)

  // 汇总
  const designOk = results.filter(r => r.design.ok).length
  const appOk = results.filter(r => r.app.ok).length
  log('=== 任务汇总 ===')
  log(`设计稿截图: ${designOk}/${results.length}`)
  log(`应用截图:   ${appOk}/${results.length}`)
  log(`总截图数:   ${designOk + appOk}/${results.length * 2}`)
  log(`报告路径:   ${REPORT_PATH}`)
  log('=== 完成 ===')

  // 列出失败项
  const failed = results.filter(r => !r.design.ok || !r.app.ok)
  if (failed.length > 0) {
    log('失败项:')
    for (const r of failed) {
      const parts = []
      if (!r.design.ok) parts.push(`design: ${r.design.error}`)
      if (!r.app.ok) parts.push(`app: ${r.app.error}`)
      log(`  #${r.idx} ${r.name}: ${parts.join(' | ')}`)
    }
  }
}

main().catch((err) => {
  console.error('脚本异常:', err)
  process.exit(1)
})
