/**
 * known_hosts 主机密钥校验模块（Phase L）
 *
 * 参考：electerm/src/app/server/ssh-known-hosts.js（MIT License）
 * 用 TypeScript 重写，不直接复制。
 *
 * 核心功能：
 * 1. checkKnownHosts      — 检查主机密钥是否在 known_hosts 中
 * 2. appendKnownHost      — 追加主机密钥到 known_hosts
 * 3. replaceKnownHost     — 替换已知主机密钥（先删后加）
 * 4. createHostVerifier   — 创建 ssh2 Client hostVerifier 回调（首次连接弹窗确认）
 * 5. buildUnknownHostPrompt       — 构建首次连接提示信息
 * 6. buildHostKeyChangedPrompt    — 构建密钥变更提示信息
 *
 * known_hosts 文件格式（OpenSSH 兼容）：
 *   - 明文条目：`hostname keyType keyData`
 *   - 端口非 22：`[hostname]:port keyType keyData`
 *   - 哈希条目：`|1|salt_base64|hash_base64 keyType keyData`
 *   - revoked：`@revoked hostname keyType keyData`
 *   - 主机名可以是逗号分隔列表：`host1,host2 keyType keyData`
 *
 * SHA256 指纹格式（OpenSSH 兼容）：`SHA256:base64`
 */

import crypto, { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { utils, type HostVerifier, type VerifyCallback } from 'ssh2'

import type {
  SshHostKeyCheckResult,
  SshHostKeyMeta,
  SshHostKeyPromptEvent,
  SshHostKeyResponseAction,
} from '@shared/models'

// ============================================================================
// 常量
// ============================================================================

/** 默认 known_hosts 相对路径（相对 $HOME） */
const DEFAULT_KNOWN_HOSTS_RELATIVE = '.ssh/known_hosts'

/** known_hosts 文件默认权限（仅 owner 可读写） */
const KNOWN_HOSTS_FILE_MODE = 0o600

/** .ssh 目录默认权限（仅 owner 可读写执行） */
const SSH_DIR_MODE = 0o700

// ============================================================================
// 内部类型
// ============================================================================

/** 解析后的 known_hosts 行 */
interface ParsedKnownHostLine {
  /** marker：@revoked / @cert-authority / undefined */
  marker?: string
  /** 主机名列表（可能是明文或哈希条目 |1|salt|hash） */
  hostnames: string[]
  /** 密钥类型，如 'ssh-ed25519' */
  keyType: string
  /** base64 编码的公钥数据 */
  keyData: string
  /** 原始行内容 */
  rawLine: string
}

/** createHostVerifier 配置 */
export interface CreateHostVerifierOptions {
  /** 主机地址 */
  host: string
  /** 端口 */
  port: number
  /** 会话 ID（用于关联弹窗事件） */
  sessionId: string
  /** 服务器 ID（对应 SshConfig.id） */
  serverId: string
  /** known_hosts 文件路径（不传默认 ~/.ssh/known_hosts） */
  knownHostsPath?: string
  /**
   * 弹窗确认回调（由 IPC 层注入，推送 SshHostKeyPromptEvent 到渲染进程）
   * 返回用户选择的动作
   */
  confirm: (prompt: SshHostKeyPromptEvent) => Promise<SshHostKeyResponseAction>
  /** 错误回调（可选，hostVerifier 内部异常时调用） */
  onError?: (error: Error) => void
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 去除主机地址的方括号
 *
 * `[192.168.1.1]` → `192.168.1.1`
 * `[::1]` → `::1`
 */
function normalizeHost(host: string): string {
  if (host.startsWith('[') && host.endsWith(']')) {
    return host.slice(1, -1)
  }
  return host
}

/**
 * 解析 known_hosts 文件路径
 *
 * - 支持 `~` 展开（`~/.ssh/known_hosts` → `$HOME/.ssh/known_hosts`）
 * - 不传时默认 `~/.ssh/known_hosts`
 * - Windows 路径兼容（path.join 自动处理分隔符）
 */
export function resolveKnownHostsPath(knownHostsPath?: string): string {
  const p = (knownHostsPath ?? '').trim() || `~/${DEFAULT_KNOWN_HOSTS_RELATIVE}`
  if (p === '~') {
    return os.homedir()
  }
  if (p.startsWith('~/')) {
    return path.join(os.homedir(), p.slice(2))
  }
  if (p.startsWith('~\\')) {
    return path.join(os.homedir(), p.slice(2))
  }
  return path.resolve(p)
}

/**
 * 确保 known_hosts 文件存在
 *
 * 文件不存在时自动创建：
 * 1. mkdir -p dirname（权限 0700）
 * 2. touch file（权限 0600，空文件）
 */
async function ensureKnownHostsFile(filePath: string): Promise<void> {
  try {
    await fs.access(filePath)
  } catch {
    const dir = path.dirname(filePath)
    await fs.mkdir(dir, { recursive: true, mode: SSH_DIR_MODE })
    await fs.writeFile(filePath, '', { mode: KNOWN_HOSTS_FILE_MODE })
  }
}

/**
 * 生成 known_hosts 匹配候选主机名列表
 *
 * - 端口 22：`[hostname]`
 * - 端口非 22：`[hostname, [hostname]:port]`（兼容两种保存格式）
 */
function getKnownHostCandidates(host: string, port: number): string[] {
  const normalized = normalizeHost(host)
  const candidates: string[] = [normalized]
  if (port !== 22) {
    candidates.push(`[${normalized}]:${port}`)
  }
  return candidates
}

/**
 * 检查哈希主机名条目是否匹配候选主机名
 *
 * 哈希条目格式：`|1|salt_base64|hash_base64`
 * 算法：HMAC-SHA1(salt, hostname) → base64，比对 hash
 */
function matchesHashedHost(hashedEntry: string, candidate: string): boolean {
  const parts = hashedEntry.split('|')
  // 格式：['', '1', 'salt_base64', 'hash_base64']
  if (parts.length !== 4 || parts[1] !== '1') {
    return false
  }
  try {
    const salt = Buffer.from(parts[2], 'base64')
    const expectedHash = Buffer.from(parts[3], 'base64')
    const computed = crypto.createHmac('sha1', salt).update(candidate).digest()
    return computed.equals(expectedHash)
  } catch {
    return false
  }
}

/**
 * 解析 known_hosts 单行
 *
 * 支持格式：
 *   - `hostname keyType keyData`
 *   - `@revoked hostname keyType keyData`
 *   - `host1,host2 keyType keyData`
 *   - `|1|salt|hash keyType keyData`
 *   - `# comment`（返回 null）
 *   - 空行（返回 null）
 */
function parseKnownHostsLine(line: string): ParsedKnownHostLine | null {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) {
    return null
  }

  let marker: string | undefined
  let rest = trimmed

  // 检查 marker（@revoked / @cert-authority）
  if (rest.startsWith('@')) {
    const spaceIdx = rest.indexOf(' ')
    if (spaceIdx === -1) {
      return null
    }
    marker = rest.slice(0, spaceIdx)
    rest = rest.slice(spaceIdx + 1)
  }

  // 分割为 [hostname, keyType, keyData, ...comment]
  const parts = rest.split(/\s+/)
  if (parts.length < 3) {
    return null
  }

  const hostnameField = parts[0]
  const keyType = parts[1]
  const keyData = parts[2]

  // hostname 可能是逗号分隔列表
  const hostnames = hostnameField.split(',')

  return { marker, hostnames, keyType, keyData, rawLine: line }
}

/**
 * 检查某行是否匹配候选主机名列表
 *
 * 匹配规则：
 *   - 明文主机名：直接比对（或候选列表包含）
 *   - 哈希条目：用 matchesHashedHost 比对每个候选
 */
function lineMatchesCandidate(line: ParsedKnownHostLine, candidates: string[]): boolean {
  for (const entryHost of line.hostnames) {
    // 哈希条目
    if (entryHost.startsWith('|1|')) {
      for (const candidate of candidates) {
        if (matchesHashedHost(entryHost, candidate)) {
          return true
        }
      }
    } else {
      // 明文主机名
      if (candidates.includes(entryHost)) {
        return true
      }
    }
  }
  return false
}

/**
 * 从 ssh2 hostKey Buffer 提取密钥元信息
 *
 * @param hostKey ssh2 hostVerifier 回调传入的 host key Buffer
 * @returns 密钥元信息，解析失败返回 null
 */
function getHostKeyMeta(hostKey: Buffer): SshHostKeyMeta | null {
  const parsed = utils.parseKey(hostKey)
  if (parsed instanceof Error || !parsed) {
    return null
  }
  const publicSsh = parsed.getPublicSSH()
  const sha256Digest = crypto.createHash('sha256').update(publicSsh).digest('base64')
  return {
    keyType: parsed.type,
    keyData: publicSsh.toString('base64'),
    sha256: `SHA256:${sha256Digest}`,
  }
}

/**
 * 从 keyType + keyData 构建 SshHostKeyMeta
 *
 * 用于从 known_hosts 文件中解析已记录的密钥元信息。
 * SHA256 指纹通过重新构造 Buffer 计算。
 */
function buildKeyMetaFromKnownHosts(keyType: string, keyData: string): SshHostKeyMeta {
  // keyData 是 base64 编码的 OpenSSH wire format
  const publicSsh = Buffer.from(keyData, 'base64')
  const sha256Digest = crypto.createHash('sha256').update(publicSsh).digest('base64')
  return {
    keyType,
    keyData,
    sha256: `SHA256:${sha256Digest}`,
  }
}

/**
 * 构建写入 known_hosts 的主机名字段
 *
 * - 端口 22：`hostname`
 * - 端口非 22：`[hostname]:port`
 */
function buildHostFieldForWrite(host: string, port: number): string {
  const normalized = normalizeHost(host)
  if (port === 22) {
    return normalized
  }
  return `[${normalized}]:${port}`
}

// ============================================================================
// 核心函数
// ============================================================================

/**
 * 检查主机密钥是否在 known_hosts 中
 *
 * @param host 主机地址
 * @param port 端口
 * @param hostKey 服务器返回的 host key Buffer
 * @param knownHostsPath known_hosts 文件路径（可选，默认 ~/.ssh/known_hosts）
 * @returns 校验结果
 */
export async function checkKnownHosts(
  host: string,
  port: number,
  hostKey: Buffer,
  knownHostsPath?: string,
): Promise<SshHostKeyCheckResult> {
  const currentKey = getHostKeyMeta(hostKey)
  if (!currentKey) {
    throw new Error('无法解析服务器返回的 host key')
  }

  const filePath = resolveKnownHostsPath(knownHostsPath)
  await ensureKnownHostsFile(filePath)

  const content = await fs.readFile(filePath, 'utf8')
  const candidates = getKnownHostCandidates(host, port)

  for (const line of content.split('\n')) {
    const parsed = parseKnownHostsLine(line)
    if (!parsed) {
      continue
    }

    if (!lineMatchesCandidate(parsed, candidates)) {
      continue
    }

    // 找到匹配的主机名条目
    if (parsed.marker === '@revoked') {
      return {
        status: 'revoked',
        currentKey,
        knownKey: buildKeyMetaFromKnownHosts(parsed.keyType, parsed.keyData),
      }
    }

    // 比对密钥
    if (parsed.keyType === currentKey.keyType && parsed.keyData === currentKey.keyData) {
      return { status: 'match', currentKey }
    }

    // 密钥不匹配
    return {
      status: 'mismatch',
      currentKey,
      knownKey: buildKeyMetaFromKnownHosts(parsed.keyType, parsed.keyData),
    }
  }

  // 未找到匹配条目
  return { status: 'not-found', currentKey }
}

/**
 * 追加主机密钥到 known_hosts 文件末尾
 *
 * @param host 主机地址
 * @param port 端口
 * @param hostKey 主机密钥 Buffer
 * @param knownHostsPath known_hosts 文件路径（可选）
 */
export async function appendKnownHost(
  host: string,
  port: number,
  hostKey: Buffer,
  knownHostsPath?: string,
): Promise<void> {
  const keyMeta = getHostKeyMeta(hostKey)
  if (!keyMeta) {
    throw new Error('无法解析 host key，无法写入 known_hosts')
  }

  const filePath = resolveKnownHostsPath(knownHostsPath)
  await ensureKnownHostsFile(filePath)

  const hostField = buildHostFieldForWrite(host, port)
  const newLine = `${hostField} ${keyMeta.keyType} ${keyMeta.keyData}\n`

  // 追加模式写入，确保文件末尾有换行
  const content = await fs.readFile(filePath, 'utf8')
  const prefix = content.length > 0 && !content.endsWith('\n') ? '\n' : ''
  await fs.appendFile(filePath, `${prefix}${newLine}`, { mode: KNOWN_HOSTS_FILE_MODE })
}

/**
 * 从 known_hosts 中删除指定主机的条目
 *
 * @param host 主机地址
 * @param port 端口
 * @param knownHostsPath known_hosts 文件路径（可选）
 * @returns 删除的行数
 */
export async function removeKnownHost(
  host: string,
  port: number,
  knownHostsPath?: string,
): Promise<number> {
  const filePath = resolveKnownHostsPath(knownHostsPath)
  await ensureKnownHostsFile(filePath)

  const content = await fs.readFile(filePath, 'utf8')
  const candidates = getKnownHostCandidates(host, port)
  const lines = content.split('\n')
  const keptLines: string[] = []
  let removedCount = 0

  for (const line of lines) {
    const parsed = parseKnownHostsLine(line)
    if (!parsed) {
      // 保留空行和注释
      keptLines.push(line)
      continue
    }

    if (lineMatchesCandidate(parsed, candidates)) {
      removedCount++
      // 跳过此行（不加入 keptLines）
    } else {
      keptLines.push(line)
    }
  }

  if (removedCount > 0) {
    // 重新写入，确保文件末尾有换行
    let newContent = keptLines.join('\n')
    // 清理末尾多余空行
    newContent = newContent.replace(/\n+$/, '\n')
    if (newContent === '\n') {
      newContent = ''
    }
    await fs.writeFile(filePath, newContent, { mode: KNOWN_HOSTS_FILE_MODE })
  }

  return removedCount
}

/**
 * 替换 known_hosts 中已知主机的密钥
 *
 * 先删除旧条目，再追加新条目（先删后加）。
 *
 * @param host 主机地址
 * @param port 端口
 * @param hostKey 新的主机密钥 Buffer
 * @param knownHostsPath known_hosts 文件路径（可选）
 */
export async function replaceKnownHost(
  host: string,
  port: number,
  hostKey: Buffer,
  knownHostsPath?: string,
): Promise<void> {
  await removeKnownHost(host, port, knownHostsPath)
  await appendKnownHost(host, port, hostKey, knownHostsPath)
}

// ============================================================================
// 提示文案构建
// ============================================================================

/**
 * 构建首次连接（unknown host）提示文案
 *
 * @param host 主机地址
 * @param port 端口
 * @param keyMeta 当前服务器返回的密钥元信息
 * @returns 多行提示文案
 */
export function buildUnknownHostPrompt(
  host: string,
  port: number,
  keyMeta: SshHostKeyMeta,
): string {
  return [
    '首次连接此服务器，无法验证主机身份。',
    '',
    `主机地址：${host}:${port}`,
    `密钥类型：${keyMeta.keyType}`,
    `密钥指纹：${keyMeta.sha256}`,
    '',
    '如果您信任此主机，可以选择「保存并继续」或「仅本次继续」。',
    '如果不确定，请选择「拒绝连接」以保护安全。',
  ].join('\n')
}

/**
 * 构建密钥变更（host key changed）提示文案
 *
 * @param host 主机地址
 * @param port 端口
 * @param currentKey 当前服务器返回的新密钥
 * @param knownKey known_hosts 中已记录的旧密钥
 * @returns 多行提示文案
 */
export function buildHostKeyChangedPrompt(
  host: string,
  port: number,
  currentKey: SshHostKeyMeta,
  knownKey: SshHostKeyMeta,
): string {
  return [
    '警告：服务器主机密钥已变更！',
    '',
    `主机地址：${host}:${port}`,
    '',
    '【已记录的旧密钥】',
    `  密钥类型：${knownKey.keyType}`,
    `  密钥指纹：${knownKey.sha256}`,
    '',
    '【服务器返回的新密钥】',
    `  密钥类型：${currentKey.keyType}`,
    `  密钥指纹：${currentKey.sha256}`,
    '',
    '密钥变更可能意味着服务器已重装系统或更换了密钥，',
    '但也可能是中间人攻击（Man-in-the-Middle Attack）。',
    '',
    '如果您确认服务器密钥变更是合法的，可以选择「保存并继续」或「仅本次继续」。',
    '如果不确定，请选择「拒绝连接」以保护安全。',
  ].join('\n')
}

// ============================================================================
// createHostVerifier — ssh2 Client hostVerifier 回调工厂
// ============================================================================

/**
 * 创建 ssh2 Client 的 hostVerifier 回调
 *
 * 核心逻辑：
 * 1. 用 getHostKeyMeta 解析服务器返回的 host key
 * 2. 用 checkKnownHosts 检查 known_hosts
 * 3. 如果 match → verify(true) 直接通过
 * 4. 如果 revoked → verify(false) 拒绝连接
 * 5. 如果 not-found / mismatch → 调用 confirm 弹窗等待用户选择
 *    - accept-and-save：写入/替换 known_hosts 后 verify(true)
 *    - accept-once：不写入 known_hosts，直接 verify(true)
 *    - reject：verify(false) 拒绝连接
 *
 * @param options 配置选项
 * @returns ssh2 HostVerifier 回调函数
 */
export function createHostVerifier(options: CreateHostVerifierOptions): HostVerifier {
  const { host, port, sessionId, serverId, knownHostsPath, confirm, onError } = options

  return (hostKey: Buffer, verify: VerifyCallback): void => {
    void (async (): Promise<void> => {
      try {
        const currentKey = getHostKeyMeta(hostKey)
        if (!currentKey) {
          onError?.(new Error('无法解析服务器返回的 host key'))
          verify(false)
          return
        }

        const checkResult = await checkKnownHosts(host, port, hostKey, knownHostsPath)

        // 密钥匹配，直接通过
        if (checkResult.status === 'match') {
          verify(true)
          return
        }

        // 密钥被吊销，拒绝连接
        if (checkResult.status === 'revoked') {
          onError?.(new Error(`主机 ${host}:${port} 的密钥已被吊销（@revoked）`))
          verify(false)
          return
        }

        // 首次连接 or 密钥变更，弹窗确认
        const scenario: 'unknown-host' | 'host-key-changed' =
          checkResult.status === 'not-found' ? 'unknown-host' : 'host-key-changed'

        const promptMessage =
          scenario === 'unknown-host'
            ? buildUnknownHostPrompt(host, port, currentKey)
            : buildHostKeyChangedPrompt(
                host,
                port,
                currentKey,
                checkResult.knownKey ?? currentKey,
              )

        const requestId = randomUUID()
        const promptEvent: SshHostKeyPromptEvent = {
          requestId,
          sessionId,
          serverId,
          host,
          port,
          scenario,
          currentKey,
          knownKey: checkResult.knownKey,
          promptMessage,
        }

        const action = await confirm(promptEvent)

        if (action === 'reject') {
          verify(false)
          return
        }

        // accept-and-save：写入 known_hosts
        if (action === 'accept-and-save') {
          try {
            if (scenario === 'unknown-host') {
              await appendKnownHost(host, port, hostKey, knownHostsPath)
            } else {
              await replaceKnownHost(host, port, hostKey, knownHostsPath)
            }
          } catch (writeErr) {
            // 写入失败不阻断连接，仅记录错误
            onError?.(new Error(`写入 known_hosts 失败: ${(writeErr as Error).message}`))
          }
        }

        // accept-once / accept-and-save 都允许连接
        verify(true)
      } catch (err) {
        onError?.(err as Error)
        verify(false)
      }
    })()
  }
}
