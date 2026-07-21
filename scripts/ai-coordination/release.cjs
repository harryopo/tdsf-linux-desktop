#!/usr/bin/env node
/**
 * release.cjs - 释放文件所有权
 * AI File Ownership Release
 *
 * Usage:
 *   node scripts/ai-coordination/release.cjs --file "x.tsx"
 *   node scripts/ai-coordination/release.cjs --session "ai-20260720-001"
 *   node scripts/ai-coordination/release.cjs -f "x.tsx" -s "ai-20260720-002"
 *   node scripts/ai-coordination/release.cjs --all    # 释放本 session 全部
 */
'use strict';

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const opts = { file: '', session: '', all: false, json: false };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '-f' || a === '--file') opts.file = args[++i];
  else if (a === '-s' || a === '--session') opts.session = args[++i];
  else if (a === '--all') opts.all = true;
  else if (a === '--json') opts.json = true;
  else if (a === '-h' || a === '--help') {
    console.log('Usage: node release.cjs [-f <file> | -s <session> | --all]');
    process.exit(0);
  }
}

const root = path.resolve(__dirname, '..', '..');
const coordinationFile = path.join(root, '.ai-coordination.json');
const sessionCache = path.join(__dirname, '.ai-session.local');

if (!opts.session && fs.existsSync(sessionCache)) {
  opts.session = fs.readFileSync(sessionCache, 'utf8').trim();
}

if (!opts.session) {
  console.error('[release] 未指定 Session（用 -s 或先运行 claim.cjs）');
  process.exit(2);
}

if (!opts.file && !opts.all) {
  console.error('[release] 必须指定 -f <file> 或 --all');
  process.exit(2);
}

if (!fs.existsSync(coordinationFile)) {
  console.error(`[release] 中央登记文件不存在: ${coordinationFile}`);
  process.exit(2);
}

const coord = JSON.parse(fs.readFileSync(coordinationFile, 'utf8'));
const now = new Date();
const released = [];

if (!coord.sessions || !coord.sessions[opts.session]) {
  console.log(`[release] Session 不存在或已释放: ${opts.session}`);
  process.exit(0);
}

const entry = coord.sessions[opts.session];

if (opts.all || !opts.file) {
  // 释放整个 session
  released.push(...(entry.claimedFiles || []));
  entry.claimedFiles = [];
} else {
  // 释放单个文件
  entry.claimedFiles = (entry.claimedFiles || []).filter(f => {
    if (f.path === opts.file) {
      released.push(f);
      return false;
    }
    return true;
  });
}

if (!coord.history) coord.history = [];
for (const f of released) {
  coord.history.push({
    sessionId: opts.session,
    action: 'release',
    file: f.path,
    task: f.task,
    timestamp: now.toISOString(),
  });
}

// 如果 session 已无文件 → 从 sessions 中删除
if (entry.claimedFiles.length === 0) {
  delete coord.sessions[opts.session];
}

coord.lastUpdated = now.toISOString();
fs.writeFileSync(coordinationFile, JSON.stringify(coord, null, 2) + '\n', 'utf8');

const green = '\x1b[32m', cyan = '\x1b[36m', reset = '\x1b[0m';
console.log(`${green}✅ [release] 已释放 ${released.length} 个文件${reset}`);
for (const f of released) {
  console.log(`${green}   - ${f.path} (${f.task})${reset}`);
}
console.log('');
console.log(`${cyan}💡 别忘了 git add .ai-coordination.json && git commit${reset}`);

if (opts.json) {
  console.log(JSON.stringify({ ok: true, released: released.map(f => f.path) }));
}
