const { chromium } = require('@playwright/test')
const path = require('node:path')
const fs = require('node:fs')
const http = require('node:http')

const OUT_DIR = path.join(__dirname, 'screenshots-fresh')
const RENDERER_DIR = path.join(__dirname, '..', '..', 'out', 'renderer')
const DESIGN_DIR = 'd:\\ai\\linux教学一体\\参考资料\\前端设计\\pages'
const PORT = 9881

fs.mkdirSync(OUT_DIR, { recursive: true })

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

const DESIGN_PAGES = [
  { name: 'boot', file: '启动加载.html' },
  { name: 'workbench', file: '工作台.html' },
  { name: 'tutorial', file: '运维教程.html' },
  { name: 'monitor', file: '实时监控.html' },
  { name: 'history', file: '历史决策.html' },
  { name: 'knowledge', file: '知识库.html' },
  { name: 'logs', file: '系统日志.html' },
  { name: 'settings-general', file: '通用设置.html' },
  { name: 'settings-model', file: '模型配置.html' },
  { name: 'settings-appearance', file: '外观设置.html' },
  { name: 'settings-risk', file: '风险控制.html' },
  { name: 'settings-ssh', file: 'SSH 连接.html' },
  { name: 'settings-terminal', file: '终端设置.html' },
  { name: 'settings-decision', file: '决策控制.html' },
  { name: 'settings-about', file: '关于.html' },
  { name: 'history-detail', file: '历史决策详情.html' },
  { name: 'knowledge-detail', file: '知识详情.html' },
  { name: 'decision-detail', file: 'AI可信决策.html' },
  { name: 'tutorial-detail', file: '教程详情.html' },
]

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

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.log(`[console error] ${msg.text()}`)
    }
  })
  page.on('pageerror', (err) => {
    console.log(`[page error] ${err.message}`)
  })

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
