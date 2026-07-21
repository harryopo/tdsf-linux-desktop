/**
 * useRecommendPath — 学习路径推荐 Hook（Sprint 9）
 *
 * 设计目标：
 * - 封装 tutorialRecommendPath IPC 调用
 * - 管理 loading / error / paths 状态
 * - 支持可选参数：goal / currentLevel / preferredCategory / maxSteps
 *
 * 输入输出契约：
 *   输入：options（可选推荐参数）
 *   输出：paths / loading / error / recommend
 *
 * 降级策略：
 * - tutorialRecommendPath 不可用 → 返回空路径 + 错误提示
 */

import { useCallback, useState } from 'react'
import type { RecommendPathOptions, TutorialPath } from '@/types/electron'

/** useRecommendPath 配置项 */
export interface UseRecommendPathOptions {
  /** 学习目标（自然语言，如"想学 Docker"） */
  goal?: string
  /** 当前水平（如 beginner / intermediate / advanced） */
  currentLevel?: string
  /** 偏好分类（如 networking） */
  preferredCategory?: string
  /** 最大步骤数（默认 8） */
  maxSteps?: number
}

/** useRecommendPath 返回值 */
export interface UseRecommendPathResult {
  /** 推荐路径列表 */
  paths: TutorialPath[]
  /** 是否正在推荐 */
  loading: boolean
  /** 错误信息（null 表示无错误） */
  error: string | null
  /** 触发路径推荐 */
  recommend: (options?: RecommendPathOptions) => Promise<void>
}

/**
 * 安全访问 electronAPI（避免直接引用 undefined 导致崩溃）
 */
function getAPI(): Record<string, unknown> | undefined {
  if (typeof window === 'undefined') return undefined
  const w = window as unknown as { electronAPI?: Record<string, unknown> }
  return w.electronAPI
}

/**
 * useRecommendPath Hook 实现
 */
export function useRecommendPath(
  defaultOptions?: UseRecommendPathOptions
): UseRecommendPathResult {
  const [paths, setPaths] = useState<TutorialPath[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ===== 检测 API 可用性 =====
  const api = getAPI()
  const hasRecommendPath = typeof api?.tutorialRecommendPath === 'function'

  // ===== recommend：触发路径推荐 =====
  const recommend = useCallback(
    async (options?: RecommendPathOptions): Promise<void> => {
      // 合并默认参数
      const mergedOptions: RecommendPathOptions = {
        ...defaultOptions,
        ...options,
      }

      // 过滤掉 undefined 值
      const cleanOptions: Record<string, unknown> = {}
      for (const key of Object.keys(mergedOptions)) {
        const value = (mergedOptions as Record<string, unknown>)[key]
        if (value !== undefined) {
          cleanOptions[key] = value
        }
      }

      if (!hasRecommendPath) {
        setError('IPC 通道不可用：tutorialRecommendPath 未暴露')
        setPaths([])
        return
      }

      setLoading(true)
      setError(null)
      try {
        const fn = api!.tutorialRecommendPath as (
          options?: RecommendPathOptions
        ) => Promise<TutorialPath[]>
        const result = await fn(
          Object.keys(cleanOptions).length > 0 ? cleanOptions : undefined
        )
        setPaths(result)
        setError(null)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error('[useRecommendPath] recommend failed:', err)
        setError(`路径推荐失败：${message}`)
        setPaths([])
      } finally {
        setLoading(false)
      }
    },
    [hasRecommendPath, defaultOptions]
  )

  return {
    paths,
    loading,
    error,
    recommend,
  }
}
