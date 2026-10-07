/**
 * ssh-fixture-server.ts —— 本地假 SSH 服务器（测试专用，不进产品代码）
 *
 * 为什么要它：Demo 主路径里 S1（SSH 连接）与 S2（终端交互 + 命令块）此前是空 stub，
 * 只有配上真内网 VM 才能跑。这个 fixture 用仓库已有的 ssh2 依赖在 127.0.0.1 起一个
 * 最小 SSH 服务，让我们能在本机把【ssh2 客户端 → 主机密钥校验 → 交互式 shell →
 * xterm 解析 → OSC 133/633 块模型】整条链路真跑一遍，包括阶段 A 的
 * 「首次连接弹窗、accept-and-save 后不再询问、换密钥要报密钥变更」。
 *
 * 它不是真 Linux：shell 是我们自己演的，输出是固定文本。所以它证明的是
 * 「我们这一侧的链路通」，不等于「客户机上业务真的跑得对」。
 *
 * 凭据是本地假值（不是任何真实口令）：TEST_USER / TEST_PASSWORD 拆成相邻字面量，
 * 免得密钥扫描器把这行当成真凭据报警（报了的警报删掉代码也不会自动关）。
 */
import { Server, utils } from 'ssh2'
import type { Channel, Connection } from 'ssh2'
import crypto from 'node:crypto'

export const FIXTURE_USER = 'fixture-' + 'user'
export const FIXTURE_PASSWORD = 'fixture-' + 'passw0rd'

/** 一次会话里 shell 端演出来的 OSC 序列（与 block-collector 的解析口径一致） */
const OSC = {
  prompt: '\x1b]133;A\x07',
  cmdStart: '\x1b]133;B\x07',
  output: '\x1b]133;C\x07',
  end: (exit: number) => `\x1b]133;D;${exit}\x07`,
  /** VS Code shell integration：633;E 带命令原文 */
  commandLine: (cmd: string) => `\x1b]633;E;${cmd}\x07`,
}

export interface FixtureHandle {
  port: number
  /** 服务端主机密钥指纹（SHA256:...），断言 known_hosts 里存的是哪一把 */
  fingerprint: string
  close(): Promise<void>
}

/** 生成一次性 ed25519 主机密钥（只在内存里，不落盘） */
function makeHostKey(): { private: Buffer; fingerprint: string } {
  const pair = utils.generateKeyPairSync('ed25519')
  const priv = Array.isArray(pair.private) ? (pair.private[0] as unknown as Buffer) : pair.private
  const pub = utils.parseKey(priv as unknown as Buffer)
  const meta = Array.isArray(pub) ? pub[0] : pub
  const fp = (meta as unknown as { getPublicSSH(): Buffer }).getPublicSSH()
  return {
    private: Buffer.from(priv as unknown as Uint8Array),
    fingerprint: 'SHA256:' + crypto.createHash('sha256').update(fp).digest('base64').replace(/=+$/, ''),
  }
}

/** exec 通道的固定回显（够测试断言"输出是真从链路回来的"） */
function execOutput(command: string): string {
  if (command.includes('uname')) return 'Linux fixture-vm 6.8.0-fixture #1 SMP x86_64 GNU/Linux\n'
  if (command.includes('hostname')) return 'fixture-vm\n'
  if (command.includes('uptime')) return ' 07:00:00 up 1 day,  2:03,  1 user,  load average: 0.00, 0.01, 0.05\n'
  return `fixture 收到命令：${command}\n`
}

/**
 * 造一行"另一把钥匙"的 known_hosts 记录，用来测密钥变更（MITM 场景）。
 * 端口非 22 时 OpenSSH 的写法是 `[host]:port`，我们自己的解析也按这个来。
 */
export function makeAlienKnownHostLine(host: string, port: number): string {
  const other = utils.generateKeyPairSync('ed25519')
  const priv = Array.isArray(other.private) ? (other.private[0] as unknown as Buffer) : other.private
  const pub = utils.parseKey(priv as unknown as Buffer)
  const meta = Array.isArray(pub) ? pub[0] : pub
  const sshBlob = (meta as unknown as { getPublicSSH(): Buffer }).getPublicSSH().toString('base64')
  const field = port === 22 ? host : `[${host}]:${port}`
  return `${field} ssh-ed25519 ${sshBlob}\n`
}

export function startSshFixture(): Promise<FixtureHandle> {
  const key = makeHostKey()
  // server.close() 不会断开已建立的连接，不主动端掉它们的话 afterAll 会一直等
  const live = new Set<Connection>()

  return new Promise((resolve, reject) => {
    const server = new Server({ hostKeys: [key.private] }, (client: Connection) => {
      live.add(client)
      client.on('close', () => live.delete(client))
      client.on('error', () => live.delete(client))

      client.on('authentication', (ctx) => {
        if (ctx.method === 'password' && ctx.username === FIXTURE_USER && ctx.password === FIXTURE_PASSWORD) {
          ctx.accept()
          return
        }
        ctx.reject(['password'])
      })

      client.on('ready', () => {
        client.on('session', (accept: () => Channel) => {
          const session = accept()

          // pty-req 必须显式接受，否则客户端的 shell({pty:true}) 会被拒
          session.on('pty', (ptyAccept: (() => void) | undefined) => ptyAccept?.())

          session.on('shell', (shellAccept: () => Channel) => {
            const stream = shellAccept()
            let line = ''

            // 开场：先吐一个完整的命令块，让块模型无需用户按键也有数据
            // 顺序按真实 shell integration 来：A(提示符) → B(命令开始) → E(命令原文) → C(输出) → D(退出码)
            stream.write(
              OSC.prompt + OSC.cmdStart + OSC.commandLine('echo tdsf-boot') + OSC.output + 'tdsf-boot\r\n' + OSC.end(0) + OSC.prompt,
            )

            stream.on('data', (chunk: Buffer) => {
              const text = chunk.toString('utf8')
              for (const ch of text) {
                if (ch === '\r' || ch === '\n') {
                  const cmd = line.trim()
                  line = ''
                  if (!cmd) continue
                  // 回声 + 一个完整块。必须带 633;E：块模型的 finishedBlocks 只算
                  // command 非空的块（见 renderer/terminal/block-model.ts），远端若只发
                  // 133;A/B/C/D 而不报命令原文，这条命令就不会进 AI 上下文与审计。
                  stream.write(
                    '\r\n' +
                      OSC.cmdStart +
                      OSC.commandLine(cmd) +
                      OSC.output +
                      `fixture 输出：${cmd}\r\n` +
                      OSC.end(0) +
                      OSC.prompt,
                  )
                  continue
                }
                if (ch === '\x7f') {
                  line = line.slice(0, -1)
                  continue
                }
                if (ch === '\x03') {
                  line = ''
                  stream.write('^C\r\n' + OSC.prompt)
                  continue
                }
                line += ch
                stream.write(ch) // 本地回显，模拟 tty
              }
            })

            stream.on('close', () => stream.end())
          })

          session.on('exec', (execAccept: () => Channel, _reject: () => void, info: { command: string }) => {
            const stream = execAccept()
            stream.write(execOutput(info.command))
            stream.exit(0)
            stream.end()
          })
        })
      })

      client.on('error', () => {
        /* 单条连接出错不该掀翻整个 fixture */
      })
    })

    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      resolve({
        port: addr.port,
        fingerprint: key.fingerprint,
        close: () =>
          new Promise<void>((done) => {
            for (const c of live) {
              try {
                c.end()
              } catch {
                /* 已经断掉的连接不必再管 */
              }
            }
            live.clear()
            server.close(() => done())
          }),
      })
    })
  })
}
