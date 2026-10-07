/**
 * fixture 靶机自环测试（不回 Electron，只用 ssh2 客户端连自己起的假服务器）
 *
 * 为什么要单独一条：ssh-fixture.spec.ts 里 F2 断言失败时，得先分清是
 * 「app 这一侧链路没通」还是「fixture 自己就没按 OSC 协议吐字」。
 * 没有这条对照，产品测试红了也不知道该改哪边。
 */
import { describe, it, expect, afterAll } from 'vitest'
import { Client } from 'ssh2'
import { FIXTURE_PASSWORD, FIXTURE_USER, startSshFixture } from '../e2e/ssh-fixture-server'
import type { FixtureHandle } from '../e2e/ssh-fixture-server'

let fixture: FixtureHandle | null = null

async function openShell(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const conn = new Client()
    let collected = ''
    conn
      .on('ready', () => {
        conn.shell('xterm-256color', { rows: 24, cols: 80, term: 'xterm-256color' }, (err, stream) => {
          if (err) return reject(err)
          stream.on('data', (buf: Buffer) => {
            collected += buf.toString('utf8')
            // 开场块 + 一条按键回显块都到位后再收
            if ((collected.match(/\x1b\]133;D/g) ?? []).length >= 2) {
              stream.end()
              conn.end()
            }
          })
          stream.on('close', () => resolve(collected))
          stream.on('error', reject)
          // 敲一条命令，验证 tty 回显 + Enter 后成块
          setTimeout(() => stream.write('uptime\r'), 200)
          setTimeout(() => resolve(collected), 4000)
        })
      })
      .on('error', reject)
      .connect({ host: '127.0.0.1', port, username: FIXTURE_USER, password: FIXTURE_PASSWORD, readyTimeout: 5000 })
  })
}

describe('fixture SSH 靶机（本地自环）', () => {
  afterAll(async () => {
    await fixture?.close()
    fixture = null
  })

  it('起得来、能握手、密码对得上', async () => {
    fixture = await startSshFixture()
    expect(fixture.port, '应监听到一个端口').toBeGreaterThan(0)
    expect(fixture.fingerprint, '指纹应是 OpenSSH 的 SHA256 形式').toMatch(/^SHA256:[A-Za-z0-9+/]+$/)
  })

  it('shell 一开场就吐一个完整 OSC 133 块，敲命令后再吐一个', async () => {
    const f = fixture ?? (await startSshFixture())
    fixture = f
    const raw = await openShell(f.port)

    expect(raw, '应带提示符开始 133;A').toContain('\x1b]133;A')
    expect(raw, '应带命令开始 133;B').toContain('\x1b]133;B')
    expect(raw, '应带命令原文 633;E').toContain('\x1b]633;E;echo tdsf-boot')
    // 块模型只把"有命令原文"的块算成一条命令（finishedBlocks 过滤 command!==null），
    // 所以敲出来的那条也必须带 633;E，否则产品侧计数不会涨
    expect(raw, '按键命令也要报 633;E 原文').toContain('\x1b]633;E;uptime')
    expect(raw, '应带输出起点 133;C').toContain('\x1b]133;C')
    expect(raw, '应带退出码 133;D;0').toContain('\x1b]133;D;0')
    expect(raw, '按键要回显（tty 行为）').toContain('uptime')
    expect((raw.match(/\x1b\]133;D/g) ?? []).length, '至少两个已结束的命令块').toBeGreaterThanOrEqual(2)
  })

  it('exec 通道按命令给出可断言的真实格式输出', async () => {
    const f = fixture ?? (await startSshFixture())
    fixture = f
    const out = await new Promise<string>((resolve, reject) => {
      const conn = new Client()
      conn
        .on('ready', () => {
          conn.exec('uname -a', (err, stream) => {
            if (err) return reject(err)
            let s = ''
            stream.on('data', (b: Buffer) => { s += b.toString('utf8') })
            stream.on('close', () => { conn.end(); resolve(s) })
          })
        })
        .on('error', reject)
        .connect({ host: '127.0.0.1', port: f.port, username: FIXTURE_USER, password: FIXTURE_PASSWORD, readyTimeout: 5000 })
    })
    expect(out, 'uname 输出必须含 Linux（与产品断言口径一致）').toContain('Linux')
  })
})
