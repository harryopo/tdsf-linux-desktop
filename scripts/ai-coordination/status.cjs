#!/usr/bin/env node
/**
 * status.cjs - 查看多 AI 协作状态
 * Multi-AI Coordination Status
 *
 * Usage:
 *   node scripts/ai-coordination/status.cjs                  # 总体概览
 *   node scripts/ai-coordination/status.cjs -f "x.tsx"       # 查某文件
 *   node scripts/ai-coordination/status.cjs --json           # JSON 输出
 */
'use strict';

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const opts = { file: '', json: false };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '-f' || a === '--file') opts.file = args[++i];
  else if (a === '--json') opts.json = true;
  else if (a === '-h' || a === '--help') {
    console.log('Usage: node status.cjs [-f <file>] [--json]');
    process.exit(0);
  }
}

const root = path.resolve(__dirname, '..', '..');
const coordinationFile = path.join(root, '.ai-coordination.json');

if (!fs.existsSync(coordinationFile)) {
  console.error(`[status] 中央登记文件不存在: ${coordinationFile}`);
  process.exit(2);
}

const coord = JSON.parse(fs.readFileSync(coordinationFile, 'utf8'));
const now = new Date();

// 分离有效和过期
const validSessions = {};
const expiredSessions = [];
for (const [key, entry] of Object.entries(coord.sessions || {})) {
  if (new Date(entry.expiresAt) < now) {
    expiredSessions.push(key);
  } else {
    validSessions[key] = entry;
  }
}

if (opts.json) {
  const claimedFiles = [];
  for (const [key, entry] of Object.entries(validSessions)) {
    for (const f of (entry.claimedFiles || [])) {
      claimedFiles.push({ session: key, file: f.path, task: f.task, claimedAt: f.claimedAt, expiresAt: entry.expiresAt });
    }
  }
  console.log(JSON.stringify({
    lastUpdated: coord.lastUpdated,
    activeSessions: Object.keys(validSessions),
    expiredSessions,
    claimedFiles,
  }, null, 2));
  process.exit(0);
}

const c = (color, text) => {
  const colors = { cyan: '\x1b[36m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', gray: '\x1b[90m', reset: '\x1b[0m' };
  return `${colors[color] || ''}${text}${colors.reset}`;
};

console.log('');
console.log(c('cyan', '=== 多 AI 协作状态 ==='));
console.log(c('gray', `Last updated: ${coord.lastUpdated}`));
console.log('');

// 文件查询
if (opts.file) {
  let found = false;
  for (const [key, entry] of Object.entries(validSessions)) {
    for (const f of (entry.claimedFiles || [])) {
      if (f.path === opts.file) {
        console.log(c('yellow', `🔒 [${opts.file}] 被占用`));
        console.log(c('yellow', `   Session:    ${key}`));
        console.log(c('yellow', `   AI:         ${entry.aiName}`));
        console.log(c('yellow', `   Task:       ${f.task}`));
        console.log(c('gray',   `   Claimed at: ${f.claimedAt}`));
        console.log(c('gray',   `   Expires at: ${entry.expiresAt}`));
        found = true;
      }
    }
  }
  if (!found) {
    console.log(c('green', `🔓 [${opts.file}] 空闲，可被 claim`));
  }
  process.exit(0);
}

// 总览
if (Object.keys(validSessions).length === 0) {
  console.log(c('green', '🟢 当前无活跃 AI Session'));
} else {
  console.log(c('yellow', `🟡 活跃 Session: ${Object.keys(validSessions).length}`));
  console.log('');
  for (const [key, entry] of Object.entries(validSessions)) {
    console.log(c('cyan', `  📌 ${key}`));
    console.log(`     Task:        ${entry.task}`);
    console.log(c('gray', `     Started:     ${entry.startedAt}`));
    console.log(c('gray', `     Last active: ${entry.lastActiveAt}`));
    console.log(`     Files:       ${(entry.claimedFiles || []).length}`);
    for (const f of (entry.claimedFiles || [])) {
      console.log(c('gray', `       - ${f.path} (${f.task})`));
    }
    console.log('');
  }
}

if (expiredSessions.length > 0) {
  console.log(c('yellow', `⚠️  过期未清理: ${expiredSessions.length} 个`));
  for (const s of expiredSessions) {
    console.log(c('gray', `   - ${s}`));
  }
  console.log('');
}

const allFiles = {};
for (const [key, entry] of Object.entries(validSessions)) {
  for (const f of (entry.claimedFiles || [])) {
    allFiles[f.path] = { session: key, task: f.task };
  }
}
if (Object.keys(allFiles).length > 0) {
  console.log(c('cyan', `📁 当前所有被占用的文件 (${Object.keys(allFiles).length}):`));
  for (const path of Object.keys(allFiles).sort()) {
    const info = allFiles[path];
    console.log(c('yellow', `   🔒 ${path}`));
    console.log(c('gray', `      → ${info.session} (${info.task})`));
  }
}
console.log('');
