/**
 * known_hosts 与真 OpenSSH 的互操作对账（A3 的参照实现那一半）
 *
 * 为什么需要这份：仓库里的 known_hosts 测试都拿 ssh2 造的密钥当被测输入，
 * 而 known_hosts 这套语义的**定义者**是 OpenSSH —— 我们自己写的行、我们自己写的匹配，
 * 只要跟 OpenSSH 的理解不一致，用户拿同一个文件去跑 ssh 就会看到"我这明明存过"。
 * 这份测试用真 OpenSSH 当裁判：它的 ssh-keyscan 提供主机密钥，它的 ssh-keygen -F 负责读回我们写的行。
 *
 * 跑法（本机 WSL 里起了真 sshd 之后）：
 *   $env:TDSF_REAL_SSHD_HOST="172.20.49.165"; $env:TDSF_REAL_SSHD_PORT="2222"
 *   pnpm test tests/unit/known-hosts-openssh-interop.test.ts
 * 没给这两个变量就整份跳过（并写明原因），不算通过也不算失败。
 *
 * 真靶子怎么来（零安装：Ubuntu-24.04 自带 /usr/sbin/sshd，普通用户就能起在非特权端口）：
 *   wsl -d Ubuntu-24.04 -- bash -lc '
 *     mkdir -p /tmp/e2e-sshd
 *     ssh-keygen -q -t ed25519 -N "" -f /tmp/e2e-sshd/host_ed25519
 *     printf "Port 2222\nHostKey /tmp/e2e-sshd/host_ed25519\nPidFile /tmp/e2e-sshd/pid\n\
 *     PermitRootLogin no\nPasswordAuthentication no\nPubkeyAuthentication yes\nUsePAM no\nStrictModes no\n" \
 *       > /tmp/e2e-sshd/config
 *     /usr/sbin/sshd -f /tmp/e2e-sshd/config'
 *   # Windows 侧的可达地址 = wsl -d Ubuntu-24.04 -- hostname -I 的第一个值（NAT 模式不是 localhost）
 *   # 用完收掉：wsl -d Ubuntu-24.04 -- kill "$(cat /tmp/e2e-sshd/pid)"
 *
 * 这份跑的是语义对账，不需要登录成功，所以不配口令、不动账号、不留密钥。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import net from 'node:net'
import path from 'node:path'
import { checkKnownHosts, replaceKnownHost } from '../../src/main/services/ssh/known-hosts'
import { generateHostKey } from '../e2e/ssh-fixture-server'

const RAW_HOST = process.env.TDSF_REAL_SSHD_HOST ?? ''
const RAW_PORT = process.env.TDSF_REAL_SSHD_PORT ?? ''
const DISTRO = process.env.TDSF_REAL_SSHD_WSL ?? 'Ubuntu-24.04'

/**
 * 参数按 fail-closed 解析：这两个值会进外部命令的参数位，
 * 不是十进制端口或带非法字符的主机名就直接判定"环境不对"，不许默认往下跑。
 */
function parseEnv(): { host: string; port: number } | null {
  if (!RAW_HOST || !RAW_PORT) return null
  if (!/^[A-Za-z0-9._:-]+$/.test(RAW_HOST)) return null
  if (!/^\d{1,5}$/.test(RAW_PORT)) return null
  const port = Number(RAW_PORT)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  return { host: RAW_HOST, port }
}

const TARGET = parseEnv()

/** Windows 路径转 WSL 挂载路径：C:\a\b -> /mnt/c/a/b */
function toWslPath(winPath: string): string {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(winPath)
  if (!m) return winPath
  return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}`
}

/** 在 WSL 里跑一条命令，参数以数组传入（不经 shell，避免把外部值拼进命令行） */
function inWsl(argv: string[]): string {
  const r = spawnSync('wsl.exe', ['-d', DISTRO, '--', ...argv], { encoding: 'utf8' })
  if (r.error) throw new Error(`wsl 调用失败：${r.error.message}`)
  return (r.stdout ?? '').replace(/\0/g, '')
}

async function tcpUp(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect(port, host)
    const done = (v: boolean): void => {
      s.destroy()
      resolve(v)
    }
    s.setTimeout(3000)
    s.on('connect', () => done(true))
    s.on('timeout', () => done(false))
    s.on('error', () => done(false))
  })
}

/** ssh-keyscan 一行：`[host]:port <type> <base64>` 或 `host <type> <base64>` */
interface Scanned {
  keyType: string
  base64: string
  blob: Buffer
}

function scanKeys(host: string, port: number): Scanned[] {
  const out = inWsl(['ssh-keyscan', '-p', String(port), host])
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const parts = l.split(/\s+/)
      const keyType = parts[1] ?? ''
      const base64 = parts[2] ?? ''
      return { keyType, base64, blob: Buffer.from(base64, 'base64') }
    })
}

/** OpenSSH 自己的读取器：-F 找得到就打印那条记录，找不到打印空 */
function opensshLookup(pattern: string, file: string): string {
  return inWsl(['ssh-keygen', '-F', pattern, '-f', file])
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .join('\n')
}

describe.skipIf(!TARGET)('known_hosts × 真 OpenSSH（A3 互操作对账）', () => {
  const host = TARGET?.host ?? ''
  const port = TARGET?.port ?? 0
  let file = ''
  let keys: Scanned[] = []

  beforeAll(async () => {
    expect(await tcpUp(host, port), `靶机 ${host}:${port} TCP 连不上（真 sshd 没起）`).toBe(true)
    keys = scanKeys(host, port)
    // 阳性对照：拿不到真密钥就是量具坏了，不许把后面几条的"没找到"当成通过
    expect(keys.length, 'ssh-keyscan 没返回任何主机密钥').toBeGreaterThan(0)
    for (const k of keys) {
      expect(k.base64.length, '扫到的记录里没有密钥体').toBeGreaterThan(20)
    }
    file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tdsf-interop-')), 'known_hosts')
    fs.writeFileSync(file, '', 'utf8')
  })

  afterAll(() => {
    if (file) fs.rmSync(path.dirname(file), { recursive: true, force: true })
  })

  it('我们写的非 22 端口那条，OpenSSH 用 [host]:port 读得回来且密钥体一致', async () => {
    const k = keys[0]!
    await replaceKnownHost(host, port, k.blob, file)

    const found = opensshLookup(`[${host}]:${port}`, toWslPath(file))
    expect(found, 'OpenSSH 读不回我们写的行').toContain(k.base64)
    expect(found.split(/\s+/)[1], '算法字段对不上').toBe(k.keyType)
  })

  it('OpenSSH 认为裸主机名不该命中非 22 端口那条 —— 我们的判定必须一样', async () => {
    const k = keys[0]!
    await replaceKnownHost(host, port, k.blob, file)

    // 参照实现的答案：端口非 22 时，裸 host 查不到
    expect(opensshLookup(host, toWslPath(file)), 'OpenSSH 自己都不认裸主机名').toBe('')
    // 我们必须在同一件事上给同一个答案（这正是 A3 修掉的端口串用漏洞）
    const via22 = await checkKnownHosts(host, 22, k.blob, file)
    expect(via22.status, '拿 :22 去查一条只存在于 :2222 的记录，不该算命中').not.toBe('match')
  })

  it('换密钥后 OpenSSH 只读得到新行（先删后加在参照实现眼里也成立）', async () => {
    const k = keys[0]!
    await replaceKnownHost(host, port, k.blob, file)
    // 「另一把钥匙」必须是真另一把：拿旧 blob 拼几个字节得到的新 blob，
    // 它的 base64 会以旧值为前缀，那这条断言就成了量具自己造的假阳性。
    const alien = generateHostKey().publicBlob
    const alienB64 = alien.toString('base64')
    expect(alienB64, '第二把钥匙与靶机那把没有区别，测不出先删后加').not.toContain(k.base64)

    await replaceKnownHost(host, port, alien, file)

    const lines = fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    expect(lines, `应只剩 1 行，实际：${lines.join(' ⏎ ')}`).toHaveLength(1)

    const found = opensshLookup(`[${host}]:${port}`, toWslPath(file))
    expect(found, '旧指纹还留在 OpenSSH 读得到的行里').not.toContain(k.base64)
    expect(found, 'OpenSSH 该读得到新行').toContain(alienB64)
    expect((await checkKnownHosts(host, port, k.blob, file)).status, '旧钥匙再来该报密钥不符').toBe('mismatch')
  })

  it('反向也不能串：只存了 22 端口的记录，拿 2222 去查不该算命中', async () => {
    const k = keys[0]!
    const p22 = path.join(path.dirname(file), 'port22_known_hosts')
    fs.writeFileSync(p22, '', 'utf8')
    await replaceKnownHost(host, 22, k.blob, p22)

    // 参照实现的答案：这条记录只属于裸名（22），[host]:2222 查不到
    expect(opensshLookup(`[${host}]:2222`, toWslPath(p22)), 'OpenSSH 认为这条记录不属于 2222').toBe('')
    // A3 修的就是这个方向：候选里混进裸主机名会让 :22 的钥匙去给别的端口作证
    expect(
      (await checkKnownHosts(host, 2222, k.blob, p22)).status,
      '拿 :22 的记录去套 :2222 不该算命中'
    ).not.toBe('match')
  })

  it('真机首连给的是 not-found，认下之后再连才是 match（A2 的三态在真密钥上同样成立）', async () => {
    const k = keys[0]!
    const fresh = path.join(path.dirname(file), 'fresh_known_hosts')
    fs.writeFileSync(fresh, '', 'utf8')

    expect((await checkKnownHosts(host, port, k.blob, fresh)).status, '首连必须报 not-found').toBe('not-found')
    await replaceKnownHost(host, port, k.blob, fresh)
    expect((await checkKnownHosts(host, port, k.blob, fresh)).status, '认下之后再连应 match').toBe('match')
  })
})

/** 没起真 sshd 时整份是 skip（不是通过），前置条件与跑法见文件头 */
