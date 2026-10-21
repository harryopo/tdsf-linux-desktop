/**
 * UI 文件面板走的 Electerm SFTP 也要有超时（2026-10-21 全维度审查 C1）
 *
 * SftpManager 有 20/60/30s 预算，但 ipc/ssh.ts 实际用的是 ElectermSftpManager，
 * 半开连接上 ssh2 回调永远不回来 ⇒ 文件面板永久转圈。这里用假连接 +
 * 假定时器证明"建立 SFTP 通道"和"元数据操作"都会在预算到达时报错。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { ElectermSftpManager } from '../../src/main/services/ssh/electerm-sftp'
import { SshConnectionManager } from '../../src/main/services/ssh/connection-manager'

function managerWithClient(client: Record<string, unknown>): ElectermSftpManager {
  const fake = Object.create(SshConnectionManager.prototype) as SshConnectionManager
  fake.getClient = (() => client) as unknown as SshConnectionManager['getClient']
  fake.onStateChanged = (() => () => undefined) as unknown as SshConnectionManager['onStateChanged']
  return new ElectermSftpManager(fake)
}

afterEach(() => {
  vi.useRealTimers()
})

describe('Electerm SFTP 预算', () => {
  it('SFTP 通道握手不返回：20 秒后失败，而不是永久挂住', async () => {
    vi.useFakeTimers()
    // sftp(cb) 永不回调：模拟半开连接
    const m = managerWithClient({ sftp: () => undefined })
    const pending = m.list('s1', '/tmp')
    const assertion = expect(pending).rejects.toThrow(/建立 SFTP 通道超时/)
    await vi.advanceTimersByTimeAsync(20_500)
    await assertion
  })

  it('元数据回调不返回：同样有预算', async () => {
    vi.useFakeTimers()
    const client = {
      sftp: (cb: (err: Error | null, sftp: unknown) => void) =>
        cb(null, { readdir: () => undefined }),
    }
    const m = managerWithClient(client)
    const pending = m.list('s1', '/tmp')
    const assertion = expect(pending).rejects.toThrow(/列出目录 .*超时/)
    await vi.advanceTimersByTimeAsync(20_500)
    await assertion
  })
})
