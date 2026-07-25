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
import type { SftpEntry } from '@shared/models'

/** 进度回调类型 */
export type SftpProgressCallback = (transferred: number, total: number) => void

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
    return new Promise<string>((resolve, reject) => {
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
        resolve(Buffer.concat(chunks).toString('utf-8'))
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
    await client.init()
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
    return client.list(remotePath)
  }

  async upload(
    sessionId: string,
    localPath: string,
    remotePath: string,
    onProgress?: SftpProgressCallback
  ): Promise<boolean> {
    const client = await this.getClient(sessionId)
    return client.upload(localPath, remotePath, onProgress)
  }

  async download(
    sessionId: string,
    remotePath: string,
    localPath: string,
    onProgress?: SftpProgressCallback
  ): Promise<boolean> {
    const client = await this.getClient(sessionId)
    return client.download(remotePath, localPath, onProgress)
  }

  async delete(sessionId: string, remotePath: string): Promise<boolean> {
    const client = await this.getClient(sessionId)
    const stat = await client.stat(remotePath)
    if (!stat) throw new Error(`远程路径不存在: ${remotePath}`)
    if (stat.isDirectory) {
      return this.rmrf(sessionId, remotePath)
    }
    return client.unlink(remotePath)
  }

  async rename(sessionId: string, oldPath: string, newPath: string): Promise<boolean> {
    const client = await this.getClient(sessionId)
    return client.rename(oldPath, newPath)
  }

  async chmod(sessionId: string, remotePath: string, mode: number): Promise<boolean> {
    const client = await this.getClient(sessionId)
    return client.chmod(remotePath, mode)
  }

  async mkdir(sessionId: string, remotePath: string): Promise<boolean> {
    const client = await this.getClient(sessionId)
    return client.mkdir(remotePath)
  }

  async stat(sessionId: string, remotePath: string): Promise<SftpEntry | null> {
    const client = await this.getClient(sessionId)
    return client.stat(remotePath)
  }

  async readFile(sessionId: string, remotePath: string, maxSize?: number): Promise<string> {
    const client = await this.getClient(sessionId)
    return client.readFile(remotePath, maxSize)
  }

  async writeFile(sessionId: string, remotePath: string, content: string): Promise<boolean> {
    const client = await this.getClient(sessionId)
    return client.writeFile(remotePath, content)
  }

  // ------------------------------------------------------------------
  // Electerm 增强方法：远端命令兜底
  // ------------------------------------------------------------------

  /** 递归删除目录（远端 rm -rf / PowerShell Remove-Item） */
  async rmrf(sessionId: string, remotePath: string): Promise<boolean> {
    const cmd = `rm -rf ${this.escapePosixPath(remotePath)}`
    const result = await this.sshManager.exec(sessionId, cmd)
    if (result.exitCode !== 0) {
      throw new Error(`rmrf 失败 '${remotePath}': ${result.stderr || result.stdout}`)
    }
    return true
  }

  /** 远端 cp -r */
  async cp(sessionId: string, from: string, to: string): Promise<boolean> {
    const cmd = `cp -r ${this.escapePosixPath(from)} ${this.escapePosixPath(to)}`
    const result = await this.sshManager.exec(sessionId, cmd)
    if (result.exitCode !== 0) {
      throw new Error(`cp 失败 '${from}' → '${to}': ${result.stderr || result.stdout}`)
    }
    return true
  }

  /** 远端 mv */
  async mv(sessionId: string, from: string, to: string): Promise<boolean> {
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
