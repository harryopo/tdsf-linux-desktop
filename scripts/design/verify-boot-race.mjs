#!/usr/bin/env node
/**
 * 启动竞态真机验证（R0 判据）
 *
 * 要回答的只有一个问题：生产构建里，渲染层挂载时主进程已经走完启动序列了，
 * BootPage 能不能仍然拿到 'done' 并让"进入工作台"按钮可点？
 *
 * 之所以不能用 verify-theme.mjs 代替：那个脚本会自己点按钮、必要时直接改 hash，
 * 等于把"按钮本来点不动"这个缺陷绕过去了。本脚本只观测，不干预。
 *
 * 用法：先 npx electron-vite build，再 node scripts/design/verify-boot-race.mjs
 * 退出码：0 = 未点击任何按钮的情况下，ready 已为真且按钮可点
 */
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')
const PORT = 9224
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
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await res.json()
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

// 采样期间的瞬时异常（React 尚未挂载、路由正在切换）不该终止验证，记下来供判读
async function sample(ws) {
  try {
    return await evalIn(ws, OBSERVE)
  } catch (err) {
    return { phase: 'unrendered', error: String(err.message).slice(0, 120) }
  }
}

// 只读观测。phase 必须靠真实节点判定，不能靠 hash：
// 实测 hash 在启动阶段一直是空串，用它判断"不在启动页"会在 React 挂载前就误判通过。
const OBSERVE = `(() => {
  const enter = document.querySelector('button[data-dom-id="boot-enter"]');
  const phase = enter ? 'boot' : (document.querySelector('.wb-main-layout') ? 'workbench' : 'unrendered');
  const api = window.electronAPI;
  const out = {
    phase,
    hash: location.hash,
    enterDisabled: enter ? !!enter.disabled : null,
    progressLabel: (document.querySelector('.boot-progress-label') || {}).textContent ?? null,
    hasGetState: typeof api?.bootGetState === 'function',
    bodyChars: (document.body ? document.body.innerText || '' : '').length,
  };
  return api?.bootGetState
    ? api.bootGetState().then((s) => ({ ...out, latestStage: s ? s.stage : null, stageProgress: s ? s.progress : null }))
    : Promise.resolve(out);
})()`

let ws
try {
  const target = await findTarget()
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', rej, { once: true })
  })
  await cdp(ws, 'Runtime.enable')

  // 全程不点任何按钮、不改 hash：等界面渲染出来 + 最小展示时长（约 3s）过完，再看状态
  let snap = null
  for (let i = 0; i < 40; i++) {
    snap = await sample(ws)
    if (snap.phase === 'workbench') break
    if (snap.phase === 'boot' && snap.latestStage === 'done' && snap.enterDisabled === false) break
    await sleep(1000)
  }

  console.log('=== R0 启动竞态真机验证（构建产物，全程零干预） ===')
  console.log(JSON.stringify(snap, null, 2))

  const fail = []
  if (!snap.hasGetState) fail.push('preload 没有暴露 bootGetState')
  if (snap.phase === 'unrendered') {
    fail.push(
      `40 秒内渲染层始终没画出界面（body 文本 ${snap.bodyChars} 字符${snap.error ? '，采样异常：' + snap.error : ''}）——不能算通过`
    )
  }
  if (snap.latestStage !== 'done') {
    fail.push(`主进程最新阶段不是 done（实测 ${JSON.stringify(snap.latestStage)}）—— 拉取通道没补上错过的推送`)
  }
  if (snap.phase === 'boot' && snap.enterDisabled !== false) {
    fail.push(`启动页按钮仍不可点（进度文案：${JSON.stringify(snap.progressLabel)}）—— ready 仍由动画决定`)
  }
  if (fail.length) {
    console.error('\n判定：不通过')
    for (const f of fail) console.error('  - ' + f)
    process.exitCode = 1
  } else {
    console.log(
      snap.phase === 'workbench'
        ? '\n判定：通过（未点任何按钮就自行进入工作台）'
        : '\n判定：通过（停在启动页属正常，但按钮已可点、文案已就绪，最新阶段=done 由拉取补齐）'
    )
  }
} catch (err) {
  console.error('验证失败：', err.message)
  process.exitCode = 1
} finally {
  if (ws) ws.close()
  app.kill()
}
