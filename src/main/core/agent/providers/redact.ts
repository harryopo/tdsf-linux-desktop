/**
 * 敏感信息脱敏工具
 *
 * 职责：在将文本发送给 LLM 之前，自动识别并替换敏感信息为 [REDACTED]，
 * 防止类似 Grok Build 静默上传 .env 凭据的数据丑闻（方案书 v0.9 §10 Hard Constraint 6）。
 *
 * 覆盖范围：
 * - 文件路径敏感（.env / .ssh / *_key / id_rsa / *.pem 等）
 * - API Key / Token 模式（sk-xxx / Bearer xxx / AKIDxxx 等）
 * - 私钥 PEM 块（-----BEGIN ... PRIVATE KEY-----）
 * - 密码赋值（password=xxx / passwd xxx 等）
 *
 * 使用方式：
 * ```ts
 * const safe = redactSecrets(rawText)
 * await llm.chat([{ role: 'user', content: safe }])
 * ```
 *
 * 方案书依据：v0.9 §10 Hard Constraint 6（敏感文件默认 redact）
 */
import { logger } from '../../../services/log/logger'

/**
 * 脱敏规则（按优先级从高到低）
 *
 * 每条规则：[正则, 替换文本, 规则名]
 * - 正则使用 g 标志，全局替换
 * - 替换文本保留部分上下文便于调试，但不泄露真实值
 */
const REDACT_RULES: Array<{ pattern: RegExp; replacement: string; name: string }> = [
  // 1. PEM 私钥块（最优先，多行匹配）
  {
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: '-----BEGIN [REDACTED PRIVATE KEY]-----',
    name: 'pem-private-key',
  },
  // 2. 文件路径敏感（.env / .ssh / *_key / id_rsa / *.pem 等）
  {
    pattern: /\/(?:[^/\s]*\/)*(?:\.env|\.ssh\/[^/\s]*|id_rsa|id_dsa|id_ecdsa|id_ed25519|[^/\s]*_key|[^/\s]*\.pem|[^/\s]*\.key)(?=[\s"'$&|;]|$)/g,
    replacement: '[REDACTED-SENSITIVE-PATH]',
    name: 'sensitive-file-path',
  },
  // 3. OpenAI 风格 API Key（sk-开头，至少 20 位）
  { pattern: /\bsk-[A-Za-z0-9-_]{20,}\b/g, replacement: 'sk-[REDACTED]', name: 'openai-key' },
  // 4. Anthropic API Key（sk-ant- 开头）
  { pattern: /\bsk-ant-[A-Za-z0-9-_]{20,}\b/g, replacement: 'sk-ant-[REDACTED]', name: 'anthropic-key' },
  // 5. Bearer Token
  { pattern: /\bBearer\s+[A-Za-z0-9-_\.]{20,}/gi, replacement: 'Bearer [REDACTED]', name: 'bearer-token' },
  // 6. 火山方舟 AccessKey（AK 开头）
  { pattern: /\bAKID[A-Za-z0-9]{16,}\b/g, replacement: 'AKID[REDACTED]', name: 'volc-akid' },
  // 7. 通义千问 / 阿里云 AccessKey（LTAI 开头）
  { pattern: /\bLTAI[A-Za-z0-9]{12,}\b/g, replacement: 'LTAI[REDACTED]', name: 'aliyun-ak' },
  // 8. Google API Key（AIza 开头）
  { pattern: /\bAIza[A-Za-z0-9_\-]{35}\b/g, replacement: 'AIza[REDACTED]', name: 'google-api-key' },
  // 9. 通用 API Key 赋值（api_key= / apikey= / api-key= / x-api-key=）
  // 用捕获组保留 key 名，仅替换值
  {
    pattern: /\b(api[_-]?key|x-api-key)(\s*[=:]\s*)['"]?[A-Za-z0-9_\-]{16,}['"]?/gi,
    replacement: '$1$2[REDACTED]',
    name: 'api-key-assign',
  },
  // 10. 密码赋值（password= / passwd= / pwd=）
  {
    pattern: /\b(password|passwd|pwd|pass)(\s*[=:]\s*)['"]?[^\s'"]{4,}['"]?/gi,
    replacement: '$1$2[REDACTED]',
    name: 'password-assign',
  },
  // 11. AWS Access Key（AKIA 开头，4+16 位）
  { pattern: /\bAKIA[A-Z0-9]{16}\b/g, replacement: 'AKIA[REDACTED]', name: 'aws-access-key' },
  // 12. AWS Secret Key（40 位 base64，仅在 secret= 后识别）
  {
    pattern: /\b(secret|secret_key|aws_secret_access_key)(\s*[=:]\s*)['"]?[A-Za-z0-9/+=]{40}['"]?/gi,
    replacement: '$1$2[REDACTED]',
    name: 'aws-secret',
  },
]

/**
 * 脱敏统计（单次调用命中的规则数，便于日志审计）
 */
export interface RedactStats {
  /** 命中的规则名 → 替换次数 */
  hits: Record<string, number>
  /** 总命中次数 */
  total: number
}

/**
 * 对文本进行敏感信息脱敏（默认重载：仅返回脱敏文本）
 *
 * 注意：实现签名在无 options 时返回 string（与本重载一致）。
 *       若需同时获取命中统计，请传 { returnStats: true }。
 *
 * @param input 原始文本（可能包含 .env 路径、API Key、密码等）
 * @returns 脱敏后的文本（敏感信息替换为 [REDACTED]）
 */
export function redactSecrets(input: string): string

/**
 * 重载：仅返回脱敏文本（便捷调用）
 */
export function redactSecrets(input: string, options?: { returnStats: false }): string

/**
 * 重载：返回脱敏文本 + 统计
 */
export function redactSecrets(
  input: string,
  options: { returnStats: true }
): { text: string; stats: RedactStats }

// 实现签名
export function redactSecrets(
  input: string,
  options?: { returnStats?: boolean }
): string | { text: string; stats: RedactStats } {
  const stats: RedactStats = { hits: {}, total: 0 }
  let text = input

  for (const rule of REDACT_RULES) {
    // 重置正则的 lastIndex（防止 g 标志在多次调用时状态污染）
    rule.pattern.lastIndex = 0
    const matches = text.match(rule.pattern)
    if (matches && matches.length > 0) {
      text = text.replace(rule.pattern, rule.replacement)
      stats.hits[rule.name] = matches.length
      stats.total += matches.length
    }
  }

  // 命中时记录审计日志（仅统计，不记录原文）
  if (stats.total > 0) {
    logger.info('AGENT.REDACT', `已脱敏 ${stats.total} 处敏感信息`, { hits: stats.hits })
  }

  return options?.returnStats ? { text, stats } : text
}

/**
 * 判断文本是否包含敏感文件路径（用于 UI 提示用户）
 *
 * 仅做路径模式匹配，不修改文本。
 */
export function containsSensitivePath(input: string): boolean {
  const pattern = REDACT_RULES[1].pattern
  pattern.lastIndex = 0
  return pattern.test(input)
}

/**
 * 获取脱敏规则列表（UI 调试用，便于展示已启用的规则）
 */
export function listRedactRules(): Array<{ name: string; description: string }> {
  return [
    { name: 'pem-private-key', description: 'PEM 私钥块（-----BEGIN PRIVATE KEY-----）' },
    { name: 'sensitive-file-path', description: '敏感文件路径（.env / .ssh / id_rsa / *.pem）' },
    { name: 'openai-key', description: 'OpenAI API Key（sk-）' },
    { name: 'anthropic-key', description: 'Anthropic API Key（sk-ant-）' },
    { name: 'bearer-token', description: 'Bearer Token' },
    { name: 'volc-akid', description: '火山方舟 AccessKey（AKID）' },
    { name: 'aliyun-ak', description: '阿里云 AccessKey（LTAI）' },
    { name: 'google-api-key', description: 'Google API Key（AIza）' },
    { name: 'api-key-assign', description: 'api_key= 赋值语句' },
    { name: 'password-assign', description: 'password= 赋值语句' },
    { name: 'aws-access-key', description: 'AWS AccessKey（AKIA）' },
    { name: 'aws-secret', description: 'AWS SecretKey 赋值语句' },
  ]
}
