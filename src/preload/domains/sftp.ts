/** sftp 域：从 src/preload/index.ts 按域拆出。暴露名以 index.ts 里的 electronApi 为准，快照闸盯着 */
import type { SftpEntry, SftpTransferResult } from '@shared/models'
import { FILE_WATCH, SFTP, SFTP_SEARCH } from '@shared/ipc-channels'
import { ipcRenderer } from 'electron'
import type { SftpGrepMatch, SftpGrepParams, SftpSearchFileEntry } from '../types'

/**
 * SFTP 文件操作 invoke 调用
 */
const sftp = {
  /** 列出远程目录 */
  list: (sessionId: string, remotePath: string): Promise<SftpEntry[]> =>
    ipcRenderer.invoke(SFTP.LIST, sessionId, remotePath),

  /**
   * 上传文件（支持 transferId 进度关联）
   *
   * 没有 localPath 参数：要传哪个本地文件由主进程弹文件选择框决定，
   * 渲染层只说目标远程目录。暴露面少一个"渲染层可填的本地绝对路径"，
   * "读 ~/.ssh/id_rsa 送去远端"这类组合就没有可拼的原料。
   */
  upload: (sessionId: string, remotePath: string, transferId?: string): Promise<SftpTransferResult> =>
    ipcRenderer.invoke(SFTP.UPLOAD, sessionId, remotePath, transferId),

  /** 下载文件（支持 transferId 进度关联）；保存位置由主进程的另存为对话框决定 */
  download: (sessionId: string, remotePath: string, transferId?: string): Promise<SftpTransferResult> =>
    ipcRenderer.invoke(SFTP.DOWNLOAD, sessionId, remotePath, transferId),

  /** 删除文件/目录 */
  delete: (sessionId: string, remotePath: string): Promise<boolean> =>
    ipcRenderer.invoke(SFTP.DELETE, sessionId, remotePath),

  /** 重命名 */
  rename: (
    sessionId: string,
    oldPath: string,
    newPath: string
  ): Promise<boolean> =>
    ipcRenderer.invoke(SFTP.RENAME, sessionId, oldPath, newPath),

  /** 修改权限 */
  chmod: (
    sessionId: string,
    remotePath: string,
    mode: number
  ): Promise<boolean> =>
    ipcRenderer.invoke(SFTP.CHMOD, sessionId, remotePath, mode),

  /** 读取远程文件内容到字符串（v0.8 IDE 工作台，10MB 上限） */
  readFile: (sessionId: string, remotePath: string): Promise<string> =>
    ipcRenderer.invoke(SFTP.READ_FILE, sessionId, remotePath),

  /** 写入字符串到远程文件（v0.8 IDE 工作台，覆盖原文件） */
  writeFile: (
    sessionId: string,
    remotePath: string,
    content: string
  ): Promise<boolean> =>
    ipcRenderer.invoke(SFTP.WRITE_FILE, sessionId, remotePath, content),

  /** 获取文件/目录元信息（返回 SftpEntry 或 null） */
  stat: (sessionId: string, remotePath: string): Promise<SftpEntry | null> =>
    ipcRenderer.invoke(SFTP.STAT, sessionId, remotePath),

  /** 创建远程目录 */
  mkdir: (sessionId: string, remotePath: string): Promise<boolean> =>
    ipcRenderer.invoke(SFTP.MKDIR, sessionId, remotePath),
}

/**
 * SFTP 文件搜索 + grep 封装
 *
 * 通道与主进程 ipc/sftp-search.ts 一一对应；UI 调用方式：
 *   const { files } = await window.electronAPI.sftpSearch(sessionId, '/etc', 'nginx')
 *   const { results } = await window.electronAPI.sftpGrep({ sessionId, path, pattern, ... })
 */
const sftpSearch = {
  /**
   * 模糊查找远程文件（find -type f -name）
   *
   * @param sessionId SSH 会话 ID
   * @param path 搜索根目录（绝对路径）
   * @param query 文件名模糊匹配（不支持正则，shell glob）
   * @returns 文件列表（最多 50 条，3 秒超时返回空数组）
   */
  search: (
    sessionId: string,
    path: string,
    query: string
  ): Promise<{ files: SftpSearchFileEntry[]; error?: string }> =>
    ipcRenderer.invoke(SFTP_SEARCH.SEARCH, sessionId, path, query),

  /**
   * 远程内容 grep（grep -rn）
   *
   * @param params 搜索参数（sessionId/path/pattern/isRegex/caseSensitive/wholeWord）
   * @returns 匹配列表（最多 100 条，3 秒超时返回空数组）
   */
  grep: (params: SftpGrepParams): Promise<{ results: SftpGrepMatch[]; error?: string }> =>
    ipcRenderer.invoke(SFTP_SEARCH.GREP, params),
}

/**
 * 远程文件监听封装
 *
 * 通道与主进程 ipc/file-watcher.ts 一一对应；UI 调用方式：
 *   const { watchId } = await window.electronAPI.fileWatchStart(sessionId, '/var/log')
 *   const off = window.electronAPI.onFileChanged((payload) => { ... })
 *   await window.electronAPI.fileWatchStop(watchId)
 */
const fileWatch = {
  /**
   * 开始监听远程路径文件变更
   *
   * @param sessionId SSH 会话 ID
   * @param path 监听根目录（绝对路径）
   * @returns watchId（用于后续 stop 调用）
   */
  start: (sessionId: string, path: string): Promise<{ watchId: string }> =>
    ipcRenderer.invoke(FILE_WATCH.WATCH_START, sessionId, path),

  /**
   * 停止监听
   *
   * @param watchId start 返回的 watchId
   * @returns { success: boolean }
   */
  stop: (watchId: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(FILE_WATCH.WATCH_STOP, watchId),
}

export { sftp, sftpSearch, fileWatch }
