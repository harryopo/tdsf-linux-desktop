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
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')
const PORT = 9235
const NO_SHOTS = process.argv.includes('--no-shots')
const OUT_DIR = path.join(ROOT, 'docs', 'assets', 'ui-audit-20261005')
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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

async function shot(ws, name) {
  // --no-shots：只跑量测不出图。窗口被最小化时 captureScreenshot 会永久不返回，
  // 而门禁要的是逐元素计算样式，不需要 PNG——别让取证卡在像素上。
  if (NO_SHOTS) return null
  // 窗口被最小化时 Page.captureScreenshot 会永久不返回：宁可 20 秒报错，也不要挂着让人以为还在跑
  const guard = new Promise((_, rej) =>
    setTimeout(() => rej(new Error(`截图 ${name} 超时 20s：窗口可能被最小化或遮挡，请把 TDSF 窗口置于前台后重跑`)), 20000)
  )
  const { data } = await Promise.race([cdp(ws, 'Page.captureScreenshot', { format: 'png' }), guard])
  fs.writeFileSync(path.join(OUT_DIR, name + '.png'), Buffer.from(data, 'base64'))
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

  return {
    viewport: [innerWidth, innerHeight],
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

const ROUTES = [
  { hash: '#/workbench', name: '01-workbench' },
  { hash: '#/knowledge', name: '02-knowledge' },
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

  for (const r of ROUTES) {
    const st = await settle(ws, r.hash)
    const file = await shot(ws, r.name)
    const m = await evalIn(ws, MEASURE)
    report.screens.push({ route: r.hash, png: file, settled: st.settled, waitedMs: st.waitedMs, ...m })
  }

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
  await shot(ws, '15-menu-context')

  console.log(JSON.stringify(report, null, 2))
  console.log('\n截图目录：' + OUT_DIR)

  // ===== --gate：把上面的量测变成硬闸（判据见 DESIGN.md §8） =====
  if (process.argv.includes('--gate')) {
    const MAX_COMBOS = 12 // 单屏 (字号/字重/字体族) 组合数上限；实测最松的一屏是 10
    const bad = []
    const exemptNotes = []
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
    }
    for (const s of layers) {
      const offIcon = (s.offTierIcons || []).map((o) => `${o.size}「${o.at || o.cls}」`)
      if (offIcon.length) bad.push(`弹层: 图标尺寸不在刻度内 — ${offIcon.join(', ')}`)
    }
    // 工作台三栏第一条栏同高（DESIGN.md §5；量不到算探针没跑成，不算通过）
    const wb = report.screens.find((s) => s.route === '#/workbench')
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
      // AI 输入区：至少三行（判据取令牌值本身，不在脚本里另写一个数），快捷提示词那一排只许一行
      if (!wb.composer) bad.push('#/workbench: AI 输入框没量到（探针没跑成，别当成不挤）')
      else {
        const minWant = wb.composerMinToken
        if (!minWant) bad.push('#/workbench: 读不到 --ui-size-composer-min，输入区高度判据断链')
        else if (wb.composer.inputH < minWant) {
          bad.push(`#/workbench: AI 输入框只有 ${wb.composer.inputH}px（应 ≥ 令牌 --ui-size-composer-min ${minWant}px）`)
        }
        if (wb.composer.chipBarH === null) bad.push('#/workbench: 快捷提示词那一排没量到（探针没跑成）')
        else if (wb.composer.chipBarH > 56) {
          bad.push(
            `#/workbench: 快捷提示词那一排换成 ${wb.composer.chipBarH}px 高（换成两行了，挤掉输入区；应单行 + 横向滚动）`
          )
        }
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
      if (!at || SHELL_ROUTES.includes(at)) continue
      if (!s.hasPageHeader) {
        bad.push(`${at}: 左上角没有 PageHeader（标题 ${s.header ? `${s.header.size}px/${s.header.weight}「${s.header.text}」` : '缺失'}，模块之间不一致）`)
      } else if (`${s.header.size}px/${s.header.weight}` !== HEAD_SIG) {
        bad.push(`${at}: 页头 ${s.header.size}px/${s.header.weight}，应为 ${HEAD_SIG}`)
      }
    }
    console.log('\n=== 门禁 ===')
    if (report.windowFit && report.windowFit.fits === false) {
      bad.push(`真实窗口底部被裁：状态栏底边 ${report.windowFit.statusBar.bottom} > 视口高 ${report.windowFit.inner[1]}（屏幕 ${report.windowFit.screen}，可用 ${report.windowFit.avail}）`)
    }
    console.log('页面左上角标题对照（字号/字重/位置应当一致）：')
    for (const s of pages) {
      const h = s.header
      console.log('  ' + String(s.route || 'boot').padEnd(20), h ? `${h.size}px/${h.weight} @${h.x},${h.y}  ${JSON.stringify(h.text)}` : '（没找到页级标题）')
    }
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
