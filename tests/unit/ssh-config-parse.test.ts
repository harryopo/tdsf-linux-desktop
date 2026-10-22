/**
 * ~/.ssh/config 解析（2026-10-22 开源对标）
 *
 * 判据分两半：能导入的字段要准；不支持的语法要如实进 warnings，
 * 不能把 `Host *` 的全局默认或 Match 段偷偷套到某台主机上。
 */
import { describe, it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseSshConfig, readSshConfigHosts } from '@main/services/ssh/ssh-config'

const HOME = '/home/tester'

describe('parseSshConfig', () => {
  it('解析 HostName / User / Port / IdentityFile，并展开 ~', () => {
    const { hosts, warnings } = parseSshConfig(
      [
        'Host web1',
        '  HostName 192.0.2.10',
        '  User deploy',
        '  Port 2222',
        '  IdentityFile ~/.ssh/id_ed25519',
      ].join('\n'),
      HOME,
      'tester'
    )
    expect(warnings).toEqual([])
    expect(hosts).toEqual([
      {
        alias: 'web1',
        host: '192.0.2.10',
        port: 2222,
        username: 'deploy',
        identityFile: join(HOME, '.ssh', 'id_ed25519'),
      },
    ])
  })

  it('缺省值：HostName=别名、Port=22、User=当前用户', () => {
    const { hosts } = parseSshConfig('Host db\n', HOME, 'tester')
    expect(hosts[0]).toMatchObject({ alias: 'db', host: 'db', port: 22, username: 'tester' })
  })

  it('大小写不敏感，支持 Host=name 与引号路径', () => {
    const { hosts } = parseSshConfig(
      'host=quoted\nHOSTNAME "example.test"\nUSER "a b"\nIdentityFile "/keys/my key"\n',
      HOME,
      'tester'
    )
    expect(hosts[0]).toMatchObject({
      alias: 'quoted',
      host: 'example.test',
      username: 'a b',
      identityFile: '/keys/my key',
    })
  })

  it('一行多个别名各自成条', () => {
    const { hosts } = parseSshConfig('Host a b\n HostName shared.test\n', HOME, 'tester')
    expect(hosts.map((h) => h.alias)).toEqual(['a', 'b'])
    expect(hosts.every((h) => h.host === 'shared.test')).toBe(true)
  })

  it('同一别名分在多段：先出现的值优先（ssh 的 first-match 语义）', () => {
    const { hosts } = parseSshConfig(
      ['Host web', ' User first', 'Host web', ' User second', ' HostName h2'].join('\n'),
      HOME,
      'tester'
    )
    expect(hosts[0].username).toBe('first')
    expect(hosts[0].host).toBe('h2')
  })

  it('通配 Host 不展开、Match 整段跳过、Include 只告警', () => {
    const { hosts, warnings } = parseSshConfig(
      [
        'Host *',
        ' User global',
        'Host real',
        ' HostName 192.0.2.20',
        'Match host evil',
        ' User shadow',
        'Include ~/.ssh/extra',
      ].join('\n'),
      HOME,
      'tester'
    )
    expect(hosts).toHaveLength(1)
    expect(hosts[0]).toMatchObject({ alias: 'real', host: '192.0.2.20', username: 'tester' })
    expect(warnings.some((w) => w.includes('通配/否定 Host'))).toBe(true)
    expect(warnings.some((w) => w.includes('Match 段已跳过'))).toBe(true)
    expect(warnings.some((w) => w.includes('Include 未展开'))).toBe(true)
  })

  it('端口非法回落 22 并告警；注释、空行、# 在引号内不当注释', () => {
    const { hosts, warnings } = parseSshConfig(
      ['# top', 'Host x', ' Port nope # trailing', ' IdentityFile "/tmp/a#b"', ''].join('\n'),
      HOME,
      'tester'
    )
    expect(hosts[0].port).toBe(22)
    expect(hosts[0].identityFile).toBe('/tmp/a#b')
    expect(warnings.some((w) => w.includes('端口'))).toBe(true)
  })

  it('~other 与含 % 的 IdentityFile 不猜，进 warnings', () => {
    const { hosts, warnings } = parseSshConfig(
      ['Host a', ' IdentityFile ~other/id', 'Host b', ' IdentityFile %d/.ssh/id', 'Host c', ' HostName %h.example'].join('\n'),
      HOME,
      'tester'
    )
    expect(hosts.find((h) => h.alias === 'a')?.identityFile).toBeUndefined()
    expect(hosts.find((h) => h.alias === 'b')?.identityFile).toBeUndefined()
    expect(warnings.some((w) => w.includes('其他用户的主目录'))).toBe(true)
    expect(warnings.some((w) => w.includes('% 标记'))).toBe(true)
    // HostName 含 % 时仍保留该主机，但 host 回落为别名并告警
    expect(hosts.find((h) => h.alias === 'c')?.host).toBe('c')
  })

  it('ProxyJump 保留原文（导入层明确不建跳板机）', () => {
    const { hosts } = parseSshConfig('Host j\n ProxyJump bastion\n', HOME, 'tester')
    expect(hosts[0].proxyJump).toBe('bastion')
  })
})

describe('readSshConfigHosts', () => {
  it('没有配置文件时 ok=true + 一条说明（不是错误）', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'tdsf-sshcfg-'))
    try {
      const result = await readSshConfigHosts(dir, 'tester')
      expect(result.ok).toBe(true)
      expect(result.hosts).toEqual([])
      expect(result.warnings.join('')).toContain('没有找到')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('读取真实文件并解析', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'tdsf-sshcfg-'))
    try {
      await fs.mkdir(join(dir, '.ssh'))
      await fs.writeFile(join(dir, '.ssh', 'config'), 'Host prod\n HostName 192.0.2.30\n User ops\n')
      const result = await readSshConfigHosts(dir, 'tester')
      expect(result.ok).toBe(true)
      expect(result.hosts[0]).toMatchObject({ alias: 'prod', host: '192.0.2.30', username: 'ops' })
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
