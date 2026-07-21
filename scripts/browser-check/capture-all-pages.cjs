const { chromium } = require('@playwright/test')
const path = require('node:path')
const fs = require('node:fs')
const http = require('node:http')

const OUT_DIR = path.join(__dirname, 'screenshots')
const DESIGN_DIR = 'd:\\ai\\linux教学一体\\tdsf-linux-redesign\\pages'
const RENDERER_DIR = path.join(__dirname, '..', '..', 'out', 'renderer')
const PORT = 9880

// 确保输出目录存在
fs.mkdirSync(OUT_DIR, { recursive: true })

// 实际页面路由列表
const APP_ROUTES = [
  { name: 'boot', route: '/', wait: 4500 },
  { name: 'workbench', route: '#/workbench', wait: 2500 },
  { name: 'tutorial', route: '#/tutorial', wait: 2500 },
  { name: 'monitor', route: '#/monitor', wait: 2500 },
  { name: 'history', route: '#/history', wait: 2500 },
  { name: 'knowledge', route: '#/knowledge', wait: 2500 },
  { name: 'logs', route: '#/logs', wait: 2500 },
  { name: 'settings-general', route: '#/settings/general', wait: 2500 },
  { name: 'settings-model', route: '#/settings/model', wait: 2500 },
  { name: 'settings-appearance', route: '#/settings/appearance', wait: 2500 },
  { name: 'settings-risk', route: '#/settings/risk', wait: 2500 },
  { name: 'settings-ssh', route: '#/settings/ssh', wait: 2500 },
  { name: 'settings-terminal', route: '#/settings/terminal', wait: 2500 },
  { name: 'settings-decision', route: '#/settings/decision', wait: 2500 },
  { name: 'settings-about', route: '#/settings/about', wait: 2500 },
  { name: 'history-detail', route: '#/history/1', wait: 2500 },
  { name: 'knowledge-detail', route: '#/knowledge/1', wait: 2500 },
  { name: 'decision-detail', route: '#/decision/1', wait: 2500 },
  { name: 'tutorial-detail', route: '#/tutorial/1', wait: 2500 },
]

// 设计稿 HTML 文件映射
const DESIGN_PAGES = [
  { name: 'boot', file: 'boot.html' },
  { name: 'workbench', file: 'workbench-ai.html' },
  { name: 'tutorial', file: 'tutorial.html' },
  { name: 'monitor', file: 'monitor.html' },
  { name: 'history', file: 'history.html' },
  { name: 'knowledge', file: 'knowledge.html' },
  { name: 'logs', file: 'logs.html' },
  { name: 'settings-general', file: 'settings-general.html' },
  { name: 'settings-model', file: 'settings-model.html' },
  { name: 'settings-appearance', file: 'settings-appearance.html' },
  { name: 'settings-risk', file: 'settings-risk.html' },
  { name: 'settings-ssh', file: 'settings-ssh.html' },
  { name: 'settings-terminal', file: 'settings-terminal.html' },
  { name: 'settings-decision', file: 'settings-decision.html' },
  { name: 'settings-about', file: 'settings-about.html' },
  { name: 'history-detail', file: 'history-detail.html' },
  { name: 'knowledge-detail', file: 'knowledge-detail.html' },
  { name: 'decision-detail', file: 'decision-detail.html' },
  { name: 'tutorial-detail', file: 'tutorial-detail.html' },
]

// 启动静态文件服务器
function startStaticServer(root, port) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let filePath = path.join(root, decodeURIComponent(req.url.split('?')[0]))
      if (filePath.endsWith(path.sep)) filePath += 'index.html'
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404)
          res.end('Not found')
          return
        }
        const ext = path.extname(filePath)
        const ct = {
          '.html': 'text/html',
          '.js': 'application/javascript',
          '.css': 'text/css',
          '.svg': 'image/svg+xml',
          '.png': 'image/png',
          '.json': 'application/json',
        }[ext] || 'application/octet-stream'
        res.writeHead(200, { 'Content-Type': ct })
        res.end(data)
      })
    })
    server.listen(port, '127.0.0.1', () => {
      console.log(`Static server running at http://127.0.0.1:${port}`)
      resolve(server)
    })
  })
}

;(async () => {
  const server = await startStaticServer(RENDERER_DIR, PORT)

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })

  // 监听控制台错误
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.log(`[console error] ${msg.text()}`)
    }
  })
  page.on('pageerror', (err) => {
    console.log(`[page error] ${err.message}`)
  })

  // 截取实际应用各页面
  for (const item of APP_ROUTES) {
    const url = `http://127.0.0.1:${PORT}/index.html${item.route === '/' ? '' : item.route}`
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 })
    } catch (e) {
      console.log(`[app] ${item.name} goto timeout/networkidle, continue...`)
    }
    await page.waitForTimeout(item.wait)
    const outPath = path.join(OUT_DIR, `app-${item.name}.png`)
    await page.screenshot({ path: outPath, fullPage: false })
    console.log(`[app] ${item.name} -> ${outPath}`)
  }

  await browser.close()
  server.close()

  // 截取设计稿
  const dBrowser = await chromium.launch()
  const dPage = await dBrowser.newPage({ viewport: { width: 1920, height: 1080 } })

  for (const item of DESIGN_PAGES) {
    const filePath = path.join(DESIGN_DIR, item.file)
    if (!fs.existsSync(filePath)) {
      console.log(`[design] skip ${item.name}: ${filePath} not found`)
      continue
    }
    await dPage.goto(`file:///${filePath.replace(/\\/g, '/')}`, { waitUntil: 'networkidle', timeout: 10000 })
    await dPage.waitForTimeout(1500)
    const outPath = path.join(OUT_DIR, `design-${item.name}.png`)
    await dPage.screenshot({ path: outPath, fullPage: false })
    console.log(`[design] ${item.name} -> ${outPath}`)
  }

  await dBrowser.close()
  console.log('All screenshots captured.')
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
