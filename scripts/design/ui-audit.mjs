#!/usr/bin/env node
/**
 * 界面取证：真机截图 + 逐项量出来的设计缺陷
 *
 * 不看代码猜，全部在跑起来的 Electron 里量：
 * - 每个可见文字节点的 (字号, 字重, 字体族) 组合分布 → 层级是否统一
 * - 文字色 vs 实际背景色的对比度 → 谁看不清（含 <4.5:1 的清单）
 * - SVG 图标的渲染尺寸分布 → 图标是否大小不一
 * - 溢出/被裁切的节点 → 遮挡问题
 * - 对话框/弹层的实际宽高与内部字号 → 弹窗比例问题
 * 同时把每个界面截成 PNG，落在 docs/assets/ui-audit-<date>/。
 *
 * 用法：先 pnpm build，再 node scripts/design/ui-audit.mjs [--gate] [--no-shots]
 * --no-shots 只量不出图（窗口被最小化时截图会挂住，量测本身不受影响）。
 * 退出码：--gate 不达标 1；取证中途异常 1（没跑完不算通过）；其余 0。数据打印到 stdout。
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { pixelVerdict } from './pixel-verdict.mjs'

const ROOT = path.resolve(import.meta.dirname, '../..')
const PORT = 9235
const NO_SHOTS = process.argv.includes('--no-shots')
const OUT_DIR = path.join(ROOT, 'docs', 'assets', 'ui-audit-20261005')
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 量哪一档明暗（默认深色 = 历史行为）。
 *
 * 这个开关存在的理由：整套判据（对比度 / 遮挡 / 字阶 / 中文落衬线）过去只在深色屏上
 * 取过数——脚本里连 theme/light 一个字都没出现。浅色模式是真实可选项，2026-10-16
 * 又把终端底色改成跟随界面明暗，浅色下"文字看不清"这种缺陷以前根本没被执行体看过。
 *
 * 浅色那遍的截图一律 light- 前缀：同一个名字直接覆盖等于把深色那遍的证据删了。
 */
const THEME = (process.env.UI_AUDIT_THEME || 'dark').toLowerCase()
if (THEME !== 'dark' && THEME !== 'light') {
  console.error(`UI_AUDIT_THEME 只认 dark / light，收到 ${JSON.stringify(process.env.UI_AUDIT_THEME)}`)
  process.exit(2)
}

/**
 * 字阶档位清单从 tailwind.css 反查，不在本脚本里再抄一份。
 *
 * 原来这里手写 7 行"档位 → --ui-font-* 变量"映射表：新增的 --text-title / --text-splash
 * 不在表里，漂移检测对它们完全不设防（同一天 cn() 那边也漏了这两档）。
 *
 * 值一律取自 @theme 里 `--text-<档>: var(--ui-font-<名>)` 右侧那个变量。
 * 为什么不直接读 --text-<档>：实测打包产物里 Tailwind 把 micro/caption/body/composer/head/display
 * 六档编成了 `.text-x{font-size:var(--ui-font-x)}`，`:root` 上根本没有 --text-x 这个属性，
 * 读它只会得到空串（第一版这么写过，闸当场把 10 档里的 6 档报成"解析不出"）。
 */
const THEME_TIERS = [
  ...[
    ...fs
      .readFileSync(path.join(ROOT, 'src/renderer/src/styles/tailwind.css'), 'utf8')
      .matchAll(/^[ \t]*--text-([a-z0-9]+):\s*var\((--ui-[a-z0-9-]+)\)/gm)
  ].map((m) => [`text-${m[1]}`, m[2]]),
]
if (THEME_TIERS.length < 8) {
  console.error(`字阶档位取数失败：从 tailwind.css 只扫出 ${THEME_TIERS.length} 档（应有 10 档左右）`)
  process.exit(1)
}

/**
 * 一排图标的中心线偏差上限（px）。
 * 亚像素缩放会带来 0.x px 的抖动，超过 1px 就是肉眼看得见的不齐
 * ——用户 2026-10-11 指出的终端标签条那一排，实测偏 8px。
 */
const ICON_MAX_OFF_Y = 1

fs.mkdirSync(OUT_DIR, { recursive: true })

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

async function findTarget() {
  for (let i = 0; i < 80; i++) {
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
  if (r.exceptionDetails) throw new Error('页面脚本异常：' + JSON.stringify(r.exceptionDetails).slice(0, 500))
  return r.result.value
}

/** 衬线字族的名字形状（SimHei 是黑体，不在这里） */
const SERIF_FONT = /(simsun|宋体|nsimsun|serif|times|kaiti|stsong|fangsong)/i

/**
 * 真实用到的字族普查（用户 2026-10-11 指出界面里看到宋体）
 *
 * 为什么不能只看 computed font-family：那只是"声明的那一串"，中文最终落在哪个字族上
 * 是浏览器逐字形回退的结果——声明 `..., monospace` 的栈，中文在 Windows 上会掉进宋体，
 * 而 computed style 里完全看不出来。CSS.getPlatformFontsForNode 给的是**实际用的字族与字形数**。
 *
 * 自带阳性对照：另挂一个显式写 SimSun 的探针节点，量不到它就算量具坏了（同链接普查那条规矩）。
 */
async function cjkFontAudit(ws, label) {
  await cdp(ws, 'DOM.enable')
  await cdp(ws, 'CSS.enable')
  const marked = await evalIn(ws, `(() => {
    const CJK = /[\\u3400-\\u4dbf\\u4e00-\\u9fff\\u3000-\\u303f\\uff00-\\uffef]/;
    document.querySelectorAll('[data-cjk-probe]').forEach((e) => e.removeAttribute('data-cjk-probe'));
    let n = 0;
    for (const el of document.querySelectorAll('body *')) {
      if (el.hasAttribute('data-audit-canary')) continue;
      const own = [...el.childNodes].filter((x) => x.nodeType === 3).map((x) => x.nodeValue).join('');
      if (!CJK.test(own)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      el.setAttribute('data-cjk-probe', String(n++));
    }
    const canary = document.createElement('span');
    canary.id = 'audit-cjk-canary';
    canary.setAttribute('data-audit-canary', '1');
    canary.style.cssText = 'position:fixed;left:2px;top:2px;z-index:-1;font-size:12px;color:#000;opacity:0.02;font-family:"SimSun", serif;';
    canary.textContent = '宋体探针';
    document.body.appendChild(canary);
    return n;
  })()`)
  const fontsOf = async (selector) => {
    // 每次都重取 document：React 中途重绘会把上一次快照里的节点整体换掉，
    // 拿旧 root 去 querySelectorAll 会读到空列表 —— 那不是"探针没抓到"，是量具自己过期了。
    const { root } = await cdp(ws, 'DOM.getDocument', { depth: -1 })
    const { nodeIds } = await cdp(ws, 'DOM.querySelectorAll', { nodeId: root.nodeId, selector })
    const out = []
    for (const nodeId of nodeIds.slice(0, 500)) {
      try {
        const r = await cdp(ws, 'CSS.getPlatformFontsForNode', { nodeId })
        out.push(...(r.fonts || []))
      } catch {
        /* React 中途重绘会把这个节点换掉，跳过这一个（探针还在，不影响判据） */
      }
    }
    return out
  }
  const used = await fontsOf('[data-cjk-probe]')
  // 有界重试。两个原因会让这一屏的读数量不到字族：DOM 快照被 React 重绘换掉，
  // 以及探针还没被光栅化（CSS.getPlatformFontsForNode 只报已经画出来的字形）。
  // 所以每次重试前先逼一次布局 + 等字体就绪，再重取 document。
  // 判据本身不放松：三次都抓不到显式 SimSun，才报"量具失效"。
  let canaryFonts = await fontsOf('#audit-cjk-canary')
  for (let attempt = 0; attempt < 3 && canaryFonts.length === 0; attempt++) {
    // 只用定时器，不用 requestAnimationFrame：窗口不可见时 rAF 会被挂起，
    // 这个 await 就永远不回来（截图那条路上已经踩过一次同样的坑）。
    await evalIn(
      ws,
      `(async () => {
        const c = document.getElementById('audit-cjk-canary');
        if (c) void c.getClientRects();
        const ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
        await Promise.race([ready, new Promise((r) => setTimeout(r, 600))]);
        await new Promise((r) => setTimeout(r, 200));
        return 1;
      })()`,
    )
    canaryFonts = await fontsOf('#audit-cjk-canary')
  }
  await evalIn(ws, `(() => { const c = document.getElementById('audit-cjk-canary'); if (c) c.remove(); })()`)
  const tally = new Map()
  for (const f of used) {
    if (!SERIF_FONT.test(f.familyName || '')) continue
    tally.set(f.familyName, (tally.get(f.familyName) || 0) + (f.glyphCount || 1))
  }
  return {
    label,
    marked,
    canaryCaught: canaryFonts.some((f) => SERIF_FONT.test(f.familyName || '')),
    serif: [...tally.entries()]
      .map(([family, glyphs]) => ({ family, glyphs }))
      .sort((a, b) => b.glyphs - a.glyphs),
  }
}

/**
 * 本轮真的写出过哪几张图（F5 判据的账本）。
 * 只认这份账本、不扫 OUT_DIR：那个目录里躺着历史轮次的文件，
 * 拿目录里的张数当下限等于让"上一轮跑了多少"决定这一轮过不过。
 */
const SHOT_LOG = []

async function shot(ws, name, kind = 'other') {
  // --no-shots：只跑量测不出图。窗口被最小化时 captureScreenshot 会永久不返回，
  // 而门禁要的是逐元素计算样式，不需要 PNG——别让取证卡在像素上。
  if (NO_SHOTS) return null
  // 窗口被最小化时 Page.captureScreenshot 会永久不返回：宁可 20 秒报错，也不要挂着让人以为还在跑
  const guard = new Promise((_, rej) =>
    setTimeout(() => rej(new Error(`截图 ${name} 超时 20s：窗口可能被最小化或遮挡，请把 TDSF 窗口置于前台后重跑`)), 20000)
  )
  const { data } = await Promise.race([cdp(ws, 'Page.captureScreenshot', { format: 'png' }), guard])
  const buf = Buffer.from(data, 'base64')
  fs.writeFileSync(path.join(OUT_DIR, name + '.png'), buf)
  SHOT_LOG.push({ name: name + '.png', kind, bytes: buf.length, hash: createHash('sha256').update(buf).digest('hex') })
  return name + '.png'
}

/** 在页面里跑一次的完整量测：文字层级 / 对比度 / 图标尺寸 / 裁切 / 弹层尺寸 */
const MEASURE = `(async () => {
  const px = (v) => Math.round(parseFloat(v) * 10) / 10;
  const lum = (c) => {
    const m = c.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const [r, g, b, aRaw] = m[1].split(',').map((x) => parseFloat(x.trim()));
    const a = aRaw === undefined ? 1 : aRaw;
    if (a === 0) return null;
    const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
    return { L: 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b), a, rgb: [r, g, b] };
  };
  const blend = (fg, bg) => fg.a >= 1 ? fg.rgb : fg.rgb.map((v, i) => v * fg.a + bg[i] * (1 - fg.a));
  const ratio = (l1, l2) => { const [a, b] = l1 > l2 ? [l1, l2] : [l2, l1]; return (a + 0.05) / (b + 0.05); };
  const bgOf = (el) => {
    for (let n = el; n; n = n.parentElement) {
      const c = lum(getComputedStyle(n).backgroundColor);
      if (c) return blend(c, { L: 1, a: 1, rgb: [255, 255, 255] });
    }
    return [255, 255, 255];
  };
  const f = (x) => Math.round(x * 100) / 100;

  const type = {};
  const families = new Set();
  const familySample = {};
  const low = [];
  // 主题色样本（代码主题预览）里的文字颜色就是"内容"本身，不按界面文字判；
  // 但豁免必须显式挂在 [data-audit-exempt] 上，并且逐屏报出条数，不许拿它当万能消音键
  const exemptContrast = [];
  const clipped = [];
  for (const el of document.querySelectorAll('h1,h2,h3,h4,h5,p,span,button,a,label,td,th,div,code,li')) {
    const txt = (el.textContent || '').trim();
    if (!txt || el.children.length > 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.15) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 6 || r.height < 6 || r.bottom < 0 || r.top > innerHeight) continue;
    const key = px(cs.fontSize) + 'px/' + cs.fontWeight + '/' + (cs.fontFamily || '').split(',')[0].replace(/["']/g, '');
    type[key] = (type[key] || 0) + 1;
    // 字体族只统计我们自己的节点：antd 注入的 -apple-system 栈在退出清单上，不按我们的刻度判
    if (!el.closest('[class*="ant-"]')) {
      const fam = (cs.fontFamily || '').split(',')[0].replace(/["']/g, '')
      families.add(fam)
      // 记下每套族第一个出现在哪个节点上，否则"第三套族"报出来没法定位
      if (!familySample[fam]) familySample[fam] = ((el.className || '').toString().slice(0, 34) || el.tagName) + ' · ' + txt.slice(0, 10)
    }

    const fg = lum(cs.color);
    if (fg) {
      const bgL = (() => {
        const rgb = bgOf(el);
        const g = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
        return 0.2126 * g(rgb[0]) + 0.7152 * g(rgb[1]) + 0.0722 * g(rgb[2]);
      })();
      const contrast = ratio(fg.L, bgL);
      const large = parseFloat(cs.fontSize) >= 18.5 || (parseFloat(cs.fontSize) >= 15 && parseInt(cs.fontWeight, 10) >= 700);
      const need = large ? 3 : 4.5;
      if (contrast + 0.001 < need) {
        const row = { text: txt.slice(0, 26), size: px(cs.fontSize), weight: cs.fontWeight, contrast: f(contrast), need, color: cs.color, cls: (el.className || '').toString().slice(0, 46) };
        const ex = el.closest('[data-audit-exempt]');
        if (ex) exemptContrast.push({ ...row, reason: ex.getAttribute('data-audit-exempt') });
        else low.push(row);
      }
    }
    const ovY = el.scrollHeight - el.clientHeight;
    const ovX = el.scrollWidth - el.clientWidth;
    const hidesY = cs.overflowY === 'hidden' || cs.overflow === 'hidden';
    const hidesX = cs.overflowX === 'hidden' || cs.overflow === 'hidden';
    // 带省略号的截断是故意的（单行标签列），不算遮挡；只有"藏起来又没有省略号"才是缺陷
    if (cs.textOverflow === 'ellipsis') continue;
    if ((hidesY && ovY > 3) || (hidesX && ovX > 3)) {
      clipped.push({ text: txt.slice(0, 26), cls: (el.className || '').toString().slice(0, 40), over: (hidesY && ovY > 3 ? 'y+' + ovY : '') + (hidesX && ovX > 3 ? 'x+' + ovX : ''), to: cs.textOverflow, ws: cs.whiteSpace });
    }
  }

  const icons = {};
  const offTierIcons = [];
  const ICON_TIER = /^(12|14|16|18|20|24|32|48)x/;
  for (const s of document.querySelectorAll('svg')) {
    const r = s.getBoundingClientRect();
    if (r.width < 2) continue;
    // antd 自带图标（.anticon 一族）在退出清单上，不按"我们的图标刻度"判它
    if (s.closest('.anticon, .ant-modal-close, .ant-select-suffix, .ant-picker-suffix')) continue;
    // radix Tooltip 的箭头是个 10x5 的填充 svg，属于浮层 chrome 不是图标
    if (/fill-(raised|canvas|panel|sunken)/.test(s.getAttribute('class') || '')) continue;
    const k = px(r.width) + 'x' + px(r.height);
    icons[k] = (icons[k] || 0) + 1;
    if (r.width <= 48 && !ICON_TIER.test(k)) {
      const host = s.closest('button,[aria-label],[title],span,div');
      offTierIcons.push({
        size: k,
        cls: (s.getAttribute('class') || '').toString().slice(0, 40),
        at: ((host && (host.getAttribute('aria-label') || host.getAttribute('title') || host.textContent)) || '').trim().slice(0, 28),
      });
    }
  }

  // ===== 字阶保真：带 text-<档位> 类的元素，实际字号必须等于该档令牌 =====
  // 抓的是"类还在、但被别处 CSS 规则压掉"这一类静默失效（如 .wb-shell .wb-aipanel textarea{font-size:11px}）。
  // 量不到另一种失效：类被 tailwind-merge 整个丢掉（元素上根本没这个类，扫不到）——
  // 那一路由 tests/unit/cn-font-size-merge.test.ts 守（摘掉登记当场红，验过）。
  const rootCs = getComputedStyle(document.documentElement);
  const TIER_PX = {};
  for (const [cls, varName] of ${JSON.stringify(THEME_TIERS)}) {
    const n = parseFloat(rootCs.getPropertyValue(varName));
    TIER_PX[cls] = Number.isFinite(n) ? n : null;
  }
  // 档位解析不出数值 = 量具坏了，不能当成"没有漂移"
  const unresolvedTiers = Object.entries(TIER_PX).filter(([, v]) => v === null).map(([k]) => k);
  const tierDrift = [];
  for (const el of document.querySelectorAll('*')) {
    const cls = typeof el.className === 'string' ? el.className : '';
    if (!cls) continue;
    const tier = Object.keys(TIER_PX).find((t) => new RegExp('(^|\\s)' + t + '(\\s|$)').test(cls));
    if (!tier || TIER_PX[tier] === null) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const got = parseFloat(cs.fontSize);
    if (Math.abs(got - TIER_PX[tier]) > 0.6) {
      tierDrift.push({
        tier,
        want: TIER_PX[tier],
        got,
        text: (el.textContent || '').trim().slice(0, 18),
        cls: cls.slice(0, 44),
      });
    }
  }

  // ===== 工作台三栏第一条栏必须同高（用户 2026-10-08 指出右栏差 8px 没对齐）=====
  // 取不到就记 null：null 由门禁报"探针没跑成"，不许当成"没量到所以对齐了"
  const panelHeads = {};
  for (const [key, sel] of [
    ['filetree', '.wb-filetree-header'],
    ['termTabs', '.term-tab-bar'],
    ['aiPanel', '.ai-panel-header'],
  ]) {
    const el = document.querySelector(sel);
    panelHeads[key] = el ? Math.round(el.getBoundingClientRect().height) : null;
  }
  // 三条一样高还不够：三栏一起跑偏也得报。判据是令牌本身，不是"彼此相等"。
  const panelHeaderToken = parseFloat(rootCs.getPropertyValue('--ui-size-panel-header'));
  const composerMinToken = parseFloat(rootCs.getPropertyValue('--ui-size-composer-min'));

  // ===== AI 输入区：至少三行、快捷提示词那一排不许换成两行（用户 2026-10-08 指出"很挤"）=====
  const composer = (() => {
    const ta = document.querySelector('#ai-composer-input');
    if (!ta) return null;
    const bar = ta.parentElement ? ta.parentElement.firstElementChild : null;
    return {
      inputH: Math.round(ta.getBoundingClientRect().height),
      minH: getComputedStyle(ta).minHeight,
      cls: (ta.getAttribute('class') || '').slice(0, 240),
      chipBarH: bar ? Math.round(bar.getBoundingClientRect().height) : null,
    };
  })();

  // ===== 页面左上角标题：必须是同一个 PageHeader（钩子 data-dom-id="page-title"）=====
  let header = null;
  {
    const el = document.querySelector('[data-dom-id="page-title"]');
    if (el) {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      header = { text: (el.textContent || '').trim().slice(0, 20), size: px(cs.fontSize), weight: cs.fontWeight, x: Math.round(r.left), y: Math.round(r.top), family: (cs.fontFamily || '').split(',')[0].replace(/["']/g, '') };
    }
  }
  const hasPageHeader = !!header;
  if (!header) {
    // 没有 PageHeader 的屏（外壳、启动页）仍量一下左上角实际是什么，便于发现漏网的自写标题
    const cands = [];
    for (const el of document.querySelectorAll('h1,h2,[class*="__title"],[class*="-title"],strong')) {
      const txt = (el.textContent || '').trim();
      if (!txt || txt.length > 24) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 6 || r.top > 200 || r.left > 400) continue;
      cands.push({ text: txt.slice(0, 20), size: px(cs.fontSize), weight: cs.fontWeight, x: Math.round(r.left), y: Math.round(r.top), family: (cs.fontFamily || '').split(',')[0].replace(/["']/g, '') });
    }
    cands.sort((a, b) => b.size - a.size || a.y - b.y);
    header = cands[0] || null;
  }

  // ===== 按钮留白：量"文字到边框的真实空隙"，不是 CSS padding（固定高度的 flex 按钮 padding 本就是 0） =====
  const cramped = [];
  const pads = [];
  for (const b of document.querySelectorAll('button, .ant-btn')) {
    const txt = (b.textContent || '').trim();
    if (!txt) continue;
    const cs = getComputedStyle(b);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const r = b.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    // 纯图标按钮（带 aria-label 且文字极短）不算：它靠的是尺寸不是内边距
    if (txt.length <= 1 && b.getAttribute('aria-label')) continue;
    const range = document.createRange();
    range.selectNodeContents(b);
    const tr = range.getBoundingClientRect();
    const gapL = Math.round(tr.left - r.left);
    const gapR = Math.round(r.right - tr.right);
    const gapT = Math.round(tr.top - r.top);
    const gapB = Math.round(r.bottom - tr.bottom);
    pads.push(Math.min(gapL, gapR));
    if (Math.min(gapL, gapR) < 8 || Math.min(gapT, gapB) < 4) {
      cramped.push({ text: txt.slice(0, 14), gapX: Math.min(gapL, gapR), gapY: Math.min(gapT, gapB), h: Math.round(r.height), cls: (b.className || '').toString().slice(0, 34) });
    }
  }

  const layers = [];  for (const el of document.querySelectorAll('[role="dialog"],[role="menu"],[role="tooltip"],.ant-modal-content,.ant-drawer-content')) {
    const r = el.getBoundingClientRect();
    const inner = [...el.querySelectorAll('h1,h2,h3,p,span,div,button,label')].filter((n) => n.children.length === 0 && (n.textContent || '').trim());
    const sizes = inner.map((n) => px(getComputedStyle(n).fontSize)).filter(Boolean);
    layers.push({
      role: el.getAttribute('role') || el.className.toString().slice(0, 20),
      w: Math.round(r.width), h: Math.round(r.height),
      vwPct: f((r.width / innerWidth) * 100), vhPct: f((r.height / innerHeight) * 100),
      bg: getComputedStyle(el).backgroundColor,
      radius: getComputedStyle(el).borderRadius,
      fontSizes: [...new Set(sizes)].sort((a, b) => a - b),
      text: (el.textContent || '').trim().slice(0, 50),
    });
  }

  // ===== 底部显示不全：外壳最后一行（状态栏）必须整条落在视口内 =====
  const shell = document.querySelector('.wb-status-bar, [class*="status-bar"], [class*="statusbar"]');
  const sr = shell ? shell.getBoundingClientRect() : null;
  const rootEl = document.getElementById('root');
  const bottomFit = {
    hasStatusBar: !!shell,
    statusBottom: sr ? Math.round(sr.bottom) : null,
    statusClipped: sr ? sr.bottom > innerHeight + 0.5 : null,
    docOverflowY: Math.max(0, document.documentElement.scrollHeight - innerHeight),
    rootH: rootEl ? Math.round(rootEl.getBoundingClientRect().height) : null,
  };

  // ===== 自动化钩子在同一屏里必须唯一 =====
  // data-dom-id 是 E2E 与审计取元素的唯一稳定入口。同一屏出现两次重名，
  // 自动化就不知道点哪个（2026-10-07 nav-decision 被左侧导航与设置导航同时占用，
  // Demo 9 步的 Step 5 与 Step 9 一起报 strict mode violation）。
  // 跨页复用同一个钩子名不算冲突，所以只能在渲染后的屏幕上判，静态扫判不出来。
  const hookSeen = new Map();
  for (const el of document.querySelectorAll('[data-dom-id]')) {
    const k = el.getAttribute('data-dom-id');
    hookSeen.set(k, (hookSeen.get(k) || 0) + 1);
  }
  const dupHooks = [...hookSeen.entries()].filter(([, n]) => n > 1).map(([k, n]) => k + '×' + n);

  // ===== 链接协议普查（S3 / P1-11）=====
  // 界面里能点的东西只该有两种：跳本页（文档自己的协议）或跳网页（http/https）。
  // javascript: / data: / 自定义协议出现在 href 上就是"点击即执行本地程序"，
  // 而这类地址的来源包括模型回复与知识库条目——那是别人写的字，不是我们的输入。
  const classifyHref = (raw) => {
    try {
      const u = new URL(raw, location.href);
      if (u.protocol === 'http:' || u.protocol === 'https:') return null;
      if (u.protocol === location.protocol && u.origin === location.origin) return null;
      return u.protocol;
    } catch {
      return 'unparsable';
    }
  };
  const badLinks = [];
  for (const el of document.querySelectorAll('a[href], area[href]')) {
    const proto = classifyHref(el.getAttribute('href'));
    if (proto) {
      badLinks.push({ proto, text: (el.textContent || '').trim().slice(0, 24), href: (el.getAttribute('href') || '').slice(0, 48) });
    }
  }
  // 量具自证：不挂进文档的假链接必须被判坏。判不出来就说明普查本身是坏的，
  // 而"0 条坏链接"就只是量具没工作。
  const canaryNode = document.createElement('a');
  canaryNode.setAttribute('href', 'javascript:alert(1)');
  const canaryCaught = classifyHref(canaryNode.getAttribute('href')) === 'javascript:';

  const links = {
    total: document.querySelectorAll('a[href], area[href]').length,
    badCount: badLinks.length,
    bad: badLinks.slice(0, 8),
    canaryCaught,
  };

  /*
   * 浮层（弹窗 / 菜单）单独量一次层级（#62 用户提的"各部分、各卡片字号统一性与层级性"）。
   * 整屏组合数里混着背景页的标题与状态栏，拿它管浮层等于管不到；
   * 浮层要的是"标题 / 说明 / 标签 / 控件 / 提示"就那么几档，
   * 所以只取浮层里面的直接文字节点。
   */
  const dlg = document.querySelector('[role="dialog"], [role="menu"]');
  let overlayType = null;
  if (dlg) {
    overlayType = {};
    for (const el of dlg.querySelectorAll('*')) {
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join('').trim();
      if (!own) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const k = cs.fontSize + '/' + cs.fontWeight;
      overlayType[k] = (overlayType[k] || 0) + 1;
    }
  }

  /*
   * ===== 几何细账（用户 2026-10-11 指出："图标不在一个水平线上、线粗细不一致、导出栏超界"）=====
   * 前面量的是"有没有被裁掉"，这一节量的是三件截图才看得见、但可以用数判的事：
   *   1. 同一排图标是否共线、描边是否一致
   *   2. 按钮标签有没有被折成两行（CJK 会中间断字）
   *   3. 内容有没有溢出容器 / 被吸底操作条盖住
   * 每一项都带"量具自证"，取不到数就报 null 让门禁红，不许当成"没量到所以没问题"。
   */

  /** 四条几何判据的量具自证结果；任何一条 false 都由门禁报"量具失效、本屏读数作废" */
  const geoCanary = { spill: false, covered: false, align: false, stroke: false, rail: false, tiny: false, wrap: false };
  // --- 1. 一排图标：找"含 ≥2 个 svg 的 flex/grid 容器"，取最内层那一圈 ---
  /*
   * 先注入两条假缺陷（图标浮起 8px + 描边 1.8 混在 2 里），让下面的正常扫描去抓它们。
   * 抓不到就说明这两条判据没牙 —— 那"0 处不齐"是量具失效，不是界面干净。
   * 用真容器真 svg，走的是与产品元素完全同一条代码路径，不是另写一套判定。
   */
  const alignCanary = document.createElement('div');
  alignCanary.setAttribute('aria-label', '__geo_align_canary__');
  alignCanary.style.cssText = 'display:flex;align-items:center;height:40px;position:fixed;left:-9999px;top:0;opacity:0';
  alignCanary.innerHTML =
    '<span style="font-size:12px">参照文字</span>' +
    '<button style="display:inline-flex;align-items:center;height:24px"><svg width="16" height="16" stroke-width="2"></svg></button>' +
    '<button style="display:inline-flex;align-items:center;height:24px;margin-top:8px"><svg width="16" height="16" stroke-width="1.8"></svg></button>';
  document.documentElement.append(alignCanary);
  const iconRows = [];
  {
    const boxes = [];
    for (const el of document.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      if (cs.display !== 'flex' && cs.display !== 'inline-flex' && cs.display !== 'grid') continue
      if (cs.visibility === 'hidden' || cs.display === 'none') continue
      const svgs = [...el.querySelectorAll('svg')].filter((s) => {
        const r = s.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) return false;
        // 整只图标要在视口内：半滚出去的图标量到的中心线不是用户看到的那条线
        if (r.top < 0 || r.bottom > innerHeight) return false;
        // 宿主必须是"控件"尺寸。closest() 会一路往上找到面板（实测找到一个 900px 的祖先，
        // 它里面那只隐藏 svg 的 stroke 是 1px，把整排的读数都污染了）
        const host = s.closest('button,[aria-label],[title]');
        if (host) {
          const hr = host.getBoundingClientRect();
          if (hr.height > 64) return false;
        }
        return true;
      });
      if (svgs.length < 2 || svgs.length > 10) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 24 || r.height < 12 || r.height > 90) continue;
      // 只留最内层：外层容器会包含同一批 svg，重复报一遍同一个偏差
      if (boxes.some((b) => b.el.contains(el))) continue;
      while (boxes.length && el.contains(boxes[boxes.length - 1].el)) boxes.pop();
      boxes.push({ el, svgs, r });
    }
    for (const { el, svgs } of boxes) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const contentTop = r.top + parseFloat(cs.paddingTop || 0);
      const contentH = r.height - parseFloat(cs.paddingTop || 0) - parseFloat(cs.paddingBottom || 0);
      if (contentH < 8) continue;
      /*
       * 用户报的是"同一排里某个图标浮起来了"，所以判据要在**同一视觉行内**比中心线：
       * 先按中心 y 排序，相邻差 <10px 归一行，再量每行内部的最大偏离。
       * 三种参照系都实测过：
       *  - 容器边框盒中心：把 .set-row--last 那种故意收窄下边距的行报成偏 5px（假阳）；
       *  - 同排子元素中位中心：工具钮自己占满中位数，真偏 8px 量不到（假阴）；
       *  - 容器内容盒中心：窄屏下工具条换行以后，把"两行"误判成"一排不齐"（假阳）。
       */
      const centers = svgs
        .map((s) => {
          const sr = s.getBoundingClientRect();
          return { s, c: sr.top + sr.height / 2, sr };
        })
        .sort((a, b) => a.c - b.c);
      const lines = [];
      for (const item of centers) {
        const last = lines[lines.length - 1];
        if (last && item.c - last[last.length - 1].c < 10) last.push(item);
        else lines.push([item]);
      }
      let worst = 0;
      let worstAt = '';
      const strokes = new Set();
      const detail = [];
      for (const line of lines) {
        const mean = line.reduce((a, x) => a + x.c, 0) / line.length;
        /*
         * 判据 A：同一视觉行内，图标彼此的中心线偏离。
         * 抓的是"某个图标浮起来/沉下去"（描边、行高、对齐方式不一致都会落到这里）。
         */
        for (const { s, sr } of line) {
          const d = Math.abs(sr.top + sr.height / 2 - mean);
          const host = s.closest('button,[aria-label],[title]');
          if (d > worst) {
            worst = d;
            worstAt = ((host && (host.getAttribute('aria-label') || host.getAttribute('title'))) || (el.getAttribute('aria-label') || '') || (el.className || '').toString().slice(0, 30)).trim();
          }
          if (d > ${ICON_MAX_OFF_Y} && host) {
            const hr = host.getBoundingClientRect();
            detail.push({
              at: (host.getAttribute('aria-label') || host.getAttribute('title') || '').slice(0, 16),
              offY: Math.round((sr.top + sr.height / 2 - mean) * 10) / 10,
              btn: Math.round(hr.height) + '@' + Math.round(hr.top - r.top),
              self: getComputedStyle(host).alignSelf,
            });
          }
        }
        /*
         * 判据 B：这一行图标的中心 vs 同一容器里"纯文字子元素"的中心。
         * 抓的是判据 A 看不见的那一类：整组工具钮一起浮在条子上沿
         * （终端标签条实测：4 个钮中心 12，标签文字中心 20，差 8px —— 钮彼此是齐的，
         * 只有跟文字比才看得出来）。
         * 只在容器里确实有"带文字、不带图标"的直接子元素时才判，否则没有参照物。
         */
        const textKids = [...el.children].filter((k) => {
          if (k.querySelector('svg')) return false;
          const txt = (k.textContent || '').trim();
          if (!txt || txt.length > 40) return false;
          const kr = k.getBoundingClientRect();
          return kr.width > 12 && kr.height > 6 && kr.top >= r.top - 1 && kr.bottom <= r.bottom + 1;
        });
        if (!textKids.length) continue;
        const textCenter =
          textKids.reduce((a, k) => {
            const kr = k.getBoundingClientRect();
            return a + (kr.top + kr.height / 2);
          }, 0) / textKids.length;
        const d2 = Math.abs(mean - textCenter);
        if (d2 > worst) {
          worst = d2;
          worstAt = ((el.getAttribute('aria-label') || '') || (el.className || '').toString().slice(0, 30)).trim();
        }
      }
      for (const s of svgs) strokes.add(s.getAttribute('stroke-width') || getComputedStyle(s).strokeWidth || '2');
      iconRows.push({
        at: worstAt.slice(0, 30),
        n: svgs.length,
        h: Math.round(r.height),
        // 亚像素抖动 0.6px 以内算共线（transform/缩放会带来这种量级的误差）
        maxOffY: Math.round(worst * 10) / 10,
        strokes: [...strokes],
        detail: worst > ${ICON_MAX_OFF_Y} || strokes.size > 1 ? detail.slice(0, 6) : undefined,
      });
    }
    iconRows.sort((a, b) => b.maxOffY - a.maxOffY || b.strokes.length - a.strokes.length);
    // 假缺陷必须被上面的扫描抓到；抓到之后**从产品读数里摘掉**——
    // 它是量具的一部分，不是界面缺陷（第一版忘了摘，每屏都假红一条"canary 不齐"）
    const canaryIdx = iconRows.findIndex((row) => row.at.includes('__geo_align_canary__'));
    const canaryRow = canaryIdx >= 0 ? iconRows.splice(canaryIdx, 1)[0] : undefined;
    geoCanary.align = !!canaryRow && canaryRow.maxOffY > ${ICON_MAX_OFF_Y};
    geoCanary.stroke = !!canaryRow && canaryRow.strokes.length > 1;
    alignCanary.remove();
  }
  // 描边刻度的唯一来源：lucide 默认 2，我们若整体改成别的值必须一致
  const strokeToken = rootCs.getPropertyValue('--ui-icon-stroke').trim() || '2';

  // --- 2. 标签折行：文字实际高度超过 1.6 倍行高就是换行了 ---
  // 假缺陷先注入：一个 40px 宽、装 4 个汉字的短标签，必须被判成折行
  const wrapCanary = document.createElement('button');
  wrapCanary.type = 'button';
  wrapCanary.className = '__geo_wrap_canary__';
  wrapCanary.style.cssText = 'position:fixed;left:-9999px;top:0;width:40px';
  const wrapCanaryBox = document.createElement('div');
  const wrapCanaryLabel = document.createElement('div');
  wrapCanaryLabel.className = '__geo_wrap_canary__';
  wrapCanaryLabel.textContent = '故障诊断';
  wrapCanaryBox.append(wrapCanaryLabel);
  wrapCanary.append(wrapCanaryBox);
  document.body.append(wrapCanary);
  /*
   * 竖排按钮（图标在上、文字在下的 flex-col）外层不算折行，是故意的两层；
   * 但标签住在它的子层里，只量外层会漏掉"侧栏标签被挤成两行"整类（实测漏过一次），
   * 所以 button>span / button>div>div 也拉进来量 —— 容器里只装文字，range 高度就是文字高度。
   */
  const wrapped = [];
  for (const el of document.querySelectorAll('button,a,label,.tab,[class*="btn"],button>span,a>span,button>div>div,a>div>div')) {
    const txt = (el.textContent || '').trim();
    if (!txt || txt.length > 24) continue;
    // 控件里那层"标题+说明"的容器：短标签（≤10 字）不许断行，长说明允许两行
    const inner = el.matches('button > div > div, a > div > div, button>span, a>span');
    if (inner && txt.length > 10) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.whiteSpace === 'nowrap') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    // 图标在上、文字在下的竖排按钮是故意的两层，不是折行
    if (cs.flexDirection === 'column') continue;
    // 只量直接文本节点：把 svg 的高度算进来会让"图标+标签"的按钮全部假阳
    let textH = 0;
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.nodeValue.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      textH = Math.max(textH, range.getBoundingClientRect().height);
    }
    if (!textH) continue;
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
    if (textH > lh * 1.6) {
      wrapped.push({ text: txt.slice(0, 16), lines: Math.round(textH / lh), h: Math.round(r.height), cls: (el.className || '').toString().slice(0, 34) });
    }
  }
  {
    const ci = wrapped.findIndex((w) => w.cls.includes('__geo_wrap_canary__'));
    const crow = ci >= 0 ? wrapped.splice(ci, 1)[0] : undefined;
    geoCanary.wrap = !!crow && crow.lines >= 2;
    wrapCanary.remove();
  }

  // --- 3a. 溢出容器：子元素右缘越过父容器内容区（没 overflow:hidden 的"超界"前面量不到）---
  const spill = [];
  /** 被父级 overflow 裁掉的探出子元素：用户看不见，所以不算缺陷，但必须留痕 */
  const clippedKids = [];
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') continue; // 横向滚动是故意的
    const r = el.getBoundingClientRect();
    if (r.width < 20) continue;
    for (const kid of el.children) {
      const kr = kid.getBoundingClientRect();
      if (kr.width < 4 || kr.height < 4) continue;
      const over = kr.right - (r.right - parseFloat(cs.paddingRight || 0));
      if (over > 2) {
        /*
         * 父级自己会裁剪（overflow hidden/clip）时，用户看不见探出去的那一截 —— 那是故意的
         * 截断，不是超界。但这条豁免不能变成盲区：单独计数并打印，
         * 让"我靠裁剪糊过去"这件事在报告里留痕（实测模型 chip 就是这种情况）。
         */
        const clips = cs.overflowX === 'hidden' || cs.overflowX === 'clip' || cs.overflow === 'hidden';
        const row = {
          // 类名前缀 34 字经常认不出是哪个控件（实测撞过一次），给到 60 字并附上可访问名
          parent: (el.className || '').toString().slice(0, 60),
          parentAt: (el.getAttribute('aria-label') || el.getAttribute('title') || el.parentElement?.getAttribute('aria-label') || '').slice(0, 24),
          child: ((kid.textContent || '').trim().slice(0, 22) || kid.tagName),
          childAt: (kid.getAttribute('aria-label') || kid.getAttribute('title') || '').slice(0, 20),
          over: Math.round(over),
        };
        if (clips) clippedKids.push({ ...row, by: cs.overflowX });
        else spill.push(row);
      }
    }
    if (spill.length > 8) break;
  }

  // --- 3b. 吸底操作条盖住内容：拿 elementFromPoint 问"这一点上谁在最上面" ---
  const covered = [];
  {
    const bars = [...document.querySelectorAll('*')].filter((el) => {
      const cs = getComputedStyle(el);
      if (cs.position !== 'sticky' && cs.position !== 'fixed') return false;
      const r = el.getBoundingClientRect();
      // 贴着视口底部的一条横栏才算操作条
      return r.height > 20 && r.height < 200 && r.width > innerWidth * 0.4 && innerHeight - r.bottom < 4;
    });
    for (const bar of bars) {
      for (const el of document.querySelectorAll('input,textarea,select,button,label,a')) {
        if (bar.contains(el) || el.contains(bar)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) continue;
        const cx = Math.round(r.left + Math.min(r.width, 60) / 2);
        const cy = Math.round(r.top + r.height / 2);
        if (cy < 0 || cy > innerHeight) continue;
        const top = document.elementFromPoint(cx, cy);
        if (top && (top === bar || bar.contains(top))) {
          covered.push({
            bar: (bar.className || '').toString().slice(0, 30),
            hidden: ((el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.textContent || el.tagName) || '').trim().slice(0, 22),
          });
        }
      }
    }
  }
  // --- 4. 横向可滚的"轨道"必须让人看出来能滚（用户 2026-10-08/10-11 两次提"chip 滚动可发现性"）---
  // 契约：确实被裁到的 overflow-x 容器要带 data-rail，并用 data-rail-overflow 说明还有哪边能滚。
  // 没标 = 用户看见的是"巡…"这种被硬切一半的样子，以为界面画坏了。
  // 先注入两条假缺陷（未标注的溢出轨道 + 10px 的按钮），下面的扫描必须抓到它们
  const railCanary = document.createElement('div');
  railCanary.className = '__geo_rail_canary__';
  railCanary.style.cssText = 'position:fixed;left:-9999px;top:0;width:80px;height:24px;overflow-x:auto;white-space:nowrap';
  const railKid = document.createElement('span');
  railKid.style.cssText = 'display:inline-block;width:400px';
  railCanary.append(railKid);
  const tinyCanary = document.createElement('button');
  tinyCanary.type = 'button';
  tinyCanary.className = '__geo_tiny_canary__';
  tinyCanary.style.cssText = 'position:fixed;left:2px;top:2px;font-size:10px';
  tinyCanary.textContent = 'canary';
  // 第二条探针：可点的"行"（div + cursor:pointer，比如文件树节点行）。
  // 这一类没有 button/a/role 标记，只靠选择器列不全 —— 探针专门盯这条路径有没有生效。
  const rowCanary = document.createElement('div');
  rowCanary.className = '__geo_tiny_row_canary__';
  rowCanary.style.cssText = 'position:fixed;left:2px;top:20px;font-size:11px;cursor:pointer';
  rowCanary.textContent = 'canary row';
  document.body.append(railCanary, tinyCanary, rowCanary);

  const rails = [];
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (cs.overflowX !== 'auto' && cs.overflowX !== 'scroll') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 8) continue;
    if (el.scrollWidth - el.clientWidth <= 4) continue; // 没溢出，不需要 affordance
    const canScrollRight = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
    const expect =
      el.scrollLeft > 4 && canScrollRight ? 'both' : canScrollRight ? 'right' : 'left';
    let cutChild = null;
    for (const k of el.children) {
      const kr = k.getBoundingClientRect();
      if (kr.width > 2 && kr.right > r.right + 2) {
        cutChild = ((k.textContent || '').trim().slice(0, 12) || k.tagName);
        break;
      }
    }
    rails.push({
      cls: (el.className || '').toString().slice(0, 52),
      marked: el.hasAttribute('data-rail'),
      state: el.getAttribute('data-rail-overflow') || '',
      expect,
      hasMoreRight: canScrollRight,
      cutChild,
    });
  }
  const railCanaryIdx = rails.findIndex((x) => x.cls.includes('__geo_rail_canary__'));
  const railCanaryRow = railCanaryIdx >= 0 ? rails.splice(railCanaryIdx, 1)[0] : undefined;

  // --- 5. 控件不许用注释档：11px 的用途是"状态点旁注、进度百分比"，不是按钮/标签/输入 ---
  /*
   * 量的是"这个控件真正显示出来的标签字号"，不是控件元素自己的 getComputedStyle。
   * 三个原因（都实测踩过）：
   *   - 外壳根 .wb-main-layout / .wb-shell 把基线写成 11px，谁不显式设字号就继承它 ——
   *     纯图标按钮根本没文字也会被算进来（假阳）；
   *   - "标签 span 是 12px、只是按钮自己是继承的 11px"，按元素算同样假阳；
   *   - 复合控件（排行号 + 标题 + 浏览量的一行）里，序号和浏览量本来就是注释性文字，
   *     按"第一个文字"会抓到序号而不是标签。所以取**控件内所有可见文字里最大的那一档**当标签：
   *     控件的名字是它自己最显眼的那段字，剩下的都是旁注。
   * 输入框/下拉框没有文字子节点，取 placeholder / 当前值按自己的字号算。
   */
  const tinyControls = [];
  const primaryLabel = (el) => {
    let best = null;
    const walk = (cur) => {
      for (const n of cur.childNodes) {
        if (n.nodeType === 1) { walk(n); continue; }
        if (n.nodeType !== 3 || !n.nodeValue.trim()) continue;
        const ncs = getComputedStyle(cur);
        if (ncs.visibility === 'hidden' || ncs.display === 'none') continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        const box = range.getBoundingClientRect();
        if (box.width < 2 || box.height < 2) continue; // 画都没画出来（0 宽/被折叠）
        const size = parseFloat(ncs.fontSize);
        if (!best || size > best.size) best = { size, text: n.nodeValue.trim() };
      }
    };
    walk(el);
    return best;
  };
  /*
   * 候选集 = 显式控件 + 任何 cursor:pointer 的元素。后者管的是文件树节点行、可点卡片
   * 这一类"行"：既不是 button/a，也没有 role，只按选择器列会整个漏掉（实测 11px 的
   * .ft-row 就这样躲过了闸）。primaryLabel 取子树里最大那一档字，所以包着 14px 标签的
   * pointer 容器不会被误判，只有整行都停在注释档的才报。
   */
  const CONTROL_SELECTOR =
    'button,a,input,textarea,select,label,[role="tab"],[role="button"],[role="menuitem"]';
  /*
   * cursor:pointer 会往下继承，所以卡片里每个内层 span 都是"pointer 元素"。
   * 只判最外层那一格可点区域：父级本身可点或父级就是控件时跳过子节点，
   * 否则一段 11px 的次级说明会被当成控件标签（实测误报 41 条）。
   */
  const pointerHost = (el) => {
    const p = el.parentElement;
    if (!p) return true;
    const pcs = getComputedStyle(p);
    if (pcs.cursor === 'pointer' || p.matches(CONTROL_SELECTOR)) return false;
    return true;
  };
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const explicit = el.matches(CONTROL_SELECTOR);
    if (!explicit && !(cs.cursor === 'pointer' && pointerHost(el))) continue;
    let info = primaryLabel(el);
    if (!info && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) {
      const ph = (el.getAttribute('placeholder') || el.value || '').trim();
      if (ph) info = { size: parseFloat(cs.fontSize), text: ph };
    }
    if (!info) continue; // 纯图标控件：没有文字可判
    if (info.size >= 12) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    tinyControls.push({ text: info.text.slice(0, 16), size: info.size, cls: (el.className || '').toString().slice(0, 64) });
  }
  const tinyCanaryIdx = tinyControls.findIndex((x) => x.cls.includes('__geo_tiny_canary__'));
  const tinyCanaryRow = tinyCanaryIdx >= 0 ? tinyControls.splice(tinyCanaryIdx, 1)[0] : undefined;
  const rowCanaryIdx = tinyControls.findIndex((x) => x.cls.includes('__geo_tiny_row_canary__'));
  const rowCanaryHit = rowCanaryIdx >= 0 ? tinyControls.splice(rowCanaryIdx, 1)[0] : undefined;
  geoCanary.rail = !!railCanaryRow && railCanaryRow.hasMoreRight && !railCanaryRow.marked;
  geoCanary.tiny = !!tinyCanaryRow && tinyCanaryRow.size < 12;
  // 探针是 11px 的 pointer div：抓不到就说明 pointer 那条候选路径没生效
  geoCanary.tinyRow = !!rowCanaryHit && rowCanaryHit.size < 12;
  railCanary.remove();
  tinyCanary.remove();
  rowCanary.remove();

  // 同一类控件在同一屏会重复出现（侧栏 8 个钮就是 8 条），按 档+类名 归并成"种类"，
  // 否则 slice(0,8) 会被第一族刷满，后面几族根本看不见（实测被 nav-btn 挡住过一次）
  const tinyKindMap = new Map();
  for (const t of tinyControls) {
    const key = t.size + '|' + t.cls;
    const g = tinyKindMap.get(key);
    if (g) g.n += 1;
    else tinyKindMap.set(key, { ...t, n: 1 });
  }
  const tinyKinds = [...tinyKindMap.values()].sort((a, b) => b.n - a.n).slice(0, 10);

  /*
   * --- 6. 终端底色只能有一个来源（用户 2026-10-12 指出的"终端双色"）---
   * 画布底色来自 xterm 主题（CODE_THEMES[].terminal.background），容器与滚动条底色来自 CSS。
   * 两边以前各写各的（#1e1e1e vs one-dark 的 #282c34），同一块终端里就出现两种深灰。
   * 现在 TerminalView 把主题底色以 --terminal-bg 交到容器上，这里比对落到元素上的实际背景。
   */
  const toRgb = (c) => {
    const s = String(c).trim();
    const hex6 = /^#([0-9a-f]{6})$/i.exec(s);
    if (hex6) {
      const n = parseInt(hex6[1], 16);
      return 'rgb(' + ((n >> 16) & 255) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255) + ')';
    }
    const hex3 = /^#([0-9a-f]{3})$/i.exec(s);
    if (hex3) {
      const p = hex3[1].split('').map((h) => parseInt(h + h, 16));
      return 'rgb(' + p[0] + ', ' + p[1] + ', ' + p[2] + ')';
    }
    return s;
  };
  const termEls = [...document.querySelectorAll('.terminal-view')];
  const termTone = {
    total: termEls.length,
    noVar: termEls.filter((el) => !getComputedStyle(el).getPropertyValue('--terminal-bg').trim()).length,
    mismatch: termEls
      .map((el) => {
        const cs = getComputedStyle(el);
        const want = toRgb(cs.getPropertyValue('--terminal-bg'));
        if (!want) return null;
        const vp = el.querySelector('.xterm-viewport');
        const surfaces = [toRgb(cs.backgroundColor)];
        if (vp) surfaces.push(toRgb(getComputedStyle(vp).backgroundColor));
        const off = surfaces.find((v) => v && v !== want);
        return off ? { want, got: off } : null;
      })
      .filter(Boolean)
      .slice(0, 3),
  };

  // 量具自证：临时造一个"盖住按钮的吸底条"，上面两条必须抓到
  try {
    const probeBtn = document.createElement('button');
    probeBtn.type = 'button';
    probeBtn.setAttribute('aria-label', '__geo_canary__');
    probeBtn.textContent = 'canary';
    const probeBar = document.createElement('div');
    probeBar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:80px;background:#000;z-index:2147483647';
    probeBtn.style.cssText = 'position:fixed;left:40px;bottom:20px;width:120px;height:28px';
    document.body.append(probeBtn, probeBar);
    const rr = probeBtn.getBoundingClientRect();
    const hit = document.elementFromPoint(Math.round(rr.left + 20), Math.round(rr.top + rr.height / 2));
    geoCanary.covered = !!(hit && probeBar.contains(hit));
    const wide = document.createElement('div');
    wide.style.cssText = 'position:fixed;left:10px;width:60px;overflow:visible';
    const wideKid = document.createElement('span');
    wideKid.style.cssText = 'display:block;width:200px';
    wide.append(wideKid);
    document.body.append(wide);
    geoCanary.spill = wideKid.getBoundingClientRect().right - wide.getBoundingClientRect().right > 2;
    // 终端底色探针：造一个"声明了主题底色、容器却刷成另一个色"的假终端，必须判出不一致
    const tv = document.createElement('div');
    tv.className = 'terminal-view';
    tv.style.cssText =
      'position:fixed;left:2px;top:60px;width:60px;height:20px;--terminal-bg:#ff0000;background:#00ff00';
    document.body.append(tv);
    const tcs = getComputedStyle(tv);
    geoCanary.termTone =
      toRgb(tcs.getPropertyValue('--terminal-bg')) === 'rgb(255, 0, 0)' &&
      tcs.backgroundColor === 'rgb(0, 255, 0)';
    tv.remove();
    probeBtn.remove();
    probeBar.remove();
    wide.remove();
  } catch {
    /* 造不了探针就留 false，由门禁报"量具失效" */
  }

  return {
    viewport: [innerWidth, innerHeight],
    iconRows: iconRows.slice(0, 6),
    iconRowWorstOffY: iconRows.length ? iconRows[0].maxOffY : null,
    iconRowsMixedStroke: iconRows.filter((r) => r.strokes.length > 1).length,
    strokeToken,
    wrapped,
    wrappedCount: wrapped.length,
    spill,
    spillCount: spill.length,
    clippedKids: clippedKids.slice(0, 4),
    clippedKidCount: clippedKids.length,
    covered,
    coveredCount: covered.length,
    rails: rails.slice(0, 6),
    railCount: rails.length,
    railMissingMark: rails.filter((x) => x.hasMoreRight && !x.marked).length,
    railBadState: rails.filter((x) => x.marked && x.state !== x.expect).length,
    tinyControls: tinyKinds,
    tinyControlCount: tinyControls.length,
    termTone,
    geoCanary,
    overlayType,
    overlayTiers: overlayType ? new Set(Object.keys(overlayType).map((k) => k.split('px/')[0] + 'px')).size : 0,
    dupHooks,
    typeScales: Object.fromEntries(Object.entries(type).sort((a, b) => b[1] - a[1]).slice(0, 24)),
    distinctTypeCombos: Object.keys(type).length,
    families: [...families],
    familySample,
    bottomFit,
    lowContrast: low.sort((a, b) => a.contrast - b.contrast).slice(0, 20),
    lowContrastCount: low.length,
    exemptContrastCount: exemptContrast.length,
    exemptContrastReasons: [...new Set(exemptContrast.map((e) => e.reason + '(' + e.text + ' ' + e.contrast + ':1)'))].slice(0, 6),
    clipped,
    iconSizes: Object.fromEntries(Object.entries(icons).sort((a, b) => b[1] - a[1]).slice(0, 14)),
    offTierIcons: offTierIcons.slice(0, 6),
    header,
    hasPageHeader,
    panelHeads,
    panelHeaderToken: Number.isFinite(panelHeaderToken) ? panelHeaderToken : null,
    composerMinToken: Number.isFinite(composerMinToken) ? composerMinToken : null,
    tierUnresolved: unresolvedTiers,
    composer,
    tierDriftCount: tierDrift.length,
    tierDrift: tierDrift.slice(0, 8),
    crampedButtons: cramped.slice(0, 10),
    crampedButtonCount: cramped.length,
    medianButtonGapX: pads.length ? pads.sort((a, b) => a - b)[Math.floor(pads.length / 2)] : null,
    layers,
    links,
  };
})()`

/**
 * 导航后等页面"定下来"，而不是干等固定毫秒
 *
 * 实测坑（2026-10-08）：并跑完整单测后紧接着跑审计，机器正忙，sleep(1600) 时 #/logs 还没渲染完，
 * 探针把外壳状态栏的 "TDSF<主机>·root" 当成左上角标题，报出"没有 PageHeader"的假红灯；
 * 反过来半渲染的页面元素更少，也可能量成"组合数达标"的假绿。
 * 判据：路由已切过去，且连续两次取到的 DOM 规模与文本长度都不再变，才算稳定。
 * 超时就如实记 settled=false，由门禁报"探针没跑成"——没测到不等于通过。
 */
async function settle(ws, hash, capMs = 9000) {
  await evalIn(ws, `location.hash = ${JSON.stringify(hash)}`)
  const started = Date.now()
  let prev = null
  let same = 0
  while (Date.now() - started < capMs) {
    await sleep(200)
    const snap = await evalIn(
      ws,
      `(() => JSON.stringify([location.hash, document.querySelectorAll('*').length, (document.body.innerText || '').length]))()`
    )
    if (snap === prev && JSON.parse(snap)[0] === hash) {
      same += 1
      if (same >= 2) return { settled: true, waitedMs: Date.now() - started }
    } else {
      same = 0
    }
    prev = snap
  }
  return { settled: false, waitedMs: Date.now() - started }
}

/**
 * 走真实用户路径切明暗档：设置 → 外观 → 点那张卡片，然后等 <html data-theme> 真的翻过去。
 *
 * 不去写 localStorage / 直接 setTheme 的原因：那样量的是"我自己调的开关"，
 * 不是"用户点那格有没有反应"。卡片点了不生效这类毛病只有真点才看得见。
 * 翻不过去就返回 false，由门禁报"本轮未测"——浅色那遍没跑成不能算通过。
 */
async function applyTheme(ws, mode) {
  const label = mode === 'light' ? '浅色模式' : '深色模式'
  await settle(ws, '#/settings/appearance')
  const clicked = await evalIn(
    ws,
    `(() => {
      const card = [...document.querySelectorAll('button.set-theme-card')].find(
        (b) => (b.textContent || '').includes(${JSON.stringify(label)}),
      );
      if (!card) return 'no-card';
      card.click();
      return 'clicked';
    })()`
  )
  if (clicked !== 'clicked') return { ok: false, why: clicked }
  const started = Date.now()
  while (Date.now() - started < 8000) {
    await sleep(150)
    const now = await evalIn(ws, `document.documentElement.getAttribute('data-theme')`)
    if (now === mode) return { ok: true, waitedMs: Date.now() - started }
  }
  return { ok: false, why: 'data-theme 没翻过去' }
}

const ROUTES = [
  { hash: '#/workbench', name: '01-workbench' },  { hash: '#/knowledge', name: '02-knowledge' },
  { hash: '#/knowledge/nope', name: '03-knowledge-missing' },
  { hash: '#/tutorial', name: '04-tutorial' },
  { hash: '#/logs', name: '05-logs' },
  { hash: '#/monitor', name: '06-monitor' },
  { hash: '#/decision', name: '07-decision' },
  { hash: '#/settings', name: '08-settings' },
  // 设置区 10 个子页全覆盖：标题单源改动（settings-sections）要有真机证据，
  // 少测一页就可能有一页的左上角标题悄悄跑偏
  { hash: '#/settings/general', name: '09a-settings-general' },
  { hash: '#/settings/appearance', name: '09b-settings-appearance' },
  { hash: '#/settings/terminal', name: '09c-settings-terminal' },
  { hash: '#/settings/decision', name: '09d-settings-decision' },
  { hash: '#/settings/alerts', name: '09e-settings-alerts' },
  { hash: '#/settings/calibration', name: '09f-settings-calibration' },
  { hash: '#/settings/ssh', name: '10-settings-ssh' },
  { hash: '#/settings/model', name: '11-settings-model' },
  { hash: '#/settings/risk', name: '12-settings-risk' },
  { hash: '#/settings/about', name: '13-settings-about' },
]

const report = { screens: [] }
/** 取证没跑完就不能报成功：以前 finally 里无条件 process.exit(0)，截图一挂照样绿，等于给坏掉的量具开绿灯 */
let auditFailed = false
try {
  const target = await findTarget()
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', rej, { once: true })
  })
  await cdp(ws, 'Runtime.enable')
  await cdp(ws, 'Page.enable')
  await cdp(ws, 'Page.bringToFront')
  // 0) 真实窗口装不装得下：必须在改模拟视口之前量，这里读到的才是用户屏幕上真实的窗口高度
  await sleep(2500)
  report.windowFit = await evalIn(ws, `(() => {
    const bar = document.querySelector('.wb-status-bar, [class*="status-bar"], [class*="statusbar"]');
    const r = bar ? bar.getBoundingClientRect() : null;
    return { inner: [innerWidth, innerHeight], screen: [screen.width, screen.height],
      avail: [screen.availWidth, screen.availHeight],
      statusBar: r ? { bottom: Math.round(r.bottom), h: Math.round(r.height) } : null,
      fits: r ? r.bottom <= innerHeight + 0.5 : null };
  })()`)
  console.log('真实窗口：' + JSON.stringify(report.windowFit))
  // 视口可覆盖：UI_AUDIT_W=1920 UI_AUDIT_H=1080 复现"全屏后底部显示不全"
  const vp = [Number(process.env.UI_AUDIT_W || 1440), Number(process.env.UI_AUDIT_H || 900)]
  if (!vp.every((n) => Number.isFinite(n) && n >= 600)) {
    console.error(`UI_AUDIT_W / UI_AUDIT_H 必须是 600 以上的数字，收到 ${JSON.stringify([process.env.UI_AUDIT_W, process.env.UI_AUDIT_H])}`)
    app.kill()
    process.exit(2)
  }
  await cdp(ws, 'Emulation.setDeviceMetricsOverride', { width: vp[0], height: vp[1], deviceScaleFactor: 1, mobile: false })

  // 1) 启动页：进度条还在走的时候截一张，走完了再截一张
  await sleep(1200)
  const bootEarly = await shot(ws, '00-boot-early')
  const bootMeasure = await evalIn(ws, MEASURE)
  await sleep(3500)
  const bootLate = await shot(ws, '00-boot-late')
  report.boot = { early: bootEarly, late: bootLate, measure: bootMeasure }

  await evalIn(ws, `(() => { const e = document.querySelector('button[data-dom-id="boot-enter"]'); if (e) e.click(); })()`)
  await sleep(2500)

  report.cjk = []
  report.themePasses = {}
  report.termOpened = {}
  /**
   * 一个明暗档跑一遍全界面量测（默认 dark + light 两遍）。
   *
   * 为什么要两遍：整套判据（对比度 / 遮挡 / 字阶 / 中文落衬线）过去只在深色下取过数，
   * 脚本里连 theme/light 一个字都没出现。浅色是用户可选项，却从没被执行体看过。
   * 2026-10-16 第一次量浅色就抓到两处：风险徽章三档底色写死深色 hex（浅字压深底 2.9:1）、
   * 日志 WARN 标签拿品牌原色当文字色（浅档 3.4:1）——都在浅色下看不清，深色下全过。
   *
   * UI_AUDIT_THEME=dark|light 只跑单档（调试用）。浅色那遍截图带 light- 前缀，
   * 不加前缀就是同名覆盖，等于把深色那遍的证据删了。
   */
  const sweepPass = async (mode) => {
    const prefix = mode === 'light' ? 'light-' : ''
    const applied = await applyTheme(ws, mode)
    report.themePasses[mode] = applied
    console.log(`明暗档：${mode} → ${JSON.stringify(applied)}`)
    if (!applied.ok) {
      auditFailed = true
      console.error(`切到 ${mode} 没成功（${applied.why}），这一遍不产出读数`)
      return
    }
    for (const r of ROUTES) {
      const st = await settle(ws, r.hash)
      /*
       * 工作台那屏先真的开一条本机终端：终端底色一致性只有在屏上有 xterm 实例时才量得到，
       * 而本机终端不需要连任何服务器。开不出来就如实记下（不静默跳过），门禁会报"本轮未测"。
       */
      if (r.hash === '#/workbench') {
        report.termOpened[mode] = await evalIn(ws, `(async () => {
          if (document.querySelector('.terminal-view')) return 'already';
          const fire = (el) => ['pointerdown', 'pointerup', 'click'].forEach((t) =>
            el.dispatchEvent(t.startsWith('pointer')
              ? new PointerEvent(t, { bubbles: true, cancelable: true })
              : new MouseEvent(t, { bubbles: true, cancelable: true })),
          );
          // 空态里就有一颗直达按钮；没有空态才去开"新建终端菜单"（Radix 要真事件序列才弹）
          const direct = [...document.querySelectorAll('button')].find((x) =>
            (x.textContent || '').includes('开一个本机终端'),
          );
          if (direct) fire(direct);
          else {
            const btn = document.querySelector('button[data-dom-id="workbench-new-terminal"]');
            if (!btn) return 'no-button';
            fire(btn);
            await new Promise((res) => setTimeout(res, 500));
            const item = [...document.querySelectorAll('[role="menuitem"]')].find((x) =>
              (x.textContent || '').includes('开一个本机终端'),
            );
            if (!item) return 'no-menuitem';
            fire(item);
          }
          for (let i = 0; i < 40; i++) {
            await new Promise((res) => setTimeout(res, 250));
            if (document.querySelector('.terminal-view')) return 'opened';
          }
          return 'timeout';
        })()`)
        console.log(`本机终端探针（${mode}）：${report.termOpened[mode]}`)
      }
      const file = await shot(ws, prefix + r.name, 'page')
      const m = await evalIn(ws, MEASURE)
      // route 带上档位：浅色那遍报出来的缺陷如果写成 "#/logs"，读的人会以为是深色下的事
      report.screens.push({
        route: `${r.hash}@${mode}`,
        png: file,
        settled: st.settled,
        waitedMs: st.waitedMs,
        ...m,
      })
      report.cjk.push(await cjkFontAudit(ws, `${r.hash}@${mode}`))
    }
  }
  for (const mode of process.env.UI_AUDIT_THEME ? [THEME] : ['dark', 'light']) {
    await sweepPass(mode)
  }

  /*
   * 额外视口两遍（用户 2026-10-11："这个导出栏做的不是很好，超界了你之前测试都没截图看到"）
   *
   * 宽屏 1440×900 下动作条永远不挤：按钮不折行、路径不溢出，那些只在窗口变窄时出现；
   * 反过来 AI 面板输入区被压扁只在窗口变矮时出现。两遍各管一头，
   * 窄屏那遍还要**先点一次"导出统计"**把那条上百字符的落盘路径渲染出来
   * （不点就没有那个状态，等于没测）。
   */
  const EXTRA_VIEWS = [
    {
      tag: '窄',
      size: [Number(process.env.UI_AUDIT_NARROW_W || 1120), Number(process.env.UI_AUDIT_NARROW_H || 680)],
      routes: [
        ['#/workbench', 'n-01-workbench-narrow'],
        ['#/settings/model', 'n-02-settings-model-narrow'],
      ],
      clickExport: true,
    },
    {
      tag: '矮',
      size: [Number(process.env.UI_AUDIT_SHORT_W || 1440), Number(process.env.UI_AUDIT_SHORT_H || 700)],
      routes: [
        ['#/workbench', 's-01-workbench-short'],
        ['#/settings/model', 's-02-settings-model-short'],
      ],
      clickExport: false,
    },
  ]
  for (const view of EXTRA_VIEWS) {
    if (!view.size.every((n) => Number.isFinite(n) && n >= 600)) {
      console.error(`${view.tag}屏视口宽高必须是 600 以上的数字，收到 ${JSON.stringify(view.size)}`)
      app.kill()
      process.exit(2)
    }
    await cdp(ws, 'Emulation.setDeviceMetricsOverride', {
      width: view.size[0],
      height: view.size[1],
      deviceScaleFactor: 1,
      mobile: false,
    })
    for (const [hash, name] of view.routes) {
      const st = await settle(ws, hash)
      if (view.clickExport) {
        // 点"导出统计"让长反馈文本真的出现在栏里；没有这个按钮就如实记下，不静默跳过
        report.narrowExportClicked = await evalIn(ws, `(async () => {
          const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('导出统计'));
          if (b) { b.click(); await new Promise((r) => setTimeout(r, 900)); }
          return !!b;
        })()`)
      }
      const file = await shot(ws, name)
      const m = await evalIn(ws, MEASURE)
      report.screens.push({
        route: `${hash}@${view.size[0]}×${view.size[1]}`,
        png: file,
        settled: st.settled,
        waitedMs: st.waitedMs,
        ...m,
      })
    }
  }
  await cdp(ws, 'Emulation.setDeviceMetricsOverride', {
    width: vp[0],
    height: vp[1],
    deviceScaleFactor: 1,
    mobile: false,
  })

  // 2) 风险控制页功能实测：只读规则表真的把引擎规则画出来了（不是空表、不是错误态）
  const stRisk = await settle(ws, '#/settings/risk')
  report.riskRules = {
    settled: stRisk.settled,
    ...(await evalIn(ws, `(() => {
    const rows = [...document.querySelectorAll('.set-table tbody tr')];
    const text = document.querySelector('.set-subpage')?.innerText || '';
    return {
      rowCount: rows.length,
      firstRow: rows[0] ? rows[0].innerText.replace(/\\s+/g, ' ').trim() : null,
      hasError: text.includes('规则读取失败'),
      hasInternalRef: text.includes('@'),
      addRuleButton: [...document.querySelectorAll('button')].some((b) => (b.textContent || '').includes('新增规则')),
    };
  })()`)),
  }
  await shot(ws, '13b-settings-risk-rules')

  // 3) 弹层实测：自研表单弹窗（添加服务器）/ 自研确认框 / 右键菜单
  //    2026-10-07 换目标：可编辑规则表随假设置删了，添加服务器也从 antd Modal 换成自研 Dialog，
  //    这里量的就是"页面 + 浮层"叠在一起时的对比度与遮挡。
  await settle(ws, '#/settings/ssh')
  await evalIn(ws, `(async () => {
    const add = [...document.querySelectorAll('button')].find((b) => (b.textContent||'').includes('添加服务器'));
    if (add) add.click();
    await new Promise((x) => setTimeout(x, 900));
  })()`)
  report.formDialog = await evalIn(ws, MEASURE)
  report.cjk.push(await cjkFontAudit(ws, '#/settings/ssh 添加服务器弹窗'))
  report.formDialogOpen = await evalIn(ws, `!!document.querySelector('[role="dialog"]')`)
  await shot(ws, '14-modal-form-connect')
  await evalIn(ws, `(() => { const c = document.querySelector('[role="dialog"] [aria-label="关闭"], .ant-modal-close'); if (c) c.click(); })()`)
  await sleep(600)

  await evalIn(ws, `(async () => {
    const del = [...document.querySelectorAll('button')].find((b) =>
      (b.textContent||'').includes('删除') || (b.getAttribute('aria-label')||'').startsWith('删除'));
    if (del) del.click();
    await new Promise((x) => setTimeout(x, 900));
  })()`)
  report.confirmDialog = await evalIn(ws, MEASURE)
  report.cjk.push(await cjkFontAudit(ws, '确认框弹窗'))
  await shot(ws, '14-dialog-confirm')
  await evalIn(ws, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await sleep(500)

  await settle(ws, '#/workbench')
  await evalIn(ws, `(async () => {
    const t = document.querySelector('.wb-filetree-empty') || document.querySelector('.wb-filetree-scroll > *');
    if (!t) return;
    const r = t.getBoundingClientRect();
    t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 12, clientY: r.top + 12 }));
    await new Promise((x) => setTimeout(x, 800));
  })()`)
  report.contextMenu = await evalIn(ws, MEASURE)
  report.cjk.push(await cjkFontAudit(ws, '右键菜单'))
  await shot(ws, '15-menu-context')

  console.log(JSON.stringify(report, null, 2))
  console.log('\n截图目录：' + OUT_DIR)

  // ===== --gate：把上面的量测变成硬闸（判据见 DESIGN.md §8） =====
  if (process.argv.includes('--gate')) {
    const MAX_COMBOS = 12 // 单屏 (字号/字重/字体族) 组合数上限；实测最松的一屏是 10
    const bad = []
    const exemptNotes = []
    /** 几何类"不算缺陷但要留痕"的说明（例如被 overflow 裁掉的探出） */
    const geoNotes = []
    const pages = [report.boot.measure, ...report.screens].filter(Boolean)
    // 弹层那几条是在"页面 + 浮层"整体上量的，组合数/字体族会把页面本身重复计入，只查对比度与遮挡
    const layers = [report.formDialog, report.confirmDialog, report.contextMenu].filter(Boolean)
    // 浮层没弹起来的话，上面三条量的就是页面本身——那等于没测，必须报错
    if (!report.formDialogOpen) bad.push('添加服务器弹窗没弹起来（探针点了但没开），浮层量测无效')
    // 探针没等页面定下来就取数，读数一律作废：半渲染的页面既能造假红（漏 PageHeader）也能造假绿（元素更少、组合数更低）
    for (const s of report.screens) {
      if (s.settled === false) {
        bad.push(`${s.route}: 页面 ${s.waitedMs}ms 内没稳定（探针读数作废，先减机器负载再重跑）`)
      }
    }
    /*
     * 明暗两档都必须真跑到：浅色那遍是 2026-10-16 才补上的维度，
     * 少了它，"全部界面达标"这句话只对深色负责。单档调试（UI_AUDIT_THEME=…）
     * 时如实报"另一档本轮未测"，不静默当成通过。
     */
    const passes = report.themePasses || {}
    for (const m of ['dark', 'light']) {
      if (!passes[m]) bad.push(`${m} 档整遍没跑（单档调试或切档失败），本报告的"达标"不覆盖这一档`)
      else if (!passes[m].ok) bad.push(`${m} 档切档失败（${passes[m].why}），这一档没有读数`)
      const t = (report.termOpened || {})[m]
      if (passes[m]?.ok && t !== 'opened' && t !== 'already') {
        bad.push(`${m} 档工作台没开出本机终端（${t}），终端底色那条判据本轮未测`)
      }
    }
    if (report.riskRules && report.riskRules.settled === false) {
      bad.push('#/settings/risk: 页面没稳定就量规则表（探针读数作废）')
    }
    for (const s of [...pages, ...layers]) {
      const at = s.route || 'boot/弹层'
      if (s.lowContrastCount) bad.push(`${at}: ${s.lowContrastCount} 处文字达不到 WCAG AA（最低 ${s.lowContrast[0]?.contrast}:1 — "${s.lowContrast[0]?.text}"）`)
      if (s.exemptContrastCount) {
        exemptNotes.push(`${at}: ${s.exemptContrastCount} 处对比度未判（${s.exemptContrastReasons.join('、')}）`)
      }
      for (const c of s.clipped) bad.push(`${at}: 文字被藏起来且无省略号 — "${c.text}" (${c.cls}) ${c.over}`)
      if (!s.dupHooks) bad.push(`${at}: 重名钩子探针没跑成（没测到不等于通过）`)
      else if (s.dupHooks.length) bad.push(`${at}: 同屏重名自动化钩子 — ${s.dupHooks.join('、')}（E2E 与审计会点到错元素）`)
      // 链接协议普查（S3）：坏协议 href 一律红；canary 没被抓到说明普查本身坏了，
      // 那种情况下"0 条坏链接"是量具失效的假绿，不是通过
      if (s.links) {
        if (!s.links.canaryCaught) bad.push(`${at}: 链接普查量具失效（注入的 javascript: 假链接没被判出来），本屏 ${s.links.total} 条链接的读数作废`)
        for (const l of s.links.bad) bad.push(`${at}: 界面里有 ${l.proto} 协议的可点链接 — "${l.text}" href=${l.href}`)
      } else if (s.route) {
        bad.push(`${at}: 链接普查没跑成（没拿到 links 字段，0 条不等于通过）`)
      }
    }
    // 真实字族（#62）：中文不许实际落在衬线字族上（用户看到的宋体），
    // 且每屏都必须抓到显式 SimSun 探针——探针没抓到就是量具坏了，"0 处衬线"是假绿。
    if (!(report.cjk || []).length) bad.push('字族普查整批没跑（0 屏不等于通过）')
    for (const c of report.cjk || []) {
      if (!c.canaryCaught)
        bad.push(`${c.label}: 字族普查量具失效（显式 SimSun 探针没被抓到），本屏 ${c.marked} 个中文节点的读数作废`)
      for (const s of c.serif)
        bad.push(`${c.label}: 中文实际落在衬线字族 ${s.family}（${s.glyphs} 个字形）——代码栈要在 monospace 前补中文黑体族`)
    }
    // 浮层层级（#62）：弹窗/菜单自己那一层有几档字号要数得过来；
    // 整屏组合数混着背景页，管不到浮层，所以这条单独判。
    const OVERLAY_TIERS = 4
    const overlays = [
      ['添加服务器弹窗', report.formDialog],
      ['确认框弹窗', report.confirmDialog],
      ['右键菜单', report.contextMenu],
    ].filter(([, s]) => s && s.overlayType)
    if (overlays.length < 2)
      bad.push(`浮层字号普查只量到 ${overlays.length} 个浮层（应 ≥2），这条判据现在等于没跑`)
    for (const [name, s] of overlays) {
      if (s.overlayTiers > OVERLAY_TIERS)
        bad.push(`${name}: 浮层内出现 ${s.overlayTiers} 档字号（上限 ${OVERLAY_TIERS}）— ${Object.keys(s.overlayType).join('、')}`)
    }
    for (const s of pages) {
      const at = s.route || 'boot'
      if (s.distinctTypeCombos > MAX_COMBOS) bad.push(`${at}: 字号/字重/字体族组合 ${s.distinctTypeCombos} 种（上限 ${MAX_COMBOS}）`)
      // 只查图标档：>48px 的是图表/插画（recharts 的容器 SVG），不是图标
      const offIcon = (s.offTierIcons || []).map((o) => `${o.size}「${o.at || o.cls}」`)
      if (offIcon.length) bad.push(`${at}: 图标尺寸不在刻度内 — ${offIcon.join(', ')}`)
      const fams = s.families || []
      if (fams.length > 2) {
        const sample = s.familySample || {}
        bad.push(`${at}: 字体族 ${fams.length} 套 — ${fams.map((fm) => `${fm}(${sample[fm] || '?'})`).join('，')}`)
      }
      if (s.bottomFit?.statusClipped) {
        bad.push(`${at}: 底部状态栏被裁掉（bottom ${s.bottomFit.statusBottom} > 视口高 ${s.viewport[1]}，root 高 ${s.bottomFit.rootH}）`)
      }
      const tiny = Object.keys(s.typeScales).filter((k) => parseFloat(k) < 11)
      if (tiny.length) bad.push(`${at}: 出现低于 11px 的字号 — ${tiny.join(', ')}`)
      if (s.tierDriftCount) {
        const sample = s.tierDrift.map((d) => `${d.tier} 应 ${d.want}px 实为 ${d.got}px「${d.text}」`).slice(0, 3)
        bad.push(`${at}: ${s.tierDriftCount} 处字阶类被别的 CSS 压掉了（类在、字号却不是令牌值）— ${sample.join('；')}`)
      }
      // 量具自证：某一档的 --text-* 读不出数值，那一档的漂移检测就等于没做
      if (s.tierUnresolved?.length) {
        bad.push(`${at}: 这些字阶档在 :root 上解析不出 px（${s.tierUnresolved.join('、')}），漂移检测对它们不设防`)
      }
      // ===== 几何细账（用户 2026-10-11："图标不在一条线、线粗细不一致、导出栏超界"）=====
      // 先判量具再判读数：探针没跑成的话 0 条不算干净
      if (!s.geoCanary) bad.push(`${at}: 几何探针没跑成（0 条不等于通过）`)
      else {
        if (!s.geoCanary.covered) bad.push(`${at}: 遮挡探针失效（造的假吸底条没被抓到），covered 读数作废`)
        if (!s.geoCanary.spill) bad.push(`${at}: 溢出探针失效（造的假超界子元素没被抓到），spill 读数作废`)
        if (!s.geoCanary.align) bad.push(`${at}: 共线探针失效（造的"图标浮起 8px"没被抓到），iconRowWorstOffY 读数作废`)
        if (!s.geoCanary.stroke) bad.push(`${at}: 描边探针失效（造的 1.8/2 混排没被抓到），mixedStroke 读数作废`)
        if (!s.geoCanary.rail) bad.push(`${at}: 轨道探针失效（造的"被裁却没标注的横向滚动容器"没被抓到），rails 读数作废`)
        if (!s.geoCanary.tiny) bad.push(`${at}: 微档探针失效（造的 10px 按钮没被抓到），tinyControls 读数作废`)
        if (!s.geoCanary.tinyRow) bad.push(`${at}: 可点行探针失效（造的 11px cursor:pointer 行没被抓到），文件树/列表那一类控件不在闸的覆盖内`)
        if (!s.geoCanary.wrap) bad.push(`${at}: 折行探针失效（造的"40px 宽装 4 个汉字"没被抓到），wrapped 读数作废`)
        if (!s.geoCanary.termTone) bad.push(`${at}: 终端底色探针失效（造的"主题色≠容器色"假终端没被抓到），termTone 读数作废`)
      }
      // 终端双色（画布一个色、容器另一个色）只有在屏上真有终端时才能量到
      if (s.termTone && s.termTone.total) {
        if (s.termTone.noVar)
          bad.push(`${at}: ${s.termTone.noVar} 个终端容器没带 --terminal-bg（底色又回到 CSS 与 xterm 各写各的）`)
        if (s.termTone.mismatch.length)
          bad.push(
            `${at}: 终端容器底色与主题底色不一致 — ${s.termTone.mismatch
              .map((m) => `应为 ${m.want}，实为 ${m.got}`)
              .join('；')}`,
          )
      } else if (String(at).startsWith('#/workbench')) {
        geoNotes.push(`${at}: 屏上没有终端实例（未连接/终端未打开），底色一致性本轮未测`)
      }
      if (s.iconRowWorstOffY === null || s.iconRowWorstOffY === undefined) {
        // 只有确实没有成排图标的屏才允许 null（外壳/启动页），其余屏取不到就是没量到
        if ((s.iconSizes && Object.keys(s.iconSizes).length > 2) && at === '#/workbench')
          bad.push(`${at}: 成排图标没量到（有 svg 却没识别出容器），共线判据等于没跑`)
      } else if (s.iconRowWorstOffY > ICON_MAX_OFF_Y) {
        const worst = (s.iconRows || [])[0]
        bad.push(`${at}: 一排图标不在同一水平线 — 最大偏移 ${s.iconRowWorstOffY}px（上限 ${ICON_MAX_OFF_Y}）「${worst?.at}」${worst?.n} 个图标`)
      }
      if (s.iconRowsMixedStroke) {
        const rows = (s.iconRows || []).filter((r) => r.strokes.length > 1)
        bad.push(`${at}: ${s.iconRowsMixedStroke} 排图标描边粗细不一致 — ${rows.map((r) => `「${r.at}」${r.strokes.join('/')}`).join('；')}（--ui-icon-stroke=${s.strokeToken}）`)
      }
      for (const w of s.wrapped || []) {
        bad.push(`${at}: 按钮/标签文字被折成 ${w.lines} 行 — 「${w.text}」(${w.cls}, 高 ${w.h}px)`)
      }
      for (const p of s.spill || []) {
        bad.push(`${at}: 内容溢出容器右缘 ${p.over}px — 「${p.child}」${p.childAt ? `(${p.childAt})` : ''} 在 .${p.parent}${p.parentAt ? ` 「${p.parentAt}」` : ''}`)
      }
      for (const c of s.covered || []) {
        bad.push(`${at}: 吸底条 .${c.bar} 盖住了「${c.hidden}」（看得见点不着）`)
      }
      // 横向滚动轨道：被裁却没提示 = 用户读到"界面画坏了"（DESIGN.md §8 第 16 条）
      for (const rl of s.rails || []) {
        if (rl.hasMoreRight && !rl.marked)
          bad.push(
            `${at}: 横向轨道被裁到「${rl.cutChild}」却没有可滚动提示（缺 data-rail/淡出）— .${rl.cls}`,
          )
        else if (rl.marked && rl.state !== rl.expect)
          bad.push(
            `${at}: 横向轨道的溢出状态写错 — .${rl.cls} 标成 ${rl.state || '(空)'}，实际是 ${rl.expect}（淡出会画错边）`,
          )
      }
      // 注释档（--ui-font-micro 11px）只给旁注用；按钮/标签/输入借它就是字阶漂移
      if (s.tinyControlCount) {
        bad.push(
          `${at}: ${s.tinyControlCount} 个控件用了注释档字号（<12px）— ${(s.tinyControls || [])
            .map((t) => `「${t.text}」${t.size}px×${t.n} ${t.cls}`)
            .join('，')}`,
        )
      }
      // 靠 overflow 裁掉的探出不算缺陷，但要报出来：哪天发现"界面少了一截"，
      // 这里就是线索（不静默吞掉，否则豁免会变成盲区）
      if (s.clippedKidCount) {
        geoNotes.push(
          `${at}: ${s.clippedKidCount} 处内容探出容器但被 overflow 裁掉 — ${(s.clippedKids || [])
            .map((c) => `「${c.childAt || c.child}」超出 ${c.over}px（父 ${c.by}）`)
            .join('；')}`,
        )
      }
    }
    for (const s of layers) {
      const offIcon = (s.offTierIcons || []).map((o) => `${o.size}「${o.at || o.cls}」`)
      if (offIcon.length) bad.push(`弹层: 图标尺寸不在刻度内 — ${offIcon.join(', ')}`)
    }
    // 工作台三栏第一条栏同高（DESIGN.md §5；量不到算探针没跑成，不算通过）
    const wb = report.screens.find((s) => (s.route || '').startsWith('#/workbench'))
    if (!wb || !wb.panelHeads) bad.push('#/workbench: 三栏顶栏没量到（探针没跑成，别当成已对齐）')
    else {
      const ph = wb.panelHeads
      const missing = Object.entries(ph).filter(([, v]) => v === null).map(([k]) => k)
      if (missing.length) bad.push(`#/workbench: 这几栏的第一条栏不在界面上（${missing.join('、')}），对齐无从判断`)
      else {
        const want = wb.panelHeaderToken
        if (!want) bad.push('#/workbench: 读不到 --ui-size-panel-header，判据无从成立（令牌断链）')
        else {
          const off = Object.entries(ph).filter(([, v]) => v !== want)
          if (off.length) {
            bad.push(
              `#/workbench: 这几栏顶栏不等于令牌 --ui-size-panel-header ${want}px — ${off.map(([k, v]) => `${k}=${v}px`).join(' ')}`
            )
          }
        }
      }
    }

    /*
     * AI 输入区：至少三行（判据取令牌值本身，不在脚本里另写一个数），快捷提示词那一排只许一行。
     * 窄/矮两遍的工作台屏也在这儿判 —— "面板被压扁"就是矮窗口才出现的症状（任务 #43）。
     */
    for (const s of pages.filter((x) => (x.route || '').startsWith('#/workbench'))) {
      const at = s.route
      if (!s.composer) {
        bad.push(`${at}: AI 输入框没量到（探针没跑成，别当成不挤）`)
        continue
      }
      const minWant = s.composerMinToken
      if (!minWant) bad.push(`${at}: 读不到 --ui-size-composer-min，输入区高度判据断链`)
      else if (s.composer.inputH < minWant) {
        bad.push(`${at}: AI 输入框只有 ${s.composer.inputH}px（应 ≥ 令牌 --ui-size-composer-min ${minWant}px）`)
      }
      if (s.composer.chipBarH === null) bad.push(`${at}: 快捷提示词那一排没量到（探针没跑成）`)
      else if (s.composer.chipBarH > 56) {
        bad.push(
          `${at}: 快捷提示词那一排换成 ${s.composer.chipBarH}px 高（换成两行了，挤掉输入区；应单行 + 横向滚动）`
        )
      }
    }

    // 风险控制页：只读规则表必须是引擎真值（空表/错误态/内部引用名/可编辑按钮都算缺陷）
    const rr = report.riskRules
    if (!rr) bad.push('风险控制页规则表没测到（探针没跑成，别当成通过）')
    else {
      if (rr.hasError) bad.push('风险控制页规则读取失败，显示的是错误态而不是引擎真值')
      if (rr.rowCount < 7) bad.push(`风险控制页只画出 ${rr.rowCount} 条规则（主进程快照实测 7 条）`)
      if (rr.hasInternalRef) bad.push(`风险控制页漏出了内部引用名（@名单）：${rr.firstRow}`)
      if (rr.addRuleButton) bad.push('风险控制页又出现「新增规则」按钮——拦截规则不该在界面上可编辑')
    }
    // 模块页左上角必须是同一个 PageHeader，且是 --ui-font-head（20px）+ semibold
    const SHELL_ROUTES = ['#/workbench'] // 外壳页的左上角是标题栏，不是模块标题
    const HEAD_SIG = '20px/600'
    for (const s of pages) {
      const at = s.route
      // 路由后面可能带 @宽×高（窄屏第二遍），豁免要按基础路由判，
      // 否则同一个外壳页在宽屏豁免、窄屏就假红一条"没有 PageHeader"
      const baseRoute = String(at || '').split('@')[0]
      if (!at || SHELL_ROUTES.includes(baseRoute)) continue
      if (!s.hasPageHeader) {
        bad.push(`${at}: 左上角没有 PageHeader（标题 ${s.header ? `${s.header.size}px/${s.header.weight}「${s.header.text}」` : '缺失'}，模块之间不一致）`)
      } else if (`${s.header.size}px/${s.header.weight}` !== HEAD_SIG) {
        bad.push(`${at}: 页头 ${s.header.size}px/${s.header.weight}，应为 ${HEAD_SIG}`)
      }
    }
    /*
     * 像素互不相同判据（F5）。逻辑本体在 scripts/design/pixel-verdict.mjs（纯函数，单测能注入假读数证伪），
     * 这里只把本轮真的写出过的那批图交出去——不扫 OUT_DIR，那里躺着历史轮次的文件。
     */
    const px = pixelVerdict(SHOT_LOG, { noShots: NO_SHOTS })
    bad.push(...px.bad)
    geoNotes.push(...px.notes)
    console.log('\n=== 门禁 ===')
    if (report.windowFit && report.windowFit.fits === false) {
      bad.push(`真实窗口底部被裁：状态栏底边 ${report.windowFit.statusBar.bottom} > 视口高 ${report.windowFit.inner[1]}（屏幕 ${report.windowFit.screen}，可用 ${report.windowFit.avail}）`)
    }
    console.log('页面左上角标题对照（字号/字重/位置应当一致）：')
    for (const s of pages) {
      const h = s.header
      console.log('  ' + String(s.route || 'boot').padEnd(20), h ? `${h.size}px/${h.weight} @${h.x},${h.y}  ${JSON.stringify(h.text)}` : '（没找到页级标题）')
    }
    for (const n of geoNotes) console.log('  几何留痕：' + n)
    if (bad.length) {
      console.error('FAIL：\n' + bad.join('\n'))
      app.kill()
      process.exit(1)
    }
    console.log('PASS：全部界面达到 DESIGN.md §8 的对比度 / 字阶 / 图标刻度 / 无遮挡要求')
    for (const n of exemptNotes) console.log('  对比度豁免：' + n)
  }
} catch (err) {
  auditFailed = true
  console.error('取证脚本异常：' + (err && err.stack ? err.stack : err))
} finally {
  app.kill()
  process.exit(auditFailed ? 1 : 0)
}
