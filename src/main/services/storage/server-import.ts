/**
 * 服务器列表导入的逐条校验（纯函数，不碰 electron-store）
 *
 * 文件来自用户手选，内容仍是外部输入：类型、端口范围、认证方式都要收口，
 * 凭据一律留空。独立成模块是为了能直接单测，不用把 electron-store 拖进测试。
 */
import type { SshConfig } from '@shared/models'

export function normalizeImportedServer(item: unknown, newId: string): SshConfig | null {
  const s = (item ?? {}) as Partial<SshConfig>
  if (typeof s.host !== 'string' || !s.host.trim()) return null
  if (typeof s.username !== 'string' || !s.username.trim()) return null
  const port =
    typeof s.port === 'number' && Number.isInteger(s.port) && s.port >= 1 && s.port <= 65535
      ? s.port
      : 22
  return {
    id: newId,
    name:
      typeof s.name === 'string' && s.name.trim()
        ? s.name.trim().slice(0, 100)
        : `${s.host.trim()}:${port}`,
    host: s.host.trim(),
    port,
    username: s.username.trim(),
    authType: s.authType === 'privateKey' ? 'privateKey' : 'password',
    privateKeyPath: typeof s.privateKeyPath === 'string' ? s.privateKeyPath : undefined,
    keepAlive: typeof s.keepAlive === 'boolean' ? s.keepAlive : undefined,
    // 敏感信息留空，需要用户重新输入
    password: undefined,
    privateKey: undefined,
    passphrase: undefined,
  }
}
