/**
 * ~/.ssh/config 的只读解析（不做 IO 的纯函数 + 一个读文件入口）
 *
 * 目标是把用户已有的 Host 别名搬进服务器列表，不是替代 OpenSSH。
 * 明确边界（都会以 warnings 告诉界面，不假装支持）：
 * - 通配 Host / 否定模式：不展开，也不套用 `Host *` 的全局默认
 * - Match 段：整段跳过（`Match exec` 会执行命令，不能碰）
 * - Include：不展开（避免递归读任意路径）
 * - ProxyJump：只回报原文，不导入跳板机（跳板机凭据/认证方式无法从配置里安全还原）
 */
import { promises as fs } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type { SshConfigHost, SshConfigScanResult } from '@shared/ssh-config-types'

const MAX_CONFIG_BYTES = 1024 * 1024

function currentUserName(): string {
  try {
    return userInfo().username
  } catch {
    return process.env.USER || process.env.USERNAME || 'root'
  }
}

interface BlockValues {
  hostName?: string
  user?: string
  port?: number
  identityFile?: string
  proxyJump?: string
}

interface Entry extends SshConfigHost {
  filled: Set<keyof BlockValues>
}

function stripComment(line: string): string {
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') inQuote = !inQuote
    else if (ch === '#' && !inQuote) return line.slice(0, i)
  }
  return line
}

/** 按空白切分，双引号内的空白保留；`Host=a` 这种等号写法也认 */
function tokenizeArgs(input: string): string[] {
  const args: string[] = []
  let current = ''
  let inQuote = false
  for (const ch of input) {
    if (ch === '"') {
      inQuote = !inQuote
      continue
    }
    if (!inQuote && /\s/.test(ch)) {
      if (current) {
        args.push(current)
        current = ''
      }
      continue
    }
    current += ch
  }
  if (current) args.push(current)
  return args
}

function splitKey(line: string): { key: string; rest: string } {
  const eq = line.indexOf('=')
  const ws = line.search(/\s/)
  if (eq !== -1 && (ws === -1 || eq < ws)) {
    return { key: line.slice(0, eq).trim().toLowerCase(), rest: line.slice(eq + 1).trim() }
  }
  if (ws === -1) return { key: line.trim().toLowerCase(), rest: '' }
  return { key: line.slice(0, ws).toLowerCase(), rest: line.slice(ws + 1).trim().replace(/^=\s*/, '') }
}

function isConcreteAlias(alias: string): boolean {
  return alias.length > 0 && !/[*?!]/.test(alias) && !alias.includes('%')
}

function expandHomePath(value: string, homeDir: string, warn: (msg: string) => void): string | undefined {
  if (value === '~') return homeDir
  if (value.startsWith('~/')) return join(homeDir, value.slice(2))
  if (value.startsWith('~')) {
    warn(`IdentityFile「${value}」使用了其他用户的主目录，未导入`)
    return undefined
  }
  if (value.includes('%')) {
    warn(`IdentityFile「${value}」包含无法静态展开的 % 标记，未导入`)
    return undefined
  }
  return isAbsolute(value) ? value : join(homeDir, '.ssh', value)
}

export function parseSshConfig(
  text: string,
  homeDir: string,
  defaultUser: string
): { hosts: SshConfigHost[]; warnings: string[] } {
  const entries = new Map<string, Entry>()
  const warnings: string[] = []
  const warn = (msg: string): void => {
    if (!warnings.includes(msg)) warnings.push(msg)
  }

  let aliases: string[] = []
  let block: BlockValues = {}
  let inMatch = false

  const commit = (): void => {
    for (const alias of aliases) {
      let entry = entries.get(alias)
      if (!entry) {
        entry = {
          alias,
          host: alias,
          port: 22,
          username: defaultUser,
          filled: new Set(),
        }
        entries.set(alias, entry)
      }
      if (!entry.filled.has('hostName') && block.hostName) {
        if (block.hostName.includes('%')) {
          warn(`Host「${alias}」的 HostName 含 % 标记，已按别名 ${alias} 导入，可能需要手动改`)
        } else {
          entry.host = block.hostName
        }
        entry.filled.add('hostName')
      }
      if (!entry.filled.has('user') && block.user) {
        entry.username = block.user
        entry.filled.add('user')
      }
      if (!entry.filled.has('port') && block.port) {
        entry.port = block.port
        entry.filled.add('port')
      }
      if (!entry.filled.has('identityFile') && block.identityFile) {
        const expanded = expandHomePath(block.identityFile, homeDir, warn)
        if (expanded) entry.identityFile = expanded
        entry.filled.add('identityFile')
      }
      if (!entry.filled.has('proxyJump') && block.proxyJump) {
        entry.proxyJump = block.proxyJump
        entry.filled.add('proxyJump')
      }
    }
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim()
    if (!line) continue
    const { key, rest } = splitKey(line)
    const args = tokenizeArgs(rest)

    if (key === 'host') {
      commit()
      block = {}
      inMatch = false
      aliases = []
      for (const alias of args) {
        if (isConcreteAlias(alias)) {
          aliases.push(alias)
        } else {
          warn(`通配/否定 Host「${alias}」已跳过；其全局默认不会套用到其他主机`)
        }
      }
      continue
    }
    if (key === 'match') {
      commit()
      block = {}
      aliases = []
      inMatch = true
      warn('Match 段已跳过（Match exec 可能执行命令，不做静态展开）')
      continue
    }
    if (key === 'include') {
      warn('Include 未展开，配置里被包含的主机不会出现在导入列表')
      continue
    }
    if (inMatch || aliases.length === 0) continue

    const value = args[0]
    if (!value) continue
    if (key === 'hostname') block.hostName = value
    else if (key === 'user') block.user = value
    else if (key === 'identityfile') block.identityFile = value
    else if (key === 'proxyjump') block.proxyJump = value === 'none' ? undefined : value
    else if (key === 'port') {
      const port = Number(value)
      if (Number.isInteger(port) && port >= 1 && port <= 65535) block.port = port
      else warn(`Host「${aliases.join(' ')}」的端口「${value}」非法，按 22 导入`)
    }
  }
  commit()

  const hosts = [...entries.values()].map(({ filled, ...host }) => {
    void filled
    return host
  })
  return { hosts, warnings }
}

export async function readSshConfigHosts(
  homeDir: string = homedir(),
  defaultUser: string = currentUserName()
): Promise<SshConfigScanResult> {
  const configPath = join(homeDir, '.ssh', 'config')
  try {
    const stat = await fs.stat(configPath)
    if (stat.size > MAX_CONFIG_BYTES) {
      return { ok: false, path: configPath, hosts: [], warnings: [], error: '配置文件超过 1MB，拒绝读取' }
    }
    const parsed = parseSshConfig(await fs.readFile(configPath, 'utf8'), homeDir, defaultUser)
    return { ok: true, path: configPath, ...parsed }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return { ok: true, path: configPath, hosts: [], warnings: ['没有找到 ~/.ssh/config'] }
    }
    return {
      ok: false,
      path: configPath,
      hosts: [],
      warnings: [],
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
