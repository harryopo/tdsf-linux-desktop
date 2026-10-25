/**
 * Electerm SFTP 模块抽取封装（v0.9.7 P3 M1）
 *
 * 参考 Electerm 的 session-sftp.js + sftp-file.js + transfer.js 设计，
 * 在原有 SftpManager 基础上增强：
 * - SFTPWrapper 会话复用：同一 SSH 会话的多次 SFTP 操作复用同一个 sftp 对象
 * - 远程 cp / mv：远端服务器上直接执行，避免先下载再上传
 * - 递归删除 rmrf：远端 `rm -rf` / PowerShell Remove-Item 兜底
 * - 文件夹大小统计：远端 `du -sh` / PowerShell Measure-Object
 *
 * 与原 SftpManager 接口保持一致，ipc/ssh.ts 可无缝替换。
 */
import type { Client, SFTPWrapper, Stats } from 'ssh2'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { SshConnectionManager } from './connection-manager'
import { assertRemoteWriteAllowed, assertRemoteWriteAllowedResolved } from './remote-write-guard'
import type { SftpEntry } from '@shared/models'

/** 进度回调类型 */
export type SftpProgressCallback = (transferred: number, total: number) => void

/**
 * 预算（毫秒）：ssh2 的回调在半开连接上永远不回来，界面会一直转圈。
 * 与 SftpManager 保持同一口径：元数据 20s、传输 60s 无进展、流 30s。
 */
const META_BUDGET_MS = 20_000
const TRANSFER_IDLE_BUDGET_MS = 60_000

function withBudget<T>(promise: Promise<T>, label: string, ms = META_BUDGET_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}超时（${Math.round(ms / 1000)} 秒无响应）`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

/** 有进展就续期的预算：大文件传输不能用绝对时限，否则正常的长传输会被误杀 */
function withIdleBudget<T>(
  start: (touch: () => void) => Promise<T>,
  label: string,
  idleMs = TRANSFER_IDLE_BUDGET_MS
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timer: NodeJS.Timeout | undefined
    const touch = (): void => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => reject(new Error(`${label}超时（${Math.round(idleMs / 1000)} 秒无进展）`)), idleMs)
    }
    touch()
    start(touch).then(
      (value) => {
        if (timer) clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        if (timer) clearTimeout(timer)
        reject(err)
      }
    )
  })
}

/** Electerm SFTP 客户端选项 */
export interface ElectermSftpOptions {
  /** 并发数（fastPut/fastGet） */
  concurrency?: number
  /** 分块大小 */
  chunkSize?: number
  /** 编码 */
  encode?: string
}

/** 单个 SFTP 会话客户端 */
export class ElectermSftpClient {
  private readonly client: Client
  private sftp: SFTPWrapper | null = null
  private readonly options: Required<ElectermSftpOptions>
  private closed = false

  constructor(client: Client, options: ElectermSftpOptions = {}) {
    this.client = client
    this.options = {
      concurrency: options.concurrency ?? 64,
      chunkSize: options.chunkSize ?? 32768,
      encode: options.encode ?? 'utf8',
    }
  }

  /** 初始化 SFTP 通道（幂等） */
  async init(): Promise<void> {
    if (this.sftp) return
    if (this.closed) throw new Error('SFTP client 已关闭')
    this.sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
      this.client.sftp((err, sftp) => {
        if (err) return reject(err)
        if (!sftp) return reject(new Error('SFTP 返回空对象'))
        resolve(sftp)
      })
    })
  }

  /** 关闭 SFTP 通道 */
  close(): void {
    this.closed = true
    if (this.sftp) {
      try {
        this.sftp.end()
      } catch {
        // 忽略关闭异常
      }
      this.sftp = null
    }
  }

  /** 列出远程目录 */
  async list(remotePath: string): Promise<SftpEntry[]> {
    const sftp = this.requireSftp()
    return new Promise<SftpEntry[]>((resolve, reject) => {
      sftp.readdir(remotePath, (err, list) => {
        if (err) {
          reject(new Error(`列出目录失败 '${remotePath}': ${err.message}`))
          return
        }
        const entries = list.map((item) => this.toSftpEntry(item))
        entries.sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) {
            return a.isDirectory ? -1 : 1
          }
          return a.name.localeCompare(b.name)
        })
        resolve(entries)
      })
    })
  }

  /** 获取远程文件/目录 stat */
  async stat(remotePath: string): Promise<SftpEntry | null> {
    const sftp = this.requireSftp()
    return this.statInternal(sftp, remotePath)
  }

  /** 上传本地文件到远程 */
  async upload(
    localPath: string,
    remotePath: string,
    onProgress?: SftpProgressCallback
  ): Promise<boolean> {
    if (!fs.existsSync(localPath)) {
      throw new Error(`本地文件不存在: ${localPath}`)
    }
    const sftp = this.requireSftp()
    const stat = fs.statSync(localPath)
    const total = stat.size
    return new Promise<boolean>((resolve, reject) => {
      sftp.fastPut(
        localPath,
        remotePath,
        {
          concurrency: this.options.concurrency,
          chunkSize: this.options.chunkSize,
          step: (transferred) => {
            onProgress?.(transferred, total)
          },
        },
        (err) => {
          if (err) {
            reject(new Error(`上传失败 '${localPath}' → '${remotePath}': ${err.message}`))
          } else {
            resolve(true)
          }
        }
      )
    })
  }

  /** 下载远程文件到本地 */
  async download(
    remotePath: string,
    localPath: string,
    onProgress?: SftpProgressCallback
  ): Promise<boolean> {
    const localDir = path.dirname(localPath)
    fs.mkdirSync(localDir, { recursive: true })
    const sftp = this.requireSftp()
    const stat = await this.statInternal(sftp, remotePath)
    const total = stat?.size ?? 0
    return new Promise<boolean>((resolve, reject) => {
      sftp.fastGet(
        remotePath,
        localPath,
        {
          concurrency: this.options.concurrency,
          chunkSize: this.options.chunkSize,
          step: (transferred) => {
            onProgress?.(transferred, total)
          },
        },
        (err) => {
          if (err) {
            reject(new Error(`下载失败 '${remotePath}' → '${localPath}': ${err.message}`))
          } else {
            resolve(true)
          }
        }
      )
    })
  }

  /** 删除远程文件 */
  async unlink(remotePath: string): Promise<boolean> {
    const sftp = this.requireSftp()
    return new Promise<boolean>((resolve, reject) => {
      sftp.unlink(remotePath, (err) => {
        if (err) reject(new Error(`删除文件失败 '${remotePath}': ${err.message}`))
        else resolve(true)
      })
    })
  }

  /** 删除远程空目录 */
  async rmdir(remotePath: string): Promise<boolean> {
    const sftp = this.requireSftp()
    return new Promise<boolean>((resolve, reject) => {
      sftp.rmdir(remotePath, (err) => {
        if (err) reject(new Error(`删除目录失败 '${remotePath}': ${err.message}`))
        else resolve(true)
      })
    })
  }

  /** 重命名 */
  async rename(oldPath: string, newPath: string): Promise<boolean> {
    const sftp = this.requireSftp()
    return new Promise<boolean>((resolve, reject) => {
      sftp.rename(oldPath, newPath, (err) => {
        if (err) reject(new Error(`重命名失败 '${oldPath}' → '${newPath}': ${err.message}`))
        else resolve(true)
      })
    })
  }

  /** 解析远端真实路径（符号链接也算）——写目的地闸在写之前要它 */
  async realpath(remotePath: string): Promise<string> {
    const sftp = this.requireSftp()
    return new Promise<string>((resolve, reject) => {
      sftp.realpath(remotePath, (err, resolvedPath) => {
        if (err) reject(err)
        else if (resolvedPath) resolve(resolvedPath)
        else reject(new Error(`realpath 没有返回路径：${remotePath}`))
      })
    })
  }

  /** 修改权限 */
  async chmod(remotePath: string, mode: number): Promise<boolean> {
    const sftp = this.requireSftp()
    return new Promise<boolean>((resolve, reject) => {
      sftp.chmod(remotePath, mode, (err) => {
        if (err) reject(new Error(`chmod 失败 '${remotePath}': ${err.message}`))
        else resolve(true)
      })
    })
  }

  /** 创建目录 */
  async mkdir(remotePath: string): Promise<boolean> {
    const sftp = this.requireSftp()
    return new Promise<boolean>((resolve, reject) => {
      sftp.mkdir(remotePath, (err) => {
        if (err) reject(new Error(`创建目录失败 '${remotePath}': ${err.message}`))
        else resolve(true)
      })
    })
  }

  /** 读取远程文件为字符串 */
  async readFile(remotePath: string, maxSize: number = 10 * 1024 * 1024): Promise<string> {
    const buf = await this.readFileBuffer(remotePath, maxSize)
    return buf.toString('utf-8')
  }

  /**
   * 读取远程文件的原始字节（W5 预览用）
   *
   * readFile 只能回 utf-8 字符串，而预览一页 HTML 还要连带它引用的图片/字体，
   * 那些二进制过一遍字符串就毁了。校验口径与 readFile 是同一条，只是最后不转码。
   */
  async readFileBuffer(remotePath: string, maxSize: number = 10 * 1024 * 1024): Promise<Buffer> {
    const sftp = this.requireSftp()
    const stat = await this.statInternal(sftp, remotePath)
    if (!stat) throw new Error(`远程文件不存在: ${remotePath}`)
    if (!stat.isFile) throw new Error(`不是文件，无法读取: ${remotePath}`)
    if (stat.size > maxSize) {
      throw new Error(
        `文件过大 (${(stat.size / 1024 / 1024).toFixed(2)} MB)，超过 ${(
          maxSize /
          1024 /
          1024
        ).toFixed(0)} MB 限制`
      )
    }
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = []
      const stream = sftp.createReadStream(remotePath, {
        highWaterMark: 64 * 1024,
        encoding: undefined,
      })
      stream.on('data', (chunk: Buffer | string) => {
        const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
        chunks.push(buf)
      })
      stream.on('error', (err: Error) => {
        reject(new Error(`读取远程文件失败 '${remotePath}': ${err.message}`))
      })
      stream.on('close', () => {
        resolve(Buffer.concat(chunks))
      })
    })
  }

  /** 写入字符串到远程文件 */
  async writeFile(remotePath: string, content: string): Promise<boolean> {
    const sftp = this.requireSftp()
    return new Promise<boolean>((resolve, reject) => {
      const stream = sftp.createWriteStream(remotePath, { highWaterMark: 64 * 1024 })
      stream.on('error', (err: Error) => {
        reject(new Error(`写入远程文件失败 '${remotePath}': ${err.message}`))
      })
      stream.on('close', () => resolve(true))
      stream.end(content, 'utf-8')
    })
  }

  // ------------------------------------------------------------------
  // 内部实现
  // ------------------------------------------------------------------

  private requireSftp(): SFTPWrapper {
    if (!this.sftp) throw new Error('SFTP 未初始化')
    return this.sftp
  }

  private statInternal(sftp: SFTPWrapper, remotePath: string): Promise<SftpEntry | null> {
    return new Promise<SftpEntry | null>((resolve, reject) => {
      sftp.stat(remotePath, (err, stats) => {
        if (err) {
          if (err.message.includes('No such file')) {
            resolve(null)
            return
          }
          reject(new Error(`stat 失败 '${remotePath}': ${err.message}`))
          return
        }
        const name = remotePath.split('/').filter(Boolean).pop() ?? remotePath
        resolve(this.statsToSftpEntry(name, remotePath, stats))
      })
    })
  }

  private toSftpEntry(item: { filename: string; longname: string; attrs: Stats }): SftpEntry {
    return this.statsToSftpEntry(item.filename, item.longname, item.attrs)
  }

  private statsToSftpEntry(name: string, longName: string, attrs: Stats): SftpEntry {
    const mode = attrs.mode ?? 0
    return {
      name,
      longName,
      isDirectory: attrs.isDirectory(),
      isFile: attrs.isFile(),
      isSymlink: attrs.isSymbolicLink(),
      size: attrs.size ?? 0,
      modifyTime: (attrs.mtime ?? 0) * 1000,
      accessTime: (attrs.atime ?? 0) * 1000,
      rights: {
        user: this.modeToRwx((mode >> 6) & 0o7),
        group: this.modeToRwx((mode >> 3) & 0o7),
        other: this.modeToRwx(mode & 0o7),
      },
      owner: String(attrs.uid ?? ''),
      group: String(attrs.gid ?? ''),
    }
  }

  private modeToRwx(mode: number): string {
    const r = mode & 0o4 ? 'r' : '-'
    const w = mode & 0o2 ? 'w' : '-'
    const x = mode & 0o1 ? 'x' : '-'
    return `${r}${w}${x}`
  }
}

/** 按 sessionId 持有 ElectermSftpClient 的管理器 */
export class ElectermSftpManager {
  private readonly sshManager: SshConnectionManager
  private readonly clients = new Map<string, ElectermSftpClient>()
  private readonly unsubscribeMap = new Map<string, () => void>()

  constructor(sshManager?: SshConnectionManager) {
    this.sshManager = sshManager ?? SshConnectionManager.getInstance()
  }

  private async getClient(sessionId: string): Promise<ElectermSftpClient> {
    let client = this.clients.get(sessionId)
    if (client) return client

    const sshClient = this.sshManager.getClient(sessionId)
    client = new ElectermSftpClient(sshClient)
    await withBudget(client.init(), '建立 SFTP 通道')
    this.clients.set(sessionId, client)

    // 会话断开后自动清理
    const unsubscribe = this.sshManager.onStateChanged((event) => {
      if (event.sessionId === sessionId && event.state === 'disconnected') {
        this.closeClient(sessionId)
      }
    })
    this.unsubscribeMap.set(sessionId, unsubscribe)

    return client
  }

  private closeClient(sessionId: string): void {
    const client = this.clients.get(sessionId)
    if (client) {
      client.close()
      this.clients.delete(sessionId)
    }
    const unsubscribe = this.unsubscribeMap.get(sessionId)
    if (unsubscribe) {
      unsubscribe()
      this.unsubscribeMap.delete(sessionId)
    }
  }

  // ------------------------------------------------------------------
  // 与原 SftpManager 兼容的公共方法
  // ------------------------------------------------------------------

  async list(sessionId: string, remotePath: string): Promise<SftpEntry[]> {
    const client = await this.getClient(sessionId)
    return withBudget(client.list(remotePath), `列出目录 ${remotePath}`)
  }

  async upload(
    sessionId: string,
    localPath: string,
    remotePath: string,
    onProgress?: SftpProgressCallback
  ): Promise<boolean> {
    assertRemoteWriteAllowed('上传', remotePath)
    const client = await this.getClient(sessionId)
    await assertRemoteWriteAllowedResolved('上传', remotePath, (p) => client.realpath(p))
    return withIdleBudget(
      (touch) =>
        client.upload(localPath, remotePath, (transferred, total) => {
          touch()
          onProgress?.(transferred, total)
        }),
      `上传 ${remotePath}`
    )
  }

  async download(
    sessionId: string,
    remotePath: string,
    localPath: string,
    onProgress?: SftpProgressCallback
  ): Promise<boolean> {
    const client = await this.getClient(sessionId)
    return withIdleBudget(
      (touch) =>
        client.download(remotePath, localPath, (transferred, total) => {
          touch()
          onProgress?.(transferred, total)
        }),
      `下载 ${remotePath}`
    )
  }

  async delete(sessionId: string, remotePath: string): Promise<boolean> {
    assertRemoteWriteAllowed('删除', remotePath)
    const client = await this.getClient(sessionId)
    return withBudget(
      (async () => {
        const stat = await client.stat(remotePath)
        if (!stat) throw new Error(`远程路径不存在: ${remotePath}`)
        if (stat.isDirectory) {
          return this.rmrf(sessionId, remotePath)
        }
        return client.unlink(remotePath)
      })(),
      `删除 ${remotePath}`
    )
  }

  async rename(sessionId: string, oldPath: string, newPath: string): Promise<boolean> {
    assertRemoteWriteAllowed('重命名', oldPath)
    assertRemoteWriteAllowed('重命名目标', newPath)
    const client = await this.getClient(sessionId)
    return withBudget(client.rename(oldPath, newPath), `重命名 ${oldPath}`)
  }

  async chmod(sessionId: string, remotePath: string, mode: number): Promise<boolean> {
    assertRemoteWriteAllowed('改权限', remotePath)
    const client = await this.getClient(sessionId)
    return withBudget(client.chmod(remotePath, mode), `改权限 ${remotePath}`)
  }

  async mkdir(sessionId: string, remotePath: string): Promise<boolean> {
    assertRemoteWriteAllowed('建目录', remotePath)
    const client = await this.getClient(sessionId)
    return withBudget(client.mkdir(remotePath), `建目录 ${remotePath}`)
  }

  async stat(sessionId: string, remotePath: string): Promise<SftpEntry | null> {
    const client = await this.getClient(sessionId)
    return withBudget(client.stat(remotePath), `读取属性 ${remotePath}`)
  }

  async readFile(sessionId: string, remotePath: string, maxSize?: number): Promise<string> {
    const client = await this.getClient(sessionId)
    return withBudget(client.readFile(remotePath, maxSize), `读取文件 ${remotePath}`, 30_000)
  }

  /** 读原始字节（W5 预览的子资源：图片/字体不能过 utf-8） */
  async readFileBuffer(sessionId: string, remotePath: string, maxSize?: number): Promise<Buffer> {
    const client = await this.getClient(sessionId)
    return withBudget(client.readFileBuffer(remotePath, maxSize), `读取文件 ${remotePath}`, 30_000)
  }

  async writeFile(sessionId: string, remotePath: string, content: string): Promise<boolean> {
    assertRemoteWriteAllowed('写入', remotePath)
    const client = await this.getClient(sessionId)
    // 符号链接解析后再判一次（#237）
    await assertRemoteWriteAllowedResolved('写入', remotePath, (p) => client.realpath(p))
    return withBudget(client.writeFile(remotePath, content), `写入文件 ${remotePath}`, 30_000)
  }

  // ------------------------------------------------------------------
  // Electerm 增强方法：远端命令兜底
  // ------------------------------------------------------------------

  /** 递归删除目录（远端 rm -rf / PowerShell Remove-Item） */
  async rmrf(sessionId: string, remotePath: string): Promise<boolean> {
    assertRemoteWriteAllowed('递归删除', remotePath)
    const cmd = `rm -rf ${this.escapePosixPath(remotePath)}`
    const result = await this.sshManager.exec(sessionId, cmd)
    if (result.exitCode !== 0) {
      throw new Error(`rmrf 失败 '${remotePath}': ${result.stderr || result.stdout}`)
    }
    return true
  }

  /** 远端 cp -r */
  async cp(sessionId: string, from: string, to: string): Promise<boolean> {
    assertRemoteWriteAllowed('复制目标', to)
    const cmd = `cp -r ${this.escapePosixPath(from)} ${this.escapePosixPath(to)}`
    const result = await this.sshManager.exec(sessionId, cmd)
    if (result.exitCode !== 0) {
      throw new Error(`cp 失败 '${from}' → '${to}': ${result.stderr || result.stdout}`)
    }
    return true
  }

  /** 远端 mv */
  async mv(sessionId: string, from: string, to: string): Promise<boolean> {
    assertRemoteWriteAllowed('移动目标', to)
    const cmd = `mv ${this.escapePosixPath(from)} ${this.escapePosixPath(to)}`
    const result = await this.sshManager.exec(sessionId, cmd)
    if (result.exitCode !== 0) {
      throw new Error(`mv 失败 '${from}' → '${to}': ${result.stderr || result.stdout}`)
    }
    return true
  }

  // 远端文件夹大小统计
  async getFolderSize(sessionId: string, remotePath: string): Promise<{ size: string; count: number }> {
    const cmd = `du -sh ${this.escapePosixPath(remotePath)} && find ${this.escapePosixPath(remotePath)} -type f | wc -l`
    const result = await this.sshManager.exec(sessionId, cmd)
    if (result.exitCode !== 0) {
      throw new Error(`文件夹大小统计失败 '${remotePath}': ${result.stderr || result.stdout}`)
    }
    const lines = result.stdout.trim().split('\n')
    const size = lines[0]?.split('\t')[0]?.trim() ?? '0'
    const count = parseInt(lines[1]?.trim() ?? '0', 10) || 0
    return { size, count }
  }

  private escapePosixPath(value: string): string {
    return `"${String(value).replace(/["\\$`]/g, '\\$&')}"`
  }
}
