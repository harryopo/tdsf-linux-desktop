#!/usr/bin/env node
/**
 * precommit-guard.cjs - 高共享文件提交前机械拦截
 * Pre-commit guard for high-share files (better-harness F2: ai-coordination-not-enforced)
 *
 * 规则（来自 AGENTS.md §多 AI 并行工作流）：
 *   以下高共享文件禁止并行修改。提交若包含它们，必须在 .ai-coordination.json
 *   中存在覆盖该文件的有效（未过期）claim，否则阻断提交。
 *
 * v2.11 harness 修复 #5：
 *   - 单源化：高共享清单从 AGENTS.md §高共享文件中央协调 段动态解析，
 *     AGENTS.md 是协作模式的唯一权威，不再在本脚本硬编码副本（消除双源漂移）。
 *     解析失败时回退到内置保底清单（fail-safe：宁可多拦，不静默丢保护）。
 *   - 绕过审计：AI_COORD_BYPASS=1 时把绕过记录（时间戳+被绕过的高共享文件）
 *     追加到 .ai-coordination-bypass.log，使绕过可审计、不再无痕。
 *
 * 本脚本只读协议状态，不修改 .ai-coordination.json，不改变协议内容本身。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..', '..');
const coordinationFile = path.join(root, '.ai-coordination.json');
const agentsFile = path.join(root, 'AGENTS.md');
const bypassLogFile = path.join(root, '.ai-coordination-bypass.log');

const c = (color, text) => {
  const colors = { cyan: '\x1b[36m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', gray: '\x1b[90m', reset: '\x1b[0m' };
  return `${colors[color] || ''}${text}${colors.reset}`;
};

/**
 * 从 AGENTS.md §高共享文件中央协调 段解析高共享清单（单一权威源）。
 * 结构：标记行「高共享文件中央协调」后紧跟若干 `- \`path\`` 项，直到下一个 ### 标题。
 * 解析失败或为空时返回内置保底清单（fail-safe）。
 */
const FALLBACK_HIGH_SHARE = [
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

function loadHighShare() {
  try {
    const md = fs.readFileSync(agentsFile, 'utf8');
    const lines = md.split('\n');
    const markerIdx = lines.findIndex((l) => l.includes('高共享文件中央协调'));
    if (markerIdx === -1) return { list: FALLBACK_HIGH_SHARE, source: 'fallback(marker-not-found)' };
    const out = [];
    for (let i = markerIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*#{2,}\s/.test(line)) break; // 遇到下一个标题，段结束
      const m = line.match(/^\s*-\s*`([^`]+)`/);
      if (m) out.push(m[1].trim().replace(/\\/g, '/'));
    }
    if (out.length === 0) return { list: FALLBACK_HIGH_SHARE, source: 'fallback(empty-parse)' };
    return { list: out, source: 'AGENTS.md' };
  } catch (e) {
    return { list: FALLBACK_HIGH_SHARE, source: `fallback(${e.message})` };
  }
}

const { list: HIGH_SHARE, source: highShareSource } = loadHighShare();
if (highShareSource !== 'AGENTS.md') {
  console.log(c('yellow', `[ai-guard] ⚠️  高共享清单未能从 AGENTS.md 解析（${highShareSource}），使用内置保底清单`));
}

/** 取暂存的高共享文件（供拦截与绕过审计共用） */
function stagedHighShare() {
  try {
    const staged = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], { cwd: root, encoding: 'utf8' })
      .split('\n').map((s) => s.trim().replace(/\\/g, '/')).filter(Boolean);
    return { staged, flagged: staged.filter((f) => HIGH_SHARE.includes(f)) };
  } catch (e) {
    return { staged: null, flagged: [], error: e.message };
  }
}

// ---------- 0. 显式绕过（带审计） ----------
if (process.env.AI_COORD_BYPASS === '1') {
  const { flagged } = stagedHighShare();
  const stamp = new Date().toISOString();
  const sessionHint = process.env.AI_SESSION_ID || process.env.SESSION_ID || 'unknown-session';
  const record = `${stamp}\tBYPASS\tsession=${sessionHint}\tfiles=${flagged.length ? flagged.join(',') : '(none)'}\n`;
  try {
    fs.appendFileSync(bypassLogFile, record, 'utf8');
    console.log(c('yellow', `[ai-guard] ⚠️  AI_COORD_BYPASS=1 — 跳过 claim 检查，已记入审计 .ai-coordination-bypass.log（${flagged.length} 个高共享文件）`));
  } catch (e) {
    console.log(c('yellow', `[ai-guard] ⚠️  AI_COORD_BYPASS=1 — 跳过 claim 检查（审计写入失败：${e.message}）`));
  }
  process.exit(0);
}

// ---------- 1. 取暂存文件 ----------
const { staged, flagged, error: stagedErr } = stagedHighShare();
if (staged === null) {
  console.log(c('yellow', `[ai-guard] ⚠️  无法读取暂存区（${stagedErr}），放行`));
  process.exit(0);
}

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
  validClaims.find((cl) => cl.path === file || (cl.path.endsWith('/') && file.startsWith(cl.path)));

// ---------- 3. 判定 ----------
const violations = flagged.filter((f) => !coveredBy(f));

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
console.log(c('cyan', '   3. 人工确认无并行冲突后可显式绕过：AI_COORD_BYPASS=1 git commit ...（会记入审计日志）'));
console.log('');
process.exit(1);
