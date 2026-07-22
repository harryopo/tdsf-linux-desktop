/**
 * 敏感信息脱敏工具（统一入口）
 *
 * v2.2 修复问题 #36：原文件存在独立实现 redactSensitiveInfo，与 core/agent/providers/redact.ts
 * 的 redactSecrets 形成 DRY 违规。现统一为单一实现：
 * - redactSecrets 为唯一核心实现（12 类规则，覆盖 PEM/路径/API Key/密码/AWS 等）
 * - redactSensitiveInfo 保留为兼容包装（维持原签名接受 null/undefined），内部委托 redactSecrets
 *
 * 覆盖规则（由 redactSecrets 提供）：
 *   - PEM 私钥块            → -----BEGIN [REDACTED PRIVATE KEY]-----
 *   - 敏感文件路径           → [REDACTED-SENSITIVE-PATH]（.env / .ssh / id_rsa / *.pem / *.key）
 *   - OpenAI / Anthropic Key → sk-[REDACTED] / sk-ant-[REDACTED]
 *   - Bearer Token          → Bearer [REDACTED]
 *   - 火山 / 阿里 / Google   → AKID[REDACTED] / LTAI[REDACTED] / AIza[REDACTED]
 *   - api_key= / password=  → api_key=[REDACTED] / password=[REDACTED]
 *   - AWS AccessKey / Secret → AKIA[REDACTED] / secret=[REDACTED]
 *
 * 不影响异常堆栈的真实性，仅替换敏感值。
 */

// 统一核心实现：re-export redactSecrets（单一数据源，避免 DRY 违规）
export { redactSecrets } from '../../core/agent/providers/redact'

import { redactSecrets } from '../../core/agent/providers/redact'

/**
 * 脱敏敏感信息（兼容包装）
 *
 * 纯函数：无副作用。对 null / undefined / 非字符串输入原样返回。
 * 字符串输入委托给 redactSecrets 统一处理，保证脱敏规则一致性。
 *
 * @param input - 原始字符串（通常是 error.message），也接受 null / undefined
 * @returns 脱敏后的字符串；非字符串输入原样返回
 *
 * @example
 * redactSensitiveInfo('Connection failed: password=secret123')
 * // → 'Connection failed: password=[REDACTED]'
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
  return redactSecrets(input) as T
}
