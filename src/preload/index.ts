/**
 * Preload 安全桥接
 *
 * 使用 contextBridge.exposeInMainWorld 把受限的 IPC 接口暴露给渲染进程。
 *
 * 安全原则：
 * 1. 不暴露 raw ipcRenderer（渲染进程无法任意发送 IPC 请求）
 * 2. 仅暴露预定义的通道白名单
 * 3. 事件监听返回取消函数，便于 React useEffect 清理
 *
 * 暴露的 API 结构（window.electronAPI）：
 * - ssh: SSH 连接管理（connect/disconnect/exec/shell.*）
 * - sftp: SFTP 文件操作（list/upload/download/delete/rename/chmod）
 * - monitor: 服务器监控（start/stop/getSystemInfo）
 * - storage: API Key 加密存储（saveApiKey/getApiKey/deleteApiKey）
 * - config: 配置存储（get/set）
 * - on: 事件监听（terminalData/monitorData/llmToken/agentStep）
 *
 * 通道列表与 IpcChannelMap 一一对应。
 */

import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import type {
  SshConfig,
  CommandResult,
  SftpEntry,
  SystemInfo,
  MonitorData,
  AgentWorkflowState,
} from '@shared/models'

// ============================================================================
// invoke 通道封装（渲染 → 主，请求-响应）
// ============================================================================

/**
 * SSH 相关 invoke 调用
 */
const ssh = {
  /** 建立 SSH 连接，返回 sessionId */
  connect: (config: SshConfig): Promise<string> =>
    ipcRenderer.invoke('ssh:connect', config),

  /** 断开 SSH 连接 */
  disconnect: (sessionId: string): Promise<boolean> =>
    ipcRenderer.invoke('ssh:disconnect', sessionId),

  /** 执行 SSH 命令 */
  exec: (sessionId: string, command: string): Promise<CommandResult> =>
    ipcRenderer.invoke('ssh:exec', sessionId, command),

  /** 交互式 Shell 操作 */
  shell: {
    /** 启动交互式 shell */
    start: (sessionId: string): Promise<boolean> =>
      ipcRenderer.invoke('ssh:shell:start', sessionId),

    /** 向 shell 写入数据 */
    write: (sessionId: string, data: string): Promise<boolean> =>
      ipcRenderer.invoke('ssh:shell:write', sessionId, data),

    /** 调整 shell 终端窗口大小 */
    resize: (sessionId: string, cols: number, rows: number): Promise<boolean> =>
      ipcRenderer.invoke('ssh:shell:resize', sessionId, cols, rows),
  },
}

/**
 * SFTP 文件操作 invoke 调用
 */
const sftp = {
  /** 列出远程目录 */
  list: (sessionId: string, remotePath: string): Promise<SftpEntry[]> =>
    ipcRenderer.invoke('sftp:list', sessionId, remotePath),

  /** 上传文件 */
  upload: (
    sessionId: string,
    localPath: string,
    remotePath: string
  ): Promise<boolean> =>
    ipcRenderer.invoke('sftp:upload', sessionId, localPath, remotePath),

  /** 下载文件 */
  download: (
    sessionId: string,
    remotePath: string,
    localPath: string
  ): Promise<boolean> =>
    ipcRenderer.invoke('sftp:download', sessionId, remotePath, localPath),

  /** 删除文件/目录 */
  delete: (sessionId: string, remotePath: string): Promise<boolean> =>
    ipcRenderer.invoke('sftp:delete', sessionId, remotePath),

  /** 重命名 */
  rename: (
    sessionId: string,
    oldPath: string,
    newPath: string
  ): Promise<boolean> =>
    ipcRenderer.invoke('sftp:rename', sessionId, oldPath, newPath),

  /** 修改权限 */
  chmod: (
    sessionId: string,
    remotePath: string,
    mode: number
  ): Promise<boolean> =>
    ipcRenderer.invoke('sftp:chmod', sessionId, remotePath, mode),
}

/**
 * 服务器监控 invoke 调用
 */
const monitor = {
  /** 启动监控 */
  start: (sessionId: string, interval: number): Promise<boolean> =>
    ipcRenderer.invoke('monitor:start', sessionId, interval),

  /** 停止监控 */
  stop: (sessionId: string): Promise<boolean> =>
    ipcRenderer.invoke('monitor:stop', sessionId),

  /** 获取系统静态信息 */
  getSystemInfo: (sessionId: string): Promise<SystemInfo> =>
    ipcRenderer.invoke('monitor:getSystemInfo', sessionId),
}

/**
 * 安全存储 invoke 调用
 */
const storage = {
  /** 加密保存 API Key */
  saveApiKey: (provider: string, key: string): Promise<boolean> =>
    ipcRenderer.invoke('storage:saveApiKey', provider, key),

  /** 读取并解密 API Key */
  getApiKey: (provider: string): Promise<string | null> =>
    ipcRenderer.invoke('storage:getApiKey', provider),

  /** 删除 API Key */
  deleteApiKey: (provider: string): Promise<boolean> =>
    ipcRenderer.invoke('storage:deleteApiKey', provider),
}

/**
 * 配置存储 invoke 调用
 */
const config = {
  /** 读取配置 */
  get: (key: string): Promise<unknown> =>
    ipcRenderer.invoke('config:get', key),

  /** 写入配置 */
  set: (key: string, value: unknown): Promise<boolean> =>
    ipcRenderer.invoke('config:set', key, value),
}

// ============================================================================
// 事件监听封装（主 → 渲染，单向推送）
// ============================================================================

/**
 * 创建事件监听器，返回取消监听函数
 *
 * 每个监听器注册一个 ipcRenderer.on 回调，
 * 返回的 cleanup 函数调用 ipcRenderer.removeListener 移除监听，
 * 便于 React useEffect 在组件卸载时清理。
 *
 * @param channel IPC 事件通道名
 * @param callback 事件回调
 * @returns 取消监听函数
 */
function createListener<T extends unknown[]>(
  channel: string,
  callback: (...args: T) => void
): () => void {
  const handler = (_event: IpcRendererEvent, ...args: unknown[]): void => {
    callback(...(args as T))
  }
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

/**
 * 事件监听 API
 *
 * 每个方法返回一个取消监听函数，调用后移除该监听器。
 * 推荐在 React useEffect 中使用：
 *   useEffect(() => {
 *     const off = window.electronAPI.on.terminalData((sid, data) => {...})
 *     return off  // 组件卸载时自动取消监听
 *   }, [])
 */
const on = {
  /** 监听终端 Shell 数据推送 */
  terminalData: (
    callback: (sessionId: string, data: string) => void
  ): (() => void) => createListener('terminal:data', callback),

  /** 监听监控数据推送 */
  monitorData: (
    callback: (sessionId: string, data: MonitorData) => void
  ): (() => void) => createListener('monitor:data', callback),

  /** 监听 LLM 流式 token 推送 */
  llmToken: (callback: (token: string) => void): (() => void) =>
    createListener('llm:token', callback),

  /** 监听 Agent 工作流步骤变更 */
  agentStep: (
    callback: (state: AgentWorkflowState) => void
  ): (() => void) => createListener('agent:step', callback),
}

// ============================================================================
// 暴露到渲染进程
// ============================================================================

/**
 * 通过 contextBridge 暴露 electronAPI 到 window 对象
 *
 * 渲染进程通过 window.electronAPI.* 调用主进程功能，
 * 无需也无法直接访问 ipcRenderer 或 Node.js API。
 */
contextBridge.exposeInMainWorld('electronAPI', {
  ssh,
  sftp,
  monitor,
  storage,
  config,
  on,
})

// 导出类型供 preload/index.d.ts 使用
export type ElectronAPI = {
  ssh: typeof ssh
  sftp: typeof sftp
  monitor: typeof monitor
  storage: typeof storage
  config: typeof config
  on: typeof on
}
