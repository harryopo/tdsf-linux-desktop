/**
 * Electron API 安全访问工具
 *
 * 在开发环境或 preload 加载失败时，window.electronAPI 可能不存在。
 * 此工具提供安全访问方式，避免直接引用 undefined 导致崩溃。
 */

/** 安全获取 electronAPI */
export function getElectronAPI(): Window['electronAPI'] | undefined {
  return window.electronAPI
}

/** 检查 electronAPI 是否可用 */
export function isElectronAPIAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI
}
