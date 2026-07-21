#!/usr/bin/env node
/**
 * check-conflict.cjs - AI 启动前冲突预检
 * Pre-flight Conflict Check
 *
 * Usage:
 *   node scripts/ai-coordination/check-conflict.cjs              # 启动时全量检查
 *   node scripts/ai-coordination/check-conflict.cjs -f "x.tsx"     # 写入前预检
 *   node scripts/ai-coordination/check-conflict.cjs --strict      # 严格模式
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const args = process.argv.slice(2);
const opts = { file: '', strict: false, json: false };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '-f' || a === '--file') opts.file = args[++i];
  else if (a === '--strict') opts.strict = true;
  else if (a === '--json') opts.json = true;
  else if (a === '-h' || a === '--help') {
    console.log('Usage: node check-conflict.cjs [-f <file>] [--strict] [--json]');
    process.exit(0);
  }
}

const root = path.resolve(__dirname, '..', '..');
const coordinationFile = path.join(root, '.ai-coordination.json');

const c = (color, text) => {
  const colors = { cyan: '\x1b[36m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', darkYellow: '\x1b[33m', gray: '\x1b[90m', reset: '\x1b[0m' };
  return `${colors[color] || ''}${text}${colors.reset}`;
};

let exitCode = 0;

console.log('');
console.log(c('cyan', '=== AI 协作冲突预检 ==='));
console.log(c('gray', `Time: ${new Date().toLocaleString('zh-CN', { hour12: false })}`));
console.log('');

// ---------- 1. Git 状态检查 ----------
console.log(c('cyan', '[1/4] Git 状态检查...'));
let gitStatus = '';
try {
  gitStatus = execSync('git status --porcelain', { cwd: root, encoding: 'utf8' });
  if (!gitStatus.trim()) {
    console.log(c('green', '  ✅ 工作区干净'));
  } else {
    console.log(c('yellow', '  ⚠️  存在未提交修改：'));
    for (const ln of gitStatus.split('\n')) {
      const t = ln.trim();
      if (!t) continue;
      if (t === '?? .ai-coordination.json' || t.startsWith('?? .ai-coordination.json')) {
        console.log(c('darkYellow', '     ⚠️  .ai-coordination.json 未跟踪（建议先 git add）'));
      } else if (t.startsWith('?? .ai-session.local')) {
        console.log(c('gray', `     ${t} (本地 session 缓存，无需关注)`));
      } else {
        console.log(c('yellow', `     ${t}`));
      }
    }
    if (opts.strict) exitCode = 1;
  }
} catch (e) {
  console.log(c('yellow', '  ⚠️  git status 失败（可能不是 git 仓库）'));
}
console.log('');

// ---------- 2. 中央登记文件检查 ----------
console.log(c('cyan', '[2/4] 中央登记文件检查...'));
let coord = null;
if (!fs.existsSync(coordinationFile)) {
  console.log(c('yellow', '  ⚠️  .ai-coordination.json 不存在，跳过'));
} else {
  try {
    coord = JSON.parse(fs.readFileSync(coordinationFile, 'utf8'));
    console.log(c('green', `  ✅ 中央登记存在，最后更新: ${coord.lastUpdated}`));
  } catch (e) {
    console.log(c('red', `  ❌ 中央登记文件 JSON 解析失败: ${e.message}`));
    exitCode = 1;
  }
}
console.log('');

// ---------- 3. 过期 claim 检查 ----------
console.log(c('cyan', '[3/4] 过期 claim 检查...'));
if (coord) {
  const now = new Date();
  let expired = 0;
  let valid = 0;
  for (const [key, entry] of Object.entries(coord.sessions || {})) {
    if (new Date(entry.expiresAt) < now) {
      console.log(c('darkYellow', `  ⚠️  过期: ${key} (${entry.task})`));
      expired++;
    } else {
      valid++;
    }
  }
  if (expired === 0) {
    console.log(c('green', '  ✅ 无过期 claim'));
  }
  if (valid > 0) {
    console.log(c('cyan', `  📊 活跃 Session: ${valid} 个`));
  }
}
console.log('');

// ---------- 4. 目标文件预检（如指定） ----------
if (opts.file) {
  console.log(c('cyan', `[4/4] 目标文件预检: ${opts.file}`));
  let conflict = false;
  if (coord) {
    const now = new Date();
    for (const [key, entry] of Object.entries(coord.sessions || {})) {
      if (new Date(entry.expiresAt) < now) continue;
      for (const f of (entry.claimedFiles || [])) {
        if (f.path === opts.file) {
          console.log(c('red', `  ❌ 文件被占用: ${key} (${entry.task})`));
          console.log(c('gray', `     Claimed: ${f.claimedAt}`));
          console.log(c('gray', `     Expires: ${entry.expiresAt}`));
          conflict = true;
        }
      }
    }
  }
  if (!conflict) {
    console.log(c('green', '  ✅ 文件空闲，可以 claim'));
  }

  const fullPath = path.join(root, opts.file);
  if (fs.existsSync(fullPath)) {
    const stat = fs.statSync(fullPath);
    const minutesSince = (Date.now() - stat.mtimeMs) / 60000;
    if (minutesSince < 5) {
      console.log(c('yellow', `  ⚠️  文件在 ${minutesSince.toFixed(0)} 分钟前刚被修改`));
      console.log(c('cyan', `     建议先 git log -1 -- ${opts.file} 查看最近提交`));
    }
  }
  console.log('');
  if (conflict && opts.strict) exitCode = 1;
}

// ---------- 总结 ----------
console.log(c('cyan', '=== 预检完成 ==='));
if (exitCode === 0) {
  console.log(c('green', '✅ 可以开始工作'));
} else {
  console.log(c('red', '❌ 存在冲突，请先处理'));
}
console.log('');
console.log(c('cyan', '💡 工作流：claim → 修改 → release → git commit'));
console.log('');

if (opts.json) {
  console.log(JSON.stringify({ ok: exitCode === 0, strict: opts.strict, file: opts.file }));
}

process.exit(exitCode);
