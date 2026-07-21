/**
 * usePersistentState — 带 IPC 配置持久化的 useState
 *
 * 设计目标：
 * - 作为 useState 的「直接替换」，让设置项自动通过主进程 electron-store 持久化
 * - 挂载时通过 window.electronAPI.configGet(key) 读取已保存值覆盖默认值
 * - 值变化时通过 window.electronAPI.configSet(key, value) 写回主进程
 *
 * 降级策略：
 * - 当 window.electronAPI 不可用（如纯浏览器 / preload 未加载）时，
 *   退化为普通 useState，仅使用内存默认值，UI 正常渲染、不会崩溃
 *
 * 输入输出契约：
 *   输入：key（配置键，建议 `namespace.field` 命名，如 `terminal.fontSize`）
 *         defaultValue（IPC 不可用或尚未保存时使用的默认值）
 *   输出：[value, setValue]，setValue 与 React Dispatch<SetStateAction<T>> 完全同型，
 *         因此可直接替换原有 setState（支持直接传值与函数式更新）
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'

export function usePersistentState<T>(
  key: string,
  defaultValue: T,
): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState<T>(defaultValue)

  // 是否已完成首次加载：避免加载阶段的 setState 触发回写（防止默认值覆盖已存配置）
  const loadedRef = useRef(false)

  // 挂载时从主进程读取配置
  useEffect(() => {
    let cancelled = false
    const api = window.electronAPI
    if (!api) {
      // 无 IPC：直接标记为已加载，后续变更仅在内存中生效
      loadedRef.current = true
      return
    }
    api
      .configGet<T>(key)
      .then((v) => {
        if (cancelled) return
        if (v !== null && v !== undefined) {
          setState(v)
        }
      })
      .catch((err) => {
        console.error(`[usePersistentState] 读取配置失败: ${key}`, err)
      })
      .finally(() => {
        if (!cancelled) loadedRef.current = true
      })
    return () => {
      cancelled = true
    }
  }, [key])

  // 值变化时写回主进程（跳过首次加载完成前的变化）
  useEffect(() => {
    if (!loadedRef.current) return
    const api = window.electronAPI
    if (!api) return
    api.configSet(key, state).catch((err) => {
      console.error(`[usePersistentState] 写入配置失败: ${key}`, err)
    })
  }, [key, state])

  // 与 React setState 同型的 setter，保证可直接替换原有 setState 用法
  const setValue = useCallback<Dispatch<SetStateAction<T>>>((value) => {
    setState(value)
  }, [])

  return [state, setValue]
}
