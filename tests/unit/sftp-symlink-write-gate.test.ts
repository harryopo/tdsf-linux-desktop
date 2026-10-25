/**
 * SFTP 写目的地的符号链接闸（#237）
 *
 * 病根：字符串闸只看路径长相。`/home/u/notes -> /etc/passwd` 这条路径不在任何受保护前缀下，
 * 写下去却落进 /etc —— 命令闸拦住的 `echo x > /etc/passwd`，从文件面板/编辑器/AI 写文件
 * 这条路照样能走通。
 *
 * 这里钉的是"写之前先问远端这个路径最终指向哪"这条判据本身：
 * 目标存在就以 realpath(目标) 为准，目标不存在就以 realpath(父目录) + 文件名 为准。
 */
import { describe, it, expect } from 'vitest'
import {
  assertRemoteWriteAllowed,
  assertRemoteWriteAllowedResolved,
} from '../../src/main/services/ssh/remote-write-guard'

/** 造一个按表解析的 realpath：没列出来的路径就按"不存在"抛错（与远端行为一致） */
function fakeRealpath(table: Record<string, string>): (p: string) => Promise<string> {
  return async (p) => {
    if (Object.prototype.hasOwnProperty.call(table, p)) return table[p]
    throw new Error(`ENOENT: ${p}`)
  }
}

describe('符号链接写闸（#237）', () => {
  it('目标本身是符号链接 → 拒绝（realpath 已解析到 /etc/passwd）', async () => {
    const realpath = fakeRealpath({
      '/home/harry/notes': '/etc/passwd',
      '/home/harry': '/home/harry',
    })
    await expect(
      assertRemoteWriteAllowedResolved('写入', '/home/harry/notes', realpath)
    ).rejects.toThrow(/符号链接不能绕过/)
  })

  it('目标不存在但父目录是指向 /etc 的符号链接 → 拒绝', async () => {
    const realpath = fakeRealpath({
      '/home/harry/linkdir': '/etc',
      '/home/harry': '/home/harry',
    })
    await expect(
      assertRemoteWriteAllowedResolved('写入', '/home/harry/linkdir/new.conf', realpath)
    ).rejects.toThrow(/实际指向 \/etc/)
  })

  it('普通文件（目标存在、真身不在保护区）→ 放行', async () => {
    const realpath = fakeRealpath({
      '/home/harry/notes.md': '/home/harry/notes.md',
      '/home/harry': '/home/harry',
    })
    await expect(
      assertRemoteWriteAllowedResolved('写入', '/home/harry/notes.md', realpath)
    ).resolves.toBeUndefined()
  })

  it('普通新文件（父目录正常）→ 放行', async () => {
    const realpath = fakeRealpath({ '/home/harry': '/home/harry' })
    await expect(
      assertRemoteWriteAllowedResolved('写入', '/home/harry/new.md', realpath)
    ).resolves.toBeUndefined()
  })

  it('目标与父目录都解析不出来 → 不在这里另造错误（底层写会报 ENOENT）', async () => {
    const realpath = fakeRealpath({})
    await expect(
      assertRemoteWriteAllowedResolved('写入', '/nope/a.md', realpath)
    ).resolves.toBeUndefined()
  })

  it('正对照：字符串闸本身仍拦 /etc/passwd（解析之前就挡掉，省一次往返）', () => {
    expect(() => assertRemoteWriteAllowed('写入', '/etc/passwd')).toThrow(/系统关键路径/)
    expect(() => assertRemoteWriteAllowed('写入', '/home/harry/notes.md')).not.toThrow()
  })
})
