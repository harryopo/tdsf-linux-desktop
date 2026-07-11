/**
 * Preload TypeScript 类型声明
 *
 * 声明 window.electronAPI 的完整类型，供渲染进程使用。
 *
 * 类型来源：
 * - 直接从 preload/index.ts 的 ElectronAPI 类型导入
 * - 同时从 shared/models.ts 导入 IpcChannelMap 作为类型校验参考
 *
 * 渲染进程使用方式：
 *   const sessionId = await window.electronAPI.ssh.connect(config)
 *   const off = window.electronAPI.on.terminalData((sid, data) => {...})
 */

import type { ElectronAPI } from './index'
import type { IpcChannelMap } from '@shared/models'

/**
 * window 对象的类型声明扩展
 *
 * 在全局 Window 接口上添加 electronAPI 字段，
 * 使渲染进程可以直接通过 window.electronAPI 访问 preload 暴露的 API。
 */
declare global {
  interface Window {
    /**
     * Electron Preload API
     *
     * 由 preload/index.ts 通过 contextBridge.exposeInMainWorld 暴露。
     * 包含 SSH/SFTP/监控/存储/配置的 invoke 调用，以及事件监听。
     *
     * 类型与 preload/index.ts 中导出的 ElectronAPI 一致，
     * 通道与 IpcChannelMap 一一对应。
     */
    electronAPI: ElectronAPI
  }
}

/**
 * IpcChannelMap 类型引用
 *
 * 此处的导入仅用于类型校验目的，确保 preload 暴露的通道
 * 与 IpcChannelMap 中定义的通道保持一致。
 * 实际类型约束通过 ElectronAPI 实现。
 */
export type { IpcChannelMap }

// 显式导出 ElectronAPI，便于渲染进程类型引用
export type { ElectronAPI }
