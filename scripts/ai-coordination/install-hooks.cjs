#!/usr/bin/env node
/**
 * install-hooks.cjs - ai-coordination git hook 自安装
 *
 * 由 package.json postinstall 自动调用（也可手动 pnpm ai:install-hooks），
 * 将高共享文件守卫（precommit-guard.cjs）以标记块形式合并进 .git/hooks/pre-commit：
 *   - 幂等：重复执行只会原位刷新 BEGIN/END 标记块
 *   - 保留 hook 中已有的其他内容（如机器本地的其他工具块）
 *   - 非 git 环境（CI tarball、无 .git）静默跳过，不阻断安装
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
 */
const PUSH_BEGIN = '# BEGIN pre-push security gates (形态闸 + 历史值闸 + 拓扑闸)';
const PUSH_END = '# END pre-push security gates';
const PUSH_BLOCK = [
  PUSH_BEGIN,
  'repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"',
  'node "$repo_root/scripts/security/secret-gate.cjs" --all || exit 1',
  'node "$repo_root/scripts/security/history-env-scan.cjs" || exit 1',
  'node "$repo_root/scripts/security/topology-gate.cjs" --no-values-ok || exit 1',
  PUSH_END,
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
  writeHook(hookFile, content, 'pre-commit（高共享文件守卫 + 形态闸 + 拓扑闸）');
  writeHook(pushFile, pushContent, 'pre-push（形态闸全量 + 历史值闸 + 拓扑闸）');
} catch (e) {
  console.log(`[install-hooks] ⚠️  写入 hook 失败（${e.message}），可手动运行 pnpm ai:install-hooks`);
  process.exit(0);
}
