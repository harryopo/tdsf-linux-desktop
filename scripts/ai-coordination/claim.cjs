#!/usr/bin/env node
/**
 * claim.cjs - AI 文件所有权声明
 * AI File Ownership Claim
 *
 * Usage:
 *   node scripts/ai-coordination/claim.cjs --file "src/xxx.tsx" --task "1:1 复刻"
 *   node scripts/ai-coordination/claim.cjs -f "x.tsx" -t "task" --session "ai-20260720-001"
 *
 * Options:
 *   -f, --file       [必填] 相对仓库根的文件路径
 *   -t, --task       [必填] 简短任务描述
 *   -s, --session    [可选] 自定义 Session ID；不传则首次自动生成并缓存
 *   --ttl <hours>    [可选] 过期小时数，默认 2
 *   --json           [可选] 输出 JSON 格式（供程序解析）
 */
'use strict';

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const opts = { file: '', task: '', session: '', ttlHours: 2, json: false };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '-f' || a === '--file') opts.file = args[++i];
  else if (a === '-t' || a === '--task') opts.task = args[++i];
  else if (a === '-s' || a === '--session') opts.session = args[++i];
  else if (a === '--ttl') opts.ttlHours = parseInt(args[++i], 10);
  else if (a === '--json') opts.json = true;
  else if (a === '-h' || a === '--help') {
    console.log('Usage: node claim.cjs -f <file> -t <task> [-s <session>] [--ttl <hours>]');
    process.exit(0);
  }
}

if (!opts.file || !opts.task) {
  console.error('[claim] 缺少必填参数 -f / -t');
  process.exit(2);
}

const root = path.resolve(__dirname, '..', '..');
const coordinationFile = path.join(root, '.ai-coordination.json');
const sessionCache = path.join(__dirname, '.ai-session.local');

function log(msg, color = '') {
  if (opts.json) return;
  const colors = { cyan: '\x1b[36m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', gray: '\x1b[90m', reset: '\x1b[0m' };
  const c = colors[color] || '';
  console.log(`${c}${msg}${colors.reset}`);
}

function generateSessionId() {
  const d = new Date();
  const stamp = d.getFullYear().toString() +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0') +
    String(d.getHours()).padStart(2, '0') +
    String(d.getMinutes()).padStart(2, '0') +
    String(d.getSeconds()).padStart(2, '0');
  const rand = String(Math.floor(Math.random() * 9999)).padStart(4, '0');
  return `ai-${stamp}-${rand}`;
}

// ---------- 1. Session ID 管理 ----------
if (!opts.session) {
  if (fs.existsSync(sessionCache)) {
    opts.session = fs.readFileSync(sessionCache, 'utf8').trim();
  } else {
    opts.session = generateSessionId();
    fs.writeFileSync(sessionCache, opts.session, 'utf8');
  }
}

log(`[claim] Session = ${opts.session}`, 'cyan');
log(`[claim] File   = ${opts.file}`, 'cyan');
log(`[claim] Task   = ${opts.task}`, 'cyan');

// ---------- 2. 加载中央登记 ----------
if (!fs.existsSync(coordinationFile)) {
  console.error(`[claim] 中央登记文件不存在: ${coordinationFile}`);
  process.exit(2);
}
const coord = JSON.parse(fs.readFileSync(coordinationFile, 'utf8'));

// ---------- 3. 清理过期 claim ----------
const now = new Date();
const expiredKeys = [];
for (const key of Object.keys(coord.sessions || {})) {
  const entry = coord.sessions[key];
  if (new Date(entry.expiresAt) < now) {
    expiredKeys.push(key);
  }
}
for (const key of expiredKeys) {
  delete coord.sessions[key];
  log(`[claim] 已清理过期 Session: ${key}`, 'gray');
}

// ---------- 4. 检查目标文件是否被其他 AI 占用 ----------
for (const [key, entry] of Object.entries(coord.sessions || {})) {
  if (key === opts.session) continue;
  for (const f of (entry.claimedFiles || [])) {
    if (f.path === opts.file) {
      log('', 'reset');
      log(`❌ [CONFLICT] 文件被其他 AI 占用`, 'red');
      log(`   文件:        ${opts.file}`, 'yellow');
      log(`   占用 Session: ${key}`, 'yellow');
      log(`   占用 AI:     ${entry.aiName}`, 'yellow');
      log(`   占用任务:    ${entry.task}`, 'yellow');
      log(`   过期时间:    ${entry.expiresAt}`, 'yellow');
      log('', 'reset');
      log(`👉 建议：等待该 AI 完成（查看 git log），或切换到其他任务`, 'cyan');
      if (opts.json) console.log(JSON.stringify({ ok: false, conflict: { session: key, file: opts.file } }));
      process.exit(1);
    }
  }
}

// ---------- 5. 写入/更新本 Session ----------
const expiresAt = new Date(now.getTime() + opts.ttlHours * 3600 * 1000).toISOString();

if (!coord.sessions) coord.sessions = {};
if (!coord.sessions[opts.session]) {
  coord.sessions[opts.session] = {
    aiName: opts.session,
    sessionId: opts.session,
    startedAt: now.toISOString(),
    lastActiveAt: now.toISOString(),
    task: opts.task,
    claimedFiles: [],
  };
}

const entry = coord.sessions[opts.session];
const already = (entry.claimedFiles || []).some(f => f.path === opts.file);
if (!already) {
  if (!entry.claimedFiles) entry.claimedFiles = [];
  entry.claimedFiles.push({
    path: opts.file,
    task: opts.task,
    claimedAt: now.toISOString(),
  });
}
entry.lastActiveAt = now.toISOString();
entry.expiresAt = expiresAt;  // 每次 claim 续期

// ---------- 6. 追加 history ----------
if (!coord.history) coord.history = [];
coord.history.push({
  sessionId: opts.session,
  action: 'claim',
  file: opts.file,
  task: opts.task,
  timestamp: now.toISOString(),
});
coord.lastUpdated = now.toISOString();

// ---------- 7. 写回文件 ----------
fs.writeFileSync(coordinationFile, JSON.stringify(coord, null, 2) + '\n', 'utf8');

log('', 'reset');
log(`✅ [OK] 声明成功`, 'green');
log(`   Session:    ${opts.session}`, 'green');
log(`   File:       ${opts.file}`, 'green');
log(`   Expires at: ${expiresAt}`, 'green');
log('', 'reset');
log(`💡 完成后请运行: node release.cjs -f "${opts.file}"`, 'cyan');
log(`💡 commit message 建议包含 Session ID: ${opts.session}`, 'cyan');
log(`💡 完成后必须 git add .ai-coordination.json（让其他 AI 看到状态）`, 'cyan');

if (opts.json) {
  console.log(JSON.stringify({ ok: true, session: opts.session, file: opts.file, expiresAt }));
}
