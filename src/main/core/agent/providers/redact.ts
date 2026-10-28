/**
 * 敏感信息脱敏工具
 *
 * 职责：在将文本发送给 LLM 之前，自动识别并替换敏感信息为 [REDACTED]，
 * 防止类似 Grok Build 静默上传 .env 凭据的数据丑闻（方案书 v0.9 §10 Hard Constraint 6）。
 *
 * 覆盖范围：
 * - 文件路径敏感（.env / .ssh / *_key / id_rsa / *.pem 等）
 * - API Key / Token 模式（sk-ant-api03-xxx / Bearer token / AKIDxxx 等）
 * - 私钥 PEM 块（-----BEGIN ... PRIVATE KEY-----）
 * - 密码赋值（password=secret / passwd secret 等）
 *
 * 使用方式：
 * ```ts
 * const safe = redactSecrets(rawText)
 * await llm.chat([{ role: 'user', content: safe }])
 * ```
 *
 * 方案书依据：v0.9 §10 Hard Constraint 6（敏感文件默认 redact）
 *
 * 这个模块是纯函数，不许回调 logger：logger 自己要用它对每条日志做收口脱敏（见
 * services/log/logger.ts 的 log()），这里再打日志就是无限递归。
 * 命中统计通过 { returnStats: true } 由调用方取用。
 */

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
  // 9b. 上游回显的"错 Key"原句（OpenAI/兼容端常见：`Incorrect API key provided: <key>`）
  //     这里没有 `api_key=` 这种可识别的赋值形状，第 9 条抓不到；
  //     而这条错误原文会被写进 Langfuse / 日志 / 界面，等于把 Key 递到第三方去。
  {
    pattern: /\b((?:incorrect|invalid|missing)\s+(?:api[\s_-]?key)|api[\s_-]?key\s+provided)(\s*[:：]\s*)\S+/gi,
    replacement: '$1$2[REDACTED]',
    name: 'api-key-echo',
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
  // 13. Windows 形态的敏感路径（样本实测原规则只认 POSIX 斜杠，盘符/UNC/%USERPROFILE% 三种起头全 MISS）
  //     C:\Users\x\.ssh\id_rsa、\\host\share\server.pem、%USERPROFILE%\.tdsf\secure-storage.json
  //     分隔符写成 \\{1,2}：日志里既可能是原生路径，也可能是 JSON.stringify 之后成对的反斜杠
  {
    pattern:
      /(?:[A-Za-z]:\\{1,2}|\\\\{1,2}[^\\'"$\s]+\\{1,2}|%USERPROFILE%\\{1,2})(?:[^\\'"$\s]+\\{1,2})*(?:\.env|\.ssh(?:\\{1,2}|\/)[^\\'"$\s]+|id_rsa|id_dsa|id_ecdsa|id_ed25519|secure-storage\.json|\.netrc|\.pgpass|credentials|[^\\'"$\s]*\.pem|[^\\'"$\s]*\.key)(?=$|[\s"',;:)\]}\\])/g,
    replacement: '[REDACTED-SENSITIVE-PATH]',
    name: 'windows-sensitive-path',
  },
  // 14. 连接串里内联的账号密码：postgres://admin:S3cr3t@10.0.0.5/db（原来整条 MISS）
  {
    pattern: /([a-z][a-z0-9+.-]{1,15}):\/\/([^\s/@:]+):([^\s/@]+)@/gi,
    replacement: '$1://$2:[REDACTED]@',
    name: 'url-credentials',
  },
  // 15. Authorization 头（Basic/Digest/Token 都是原来 Bearer 单条规则漏掉的）
  {
    pattern: /\b(Authorization)(\s*[:=]\s*)(Basic|Digest|Bearer|Token)\s+[^\s"']{4,}/gi,
    replacement: '$1$2$3 [REDACTED]',
    name: 'authorization-header',
  },
  // 16. sshpass -p'pw' / sshpass -pQq（明文口令直接写在命令里，commandPreview 会整条进日志）
  {
    pattern: /\b(sshpass\s+(?:-p\s?|--password[= ]))(?:'[^']*'|"[^"]*"|[^\s'"]{1,})/gi,
    replacement: '$1[REDACTED]',
    name: 'sshpass-inline',
  },
  // 17. 键名形态补全：token/secret/passphrase/private_key/access_token/client_secret/credential(s)
  //     （原来只有 api_key 与 password 两族，`token=xxx` 与 `passphrase: xxx` 直接落盘）
  //     裸 token 也算：后面必须紧跟 = 或 :，所以 token_count / tokens / tokenizer 都不会被误伤
  {
    pattern:
      /\b((?:access|refresh|client|api|secret|session|auth|bearer|csrf|xsrf)[_-]?(?:key|token|secret)|passphrase|private[_-]?key|credentials?|auth[_-]?token|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret[_-]?key|token|jwt)(\s*[=:]\s*)['"]?[^\s'"]{4,}['"]?/gi,
    replacement: '$1$2[REDACTED]',
    name: 'sensitive-key-assign',
  },
  // 18. 厂商前缀型 token（GitHub/GitLab/Slack/npm）——这类没有键名，只能按前缀认
  //     没有做"高熵兜底"：随机串规则和 UUID、sha512、base64 正常日志同形，
  //     加上去等于把"现场查不到"换成"现场看不懂"，不划算。
  {
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{15,}|xox[abprs]-[A-Za-z0-9-]{10,}|npm_[A-Za-z0-9]{36})\b/g,
    replacement: '[REDACTED-VENDOR-TOKEN]',
    name: 'vendor-token-prefix',
  },
  // 19. 没有 END 行的私钥块（粘贴被截断 / 只贴了半截）
  //     规则 1 要求成对闭合，所以"-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnZ..."
  //     这种最常见的泄露形态原来一个字都不涂。放在闭合规则之后，剩下的就是残缺块。
  {
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*$/g,
    replacement: '-----BEGIN [REDACTED PRIVATE KEY]-----',
    name: 'pem-private-key-unterminated',
  },
  // 20. 中文标签：「密码是XXX」「口令为：XXX」「密钥：XXX」
  //     英文那几条靠 [=:：] 分隔，中文里"是/为"当连接动词时没有分隔符，整条 MISS。
  //     取值到空白或中文标点为止，不会把后半句话一起吞掉。
  {
    pattern: /(密码|口令|私钥|密钥|令牌|凭据|访问密钥)(是|为|[:：=])(\s*)[^\s，。；;、'""]{4,}/g,
    replacement: '$1$2$3[REDACTED]',
    name: 'cjk-secret-label',
  },
  // 21. 命令行内联口令：`mysql -pXXX` / `redis-cli -a XXX` / `curl -u user:pass`
  //     password= 那几条要求键名后跟 = 或 :，这几种是旗标 + 空格，整条 MISS。
  {
    pattern: /(\bmysql\b[^\n|;]*?\s-p)(?=[^\s'"])(?:'[^']*'|"[^"]*"|\S+)/gi,
    replacement: '$1[REDACTED]',
    name: 'mysql-inline-password',
  },
  {
    pattern: /(\bredis-cli\b[^\n|;]*?\s-a\s+)(?:'[^']*'|"[^"]*"|\S+)/gi,
    replacement: '$1[REDACTED]',
    name: 'redis-cli-inline-password',
  },
  {
    pattern: /(\bcurl\b[^\n|;]*?\s-u\s+)(?:'[^']*'|"[^"]*"|[^\s:]+:[^\s]+)/gi,
    replacement: '$1[REDACTED]',
    name: 'curl-inline-credentials',
  },
  // 22. `--password 值` 的分离写法（`--password=值` 已被规则 10 覆盖）
  {
    // `\b` 在 `--` 前面不成立（两边都是非单词字符），所以用"行首或分隔符"作锚
    pattern: /(^|[\s;|&])(--password)(\s+)(?:'[^']*'|"[^"]*"|\S+)/gi,
    replacement: '$1$2$3[REDACTED]',
    name: 'password-flag',
  },
  // 23. 全大写环境变量口令：\b 在 PGPASSWORD 这种前缀后面不成立，规则 10 看不见
  {
    pattern: /\b(PGPASSWORD|MYSQL_PWD|REDISCLI_AUTH)(\s*=\s*)(?:'[^']*'|"[^"]*"|\S+)/g,
    replacement: '$1$2[REDACTED]',
    name: 'env-password',
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

  // 命中统计不再自己打日志：logger.log() 现在正用这个函数做收口脱敏，
  // 在这里写日志等于自我递归。要观测命中数请用 { returnStats: true }。
  return options?.returnStats ? { text, stats } : text
}

/**
 * 判断文本是否包含敏感文件路径（用于 UI 提示用户）
 *
 * 仅做路径模式匹配，不修改文本。按规则名取，不按数组下标取——
 * 下标会在下次加规则时静默变成"检查了另一条规则"。
 */
export function containsSensitivePath(input: string): boolean {
  const rules = REDACT_RULES.filter(
    (r) => r.name === 'sensitive-file-path' || r.name === 'windows-sensitive-path'
  )
  return rules.some((rule) => {
    rule.pattern.lastIndex = 0
    return rule.pattern.test(input)
  })
}

/**
 * 获取脱敏规则列表（UI 调试与判据用）
 *
 * 从 REDACT_RULES 现取，不另立一份手工清单：上一版就是那份清单，
 * 规则加到 18 条时它还写着 12 条，等于对外报一个假的能力数字。
 */
export function listRedactRules(): Array<{ name: string; description: string }> {
  return REDACT_RULES.map((rule) => ({
    name: rule.name,
    description: rule.pattern.source,
  }))
}

/**
 * 递归脱敏任意工具返回值（HC-6 的出边界收口）。
 *
 * 病根：redactSecrets 原先只装在用户消息与 sftp_read 两个点上，而工具结果才是凭据
 * 最常见的载体（`cat ~/.my.cnf` / `env` / `ps aux` / 日志里的 token），三个命令类工具的
 * stdout/stderr 原样进模型上下文。同一条文本能从多个出口离开边界，只装一个等于没装。
 */
export function redactToolValue(value: unknown): unknown {
  if (typeof value === 'string') return redactSecrets(value)
  if (Array.isArray(value)) return value.map(redactToolValue)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactToolValue(v)
    return out
  }
  return value
}

/**
 * 给一组工具定义的 execute 套上结果脱敏（浅拷贝，不改共享对象）。
 *
 * 收口放在 tools 的组装点而不是每个 execute 里：新增工具自动受管，
 * 不再依赖"写工具的人记得自己脱敏"这条没人检查的约定。
 */
export function withToolResultRedaction<T extends object>(tools: T): T {
  const wrapped: Record<string, unknown> = {}
  for (const [name, def] of Object.entries(tools as Record<string, unknown>)) {
    if (def && typeof def === 'object' && typeof (def as { execute?: unknown }).execute === 'function') {
      const run = (def as { execute: (...args: unknown[]) => unknown }).execute
      // 必须 await：工具 execute 几乎都是 async，不等待时脱敏看到的是 Promise 对象，
      // 枚举不出任何键 ⇒ 模型收到 {}（2026-10-20 实测）。
      wrapped[name] = { ...def, execute: async (...args: unknown[]) => redactToolValue(await run(...args)) }
    } else {
      wrapped[name] = def
    }
  }
  return wrapped as T
}
