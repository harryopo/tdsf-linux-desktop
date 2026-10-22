/**
 * 服务器列表导入的边界校验（2026-10-21 发布前收口）
 *
 * 导入文件是外部输入，而主机列表会直接喂给 ssh2 建连、写进配置。
 * 三类必须收口：缺 host/username 的条目丢掉；端口/认证方式不接受任意值；
 * 凭据三键一律留空（导出文件本来就不含，导入更不能凭空带进来）。
 */
import { describe, it, expect } from 'vitest'
import { normalizeImportedServer } from '@main/services/storage/server-import'

describe('normalizeImportedServer', () => {
  it('合法条目保留字段，密码/私钥/口令一律清空', () => {
    const s = normalizeImportedServer(
      {
        name: '  web-1  ',
        host: ' 192.0.2.10 ',
        port: 2222,
        username: ' ops ',
        authType: 'privateKey',
        privateKeyPath: '/home/ops/.ssh/id_ed25519',
        password: 'should-not-survive',
        privateKey: 'should-not-survive',
        passphrase: 'should-not-survive',
      },
      'new-id'
    )
    expect(s).not.toBeNull()
    expect(s).toMatchObject({
      id: 'new-id',
      name: 'web-1',
      host: '192.0.2.10',
      port: 2222,
      username: 'ops',
      authType: 'privateKey',
      privateKeyPath: '/home/ops/.ssh/id_ed25519',
    })
    expect(s?.password).toBeUndefined()
    expect(s?.privateKey).toBeUndefined()
    expect(s?.passphrase).toBeUndefined()
  })

  it('缺 host 或 username 的条目返回 null', () => {
    expect(normalizeImportedServer({ username: 'root' }, 'id')).toBeNull()
    expect(normalizeImportedServer({ host: '192.0.2.10' }, 'id')).toBeNull()
    expect(normalizeImportedServer({ host: '   ', username: 'root' }, 'id')).toBeNull()
    expect(normalizeImportedServer(null, 'id')).toBeNull()
  })

  it('端口越界/非整数回落到 22，非法 authType 回落到 password', () => {
    const s = normalizeImportedServer(
      { host: 'h', username: 'u', port: 99999, authType: 'magic' },
      'id'
    )
    expect(s?.port).toBe(22)
    expect(s?.authType).toBe('password')
  })

  it('agent 认证合法，导入后仍然不携带任何凭据', () => {
    const s = normalizeImportedServer({ host: 'h', username: 'u', authType: 'agent' }, 'id')
    expect(s?.authType).toBe('agent')
    expect(s?.password).toBeUndefined()
    expect(s?.privateKey).toBeUndefined()
  })

  it('缺 name 时用 host:port 兜底，name 过长按 100 字截断', () => {
    expect(normalizeImportedServer({ host: 'h', username: 'u' }, 'id')?.name).toBe('h:22')
    const long = 'x'.repeat(200)
    expect(normalizeImportedServer({ host: 'h', username: 'u', name: long }, 'id')?.name).toHaveLength(100)
  })
})
