/**
 * SFTP 文件管理器
 *
 * 基于 ssh2 的 sftp() 接口实现远程文件操作：
 * - 目录列表（list）
 * - 文件上传/下载（upload/download，支持进度回调）
 * - 文件/目录删除、重命名、chmod、mkdir、stat
 *
 * 每次 SFTP 操作独立获取 SFTPWrapper，操作完成后立即 end 释放。
 * 通过 SshConnectionManager.getClient(sessionId) 拿到底层 Client，
 * 再调用 client.sftp() 获取 SFTPWrapper。
 *
 * 参考：_legacy-python/src/tdsf_desktop/ssh/sftp.py
 */

import type { SFTPWrapper, Stats } from 'ssh2'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { SshConnectionManager } from './connection-manager'
import type { SftpEntry } from '@shared/models'

/** SFTP 操作的默认读写缓冲区大小（字节） */
const SFTP_BUFFER_SIZE = 64 * 1024

/**
 * SFTP 文件管理器
 *
 * 通过 SSH 会话进行远程文件操作。
 * 不持有状态，所有方法独立获取/释放 SFTPWrapper。
 */
export class SftpManager {
  /** SSH 连接管理器实例 */
  private readonly sshManager: SshConnectionManager

  /**
   * @param sshManager SSH 连接管理器（默认使用单例）
   */
  public constructor(sshManager?: SshConnectionManager) {
    this.sshManager = sshManager ?? SshConnectionManager.getInstance()
  }

  // ------------------------------------------------------------------
  // 公共方法
  // ------------------------------------------------------------------

  /**
   * 列出远程目录内容
   *
   * 返回 SftpEntry 数组，目录排在前面，同类按名称排序。
   *
   * @param sessionId SSH 会话 ID
   * @param remotePath 远程目录路径
   * @returns SftpEntry 数组
   */
  public async list(sessionId: string, remotePath: string): Promise<SftpEntry[]> {
    const sftp = await this.openSftp(sessionId)
    try {
      return await new Promise<SftpEntry[]>((resolve, reject) => {
        sftp.readdir(remotePath, (err, list) => {
          if (err) {
            reject(new Error(`列出目录失败 '${remotePath}': ${err.message}`))
            return
          }
          const entries = list.map((item) => this.toSftpEntry(item))
          // 目录排前面，然后按名称排序
          entries.sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) {
              return a.isDirectory ? -1 : 1
            }
            return a.name.localeCompare(b.name)
          })
          resolve(entries)
        })
      })
    } finally {
      this.closeSftp(sftp)
    }
  }

  /**
   * 上传本地文件到远程
   *
   * 使用 ssh2 fastPut 并发传输，自动创建远程父目录，支持进度回调。
   *
   * @param sessionId SSH 会话 ID
   * @param localPath 本地文件路径
   * @param remotePath 远程目标路径
   * @param onProgress 进度回调（transferred 已传输字节，total 总字节）
   * @returns 是否成功
   */
  public async upload(
    sessionId: string,
    localPath: string,
    remotePath: string,
    onProgress?: (transferred: number, total: number) => void
  ): Promise<boolean> {
    if (!fs.existsSync(localPath)) {
      throw new Error(`本地文件不存在: ${localPath}`)
    }
    const sftp = await this.openSftp(sessionId)
    try {
      const stat = fs.statSync(localPath)
      const total = stat.size
      return await new Promise<boolean>((resolve, reject) => {
        sftp.fastPut(localPath, remotePath, {
          concurrency: 64,
          chunkSize: 32768,
          step: (transferred) => {
            onProgress?.(transferred, total)
          },
        }, (err) => {
          if (err) {
            reject(new Error(`上传失败 '${localPath}' → '${remotePath}': ${err.message}`))
          } else {
            resolve(true)
          }
        })
      })
    } finally {
      this.closeSftp(sftp)
    }
  }

  /**
   * 下载远程文件到本地
   *
   * 使用 ssh2 fastGet 并发传输，自动创建本地父目录，支持进度回调。
   *
   * @param sessionId SSH 会话 ID
   * @param remotePath 远程文件路径
   * @param localPath 本地目标路径
   * @param onProgress 进度回调（transferred 已传输字节，total 总字节）
   * @returns 是否成功
   */
  public async download(
    sessionId: string,
    remotePath: string,
    localPath: string,
    onProgress?: (transferred: number, total: number) => void
  ): Promise<boolean> {
    // 确保本地目录存在
    const localDir = path.dirname(localPath)
    fs.mkdirSync(localDir, { recursive: true })

    const sftp = await this.openSftp(sessionId)
    try {
      const stat = await this.statInternal(sftp, remotePath)
      const total = stat?.size ?? 0
      return await new Promise<boolean>((resolve, reject) => {
        sftp.fastGet(remotePath, localPath, {
          concurrency: 64,
          chunkSize: 32768,
          step: (transferred) => {
            onProgress?.(transferred, total)
          },
        }, (err) => {
          if (err) {
            reject(new Error(`下载失败 '${remotePath}' → '${localPath}': ${err.message}`))
          } else {
            resolve(true)
          }
        })
      })
    } finally {
      this.closeSftp(sftp)
    }
  }

  /**
   * 删除远程文件或目录
   *
   * 自动判断目标类型：文件用 unlink，目录用 rmdir（要求目录为空）。
   * 如需递归删除非空目录，请先用 list + 递归 delete 实现。
   *
   * @param sessionId SSH 会话 ID
   * @param remotePath 远程路径
   * @returns 是否成功
   */
  public async delete(sessionId: string, remotePath: string): Promise<boolean> {
    const sftp = await this.openSftp(sessionId)
    try {
      // 先 stat 判断类型
      const stat = await this.statInternal(sftp, remotePath)
      if (!stat) {
        throw new Error(`远程路径不存在: ${remotePath}`)
      }
      return await new Promise<boolean>((resolve, reject) => {
        // ssh2 的 Callback 类型是 (err: Error | null | undefined) => void
        const callback = (err: Error | null | undefined) => {
          if (err) {
            reject(new Error(`删除失败 '${remotePath}': ${err.message}`))
          } else {
            resolve(true)
          }
        }
        if (stat.isDirectory) {
          sftp.rmdir(remotePath, callback)
        } else {
          sftp.unlink(remotePath, callback)
        }
      })
    } finally {
      this.closeSftp(sftp)
    }
  }

  /**
   * 重命名远程文件或目录
   * @param sessionId SSH 会话 ID
   * @param oldPath 原路径
   * @param newPath 新路径
   */
  public async rename(
    sessionId: string,
    oldPath: string,
    newPath: string
  ): Promise<boolean> {
    const sftp = await this.openSftp(sessionId)
    try {
      return await new Promise<boolean>((resolve, reject) => {
        sftp.rename(oldPath, newPath, (err) => {
          if (err) {
            reject(new Error(`重命名失败 '${oldPath}' → '${newPath}': ${err.message}`))
          } else {
            resolve(true)
          }
        })
      })
    } finally {
      this.closeSftp(sftp)
    }
  }

  /**
   * 修改远程文件/目录权限
   * @param sessionId SSH 会话 ID
   * @param remotePath 远程路径
   * @param mode 权限模式（八进制数字，如 0o755）
   */
  public async chmod(
    sessionId: string,
    remotePath: string,
    mode: number
  ): Promise<boolean> {
    const sftp = await this.openSftp(sessionId)
    try {
      return await new Promise<boolean>((resolve, reject) => {
        sftp.chmod(remotePath, mode, (err) => {
          if (err) {
            reject(new Error(`chmod 失败 '${remotePath}': ${err.message}`))
          } else {
            resolve(true)
          }
        })
      })
    } finally {
      this.closeSftp(sftp)
    }
  }

  /**
   * 创建远程目录
   * @param sessionId SSH 会话 ID
   * @param remotePath 远程目录路径
   */
  public async mkdir(sessionId: string, remotePath: string): Promise<boolean> {
    const sftp = await this.openSftp(sessionId)
    try {
      return await new Promise<boolean>((resolve, reject) => {
        sftp.mkdir(remotePath, (err) => {
          if (err) {
            reject(new Error(`创建目录失败 '${remotePath}': ${err.message}`))
          } else {
            resolve(true)
          }
        })
      })
    } finally {
      this.closeSftp(sftp)
    }
  }

  /**
   * 获取远程文件/目录的 stat 信息
   * @param sessionId SSH 会话 ID
   * @param remotePath 远程路径
   * @returns SftpEntry 或 null（路径不存在时）
   */
  public async stat(
    sessionId: string,
    remotePath: string
  ): Promise<SftpEntry | null> {
    const sftp = await this.openSftp(sessionId)
    try {
      return await this.statInternal(sftp, remotePath)
    } finally {
      this.closeSftp(sftp)
    }
  }

  /**
   * 读取远程文件内容到字符串（v0.8 IDE 工作台）
   *
   * 使用流式读取，先 stat 检查大小，超过 maxSize 拒绝。
   * 适用于代码编辑器加载文件场景。
   *
   * @param sessionId SSH 会话 ID
   * @param remotePath 远程文件路径
   * @param maxSize 最大字节数（默认 10MB），超过抛错
   * @returns 文件内容字符串（utf-8 编码）
   */
  public async readFile(
    sessionId: string,
    remotePath: string,
    maxSize: number = 10 * 1024 * 1024
  ): Promise<string> {
    const sftp = await this.openSftp(sessionId)
    try {
      // 先 stat 判断大小和类型
      const stat = await this.statInternal(sftp, remotePath)
      if (!stat) {
        throw new Error(`远程文件不存在: ${remotePath}`)
      }
      if (!stat.isFile) {
        throw new Error(`不是文件，无法读取: ${remotePath}`)
      }
      if (stat.size > maxSize) {
        throw new Error(
          `文件过大 (${(stat.size / 1024 / 1024).toFixed(2)} MB)，超过 ${(
            maxSize /
            1024 /
            1024
          ).toFixed(0)} MB 限制`
        )
      }
      // 流式读取到 Buffer，再转 utf-8 字符串
      return await new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = []
        const readStream = sftp.createReadStream(remotePath, {
          highWaterMark: SFTP_BUFFER_SIZE,
          encoding: undefined, // 强制返回 Buffer
        })
        readStream.on('data', (chunk: Buffer | string) => {
          // chunk 可能是 Buffer 或 string，统一转 Buffer
          const buf =
            typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer)
          chunks.push(buf)
        })
        readStream.on('error', (err: Error) => {
          reject(new Error(`读取远程文件失败 '${remotePath}': ${err.message}`))
        })
        readStream.on('close', () => {
          resolve(Buffer.concat(chunks).toString('utf-8'))
        })
      })
    } finally {
      this.closeSftp(sftp)
    }
  }

  /**
   * 写入字符串到远程文件（v0.8 IDE 工作台）
   *
   * 使用流式写入，覆盖原文件内容。适用于代码编辑器保存场景。
   *
   * @param sessionId SSH 会话 ID
   * @param remotePath 远程文件路径
   * @param content 文件内容字符串
   * @returns 是否成功
   */
  public async writeFile(
    sessionId: string,
    remotePath: string,
    content: string
  ): Promise<boolean> {
    const sftp = await this.openSftp(sessionId)
    try {
      return await new Promise<boolean>((resolve, reject) => {
        const writeStream = sftp.createWriteStream(remotePath, {
          highWaterMark: SFTP_BUFFER_SIZE,
        })
        writeStream.on('error', (err: Error) => {
          reject(new Error(`写入远程文件失败 '${remotePath}': ${err.message}`))
        })
        writeStream.on('close', () => {
          resolve(true)
        })
        // 写入字符串并结束流（writeStream.end 会自动 flush）
        writeStream.end(content, 'utf-8')
      })
    } finally {
      this.closeSftp(sftp)
    }
  }

  // ------------------------------------------------------------------
  // 内部实现
  // ------------------------------------------------------------------

  /**
   * 打开 SFTP 通道
   * @returns SFTPWrapper 实例
   */
  private openSftp(sessionId: string): Promise<SFTPWrapper> {
    const client = this.sshManager.getClient(sessionId)
    return new Promise<SFTPWrapper>((resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err) {
          reject(new Error(`打开 SFTP 通道失败: ${err.message}`))
        } else if (!sftp) {
          reject(new Error('打开 SFTP 通道失败: 返回空对象'))
        } else {
          resolve(sftp)
        }
      })
    })
  }

  /** 关闭 SFTP 通道（忽略异常） */
  private closeSftp(sftp: SFTPWrapper): void {
    try {
      sftp.end()
    } catch {
      // 忽略关闭异常
    }
  }

  /**
   * 内部 stat 实现（直接操作 SFTPWrapper，不重新打开通道）
   * @returns SftpEntry 或 null
   */
  private statInternal(
    sftp: SFTPWrapper,
    remotePath: string
  ): Promise<SftpEntry | null> {
    return new Promise<SftpEntry | null>((resolve, reject) => {
      sftp.stat(remotePath, (err, stats) => {
        if (err) {
          // 路径不存在时返回 null（不视为错误）
          if (err.message.includes('No such file')) {
            resolve(null)
            return
          }
          reject(new Error(`stat 失败 '${remotePath}': ${err.message}`))
          return
        }
        // 把 Stats 转为 SftpEntry，name 取路径最后一段
        const name = remotePath.split('/').filter(Boolean).pop() ?? remotePath
        resolve(this.statsToSftpEntry(name, remotePath, stats))
      })
    })
  }

  /**
   * 把 ssh2 的 readdir 返回的 FileEntry 转为 SftpEntry
   */
  private toSftpEntry(item: {
    filename: string
    longname: string
    attrs: Stats
  }): SftpEntry {
    return this.statsToSftpEntry(item.filename, item.longname, item.attrs)
  }

  /**
   * 把 ssh2 的 Stats 转为 SftpEntry
   *
   * ssh2 的 Stats 提供 isDirectory()/isFile()/isSymbolicLink() 等方法，
   * 权限信息通过 mode 字段计算 rwx 字符串。
   */
  private statsToSftpEntry(
    name: string,
    longName: string,
    attrs: Stats
  ): SftpEntry {
    // ssh2 Stats 提供 mode、uid、gid、size、atime、mtime
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

  /**
   * 把 0-7 的权限位转为 'rwx' 字符串
   * @param bits 0-7 的权限位
   */
  private modeToRwx(bits: number): string {
    return (
      (bits & 4 ? 'r' : '-') +
      (bits & 2 ? 'w' : '-') +
      (bits & 1 ? 'x' : '-')
    )
  }
}
