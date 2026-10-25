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

/** 决定"凭据会被发往哪台机/走哪条链路"的字段 */
const IDENTITY_KEYS = ['host', 'username', 'authType', 'privateKeyPath'] as const

/** SshConfig 与 jumpHost 两层的公共身份字段 */
interface ConnectionIdentity {
  host: string
  port: number
  username: string
  authType: string
  privateKeyPath?: string
}

function sameIdentity(a: ConnectionIdentity, b: ConnectionIdentity): boolean {
  if (Number(a.port ?? 22) !== Number(b.port ?? 22)) return false
  for (const k of IDENTITY_KEYS) {
    // 空串与 undefined 都表示"没填"，视为相同；否则表单序列化一轮就会误判成换机
    if ((a[k] ?? '') !== (b[k] ?? '')) {
      return false
    }
  }
  return true
}

/**
 * 同一条 id 的配置，是不是被改成了"另一台机"。
 *
 * 为什么要这条判据：口令/私钥存在 SecureStore 里、按 id 取用。渲染层能改 host 却拿不到凭据，
 * 于是"把 host 改成攻击者机器 → 再按 id 连接"就成了一条把已存凭据送出去的现成路径。
 * 换机（含换跳板机）时必须让旧凭据失效，除非这次保存同时带来了新凭据。
 *
 * 只改名字、保活、超时这类不改路由的字段不算换机。
 */
export function connectionIdentityChanged(before: SshConfig, after: SshConfig): boolean {
  if (!sameIdentity(before, after)) return true
  if (Boolean(before.jumpHost) !== Boolean(after.jumpHost)) return true
  if (before.jumpHost && after.jumpHost && !sameIdentity(before.jumpHost, after.jumpHost)) {
    return true
  }
  return false
}

/**
 * 剥掉服务器条目里的安全开关（strictHostKeyCheck / knownHostsPath）。
 *
 * 这两项属于设置页的**全局默认值**（`sshDefaults`），不属于单台服务器。
 * 允许它们随服务器条目落库，等于给渲染层留了一个"把严格主机密钥校验关掉"的写入口——
 * 再配合改 host，就是一条不需要用户看见的中间人通道。
 */
export function stripServerSecurityOverrides(s: SshConfig): SshConfig {
  const out: SshConfig = { ...s }
  delete out.strictHostKeyCheck
  delete out.knownHostsPath
  if (out.jumpHost) {
    const jh = { ...out.jumpHost }
    delete jh.strictHostKeyCheck
    delete jh.knownHostsPath
    out.jumpHost = jh
  }
  return out
}
