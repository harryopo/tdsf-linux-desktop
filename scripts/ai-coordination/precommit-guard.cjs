#!/usr/bin/env node
/**
 * precommit-guard.cjs - 高共享文件提交前机械拦截
 * Pre-commit guard for high-share files (better-harness F2: ai-coordination-not-enforced)
 *
 * 规则（来自 AGENTS.md §多 AI 并行工作流 v10.2）：
 *   以下高共享文件禁止并行修改。提交若包含它们，必须在 .ai-coordination.json
 *   中存在覆盖该文件的有效（未过期）claim，否则阻断提交。
 *
 * 绕过（人工显式操作，事后需补登记）：
 *   AI_COORD_BYPASS=1 git commit ...
 *
 * 本脚本只读协议状态，不修改 .ai-coordination.json，不改变协议内容本身。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..', '..');
const coordinationFile = path.join(root, '.ai-coordination.json');

// AGENTS.md §高共享文件中央协调 清单（如 AGENTS.md 更新，此处需同步）
const HIGH_SHARE = [
  'src/shared/ipc-channels.ts',
  'src/shared/agent-types.ts',
  'src/shared/models.ts',
  'src/preload/index.ts',
  'src/preload/index.d.ts',
  'src/main/ipc/index.ts',
  'package.json',
  'AGENTS.md',
  'CLAUDE.md',
];

const c = (color, text) => {
  const colors = { cyan: '\x1b[36m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', gray: '\x1b[90m', reset: '\x1b[0m' };
  return `${colors[color] || ''}${text}${colors.reset}`;
};

// ---------- 0. 显式绕过 ----------
if (process.env.AI_COORD_BYPASS === '1') {
  console.log(c('yellow', '[ai-guard] ⚠️  AI_COORD_BYPASS=1 — 跳过高共享文件 claim 检查（请事后补登记）'));
  process.exit(0);
}

// ---------- 1. 取暂存文件 ----------
let staged = [];
try {
  staged = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], { cwd: root, encoding: 'utf8' })
    .split('\n').map(s => s.trim().replace(/\\/g, '/')).filter(Boolean);
} catch (e) {
  console.log(c('yellow', `[ai-guard] ⚠️  无法读取暂存区（${e.message}），放行`));
  process.exit(0);
}

const flagged = staged.filter(f => HIGH_SHARE.includes(f));
if (flagged.length === 0) process.exit(0); // 未触及高共享文件，放行

// ---------- 2. 加载有效 claim ----------
let coord = null;
try {
  coord = JSON.parse(fs.readFileSync(coordinationFile, 'utf8'));
} catch (e) {
  console.log(c('red', `[ai-guard] ❌ 触及高共享文件但无法读取 .ai-coordination.json: ${e.message}`));
  process.exit(1);
}

const now = new Date();
const validClaims = []; // { path, session }
for (const [key, entry] of Object.entries(coord.sessions || {})) {
  if (new Date(entry.expiresAt) < now) continue; // 过期不算
  for (const f of (entry.claimedFiles || [])) {
    validClaims.push({ path: String(f.path).replace(/\\/g, '/'), session: key });
  }
}

// 支持精确匹配与目录前缀 claim（如 "src/shared/"）
const coveredBy = (file) =>
  validClaims.find(cl => cl.path === file || (cl.path.endsWith('/') && file.startsWith(cl.path)));

// ---------- 3. 判定 ----------
const violations = flagged.filter(f => !coveredBy(f));

if (violations.length === 0) {
  for (const f of flagged) {
    const cl = coveredBy(f);
    console.log(c('green', `[ai-guard] ✅ ${f} 持有有效 claim（${cl.session}）`));
  }
  process.exit(0);
}

console.log('');
console.log(c('red', '❌ [ai-guard] 提交被阻断：以下高共享文件无有效未过期 claim'));
for (const f of violations) console.log(c('yellow', `   - ${f}`));
console.log('');
console.log(c('cyan', '👉 处理方式（AGENTS.md §多 AI 并行工作流）：'));
console.log(c('cyan', '   1. 登记所有权：pnpm ai:claim -f "<file>" -t "<task>"'));
console.log(c('cyan', '   2. 查看当前占用：pnpm ai:status'));
console.log(c('cyan', '   3. 人工确认无并行冲突后可显式绕过：AI_COORD_BYPASS=1 git commit ...'));
console.log('');
process.exit(1);
