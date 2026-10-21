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

  it('historyBlocks：limit 可省略，但给了就必须是整数', () => {
    expect(() => assertContractArgs('historyBlocks', [])).not.toThrow()
    expect(() => assertContractArgs('historyBlocks', [20])).not.toThrow()
    expect(() => assertContractArgs('historyBlocks', [1.5])).toThrow()
  })
})
