/**
 * 契约扩面第一批的形状判据（2026-10-21 全维度审查 B1）
 *
 * SSH 执行、SFTP 改写、拦截记录此前只有 TS 签名：运行时传歪了主进程照收。
 * 这里钉住新登记的 schema：正确形状放行；类型错、必填缺失、mode 越界当场抛。
 */
import { describe, it, expect } from 'vitest'
import { assertContractArgs } from '@shared/ipc-contract'

describe('新契约拒绝错误形状', () => {
  it('sshExec：sessionId / command 必须是字符串', () => {
    expect(() => assertContractArgs('sshExec', ['s1', 'df -h'])).not.toThrow()
    expect(() => assertContractArgs('sshExec', ['s1', 42])).toThrow()
    expect(() => assertContractArgs('sshExec', ['s1'])).toThrow()
  })

  it('sftpWriteFile：三个位置都必填', () => {
    expect(() => assertContractArgs('sftpWriteFile', ['s1', '/tmp/a', 'x'])).not.toThrow()
    expect(() => assertContractArgs('sftpWriteFile', ['s1', '/tmp/a'])).toThrow()
  })

  it('sftpChmod：mode 必须是 0..0o7777 的整数', () => {
    expect(() => assertContractArgs('sftpChmod', ['s1', '/tmp/a', 0o644])).not.toThrow()
    expect(() => assertContractArgs('sftpChmod', ['s1', '/tmp/a', 99999])).toThrow()
    expect(() => assertContractArgs('sftpChmod', ['s1', '/tmp/a', 1.5])).toThrow()
  })

  it('sftpList / sftpReadFile：sessionId 与 remotePath 都必填', () => {
    expect(() => assertContractArgs('sftpList', ['s1', '/tmp'])).not.toThrow()
    expect(() => assertContractArgs('sftpList', ['s1'])).toThrow()
    expect(() => assertContractArgs('sftpReadFile', ['s1', '/tmp/a'])).not.toThrow()
    expect(() => assertContractArgs('sftpReadFile', [null, '/tmp/a'])).toThrow()
  })

  it('sftpUpload：transferId 可省略，给了必须是字符串', () => {
    expect(() => assertContractArgs('sftpUpload', ['s1', '/tmp', undefined])).not.toThrow()
    expect(() => assertContractArgs('sftpUpload', ['s1', '/tmp', 't1'])).not.toThrow()
    expect(() => assertContractArgs('sftpUpload', ['s1', '/tmp', 1])).toThrow()
  })

  it('sshGenerateKeypair：类型只认 ed25519 / rsa', () => {
    expect(() =>
      assertContractArgs('sshGenerateKeypair', [{ type: 'ed25519', name: 'id_x' }])
    ).not.toThrow()
    expect(() =>
      assertContractArgs('sshGenerateKeypair', [{ type: 'dsa', name: 'id_x' }])
    ).toThrow()
  })

  it('historyBlocks：limit 可省略，但给了就必须是整数', () => {
    expect(() => assertContractArgs('historyBlocks', [])).not.toThrow()
    expect(() => assertContractArgs('historyBlocks', [20])).not.toThrow()
    expect(() => assertContractArgs('historyBlocks', [1.5])).toThrow()
  })
})
