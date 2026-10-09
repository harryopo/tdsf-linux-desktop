/**
 * 服务器凭据的剥离与列表形状（纯函数，无 electron 依赖）
 *
 * 单独成模块的原因：这条边界是安全判据（凭据不许跨进程），必须能在不启动 Electron 的
 * 环境里被直接测到 —— 放进 config-store 就得连 electron-store + safeStorage 一起 mock，
 * 测不到就等于没测。
 */
import type { ServerListItem, SshConfig } from '@shared/models'

/** 三个凭据字段（含跳板机那一层的同名键） */
const CREDENTIAL_KEYS = ['password', 'privateKey', 'passphrase'] as const

/**
 * 剥掉一台服务器配置里的凭据，**含 jumpHost 那一层**。
 *
 * 2026-10-09 安全审查复测发现的漏点：原先保存/导出只解构顶层三个键，
 * `jumpHost.password` 会原样进 electron-store（明文 JSON）与导出文件。
 */
export function stripServerCredentials(s: SshConfig): SshConfig {
  const out: SshConfig = { ...s }
  for (const k of CREDENTIAL_KEYS) delete (out as unknown as Record<string, unknown>)[k]
  if (s.jumpHost) {
    const jh = { ...s.jumpHost }
    for (const k of CREDENTIAL_KEYS) delete (jh as unknown as Record<string, unknown>)[k]
    out.jumpHost = jh
  }
  return out
}

/**
 * 渲染层能看到的列表项：非敏感字段 + `hasCredential`
 *
 * @param hasCredential 主进程是否存有该服务器的凭据（口令或私钥）
 */
export function toServerListItem(s: SshConfig, hasCredential: boolean): ServerListItem {
  const stripped = stripServerCredentials(s)
  return { ...stripped, hasCredential }
}

/** 这条配置里是否真的带了凭据（空串按"没有"处理，与 SecureStore 的存入口径一致） */
export function carriesCredential(s: SshConfig): boolean {
  return Boolean(s.password || s.privateKey || s.passphrase)
}
