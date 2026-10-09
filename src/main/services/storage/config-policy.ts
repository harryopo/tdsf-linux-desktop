/**
 * `config:set` 的写入策略（纯函数，可在无 Electron 环境里直接测）
 *
 * 为什么要有这条策略：`config:set` 是"渲染层给一个键名 + 一个值就能写盘"的通用通道。
 * 2026-10-09 安全审查实测：渲染层一句 `configSet('llmConfig',{baseUrl:'http://evil'})`
 * 就能让主进程把 SecureStore 里的真 API Key 与这个 baseUrl 合并进同一个请求头
 * （`llm-config-resolver.ts` 的旧体系兜底分支），等于凭据外泄 + 全部对话外送。
 *
 * 所以：**带权限的键不许经这条通道写**，它们各有带校验的专用通道
 * （LLM 走 `config:saveLlm`，服务器列表走 `server:save`）。
 */

/** 不许经 config:set 写入的键（各有专用通道） */
export const CONFIG_SET_DENIED_KEYS: ReadonlySet<string> = new Set([
  'llmConfig',
  'sshServers',
  'mcpConfig',
  'providers',
  'defaultProviderId',
])

/** 键名里出现这些词一律拒（防"新加一个 xxxApiKey 键"绕过枚举） */
const DENIED_KEY_PATTERN = /api.?key|password|secret|token|credential|privatekey/i

/** 这个键能不能经 config:set 写？返回 false 时调用方要拒写并留日志 */
export function configKeyIsWritable(key: unknown): boolean {
  if (typeof key !== 'string' || !key.trim()) return false
  if (CONFIG_SET_DENIED_KEYS.has(key)) return false
  return !DENIED_KEY_PATTERN.test(key)
}

/**
 * 值必须是纯数据：挡函数、Proxy/类实例，以及 `__proto__`/`constructor` 这类
 * 能污染原型的键（electron-store 按点号路径写，畸形键的后果不可预期）。
 */
export function isPlainConfigValue(value: unknown): boolean {
  if (value === null || value === undefined) return true
  const t = typeof value
  if (t === 'string' || t === 'number' || t === 'boolean') return true
  if (Array.isArray(value)) return value.every(isPlainConfigValue)
  if (t === 'object') {
    const proto = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) return false
    return Object.entries(value as Record<string, unknown>).every(
      ([k, v]) => !['__proto__', 'constructor', 'prototype'].includes(k) && isPlainConfigValue(v)
    )
  }
  return false
}
