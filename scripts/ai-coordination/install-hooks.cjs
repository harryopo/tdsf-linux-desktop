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

try {
  fs.writeFileSync(hookFile, content, { encoding: 'utf8' });
  fs.chmodSync(hookFile, 0o755);
  console.log(`[install-hooks] ✅ pre-commit 高共享文件守卫已安装: ${hookFile}`);
} catch (e) {
  console.log(`[install-hooks] ⚠️  写入 pre-commit 失败（${e.message}），可手动运行 pnpm ai:install-hooks`);
  process.exit(0);
}
