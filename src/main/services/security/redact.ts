/**
 * 敏感信息脱敏工具
 *
 * 用于在日志记录 / 数据库写入前对错误信息中的敏感字段进行脱敏。
 * 覆盖规则：
 *   - password=xxx       → password=[REDACTED]
 *   - token=xxx          → token=[REDACTED]
 *   - api_key=xxx        → api_key=[REDACTED]
 *   - apiKey=xxx         → apiKey=[REDACTED]
 *   - secret=xxx         → secret=[REDACTED]
 *   - .env 文件路径      → [PATH_REDACTED]
 *   - .ssh 目录路径      → [PATH_REDACTED]
 *   - Bearer xxx         → Bearer [REDACTED]
 *
 * 不影响异常堆栈的真实性，仅替换敏感值。
 */

/**
 * 脱敏敏感信息
 *
 * 纯函数：无副作用、无 I/O。对 null / undefined / 非字符串输入原样返回。
 *
 * @param input - 原始字符串（通常是 error.message），也接受 null / undefined
 * @returns 脱敏后的字符串；非字符串输入原样返回
 *
 * @example
 * redactSensitiveInfo('Connection failed: password=secret123')
 * // → 'Connection failed: password=[REDACTED]'
 *
 * redactSensitiveInfo('Loaded .env from /home/user/.env')
 * // → 'Loaded .env from [PATH_REDACTED]'
 *
 * redactSensitiveInfo(null)
 * // → null
 */
export function redactSensitiveInfo<T extends string | null | undefined>(
  input: T
): T {
  if (!input || typeof input !== 'string') {
    return input
  }

  let result: string = input

  // 1. key=value 模式（password / token / api_key / apiKey / secret）
  const keyValuePattern =
    /((?:password|token|api_key|apiKey|secret)\s*[=:]\s*)([^\s,;'"&]+)/gi
  result = result.replace(keyValuePattern, '$1[REDACTED]')

  // 2. Bearer token 模式
  const bearerPattern = /(Bearer\s+)([A-Za-z0-9\-_.~+\/]+=*)/gi
  result = result.replace(bearerPattern, '$1[REDACTED]')

  // 3. .env 文件路径
  //    要求 .env 前面有盘符/路径分隔符/字符串开头，避免误匹配文本中的 ".env" 单词
  const envPathPattern = /((?:[A-Za-z]:[\\\/]|[\\\/]|^)[^\s'"<>|*?]*\.env\b)/g
  result = result.replace(envPathPattern, '[PATH_REDACTED]')

  // 4. .ssh 目录路径
  const sshPathPattern =
    /((?:[A-Za-z]:[\\\/]|\/)?[^\s'"<>|*?]*\.ssh[\\\/][^\s'"<>|*?]*)/g
  result = result.replace(sshPathPattern, '[PATH_REDACTED]')

  return result as T
}
