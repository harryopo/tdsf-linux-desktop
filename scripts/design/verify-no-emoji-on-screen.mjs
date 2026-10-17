#!/usr/bin/env node
/**
 * 表情符号真机验证（阶段 E5 判据）
 *
 * 静态测试只能证明"源码里没写表情"。这里要证明的是另一件事：
 * 老用户库里已经存着带表情的分类标签（「企鹅 + Linux 基础」这种形态），
 * 主进程读回来、渲染层画出来之后，屏幕上仍然不该出现表情。
 *
 * 所以本脚本连的是真实 userData 里的 tdsf.db，走完整链路：
 *   preload IPC → TutorialRepository.rowToEntry → 教程页 DOM
 *
 * 用法：先 npx electron-vite build，再 node scripts/design/verify-no-emoji-on-screen.mjs
 * 退出码：0 = 数据层与屏幕两层都没有表情；非 0 = 打印命中清单
 */
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')
const PORT = 9225
const ELECTRON = path.join(ROOT, 'node_modules/electron/dist/electron.exe')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const EMOJI_SRC = '[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{FE0F}\\u{1F000}-\\u{1F2FF}]'

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

/** 在页面里跑的采集器：数据层（IPC 返回值）+ 屏幕层（教程页可见文本） */
const COLLECT = `(async () => {
  const EMO = new RegExp(${JSON.stringify(EMOJI_SRC)}, 'gu');
  const grab = (s) => (typeof s === 'string' ? s.match(EMO) : null);

  const list = await window.electronAPI.tutorialList();
  const cats = await window.electronAPI.tutorialCategories();

  const dataHits = [];
  for (const t of list) {
    for (const tag of t.tags ?? []) {
      if (grab(tag)) dataHits.push('tags: ' + t.id + ' → ' + tag);
    }
  }
  for (const c of cats) {
    if (grab(c.label)) dataHits.push('categorySummary: ' + c.category + ' → ' + c.label);
  }

  document.querySelector('[data-dom-id="nav-tutorial"]')?.click();
  await new Promise((r) => setTimeout(r, 2500));

  const text = document.body.innerText || '';
  const screenHits = [];
  text.split('\\n').forEach((line, i) => {
    if (grab(line)) screenHits.push('L' + (i + 1) + ': ' + line.trim().slice(0, 80));
  });

  return {
    tutorialCount: list.length,
    categoryCount: cats.length,
    sampleLabels: cats.slice(0, 4).map((c) => c.label),
    sampleTags: (list[0]?.tags ?? []).slice(0, 6),
    courseCards: document.querySelectorAll('.tut-course-card').length,
    screenChars: text.length,
    dataHits,
    screenHits,
  };
})()`

let ws
let snap = null
try {
  const target = await findTarget()
  ws = new WebSocket(target.webSocketDebuggerUrl)
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

  snap = await evalIn(ws, COLLECT)

  console.log('=== E5 表情符号真机验证（构建产物 + 真实 userData 库） ===')
  console.log(JSON.stringify(snap, null, 2))

  const fail = []
  if (snap.tutorialCount === 0) {
    fail.push('tutorialList() 返回 0 条 —— 库里没教程数据，本次等于空跑，不能算通过')
  }
  if (snap.courseCards === 0) {
    fail.push('教程页没渲染出课程卡（.tut-course-card = 0），屏幕层等于没扫到东西')
  }
  if (snap.dataHits.length) fail.push('数据层仍带表情：\n  ' + snap.dataHits.join('\n  '))
  if (snap.screenHits.length) fail.push('屏幕上出现表情：\n  ' + snap.screenHits.join('\n  '))

  if (fail.length) {
    console.error('\nFAIL:\n' + fail.join('\n'))
    process.exitCode = 1
  } else {
    console.log(
      `\nPASS：${snap.tutorialCount} 条教程 / ${snap.categoryCount} 个分类，` +
        `课程卡 ${snap.courseCards} 张，可见文本 ${snap.screenChars} 字符，表情命中 0`
    )
  }
} catch (err) {
  console.error('验证脚本异常：' + (err?.stack || err))
  if (!snap) console.error('未能取得任何实测数据，判为失败')
  process.exitCode = 1
} finally {
  app.kill()
  const log = appLog.join('')
  // 只认真正的 ERROR 级日志标签：agent:error / loop:error 这类通道名里也带 "error"，
  // 用大小写不敏感匹配会把正常 INFO 行当错误打出来。
  const bad = log.split('\n').filter((l) => /\[ERROR\]|\.ERROR\b|Uncaught|FATAL/.test(l)).slice(-8)
  if (bad.length) console.log('\n--- 应用日志中的错误行 ---\n' + bad.join('\n'))
  process.exit(process.exitCode ?? 0)
}
