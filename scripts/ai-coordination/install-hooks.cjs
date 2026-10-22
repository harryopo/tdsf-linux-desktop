#!/usr/bin/env node
/**
 * install-hooks.cjs - ai-coordination git hook 自安装
 *
 * 由 package.json postinstall 自动调用（也可手动 pnpm ai:install-hooks），
 * 把五道闸以标记块形式合并进 .git/hooks/pre-commit（claim 守卫 + 凭据形态 + 内网拓扑 +
 * 身份暴露 + 目录卫生），并把四道较重的闸合并进 .git/hooks/pre-push：
 *   - 幂等：重复执行只会原位刷新 BEGIN/END 标记块
 *   - 保留 hook 中已有的其他内容（如机器本地的其他工具块）
 *   - 非 git 环境（CI tarball、无 .git）静默跳过，不阻断安装
 *
 * 【安装器必须与真机 hook 逐块对齐】：2026-10-22 实测这台机器的 pre-commit 里有 identity gate，
 * 而安装器从没写过那块——本机看着"有防护"，新克隆/新 worktree 没有。所以加了 identity 与
 * hygiene 两块，并在下面用 assertInstalledBlocks() 把"块数"钉住：以后谁手工往 hook 里加块，
 * 忘了同步安装器，当场就能被发现。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..', '..');
const BEGIN = '# BEGIN ai-coordination guard (AGENTS.md 高共享文件 claim 拦截)';
const END = '# END ai-coordination guard';
const BLOCK = [
  BEGIN,
  'repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"',
  'node "$repo_root/scripts/ai-coordination/precommit-guard.cjs" || exit 1',
  END,
].join('\n');

const SEC_BEGIN = '# BEGIN secret gate (凭据形态拦截，替代未开通的 GitHub Secret Scanning)';
const SEC_END = '# END secret gate';
const SECRET_BLOCK = [
  SEC_BEGIN,
  'repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"',
  'node "$repo_root/scripts/security/secret-gate.cjs" || exit 1',
  SEC_END,
].join('\n');

/**
 * 内网拓扑值闸（0.4s）：按【值】核对 .env.local 里的 HOST 地址没被抄进代码。
 *
 * 为什么要挂进 hook：这道闸原本只有手敲 `npm run security:topology` 才跑，
 * 而 2026-10-13 那次我自己把真机 IP 写进提交的测试里，它一声没吭——有判据没执行体
 * 的闸只对"记得跑的人"负责。--no-values-ok 是给新克隆留的活路：没有 .env.local
 * 就没有可锚定的值，闸大声跳过（结论 SKIPPED），而不是把全仓库钉成常亮红灯。
 */
const TOPO_BEGIN = '# BEGIN topology gate (内网拓扑值按值锚定)';
const TOPO_END = '# END topology gate';
const TOPOLOGY_BLOCK = [
  TOPO_BEGIN,
  'repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"',
  'node "$repo_root/scripts/security/topology-gate.cjs" --no-values-ok || exit 1',
  TOPO_END,
].join('\n');

/**
 * pre-push：推出去之前按真值核一遍 git 历史（12s 级，放在 push 不放 commit）。
 *
 * 分工：secret-gate 管【形态】（厂商前缀/PEM/赋值），history-env-scan 管【值】
 * （.env.local 的口令 + .secrets-anchor.local.json 里申报的额外密钥），
 * topology-gate 管【当前代码】里的内网地址。三道闸互不覆盖，缺一个就有一类沉默通过。
 *
 * 第四道是 tests/ 的类型闸（2026-10-20 加）：同一天两次把 master 的 CI 推红，
 * 两次都是同一个形状——"跑过门 → 又改了测试文件 → 拿旧读数报全绿"。
 * 单测本身（vitest）不看类型，所以那 9~12 条 TS18046/TS18048 只有这条门能抓，
 * 而它当时只在 CI 上跑。放到 pre-push 就是让"改了没重跑"这件事在推之前自己拦下来。
 * 代价：每次 push 多等 60~90 秒（tsc 扫 310 个测试文件）。
 */
const PUSH_BEGIN = '# BEGIN pre-push security gates (形态闸 + 历史值闸 + 拓扑闸 + tests 类型闸)';
const PUSH_END = '# END pre-push security gates';
const PUSH_BLOCK = [
  PUSH_BEGIN,
  'repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"',
  'node "$repo_root/scripts/security/secret-gate.cjs" --all || exit 1',
  'node "$repo_root/scripts/security/history-env-scan.cjs" || exit 1',
  'node "$repo_root/scripts/security/topology-gate.cjs" --no-values-ok || exit 1',
  'node "$repo_root/scripts/quality/tests-typecheck.cjs" || exit 1',
  PUSH_END,
].join('\n');

/**
 * 身份暴露闸（2026-10-22 补进安装器）。
 *
 * 这块以前【只在这台机器的 .git/hooks/pre-commit 里】，安装器从没写过它——
 * 也就是说换一台机器、或另开一个 worktree 接手，pre-commit 就没有这道闸，
 * 而 CI 的 Identity gate 要到 push 之后才说话。"本机有闸"不等于"克隆有闸"。
 */
const IDENT_BEGIN = '# BEGIN identity gate (身份暴露：校名/专业/真实姓名/赛事字样，带阳性对照)';
const IDENT_END = '# END identity gate';
const IDENTITY_BLOCK = [
  IDENT_BEGIN,
  'repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"',
  'node "$repo_root/scripts/security/identity-gate.cjs" --staged || exit 1',
  IDENT_END,
].join('\n');

/**
 * 目录卫生闸（2026-10-22 加）：拦「既没被跟踪、也没被忽略」的目录。
 *
 * 为什么挂在 commit 而不是 push：这类目录的两种伤害都发生在【本地】——
 * Tailwind v4 按「git 看得见的文件」取内容源，未忽略的 scratch 会直接进产物 CSS；
 * 而一次误手的 git add -A 会把 356MB 出包目录或 824MB venv 推进仓。
 * 实测本机仓库根当天同时躺着 4×356MB 的 release-*（逐个名字忽略，换名就漏）和一个 venv。
 */
const HYGIENE_BEGIN = '# BEGIN scratch hygiene gate (未跟踪又未忽略的目录：Tailwind 会扫进产物)';
const HYGIENE_END = '# END scratch hygiene gate';
const HYGIENE_BLOCK = [
  HYGIENE_BEGIN,
  'repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"',
  'node "$repo_root/scripts/quality/scratch-hygiene-gate.cjs" || exit 1',
  HYGIENE_END,
].join('\n');

// ---------- 1. 定位 hooks 目录（兼容 worktree / 自定义 git-dir） ----------
let hooksDir;
try {
  hooksDir = execFileSync('git', ['rev-parse', '--git-path', 'hooks'], { cwd: root, encoding: 'utf8' }).trim();
  if (!path.isAbsolute(hooksDir)) hooksDir = path.join(root, hooksDir);
} catch {
  console.log('[install-hooks] 非 git 环境，跳过 hook 安装');
  process.exit(0);
}

// core.hooksPath 指向仓库外或只读位置时不强行写入
try {
  fs.mkdirSync(hooksDir, { recursive: true });
} catch (e) {
  console.log(`[install-hooks] ⚠️  无法创建 hooks 目录（${e.message}），跳过`);
  process.exit(0);
}

// ---------- 2. 合并标记块到 pre-commit ----------
const hookFile = path.join(hooksDir, 'pre-commit');
let content = '';
if (fs.existsSync(hookFile)) {
  content = fs.readFileSync(hookFile, 'utf8');
}

/**
 * 把标记块写入 hook：已有则原位刷新，没有则追加，空文件则补 shebang。
 * beginRe 用「任意 BEGIN 行」匹配，兼容历史版本改过的注释文案。
 */
function mergeBlock(text, beginPrefix, block) {
  const re = new RegExp(`${beginPrefix}[^\\n]*\\n[\\s\\S]*?# END [^\\n]*\\n?`);
  if (re.test(text)) return text.replace(re, block + '\n');
  if (text.trim() === '') return '#!/bin/sh\n' + block + '\n';
  return (text.endsWith('\n') ? text : text + '\n') + block + '\n';
}

content = mergeBlock(content, '# BEGIN ai-coordination guard', BLOCK);
content = mergeBlock(content, '# BEGIN secret gate', SECRET_BLOCK);
content = mergeBlock(content, '# BEGIN topology gate', TOPOLOGY_BLOCK);
content = mergeBlock(content, '# BEGIN identity gate', IDENTITY_BLOCK);
content = mergeBlock(content, '# BEGIN scratch hygiene gate', HYGIENE_BLOCK);

/** pre-push 是独立文件：没有历史块时从空串起（mergeBlock 会补 shebang） */
const pushFile = path.join(hooksDir, 'pre-push');
let pushContent = fs.existsSync(pushFile) ? fs.readFileSync(pushFile, 'utf8') : '';
pushContent = mergeBlock(pushContent, '# BEGIN pre-push security gates', PUSH_BLOCK);

function writeHook(file, body, label) {
  fs.writeFileSync(file, body, { encoding: 'utf8' });
  fs.chmodSync(file, 0o755);
  console.log(`[install-hooks] ✅ ${label} 已安装: ${file}`);
}

try {
  writeHook(hookFile, content, 'pre-commit（高共享文件守卫 + 形态闸 + 拓扑闸 + 身份闸 + 卫生闸）');
  writeHook(pushFile, pushContent, 'pre-push（形态闸全量 + 历史值闸 + 拓扑闸 + tests 类型闸）');
} catch (e) {
  console.log(`[install-hooks] ⚠️  写入 hook 失败（${e.message}），可手动运行 pnpm ai:install-hooks`);
  process.exit(0);
}

/**
 * 写完之后按【盘上真值】复核：安装器声称的每个块，必须真的出现在 hook 文件里。
 * 只打印"已安装"而不回读，等于让这句话只对写入调用负责——这次的 identity 漂移就是这么来的。
 */
const EXPECTED = [
  { file: hookFile, label: 'pre-commit', blocks: [BEGIN, SEC_BEGIN, TOPO_BEGIN, IDENT_BEGIN, HYGIENE_BEGIN] },
  { file: pushFile, label: 'pre-push', blocks: [PUSH_BEGIN] },
];
const missing = [];
for (const { file, label, blocks } of EXPECTED) {
  let body = '';
  try {
    body = fs.readFileSync(file, 'utf8');
  } catch (e) {
    missing.push(`${label}: 读不回（${e.message}）`);
    continue;
  }
  for (const b of blocks) {
    if (!body.includes(b)) missing.push(`${label}: 缺块 ${b}`);
  }
}
if (missing.length > 0) {
  console.error(`[install-hooks] ❌ 写后回读不一致：\n  ${missing.join('\n  ')}`);
  process.exit(1);
}
console.log(
  `[install-hooks] ✅ 回读核对通过：pre-commit ${EXPECTED[0].blocks.length} 块、pre-push 1 块都在盘上`,
);
