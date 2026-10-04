#!/usr/bin/env node
/**
 * secret-gate.cjs — 提交前凭据闸（替代 GitHub Secret Scanning）
 *
 * 背景：本仓库是私人仓库，GitHub 的 Secret Scanning / push protection 需要付费
 * Advanced Security，实测 PATCH 返回 422「not available for this repository」，
 * 历史里那条 SSH root 口令因此从未被任何扫描器发现过。这里用零依赖本地闸补位。
 *
 * 取舍：只做"形态明确"的检测（PEM、已知厂商 token 前缀、带引号的口令赋值）。
 * 故意不检测裸 32/40 位十六进制串——那会命中 packageManager 的 sha512、
 * 文档里的 commit 哈希和测试快照，误报一多，守卫就会被关掉。
 *
 * 用法：
 *   node scripts/security/secret-gate.cjs          扫本次暂存内容（pre-commit 用）
 *   node scripts/security/secret-gate.cjs --all    扫全部已跟踪文件（自查/CI 用）
 *
 * 命中即 exit 1；报告里只出现文件、行号、规则名和打码后的值。
 */
'use strict';

const { execFileSync } = require('child_process');

const mode = process.argv.includes('--all') ? 'all' : 'staged';

/** 明确形态的凭据规则 */
const RULES = [
  { name: 'PEM 私钥块', re: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/ },
  { name: 'GitHub token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/ },
  { name: 'OpenAI 风格 key', re: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'AWS AccessKeyId', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: '火山引擎 Ark key', re: /\bAKLT[a-f0-9]{20,}\b/ },
  { name: '腾讯云 SecretId', re: /\bAKID[A-Za-z0-9]{13,}\b/ },
  { name: 'Slack token', re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ },
  { name: 'JWT 三段串', re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/ },
  { name: 'Bearer 字面量', re: /Bearer\s+([A-Za-z0-9._~+/-]{20,}=*)/i, value: 1 },
  {
    name: '口令字面量赋值',
    re: /(?:password|passwd|passphrase|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*['"]([^'"\n]{6,})['"]/i,
    value: 1,
  },
];

/**
 * 值是否"像真凭据"
 *
 * 实测教训：不判形状时，`SAVE_API_KEY: 'storage:saveApiKey'`、
 * `apiKey: 'valid-key'`、`_KEYRING_API_KEY = "api_key"` 全被报成命中（31 条里 30 条误报）。
 * 闸一旦误报成灾就会被绕过，所以这里宁可漏"弱形态"也不淹没真信号。
 */
function looksSecret(v) {
  if (v.length < 6) return false;
  // 标识符 / IPC 通道名 / 小写连字符短语：不是凭据
  // IPC 通道名（storage:deleteApiKey 这类含大写但非凭据）
  if (/^[a-z][a-zA-Z0-9]*(:[a-zA-Z0-9]+)+$/.test(v)) return false;
  if (!/[A-Z]/.test(v) && /^[a-z][a-zA-Z0-9]*([-_.][a-zA-Z0-9]+)*$/.test(v)) return false;
  // 大小写 + 数字混合（如真口令形状）
  if (/[A-Z]/.test(v) && /[0-9]/.test(v) && v.length >= 8) return true;
  // 长且无空格的连续串（token 形态）
  if (v.length >= 20 && !/\s/.test(v)) return true;
  return false;
}

/** 明显不是真凭据的值特征 */
const PLACEHOLDER_RE = /placeholder|sample|example|dummy|fake|changeme|change_me|replace|your[-_]|xxx+|\*{3,}|<[^>]*>|\$\{|process\.env|import\.meta|\[type=|REDACTED|\btest[-_]/i;

/**
 * 不参与扫描的路径
 *
 * redact.ts / secret-gate.cjs 是"检测器本身"，其源码必须包含被检测的字面量；
 * lock 文件与 .env.example 属占位与哈希，实测均为误报。
 */
const SKIP_PATH_RE =
  /(^|\/)(\.env\.example|pnpm-lock\.yaml|package-lock\.json|node_modules\/)|(^|\/)redact\.ts$|secret-gate\.cjs$/;

function listFiles() {
  const run = (args) =>
    execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split(/\r?\n/)
      .filter(Boolean);
  if (mode === 'all') return run(['ls-files']);
  return run(['diff', '--cached', '--name-only', '--diff-filter=ACMR']);
}

/** 取内容：staged 用索引里的版本，避免"改了但没 add"造成漏检/误检 */
function readContent(file) {
  const rev = mode === 'all' ? `HEAD:${file}` : `:${file}`;
  try {
    // 新增文件在 HEAD 里不存在，git 会往 stderr 打 fatal——静默即可，不是错误
    return execFileSync('git', ['show', rev], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null; // 二进制或读不到
  }
}

function mask(value) {
  if (value.length <= 8) return '****';
  return `${value.slice(0, 3)}****${value.slice(-2)}(len${value.length})`;
}

const findings = [];
const files = listFiles();

for (const file of files) {
  if (SKIP_PATH_RE.test(file)) continue;
  const content = readContent(file);
  if (content === null) continue;
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const rule of RULES) {
      const m = line.match(rule.re);
      if (!m) continue;
      if (PLACEHOLDER_RE.test(line)) continue;
      const value = rule.value ? m[rule.value] : m[0];
      if (rule.value && !looksSecret(value)) continue;
      findings.push({ file, line: i + 1, rule: rule.name, sample: mask(value) });
    }
  }
}

console.log(`[secret-gate] 模式=${mode} 扫描文件数=${files.length} 命中=${findings.length}`);

if (findings.length > 0) {
  for (const f of findings) {
    console.log(`  ✗ ${f.file}:${f.line}  ${f.rule}  ${f.sample}`);
  }
  console.log('\n提交已阻止。凭据请改从环境变量或 .gitignore 覆盖的本地文件读取。');
  console.log('确属误报时，把该行改成带 placeholder 特征的写法，或调整本脚本的排除规则（不要加 --no-verify）。');
  process.exit(1);
}
