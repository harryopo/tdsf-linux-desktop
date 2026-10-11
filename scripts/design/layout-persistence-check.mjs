#!/usr/bin/env node
/**
 * 阶段 F3 + W5 真机验收：三栏默认比例、拖拽、复位、宽度持久化
 *
 * 为什么单独一个脚本：可拖拽分栏最容易糊过去的地方是「拖得动但记不住」和
 * 「默认比例其实写死了」——代码里 defaultSize 看着没问题，量出来才知道。
 * 这个探针不猜，直接在跑起来的 Electron 里量：
 *   1) 清掉存过的宽度并刷新，读**默认**三栏宽度，断言 中间∶右栏 ≈ 黄金分割
 *   2) 对第一条分隔线做一次真实鼠标拖拽（CDP Input 域，不是合成事件），断言左栏变宽、localStorage 落了值
 *   3) 双击分隔条，断言各栏回到默认宽度
 *   4) 再拖一次并刷新，断言宽度还在
 *
 * 用法：先 pnpm build，再 node scripts/design/layout-persistence-check.mjs
 * 退出码：0 通过；1 判据不成立；2 环境不满足（没构建 / 连不上调试口）
 */
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')
const PORT = 9237
const DRAG_PX = 120
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

if (!fs.existsSync(path.join(ROOT, 'out', 'main', 'index.js'))) {
  console.error('缺少 out/main/index.js —— 先跑：pnpm build')
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

/** 拿到渲染进程的 CDP target（启动页与工作台是同一个 webContents） */
async function findTarget(retries = 40) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await res.json()
      const page = list.find((t) => t.type === 'page' && /index\.html/.test(t.url))
      if (page?.webSocketDebuggerUrl) return page
    } catch {
      // 调试口还没起来
    }
    await sleep(500)
  }
  return null
}

let ws
let seq = 0
const pending = new Map()
function send(method, params = {}) {
  const id = ++seq
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(`页面里执行失败：${r.exceptionDetails.text}`)
  return r.result?.value
}

/** 量三栏宽度：Group 的直接子节点依次是 面板 / 分隔线 / 面板 / 分隔线 / 面板 */
const MEASURE = `(() => {
  const group = document.querySelector('[data-dom-id="wb-layout"]')
  if (!group) return { error: '找不到 wb-layout（工作台没渲染出来？）' }
  const widths = [...group.children].map((el) => Math.round(el.getBoundingClientRect().width))
  const sep = [...group.children][1]
  const r = sep?.getBoundingClientRect()
  return {
    widths,
    sep: r ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } : null,
    stored: localStorage.getItem('tdsf.workbench.layout'),
  }
})()`

async function mouse(type, x, y, clickCount = 1) {
  await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount, buttons: type === 'mouseReleased' ? 0 : 1 })
}

/** 双击（CDP 要按 down/up/clickCount=2 的顺序发，浏览器才会合成 dblclick） */
async function doubleClick(x, y) {
  await mouse('mousePressed', x, y, 1)
  await mouse('mouseReleased', x, y, 1)
  await mouse('mousePressed', x, y, 2)
  await mouse('mouseReleased', x, y, 2)
}

/** 按住分隔条往右拖 */
async function dragRight(x, y, px) {
  await mouse('mousePressed', x, y)
  for (let i = 1; i <= 6; i++) await mouse('mouseMoved', x + (px * i) / 6, y)
  await mouse('mouseReleased', x + px, y)
  await sleep(600)
}

/** 默认布局要求：中间∶右栏 ≈ 黄金分割（用户点名要的默认比例） */
const GOLDEN = 1.618
const RATIO_TOL = 0.08
const PX_TOL = 8

const failures = []
try {
  const target = await findTarget()
  if (!target) {
    console.error('连不上 CDP 调试口，看最后几行应用日志：\n' + appLog.join('').slice(-1500))
    process.exit(2)
  }
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', rej, { once: true })
  })
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
    }
  })
  await send('Runtime.enable')
  await send('Page.enable')

  // 进工作台（启动页要点一下，直接改 hash 更快）
  await evaluate("location.hash = '#/workbench'")
  await sleep(2500)

  // 上一轮跑留下的宽度会污染"默认布局"这一步：先清掉再量
  await evaluate("localStorage.removeItem('tdsf.workbench.layout')")
  await send('Page.reload')
  await sleep(2500)

  const before = await evaluate(MEASURE)
  if (before.error) throw new Error(before.error)
  console.log('默认三栏宽度:', before.widths.join(' / '))

  if (!before.sep) throw new Error('找不到可拖的分隔线')
  // 子节点顺序：面板 / 分隔线 / 面板 / 分隔线 / 面板（两侧都开着才是 5 个）
  if (before.widths.length !== 5) {
    failures.push(`三栏布局没渲染出 5 个子节点（实际 ${before.widths.length} 个：${before.widths.join(',')}）`)
  } else {
    const [, , editor, , ai] = before.widths
    const r = editor / ai
    if (Math.abs(r - GOLDEN) > RATIO_TOL) {
      failures.push(`默认布局不是黄金分割：中间∶右栏 = ${r.toFixed(3)}（期望 ${GOLDEN}±${RATIO_TOL}）`)
    }
  }

  const { x, y } = before.sep
  await dragRight(x, y, DRAG_PX)

  const after = await evaluate(MEASURE)
  console.log('拖拽后宽度  :', after.widths.join(' / '))
  console.log('落盘值      :', after.stored)
  const grew = after.widths[0] - before.widths[0]
  if (grew < DRAG_PX * 0.6) failures.push(`拖拽没改变左栏宽度（只涨了 ${grew}px，期望约 ${DRAG_PX}px）`)
  if (!after.stored) failures.push('拖拽后 localStorage 里没有布局值（记不住）')

  // 双击分隔条 = 恢复默认（用户手拖歪了要能一键回来）
  // 注意要重新量一次分隔条的位置：拖完之后它已经跟着左栏往右移了
  const moved = await evaluate(MEASURE)
  if (!moved.sep) throw new Error('拖拽后找不到可拖的分隔线')
  await doubleClick(moved.sep.x, moved.sep.y)
  await sleep(700)
  const reset = await evaluate(MEASURE)
  console.log('双击复位    :', reset.widths.join(' / '))
  if (before.widths.length === 5) {
    const drift = before.widths.map((w, i) => Math.abs((reset.widths[i] ?? 0) - w))
    if (drift.some((d) => d > PX_TOL)) {
      failures.push(`双击分隔条没回到默认布局（各栏偏差 ${drift.join('/')}px，容差 ${PX_TOL}px）`)
    }
  }

  // 记住宽度：再拖一次，刷新看还在不在
  await dragRight(x, y, DRAG_PX)
  const dragged = await evaluate(MEASURE)
  await send('Page.reload')
  await sleep(2500)
  const reloaded = await evaluate(MEASURE)
  console.log('刷新后宽度  :', reloaded.widths.join(' / '))
  if (Math.abs(reloaded.widths[0] - dragged.widths[0]) > 6) {
    failures.push(`刷新后左栏宽度没保持住（${dragged.widths[0]} → ${reloaded.widths[0]}）`)
  }
} catch (err) {
  failures.push(String(err?.message ?? err))
} finally {
  try { ws?.close() } catch { /* 已断开 */ }
  app.kill()
}

if (failures.length) {
  console.error('\nFAIL：')
  for (const f of failures) console.error('  - ' + f)
  process.exit(1)
}
console.log('\nPASS：默认是黄金分割、三栏拖得动、双击能复位、宽度重开还在')
process.exit(0)
