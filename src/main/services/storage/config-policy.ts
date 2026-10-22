/**
 * `config:get` / `config:set` 的键策略（纯函数，可在无 Electron 环境里直接测）
 *
 * 2026-10-22 独立复核实测到的真实越权链（都在本文件收紧前成立）：
 * 1. 禁用表写的是 `providers` / `defaultProviderId`，而 Provider 实际存在
 *    `agentProviders` / `agentDefaultProviderId`（provider-registry.ts:29,31）；
 * 2. electron-store 按点号路径写，`mcpConfig.externalServers`、`llmConfig.baseUrl`
 *    这类形如 "顶层键.子键" 的写法直接绕过整键禁用表。
 * 于是渲染层写一次 agentProviders（把 baseURL 换成攻击者地址）就能让
 * 下一次 AI 调用把 SecureStore 里的真 Key 发给攻击者；mcpConfig.externalServers
 * 则能持久化一条外部命令，下次启动由 StdioClientTransport 执行。
 *
 * 修法从"列黑名单"改为"列白名单"：只有界面真正读写的用户设置键能过，
 * 其余（含任何未登记的新键、点号路径、原型链段）一律 fail-closed。
 * 读也走同一张表：config:get 不再能读 mcpConfig / agentProviders / 旧 llmConfig 原文。
 */

/** 界面真正读写的用户设置键（新增设置项时必须同步登记，否则会被拒写） */
const CONFIG_UI_KEYS = [
  'alertThreshold',
  'monthlyBudget',
  'sshDefaults',
  'sshTimeout',
  'ssh.allowPasswordAuth',
  'general.email',
  'calibration.minSamples',
  'decision.decisionTimeout',
  'decision.weights',
  'decision.confidenceThreshold',
  'decision.fileSizeLimit',
  'decision.batchLimit',
  'decision.rollbackRetention',
  'risk.auditCmdExec',
  'risk.auditFileMod',
  'risk.auditAiDecision',
  'risk.auditSshConn',
  'risk.auditRetention',
  'monitor.threshold.cpu',
  'monitor.threshold.memory',
  'monitor.threshold.disk',
  'terminal.fontSize',
  'terminal.lineHeight',
  'terminal.cursorStyle',
  'terminal.cursorBlink',
  'terminal.scrollback',
  'terminal.bellEnabled',
  'terminal.autoCopy',
  'terminal.stripNewline',
  'terminal.stripControlChars',
  'terminal.cmdTimeout',
  'terminal.shell',
  'terminal.fontFamily',
  'terminal.rightClickPaste',
  'terminal.mouseSupport',
  'terminal.webglRenderer',
  'terminal.sshHeartbeat',
  'appearance.theme',
  'appearance.codeFont',
  'appearance.fontSize',
  'appearance.lineHeight',
  'appearance.density',
  'appearance.codeTheme',
] as const

/** 可经自由通道写的键：白名单，不再靠"名字里有没有 secret"猜 */
export const CONFIG_WRITABLE_KEYS: ReadonlySet<string> = new Set(CONFIG_UI_KEYS)

/** 只读给渲染层的键：llmConfig 会先脱掉 apiKey 再返回 */
const CONFIG_READABLE_KEYS: ReadonlySet<string> = new Set([...CONFIG_UI_KEYS, 'llmConfig'])

/**
 * 历史上登记过的权限键，保留给测试与文档对账；真正拦截靠上面的白名单。
 * 新增带权限的存储键时应同时加到这里，让测试能点名它。
 */
export const CONFIG_SET_DENIED_KEYS: ReadonlySet<string> = new Set([
  'llmConfig',
  'sshServers',
  'mcpConfig',
  'providers',
  'defaultProviderId',
  'agentProviders',
  'agentDefaultProviderId',
  'langfuseConfig',
])

/** 键名里出现这些词一律拒（防"新加一个 xxxApiKey 键"绕过枚举） */
const DENIED_KEY_PATTERN = /api.?key|password|secret|token|credential|privatekey/i

/** 点号路径里允许出现的段；原型链段与空段一律拒 */
const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])

function isSafeKeyShape(key: string): boolean {
  if (key.length === 0 || key.length > 120) return false
  if (!/^[a-zA-Z0-9_.]+$/.test(key)) return false
  const segments = key.split('.')
  return segments.every((s) => s.length > 0 && !FORBIDDEN_PATH_SEGMENTS.has(s))
}

/** 这个键能不能经 config:set 写？返回 false 时调用方要拒写并留日志 */
export function configKeyIsWritable(key: unknown): boolean {
  if (typeof key !== 'string') return false
  if (!isSafeKeyShape(key)) return false
  if (!CONFIG_WRITABLE_KEYS.has(key)) return false
  return !DENIED_KEY_PATTERN.test(key)
}

/** 这个键能不能经 config:get 读给渲染层？ */
export function configKeyIsReadable(key: unknown): boolean {
  if (typeof key !== 'string') return false
  if (!isSafeKeyShape(key)) return false
  return CONFIG_READABLE_KEYS.has(key)
}

/**
 * 把配置值脱敏后再交给渲染层。
 *
 * llmConfig 的历史数据里可能还留着明文 apiKey（旧版本写入的）；
 * 即使读取白名单允许 llmConfig，也必须在这里把 apiKey 摘掉。
 */
export function sanitizeConfigForRenderer(key: string, value: unknown): unknown {
  if (key !== 'llmConfig') return value
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
  const { apiKey: _apiKey, ...rest } = value as Record<string, unknown>
  void _apiKey
  return rest
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
      ([k, v]) => !FORBIDDEN_PATH_SEGMENTS.has(k) && isPlainConfigValue(v)
    )
  }
  return false
}
