#!/usr/bin/env node
/**
 * 设置区导航真机验证（阶段 F3 判据）
 *
 * 要证明的行为：在设置区点左栏任意一项，左栏必须一直在、被点项必须高亮，
 * 且页面里不该再有一个"返回设置"按钮（那是导航卸载时代留下的重复出口）。
 *
 * 用法：先 npx electron-vite build，再 node scripts/design/verify-settings-nav.mjs
 * 退出码：0 = 六个导航项全部满足；非 0 = 打印失败项
 */
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')
const PORT = 9226
const ELECTRON = path.join(ROOT, 'node_modules/electron/dist/electron.exe')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

if (!fs.existsSync(path.join(ROOT, 'out/main/index.js'))) {
  console.error('缺少 out/main/index.js —— 先跑：npx electron-vite build')
  process.exit(2)
}

const app = spawn(ELECTRON, ['.', `--remote-debugging-port=${PORT}`], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
})
const appLog = []
app.stdout.on('data', (d) => appLog.push(d.toString()))
app.stderr.on('data', (d) => appLog.push(d.toString()))

async function findTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = list.find((t) => t.type === 'page' && /index\.html|localhost|127\.0\.0\.1/.test(t.url))
      if (page) return page
    } catch {
      /* CDP 还没起 */
    }
    await sleep(500)
  }
  throw new Error('等不到 CDP target\n' + appLog.join('').slice(-2000))
}

let msgId = 0
function cdp(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId
    const onMsg = (ev) => {
      const m = JSON.parse(typeof ev === 'string' ? ev : String(ev.data))
      if (m.id === id) {
        ws.removeEventListener('message', onMsg)
        if (m.error) reject(new Error(method + ': ' + JSON.stringify(m.error)))
        else resolve(m.result)
      }
    }
    ws.addEventListener('message', onMsg)
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function evalIn(ws, expression) {
  const r = await cdp(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error('页面脚本异常：' + JSON.stringify(r.exceptionDetails).slice(0, 400))
  return r.result.value
}

/** 点一个导航项，回报点完之后设置区到底是什么状态 */
const CLICK_AND_READ = (domId) => `(async () => {
  const el = document.querySelector('[data-dom-id="${domId}"]');
  if (!el) return { domId: '${domId}', missing: true };
  el.click();
  await new Promise((r) => setTimeout(r, 900));
  const nav = document.querySelector('.set-nav');
  const active = nav ? [...nav.querySelectorAll('.set-nav__item.is-active')].map((a) => a.textContent.trim()) : [];
  const head = document.querySelector('.set-pageheader h1, .set-ab-hero__name');
  return {
    domId: '${domId}',
    hash: location.hash,
    navKept: !!nav,
    navItems: nav ? nav.children.length : 0,
    active,
    heading: head ? head.textContent.trim().slice(0, 30) : null,
    backButtons: document.querySelectorAll('[data-dom-id="back-settings"]').length,
  };
})()`

let report = null
try {
  const target = await findTarget()
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', rej, { once: true })
  })
  await cdp(ws, 'Runtime.enable')

  // 进工作台：启动页加载完自己跳，脚本不点任何东西（2026-10-17 起那个按钮已经删掉了）
  for (let i = 0; i < 30; i++) {
    const phase = await evalIn(ws, `(() => {
      const loading = document.querySelector('[data-dom-id="boot-loading"]');
      return loading ? 'boot' : (document.querySelector('.wb-main-layout') ? 'workbench' : 'unrendered');
    })()`)
    if (phase === 'workbench') break
    await sleep(1000)
  }

  await evalIn(ws, `location.hash = '#/settings'`)
  await sleep(1200)
  const hubHeading = await evalIn(ws, `(() => {
    const nav = document.querySelector('.set-nav');
    return { navOnHub: !!nav, items: nav ? nav.children.length : 0 };
  })()`)

  const ids = ['nav-general', 'nav-ssh', 'nav-model-config', 'nav-alerts', 'nav-appearance', 'nav-about']
  const results = []
  for (const id of ids) {
    results.push(await evalIn(ws, CLICK_AND_READ(id)))
  }
  report = { hubHeading, results }

  console.log('=== F3 设置区导航真机验证（构建产物） ===')
  console.log(JSON.stringify(report, null, 2))

  const fail = []
  if (!hubHeading.navOnHub) fail.push('设置首页没有左栏导航')
  for (const r of results) {
    if (r.missing) fail.push(`${r.domId}: 导航项不存在`)
    else {
      if (!r.navKept) fail.push(`${r.domId}: 点完之后左栏被卸掉了（${r.hash}）`)
      if (!r.active.length) fail.push(`${r.domId}: 点完之后没有任何高亮项`)
      if (!r.heading) fail.push(`${r.domId}: 点完之后页面标题没渲染出来`)
      if (r.backButtons > 0) fail.push(`${r.domId}: 页面里还留着 ${r.backButtons} 个"返回设置"按钮`)
    }
  }

  if (fail.length) {
    console.error('\nFAIL:\n' + fail.join('\n'))
    process.exitCode = 1
  } else {
    console.log(`\nPASS：${results.length} 个导航项全部保住左栏、有高亮、有标题，且无重复返回口`)
  }
} catch (err) {
  console.error('验证脚本异常：' + (err?.stack || err))
  if (!report) console.error('未能取得任何实测数据，判为失败')
  process.exitCode = 1
} finally {
  app.kill()
  const bad = appLog.join('').split('\n').filter((l) => /\[ERROR\]|\.ERROR\b|Uncaught|FATAL/.test(l)).slice(-8)
  if (bad.length) console.log('\n--- 应用日志中的错误行 ---\n' + bad.join('\n'))
  process.exit(process.exitCode ?? 0)
}
