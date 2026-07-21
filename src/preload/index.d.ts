/**
 * Preload TypeScript 类型声明
 *
 * 声明 window.electronAPI 的完整类型，供渲染进程使用。
 *
 * 渲染进程使用扁平调用方式：
 *   const sessionId = await window.electronAPI.sshConnect(config)
 *   const off = window.electronAPI.onTerminalData((sid, data) => {...})
 */

import type { ElectronAPI } from './index'

/**
 * window 对象的类型声明扩展
 *
 * 在全局 Window 接口上添加 electronAPI 字段，
 * 使渲染进程可以直接通过 window.electronAPI 访问 preload 暴露的 API。
 */
declare global {
  interface Window {
    /**
     * Electron Preload API（扁平化）
     *
     * 由 preload/index.ts 通过 contextBridge.exposeInMainWorld 暴露。
     * 所有方法为扁平结构，直接通过 window.electronAPI.methodName() 调用。
     */
    electronAPI: ElectronAPI
  }
}

// 显式导出 ElectronAPI，便于渲染进程类型引用
export type { ElectronAPI }
