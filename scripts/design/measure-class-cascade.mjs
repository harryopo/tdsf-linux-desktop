#!/usr/bin/env node
/**
 * Tailwind v4 里 text-* 与 leading-* 谁赢（决定字号收敛后要不要保留显式 leading）
 *
 * 收敛脚本把 text-[30px] 换成了 text-display（自带 36px 行高），
 * 而 EvidenceList 那个节点原本还写着 leading-none。
 * 两者都在 utilities 层，谁生效取决于样式表里的先后顺序 —— 这不能靠猜，实测。
 *
 * 用法：先 npx electron-vite build，再 node scripts/design/measure-class-cascade.mjs
 */
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')
const PORT = 9231
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
app.stdout.on('data', () => {})
app.stderr.on('data', () => {})

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
  throw new Error('等不到 CDP target')
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
  if (r.exceptionDetails) throw new Error('页面脚本异常：' + JSON.stringify(r.exceptionDetails).slice(0, 300))
  return r.result.value
}

const MEASURE = `(() => {
  const combos = [
    ['text-display leading-none', 'display + leading-none'],
    ['text-display', 'display 单用'],
    ['leading-none', 'leading-none 单用（父级默认字号）'],
    ['text-sm leading-normal', 'sm + leading-normal'],
    ['text-sm', 'sm 单用'],
  ];
  const host = document.createElement('div');
  document.body.appendChild(host);
  const out = combos.map(([cls, name]) => {
    const el = document.createElement('span');
    el.className = cls;
    el.textContent = '测量';
    host.appendChild(el);
    const cs = getComputedStyle(el);
    return { name, cls, fontSize: cs.fontSize, lineHeight: cs.lineHeight };
  });
  host.remove();
  return out;
})()`

try {
  const target = await findTarget()
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', rej, { once: true })
  })
  await cdp(ws, 'Runtime.enable')
  for (let i = 0; i < 30; i++) {
    const ready = await evalIn(ws, `!!document.querySelector('.wb-main-layout, .boot-progress-label, #root')`)
    if (ready) break
    await sleep(1000)
  }
  console.log(JSON.stringify(await evalIn(ws, MEASURE), null, 2))
} finally {
  app.kill()
  process.exit(0)
}
