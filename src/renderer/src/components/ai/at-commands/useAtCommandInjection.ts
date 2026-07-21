/**
 * useAtCommandInjection - @命令注入 hook
 *
 * 职责：
 * - 管理 injectedCommands 状态（带 id 的 AtCommandChipData[]）
 * - parseAndInject(text): 解析文本中的 @命令并注入
 * - addCommand(type, args): resolve 单个命令并加入
 * - removeCommand(id): 移除单个命令
 * - clearAll(): 清空
 * - buildInjectedText(): 拼装所有 @命令的 injectedText 用于 LLM prompt
 * - stripAtCommands(text): 移除文本中的 @命令标记
 *
 * 内部使用 IPC：
 * - window.electronAPI.atResolve(type, args, source?, userId?)
 * - window.electronAPI.atParse(text, source?, userId?)
 *
 * 方案书依据：v0.9 §4.3（@命令接口契约）
 */
import { useState, useCallback } from 'react'
import type {
  AtCommand,
  AtCommandSource,
  AtCommandType,
} from '@shared/at-command-types'
import { isElectronAPIAvailable } from '../../../utils/electron-api'
import type { AtCommandChipData } from './AtCommandChip'

/** 生成简单唯一 ID（不依赖外部 uuid 库） */
function genId(): string {
  return `at-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** useAtCommandInjection 返回值 */
export interface UseAtCommandInjectionResult {
  /** 已注入的命令列表（带 id） */
  injectedCommands: AtCommandChipData[]
  /** 解析文本中的 @命令并注入（atParse 走主进程 parser）
   * @returns 解析后的纯文本（去除 @命令标记）
   */
  parseAndInject: (text: string, source?: AtCommandSource) => Promise<string>
  /** 添加单个命令（先 resolve 再加入）
   * @returns 解析后的 AtCommandChipData 或 null（resolve 失败时）
   */
  addCommand: (
    type: AtCommandType,
    args: Record<string, unknown>,
    source?: AtCommandSource
  ) => Promise<AtCommandChipData | null>
  /** 移除单个命令（按 id） */
  removeCommand: (id: string) => void
  /** 清空所有注入的命令 */
  clearAll: () => void
  /** 拼装所有 @命令的 injectedText（用于 LLM prompt 前置注入）
   * @returns 拼装后的字符串（多命令用空行分隔；空列表返回空字符串）
   */
  buildInjectedText: () => string
  /** 移除文本中的 @命令标记（纯文本处理，不调用 IPC）
   * 用正则去除 @type[args] 格式的标记
   */
  stripAtCommands: (text: string) => string
}

/**
 * @命令注入 hook
 *
 * @param defaultSource 默认来源标识（不传时为 'chat-input'）
 */
export function useAtCommandInjection(
  defaultSource: AtCommandSource = 'chat-input'
): UseAtCommandInjectionResult {
  const [injectedCommands, setInjectedCommands] = useState<AtCommandChipData[]>([])

  /** 把 AtCommand 转为 AtCommandChipData（附加 id） */
  const toChipData = useCallback((cmd: AtCommand): AtCommandChipData => {
    return { ...cmd, id: genId() }
  }, [])

  /** 解析文本中的 @命令并注入 */
  const parseAndInject = useCallback(
    async (text: string, source?: AtCommandSource): Promise<string> => {
      if (!isElectronAPIAvailable()) {
        // electronAPI 不可用时，原样返回文本（无法解析）
        return text
      }
      try {
        const result = await window.electronAPI.atParse(text, source ?? defaultSource)
        if (result.commands.length > 0) {
          const chipDataList = result.commands.map(toChipData)
          setInjectedCommands((prev) => [...prev, ...chipDataList])
        }
        return result.text
      } catch (err) {
        console.error('[useAtCommandInjection] atParse 失败:', err)
        // 失败时返回原文本（不阻塞用户输入）
        return text
      }
    },
    [defaultSource, toChipData]
  )

  /** 添加单个命令（先 resolve 再加入） */
  const addCommand = useCallback(
    async (
      type: AtCommandType,
      args: Record<string, unknown>,
      source?: AtCommandSource
    ): Promise<AtCommandChipData | null> => {
      if (!isElectronAPIAvailable()) {
        console.warn('[useAtCommandInjection] electronAPI 不可用，无法 addCommand')
        return null
      }
      try {
        const cmd = await window.electronAPI.atResolve(type, args, source ?? defaultSource)
        const chipData = toChipData(cmd)
        setInjectedCommands((prev) => [...prev, chipData])
        return chipData
      } catch (err) {
        console.error('[useAtCommandInjection] atResolve 失败:', err)
        return null
      }
    },
    [defaultSource, toChipData]
  )

  /** 移除单个命令 */
  const removeCommand = useCallback((id: string): void => {
    setInjectedCommands((prev) => prev.filter((cmd) => cmd.id !== id))
  }, [])

  /** 清空所有 */
  const clearAll = useCallback((): void => {
    setInjectedCommands([])
  }, [])

  /** 拼装所有 @命令的 injectedText */
  const buildInjectedText = useCallback((): string => {
    // 用闭包读取最新 injectedCommands（避免依赖数组触发重建）
    // 注意：此处使用 setInjectedCommands 的回调形式获取最新值不可行（set 不返回值）
    // 改为依赖 injectedCommands，让调用方 useMemo 包装
    return injectedCommands
      .map((cmd) => cmd.injectedText)
      .filter((text) => text.trim().length > 0)
      .join('\n\n')
  }, [injectedCommands])

  /** 移除文本中的 @命令标记
   * 匹配格式：
   * - @log
   * - @log[...]
   * - @log(...)
   * - @log{...}
   */
  const stripAtCommands = useCallback((text: string): string => {
    // 匹配 @type 后跟可选的 [] / () / {} 参数块
    // type 限定为 8 类已知命令，避免误删邮箱地址中的 @
    return text
      .replace(/@(log|cmd|file|metric|decision|kb|skill|server)(\[[^\]]*\]|\([^)]*\)|\{[^}]*\})?/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
  }, [])

  return {
    injectedCommands,
    parseAndInject,
    addCommand,
    removeCommand,
    clearAll,
    buildInjectedText,
    stripAtCommands,
  }
}

export default useAtCommandInjection
