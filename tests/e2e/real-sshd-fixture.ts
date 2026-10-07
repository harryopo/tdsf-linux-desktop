/**
 * 真 OpenSSH 靶子的共用夹具（两份 real-* spec 与一份单测共用）
 *
 * 为什么要抽出来：这两个文件原先各写各的临时密钥路径，一次清理就把它俩分到了不同目录，
 * 结果一份在跑、另一份悄悄变成 skip —— 漂移的根源是"同一个约定写了两遍"。
 *
 * 靶子怎么起（零安装；本机 WSL 的 Ubuntu-24.04 自带 sshd，普通用户即可，不需要 root/sudo）：
 *   1) 给跳板与目标各生成一把**不同**的主机密钥（ed25519 / rsa），
 *      生成一份一次性客户端密钥到 /tmp/e2e-sshd-client
 *   2) 两份 config：Port 2222 / Port 2224、HostKey 各自、PidFile、
 *      PasswordAuthentication no、PubkeyAuthentication yes、UsePAM no、StrictModes no、
 *      AuthorizedKeysFile 指向 /tmp 下自己那份（**绝不写 ~/.ssh/authorized_keys**）、
 *      跳板那份再开 AllowTcpForwarding yes
 *   3) /usr/sbin/sshd -t -f config 先校一遍，再 /usr/sbin/sshd -f config 起
 *   4) Windows 侧地址用 `wsl -d Ubuntu-24.04 -- hostname -I` 的第一个 IP（WSL2 是 NAT，不是 localhost）
 *   5) 用完：kill $(cat /tmp/e2e-sshd-b/pid)；kill $(cat /tmp/e2e-sshd-t/pid)；rm -rf /tmp/e2e-sshd-* /tmp/e2e-sshd-client*
 *
 * 约定死的三件事（两份 real-* spec 与那份单测都按这套读）：
 *   - 跳板 2222、目标 2224，两把主机密钥不同（否则测不出"每一跳各自校验"）
 *   - 一次性客户端私钥固定在 /tmp/e2e-sshd-client
 *   - 全程不写 ~/.ssh、不设口令
 *
 * 起之前先看端口有没有被上一轮残留占着：`ss -ltn | grep -E ':2222|:2224'`。
 * 残留会伪装成"起成功了"——新进程绑不上端口就退出，而端口仍然亮着。
 */
import { execFileSync } from 'node:child_process'

export const KEY_IN_WSL = '/tmp/e2e-sshd-client'
export const DEFAULT_DISTRO = 'Ubuntu-24.04'

/** 在 WSL 里跑一条命令：参数按数组传，不经 shell，避免把外部值拼进命令行 */
export function wsl(distro: string, argv: string[]): string {
  return execFileSync('wsl.exe', ['-d', distro, '--', ...argv], {
    encoding: 'utf8',
    maxBuffer: 1 << 20,
  }).replace(/\0/g, '')
}

/** 一次性客户端私钥内容（在 /tmp 下，删净即无痕） */
export function readClientKey(distro = DEFAULT_DISTRO): string {
  return wsl(distro, ['cat', KEY_IN_WSL]).replace(/\r/g, '')
}

/** Windows 路径 → WSL 挂载路径（C:\a\b → /mnt/c/a/b），让 OpenSSH 能读我们写的文件 */
export function toWslPath(winPath: string): string {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(winPath)
  if (!m) return winPath
  return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}`
}

/** OpenSSH 自己的扫描器：拿一台真服务端在某个端口上的主机密钥行 */
export function scanHostLine(host: string, port: number, distro = DEFAULT_DISTRO): string | null {
  const out = wsl(distro, ['ssh-keyscan', '-p', String(port), host])
  const line = out
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#'))
  return line ?? null
}

/** OpenSSH 自己的读取器：-F 找得到就打印那条记录，找不到就是空 */
export function opensshLookup(pattern: string, wslFilePath: string, distro = DEFAULT_DISTRO): string {
  return wsl(distro, ['ssh-keygen', '-F', pattern, '-f', wslFilePath])
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .join('\n')
}

/** 主机名/端口必须是干净值才允许拿去连；否则当"环境没配好"处理 */
export function parseTarget(rawHost: string | undefined, rawPort: string | undefined): { host: string; port: number } | null {
  const host = (rawHost ?? '').trim()
  const port = (rawPort ?? '').trim()
  if (!/^[A-Za-z0-9._-]+$/.test(host)) return null
  if (!/^\d{1,5}$/.test(port)) return null
  const n = Number(port)
  if (!Number.isInteger(n) || n < 1 || n > 65535) return null
  return { host, port: n }
}
