#!/usr/bin/env node
/**
 * 页面诚实性真机验证（阶段 F4 判据）
 *
 * 静态测试已经禁止了源码里的假数据字面量，这里要回答的是运行时那半个问题：
 * 真实构建 + 真实用户库里，这些页面画出来的文字里还有没有示例值、
 * 有没有 undefined / NaN 这种崩到界面上的残渣，以及条目不存在时是不是诚实空态。
 *
 * 用法：先 npx electron-vite build，再 node scripts/design/verify-pages-honest.mjs
 * 退出码：0 = 五个页面全部实测有内容且无违禁字串；非 0 = 打印命中
 */
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')
const PORT = 9227
const ELECTRON = path.join(ROOT, 'node_modules/electron/dist/electron.exe')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 界面上不该出现的字样：示例数据残留 + 渲染残渣 */
const FORBIDDEN = [
  'KB-NGINX-014', 'P99延迟优化实战', '1,247', '3.2k', '示例数据', '演示数据',
  'undefined', 'NaN', '[object Object]',
]

const PAGES = [
  { hash: '#/', name: '工作台（AI 面板）', minChars: 20 },
  { hash: '#/knowledge', name: '知识库列表', minChars: 20 },
  { hash: '#/knowledge/does-not-exist', name: '知识详情（条目不存在）', minChars: 10, mustContain: '不存在' },
  { hash: '#/tutorial', name: '教程页', minChars: 20 },
  { hash: '#/logs', name: '系统日志', minChars: 20 },
  { hash: '#/decision', name: '决策页', minChars: 20 },
  { hash: '#/monitor', name: '监控页', minChars: 20 },
  { hash: '#/settings/about', name: '关于（功能就绪度）', minChars: 40, mustContain: '待开发' },
]

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

const READ = `(async () => {
  await new Promise((r) => setTimeout(r, 1800));
  const text = document.body.innerText || '';

  // 字号改由字阶提供后，行高也一并变成显式的了；这里查有没有文字被裁掉。
  // 只查叶子文字节点，且承认 text-overflow: ellipsis 是故意的截断。
  const clipped = [];
  for (const el of document.querySelectorAll('h1,h2,h3,h4,p,span,button,a,label,td,th,div')) {
    if (el.children.length > 0) continue;
    const label = (el.textContent || '').trim().slice(0, 24);
    if (!label) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.textOverflow === 'ellipsis') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 6) continue;
    const overflowY = el.scrollHeight - el.clientHeight;
    const overflowX = el.scrollWidth - el.clientWidth;
    const hidesY = cs.overflowY === 'hidden' || cs.overflow === 'hidden';
    const hidesX = cs.overflowX === 'hidden' || cs.overflow === 'hidden';
    if ((hidesY && overflowY > 3) || (hidesX && overflowX > 3)) {
      clipped.push(label + (hidesY && overflowY > 3 ? ' [纵向裁 ' + overflowY + 'px]' : '') + (hidesX && overflowX > 3 ? ' [横向裁 ' + overflowX + 'px]' : ''));
    }
  }

  return { hash: location.hash, chars: text.length, clipped: clipped.slice(0, 8), clippedCount: clipped.length, text: text.slice(0, 8000) };
})()`

let rows = null
try {
  const target = await findTarget()
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', rej, { once: true })
  })
  await cdp(ws, 'Runtime.enable')

  for (let i = 0; i < 30; i++) {
    const phase = await evalIn(ws, `(() => {
      const enter = document.querySelector('button[data-dom-id="boot-enter"]');
      return enter ? 'boot' : (document.querySelector('.wb-main-layout') ? 'workbench' : 'unrendered');
    })()`)
    if (phase === 'workbench') break
    if (phase === 'boot') await evalIn(ws, `document.querySelector('button[data-dom-id="boot-enter"]').click()`)
    await sleep(1000)
  }

  rows = []
  for (const p of PAGES) {
    await evalIn(ws, `location.hash = ${JSON.stringify(p.hash)}`)
    const r = await evalIn(ws, READ)
    const bad = FORBIDDEN.filter((w) => r.text.includes(w))
    const missing = p.mustContain && !r.text.includes(p.mustContain) ? p.mustContain : null
    rows.push({
      page: p.name,
      hash: r.hash,
      chars: r.chars,
      minChars: p.minChars,
      forbidden: bad,
      missing,
      clippedCount: r.clippedCount,
      clipped: r.clipped,
    })
  }

  console.log('=== F4 页面诚实性真机验证（构建产物 + 真实 userData 库） ===')
  console.log(JSON.stringify(rows, null, 2))

  const fail = []
  for (const r of rows) {
    if (r.chars < r.minChars) fail.push(`${r.page}：可见文本只有 ${r.chars} 字符（要求 ≥${r.minChars}），页面可能没渲染`)
    if (r.forbidden.length) fail.push(`${r.page}：界面出现违禁字串 ${r.forbidden.join(' / ')}`)
    if (r.missing) fail.push(`${r.page}：应当出现"${r.missing}"，实测没有`)
  }
  if (fail.length) {
    console.error('\nFAIL:\n' + fail.join('\n'))
    process.exitCode = 1
  } else {
    console.log(`\nPASS：${rows.length} 个页面实测有内容、无示例值残留、无 undefined/NaN`)
  }
} catch (err) {
  console.error('验证脚本异常：' + (err?.stack || err))
  if (!rows) console.error('未能取得任何实测数据，判为失败')
  process.exitCode = 1
} finally {
  app.kill()
  const bad = appLog.join('').split('\n').filter((l) => /\[ERROR\]|\.ERROR\b|Uncaught|FATAL/.test(l)).slice(-8)
  if (bad.length) console.log('\n--- 应用日志中的错误行 ---\n' + bad.join('\n'))
  process.exit(process.exitCode ?? 0)
}
