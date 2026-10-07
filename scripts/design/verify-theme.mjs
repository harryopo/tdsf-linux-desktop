#!/usr/bin/env node
/**
 * 浅色主题真机验证（阶段 E3 判据）
 *
 * 为什么走 CDP 而不是肉眼看截图：计划要求"真机切浅色 → 无深灰残留 +
 * getComputedStyle 关键节点断言"。人眼看图只能看出"大块没翻过来"，
 * 看不出某个面板还是 #1a1b1d。所以这里用构建产物起真应用，连 CDP，
 * 把每个可见节点的 computed background 实测一遍。
 *
 * 用法：node scripts/design/verify-theme.mjs [--keep-screens]
 * 前置：先跑 npx electron-vite build（本脚本不打包，只用 out/ 里的产物）
 * 退出码：0 = 关键节点全部翻到浅色且无深灰残留；非 0 = 有残留（打印清单）
 */
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')
const PORT = 9223
const OUT_DIR = path.join(ROOT, 'docs/assets/theme-check')
const ELECTRON = path.join(ROOT, 'node_modules/electron/dist/electron.exe')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

if (!fs.existsSync(path.join(ROOT, 'out/main/index.js'))) {
  console.error('缺少 out/main/index.js —— 先跑：npx electron-vite build')
  process.exit(2)
}
fs.mkdirSync(OUT_DIR, { recursive: true })

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
      // Node 的全局 WebSocket 给的是 MessageEvent，负载在 ev.data
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
  const r = await cdp(ws, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (r.exceptionDetails) throw new Error('页面脚本异常：' + JSON.stringify(r.exceptionDetails).slice(0, 400))
  return r.result.value
}

const SET = (theme) => `document.documentElement.dataset.theme = ${JSON.stringify(theme)}; void document.documentElement.offsetWidth; 1`

const PROBE = (theme) => `(() => {
  // 主题已由 SET 切好；这里只测量
  void document.documentElement.offsetWidth;
  // "深灰残留"的准确定义：**不透明**的深色底 —— 那才是没跟着主题翻面的硬编码颜色。
  // 带 alpha 的着色（chip / tint / color-mix 出来的 oklab(...)）不参与判定：
  // 它们叠在浅色画布上必然偏亮，而且旧的解析法会把 oklab(0.56 0.048 0.11 / 0.15)
  // 当成 sRGB 的三个小数值 → 误判成近黑深灰，浅色主题明明干净却报红（2026-10-07 踩到）。
  // 有彩色（主色按钮、状态 chip）同样不算残留。
  const channels = (c) => {
    const s = String(c);
    if (!/^rgba?\\(/.test(s)) return null; // oklab / lab / color(...) 一类不解析：判不了就别猜
    const m = s.match(/[\\d.]+/g);
    if (!m || m.length < 3) return null;
    const a = m.length > 3 ? Number(m[3]) : 1;
    if (a < 1) return null; // 半透明着色叠在画布上，判它"深色底"没有意义
    return [+m[0], +m[1], +m[2]];
  };
  const lum = (c) => {
    const ch = channels(c);
    if (!ch) return null;
    const f = (v) => { v = v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(ch[0]) + 0.7152 * f(ch[1]) + 0.0722 * f(ch[2]);
  };
  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 24 && r.height >= 12;
  };
  const isDarkGrey = (c) => {
    const ch = channels(c);
    if (!ch) return false;
    const spread = Math.max(...ch) - Math.min(...ch);
    return spread < 25 && lum(c) < 0.30;
  };
  const brand = getComputedStyle(document.documentElement).getPropertyValue('--trae-bg-brand').trim();
  const dark = [];
  let checked = 0;
  for (const el of document.querySelectorAll('body, *')) {
    if (!visible(el)) continue;
    const bg = getComputedStyle(el).backgroundColor;
    if (lum(bg) === null) continue;
    checked++;
    if (isDarkGrey(bg)) {
      const cls = el.className && String(el.className).trim();
      dark.push((cls ? cls.slice(0, 46) : el.tagName.toLowerCase()) + ' ' + bg);
    }
  }
  const keys = {};
  for (const sel of ['body', '.wb-app-frame', '.wb-main-layout', '.page-enter', '.wb-activity-rail', '.wb-filetree', '.wb-aipanel', '.wb-statusbar']) {
    const el = document.querySelector(sel);
    keys[sel] = el ? getComputedStyle(el).backgroundColor : '(缺节点)';
  }
  // 不靠猜类名：把占视口 5% 以上的大容器按面积列出来，浅色下它们任何一个还是深色底就是残留
  const vw = innerWidth, vh = innerHeight;
  const big = [];
  for (const el of document.querySelectorAll('body, *')) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width * r.height < vw * vh * 0.05) continue;
    const bg = getComputedStyle(el).backgroundColor;
    const L = lum(bg);
    if (L === null) continue;
    const ch = channels(bg);
    const grey = ch ? Math.max(...ch) - Math.min(...ch) < 25 : false;
    const cls = el.className && String(el.className).trim();
    big.push({ name: (cls ? '.' + cls.split(/\\s+/)[0] : el.tagName.toLowerCase()), L: Number(L.toFixed(3)), grey, bg, area: Math.round(r.width * r.height) });
  }
  big.sort((a, b) => b.area - a.area);
  const bodyEl = document.body;
  const bodyCS = getComputedStyle(bodyEl);
  return JSON.stringify({ theme: ${JSON.stringify(theme)}, checked, darkCount: dark.length, darkSample: [...new Set(dark)].slice(0, 14), keys, big: big.slice(0, 12),
    diag: {
      tokenOnBody: bodyCS.getPropertyValue('--trae-bg-base-default').trim(),
      bodyBg: bodyCS.backgroundColor,
      bodyInline: bodyEl.getAttribute('style') || '(无)',
      rootTheme: document.documentElement.getAttribute('data-theme'),
      // 谁在给 body 上底色：把匹配 body 的背景声明按顺序列出来
      bodyRules: (() => {
        const out = [];
        for (const sheet of document.styleSheets) {
          let rules; try { rules = sheet.cssRules } catch { continue }
          for (const r of rules) {
            if (r.style && r.selectorText && /(^|,|\s)body(\s|,|$)/.test(r.selectorText) && (r.style.background || r.style.backgroundColor)) {
              out.push(sheet.href ? sheet.href.split('/').pop() : 'inline' + ' :: ' + r.selectorText + ' { ' + (r.style.background || r.style.backgroundColor) + ' }');
            }
            if (r.cssRules) for (const rr of r.cssRules) {
              if (rr.style && rr.selectorText && /(^|,|\s)body(\s|,|$)/.test(rr.selectorText) && (rr.style.background || rr.style.backgroundColor)) {
                out.push('@rule :: ' + rr.selectorText + ' { ' + (rr.style.background || rr.style.backgroundColor) + ' }');
              }
            }
          }
        }
        return out.slice(0, 8);
      })(),
    },
  })
})()`

async function shoot(ws, name) {
  const r = await cdp(ws, 'Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(OUT_DIR, name), Buffer.from(r.data, 'base64'))
  return path.join(OUT_DIR, name)
}

let ws
try {
  const target = await findTarget()
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', rej, { once: true })
  })
  await cdp(ws, 'Runtime.enable')
  await cdp(ws, 'Page.enable')

  // 启动页要点了"进入工作台"才进主界面。必须点那个 button 本身：
  // 按文字找会先命中它的父级 div（pointer-events-none），click() 打在上面什么都不做。
  let ready = false
  for (let i = 0; i < 40 && !ready; i++) {
    ready = await evalIn(ws, `!!document.querySelector('.wb-main-layout')`)
    if (!ready) {
      await evalIn(ws, `(() => {
        const b = document.querySelector('button[data-dom-id="boot-enter"]');
        if (b && !b.disabled) b.click();
        return true
      })()`)
      await sleep(1000)
    }
  }
  if (!ready) {
    // 不静默失败：把页面到底停在哪儿、根节点里有什么、报了什么错打出来
    const diag = await evalIn(ws, `JSON.stringify({
      url: location.href,
      hash: location.hash,
      title: document.title,
      bodyClass: document.body.className,
      theme: document.documentElement.dataset.theme || '(未设置)',
      rootHtmlHead: (document.getElementById('root') || document.body).innerHTML.slice(0, 500),
    })`)
    console.error('页面诊断：', diag)
    throw new Error('等不到工作台渲染')
  }
  await sleep(1500)

  await evalIn(ws, SET('dark')); await sleep(600)
  const dark = JSON.parse(await evalIn(ws, PROBE('dark')))
  const darkShot = await shoot(ws, 'dark.png')
  await evalIn(ws, SET('light')); await sleep(600)
  const light = JSON.parse(await evalIn(ws, PROBE('light')))
  const lightShot = await shoot(ws, 'light.png')
  // 还原，避免影响后续人工查看
  await evalIn(ws, `document.documentElement.dataset.theme='dark'`)

  const lightBodyLum = (() => {
    const m = String(light.keys['body']).match(/[\d.]+/g)
    if (!m) return null
    const f = (v) => { v = v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
    return 0.2126 * f(+m[0]) + 0.7152 * f(+m[1]) + 0.0722 * f(+m[2])
  })()

  console.log('=== 浅色主题真机验证（构建产物 + CDP 实测） ===')
  console.log(`深色基线：可见带背景节点 ${dark.checked} 个，其中深色底 ${dark.darkCount} 个（应当很多，这是深色）`)
  console.log(`浅色：可见带背景节点 ${light.checked} 个，其中仍是深色底 ${light.darkCount} 个`)
  console.log('浅色下关键节点 background：')
  for (const [k, v] of Object.entries(light.keys)) console.log(`  ${k.padEnd(16)} ${v}`)
  console.log(`body 亮度 ${lightBodyLum === null ? '未知' : lightBodyLum.toFixed(3)}（阈值 > 0.85）`)
  if (light.darkCount) {
    console.log('浅色下残留深色底节点（前 14 条）：')
    for (const d of light.darkSample) console.log('  ' + d)
  }
  console.log('截图：', darkShot, '/', lightShot)

  console.log('body 底色来源诊断（浅色态）：', JSON.stringify(light.diag))
  console.log('浅色下大容器（占视口 ≥5%，按面积排序）：')
  for (const b of light.big) console.log(`  ${b.name.padEnd(22)} L=${b.L.toFixed(3)}  ${b.bg}`)

  const fail = []
  if (lightBodyLum === null) fail.push('读不到 body 背景色')
  else if (lightBodyLum <= 0.85) fail.push(`body 亮度 ${lightBodyLum.toFixed(3)} 未到 0.85`)
  // 大容器是"一眼看过去的那几块"，它们任何一个没翻面就是假浅色
  const stuck = light.big.filter((b) => b.L < 0.85)
  if (stuck.length) fail.push('浅色下这些大容器仍是深色底：' + stuck.map((b) => `${b.name}(L=${b.L})`).join(', '))
  if (light.darkCount > 0) fail.push(`浅色下仍有 ${light.darkCount} 个深灰残留节点（见上面清单）`)

  if (fail.length) {
    console.error('\n判定：不通过')
    for (const f of fail) console.error('  - ' + f)
    process.exitCode = 1
  } else {
    console.log('\n判定：通过（主容器全部翻面，无深灰残留）')
  }
} catch (err) {
  console.error('验证失败：', err.message)
  process.exitCode = 1
} finally {
  if (ws) ws.close()
  app.kill()
}
