#!/usr/bin/env node
/**
 * 启动竞态真机验证（R0 判据）
 *
 * 要回答的只有一个问题：生产构建里，渲染层挂载时主进程已经走完启动序列了，
 * BootPage 能不能仍然拿到 'done' 并自己跳进工作台？
 *
 * 之所以不能用 verify-theme.mjs 代替：那个脚本会自己点按钮、必要时直接改 hash，
 * 等于把"没人点就进不去"这个缺陷绕过去了。本脚本只观测，不干预。
 *
 * 用法：先 npx electron-vite build，再 node scripts/design/verify-boot-race.mjs
 * 退出码：0 = 零干预下自动进了工作台，且主进程最新阶段为 done
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const PORT = 9224;
const ELECTRON = path.join(ROOT, "node_modules/electron/dist/electron.exe");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!fs.existsSync(path.join(ROOT, "out/main/index.js"))) {
  console.error("缺少 out/main/index.js —— 先跑：npx electron-vite build");
  process.exit(2);
}

// 端口上已经有实例 = 连到别人（或昨天）起的那个窗，判据就会量在别的构建上。先拒。
try {
  const probe = await fetch(`http://127.0.0.1:${PORT}/json/version`);
  if (probe.ok) {
    console.error(
      `9224 已经有人占着（${PORT} 上有 CDP 端点）——先关掉那个实例再跑，否则量到的不是本次构建`,
    );
    process.exit(2);
  }
} catch {
  /* 连不上才对：说明端口空着 */
}

const app = spawn(ELECTRON, [".", `--remote-debugging-port=${PORT}`], {
  cwd: ROOT,
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1" },
});
const appLog = [];
app.stdout.on("data", (d) => appLog.push(d.toString()));
app.stderr.on("data", (d) => appLog.push(d.toString()));

async function findTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find(
        (t) =>
          t.type === "page" && /index\.html|localhost|127\.0\.0\.1/.test(t.url),
      );
      if (page) return page;
    } catch {
      /* CDP 还没起 */
    }
    await sleep(500);
  }
  throw new Error("等不到 CDP target\n" + appLog.join("").slice(-2000));
}

let msgId = 0;
function cdp(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    const onMsg = (ev) => {
      const m = JSON.parse(typeof ev === "string" ? ev : String(ev.data));
      if (m.id === id) {
        ws.removeEventListener("message", onMsg);
        if (m.error) reject(new Error(method + ": " + JSON.stringify(m.error)));
        else resolve(m.result);
      }
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evalIn(ws, expression) {
  const r = await cdp(ws, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails)
    throw new Error(
      "页面脚本异常：" + JSON.stringify(r.exceptionDetails).slice(0, 400),
    );
  return r.result.value;
}

// 采样期间的瞬时异常（React 尚未挂载、路由正在切换）不该终止验证，记下来供判读
async function sample(ws) {
  try {
    return await evalIn(ws, OBSERVE);
  } catch (err) {
    return { phase: "unrendered", error: String(err.message).slice(0, 120) };
  }
}

// 只读观测。phase 必须靠真实节点判定，不能靠 hash：
// 实测 hash 在启动阶段一直是空串，用它判断"不在启动页"会在 React 挂载前就误判通过。
// 启动页现在只有一个状态行（data-dom-id="boot-loading"），没有按钮也没有进度条，
// 所以"还停在启动页"本身就等于失败——不用再去看一个不存在的按钮可不可点。
const OBSERVE = `(() => {
  const loading = document.querySelector('[data-dom-id="boot-loading"]');
  const phase = loading ? 'boot' : (document.querySelector('.wb-main-layout') ? 'workbench' : 'unrendered');
  const api = window.electronAPI;
  const out = {
    phase,
    hash: location.hash,
    loadingText: loading ? loading.textContent : null,
    hasEnterButton: !!document.querySelector('button[data-dom-id="boot-enter"]'),
    hasGetState: typeof api?.bootGetState === 'function',
    bodyChars: (document.body ? document.body.innerText || '' : '').length,
  };
  return api?.bootGetState
    ? api.bootGetState().then((s) => ({ ...out, latestStage: s ? s.stage : null }))
    : Promise.resolve(out);
})()`;

// 启动耗时的读数口径（2026-10-20 加）：
// 原先这个脚本只回答"能不能零干预进工作台"，一个毫秒数都不给，于是"启动快不快"没法讨论。
// 这里刻意**不往产品代码里塞打点**：外部探针能拿到的三个数已经是可复现的最小集合——
//   spawn→CDP target  ：Electron 自己起进程 + 建页面的时间
//   页内 FCP / load    ：浏览器视角的首屏与文档完成（performance timing，零改动）
//   spawn→工作台       ：用户真正"能动手"的时刻
// 注意最后一项含**故意的最小展示时长（约 3s）**，它是产品设定不是缺陷，
// 所以报数时并列给出这个下限，别把 3s 读成"启动慢"。
const T_SPAWN = Date.now();
let tCdpTarget = 0;
let tWorkbench = 0;

let ws;
try {
  const target = await findTarget();
  tCdpTarget = Date.now();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });
  await cdp(ws, "Runtime.enable");

  // 全程不点任何东西、不改 hash：等它自己走完最小展示时长（约 3s）进工作台
  let snap = null;
  for (let i = 0; i < 40; i++) {
    snap = await sample(ws);
    if (snap.phase === "workbench") {
      tWorkbench = Date.now();
      break;
    }
    await sleep(1000);
  }

  // 页内计时要单独取一次；取不到（页面刚切换、导航条目被裁剪）就报"没取到"，不猜 0
  let nav = null;
  try {
    nav = await evalIn(
      ws,
      `(() => {
      const n = performance.getEntriesByType('navigation')[0];
      const fcp = performance.getEntriesByName('first-contentful-paint')[0];
      return {
        fcp: fcp ? Math.round(fcp.startTime) : null,
        domContentLoaded: n ? Math.round(n.domContentLoadedEventEnd) : null,
        load: n ? Math.round(n.loadEventEnd) : null,
      };
    })()`,
    );
  } catch {
    nav = null;
  }

  console.log("=== R0 启动竞态真机验证（构建产物，全程零干预） ===");
  console.log(JSON.stringify(snap, null, 2));
  console.log("\n=== 启动耗时（本机一轮实测，不是 CI 数）===");
  console.log(`  spawn → CDP target 可见 : ${tCdpTarget - T_SPAWN} ms`);
  console.log(
    `  页内 FCP / DCL / load      : ${nav ? `${nav.fcp} / ${nav.domContentLoaded} / ${nav.load} ms` : "没取到（不猜 0）"}`,
  );
  console.log(
    `  spawn → 进入工作台      : ${tWorkbench ? `${tWorkbench - T_SPAWN} ms` : "没进工作台（见上面的判定）"}`,
  );
  console.log("  其中最小展示时长 ≈ 3000 ms 是产品设定，不是启动开销");

  const fail = [];
  if (!snap.hasGetState) fail.push("preload 没有暴露 bootGetState");
  if (snap.phase !== "workbench") {
    fail.push(
      `40 秒后仍不在工作台（实测 phase=${JSON.stringify(snap.phase)}，加载行文案 ${JSON.stringify(snap.loadingText)}，` +
        `body 文本 ${snap.bodyChars} 字符${snap.error ? "，采样异常：" + snap.error : ""}）——自动跳转没生效`,
    );
  }
  if (snap.latestStage !== "done") {
    fail.push(
      `主进程最新阶段不是 done（实测 ${JSON.stringify(snap.latestStage)}）—— 拉取通道没补上错过的推送`,
    );
  }
  if (snap.hasEnterButton) {
    fail.push(
      "启动页又长出「进入工作台」按钮（2026-10-17 已明确删掉，加载完应自己跳）",
    );
  }
  if (fail.length) {
    console.error("\n判定：不通过");
    for (const f of fail) console.error("  - " + f);
    process.exitCode = 1;
  } else {
    console.log(
      "\n判定：通过（没点任何东西就自行进入工作台，最新阶段=done 由拉取补齐）",
    );
  }
} catch (err) {
  console.error("验证失败：", err.message);
  process.exitCode = 1;
} finally {
  if (ws) ws.close();
  app.kill();
}
