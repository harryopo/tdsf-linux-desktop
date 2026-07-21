/**
 * useHybridSearch — 混合检索 Hook（Sprint 7 任务 F）
 *
 * 设计目标：
 * - 封装 tutorialHybridSearch / tutorialSearchStatus / tutorialBackfillEmbeddings 三个 IPC
 * - 防抖 300ms（避免频繁调用 IPC）
 * - 检测新 API 可用性，不可用时降级到 tutorialSearch（关键词搜索）+ 本地过滤
 * - 管理 SearchStatus / BackfillProgress / skipped 状态
 * - skipped 状态持久化到 localStorage（跨会话不再提示）
 *
 * 输入输出契约：
 *   输入：mode / query / debounceMs / limit / storageKey
 *   输出：results / loading / error / status / progress / skipped / backfill / skip / dismissBanner
 *
 * 降级策略：
 * 1. tutorialHybridSearch 不可用 + 用户选 semantic → 自动切回 keyword + 标记 semanticDisabled
 * 2. tutorialSearch 也不可用 → 返回空结果 + 提示"IPC 不可用"
 * 3. tutorialSearchStatus 不可用 → status=null，Banner 不渲染，搜索仍可工作（默认关键词）
 *
 * 注意：preload 暴露的 tutorialBackfillEmbeddings 是一次性同步等待返回（非流式推送），
 *      所以 progress 只能反映 "开始 / 结束 / 错误" 三个状态，中间显示 indeterminate 进度条。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  SearchMode,
  SearchStatus,
  BackfillProgress,
  BackfillResult,
  HybridSearchResult,
  SearchResultItem,
} from '@/components/tutorial/v1/hybrid-search-types'
import { toSearchResultItem } from '@/components/tutorial/v1/hybrid-search-types'
import type { TutorialEntry } from '@shared/tutorial-types'

/** useHybridSearch 配置项 */
export interface UseHybridSearchOptions {
  /** 搜索模式（keyword / semantic） */
  mode: SearchMode
  /** 搜索查询字符串 */
  query: string
  /** 防抖延迟（毫秒，默认 300） */
  debounceMs?: number
  /** 返回结果数量上限（默认 10） */
  limit?: number
  /** 知识类型过滤（默认 'tutorial'） */
  type?: 'tutorial' | 'command_skill' | 'incident_case'
  /** localStorage 持久化 key（默认 'tutorial:hybrid-search:skipped'） */
  storageKey?: string
  /** 是否启用首次引导 Banner（默认 true） */
  bannerEnabled?: boolean
}

/** useHybridSearch 返回值 */
export interface UseHybridSearchResult {
  /** 搜索结果（已转换为 UI 友好格式） */
  results: SearchResultItem[]
  /** 是否正在搜索 */
  loading: boolean
  /** 错误信息（null 表示无错误） */
  error: string | null
  /** 检索能力快照（null 表示 API 不可用） */
  status: SearchStatus | null
  /** 回填进度（null 表示尚未开始下载） */
  progress: BackfillProgress | null
  /** 是否已跳过 Banner（持久化到 localStorage） */
  skipped: boolean
  /** 语义模式是否可用（受 status.vectorEnabled + status.embeddingModelLoaded 影响） */
  semanticAvailable: boolean
  /** 触发模型下载 + embedding 回填 */
  backfill: () => Promise<void>
  /** 跳过本次提示（持久化 skipped=true） */
  skip: () => void
  /** 关闭 Banner（仅当前会话，不持久化） */
  dismissBanner: () => void
  /** Banner 是否可见（status / skipped / dismissed / progress 综合判断） */
  bannerVisible: boolean
}

/**
 * 安全访问 electronAPI（避免直接引用 undefined 导致崩溃）
 *
 * 返回 unknown 类型，由调用方做类型断言（避免 electron.d.ts 类型不完整时编译报错）
 */
function getAPI(): Record<string, unknown> | undefined {
  if (typeof window === 'undefined') return undefined
  const w = window as unknown as { electronAPI?: Record<string, unknown> }
  return w.electronAPI
}

/**
 * 读取 localStorage 中 skipped 状态
 */
function readSkipped(storageKey: string): boolean {
  try {
    return localStorage.getItem(storageKey) === '1'
  } catch {
    return false
  }
}

/**
 * 写入 localStorage 中 skipped 状态
 */
function writeSkipped(storageKey: string, value: boolean): void {
  try {
    if (value) {
      localStorage.setItem(storageKey, '1')
    } else {
      localStorage.removeItem(storageKey)
    }
  } catch {
    // localStorage 不可用时静默失败（如隐私模式）
  }
}

/**
 * useHybridSearch Hook 实现
 */
export function useHybridSearch(options: UseHybridSearchOptions): UseHybridSearchResult {
  const {
    mode,
    query,
    debounceMs = 300,
    limit = 10,
    type = 'tutorial',
    storageKey = 'tutorial:hybrid-search:skipped',
    bannerEnabled = true,
  } = options

  // ===== 状态 =====
  const [results, setResults] = useState<SearchResultItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<SearchStatus | null>(null)
  const [progress, setProgress] = useState<BackfillProgress | null>(null)
  const [skipped, setSkipped] = useState<boolean>(() => readSkipped(storageKey))
  const [dismissed, setDismissed] = useState<boolean>(false)

  // ===== 检测新 API 可用性 =====
  // 在每次渲染时检测（不会触发 re-render，仅用于决策）
  const api = getAPI()
  const hasHybridSearch = typeof api?.tutorialHybridSearch === 'function'
  const hasSearchStatus = typeof api?.tutorialSearchStatus === 'function'
  const hasBackfill = typeof api?.tutorialBackfillEmbeddings === 'function'
  const hasLegacySearch = typeof api?.tutorialSearch === 'function'

  // 语义模式可用性：vectorEnabled && embeddingModelLoaded && hasHybridSearch
  // 注意：status 为 null 时（API 不可用），semanticAvailable=false
  const semanticAvailable =
    hasHybridSearch &&
    hasBackfill &&
    (status?.vectorEnabled ?? false) &&
    (status?.embeddingModelLoaded ?? false)

  // ===== 启动时拉取检索状态 =====
  useEffect(() => {
    if (!hasSearchStatus) {
      setStatus(null)
      return
    }
    let cancelled = false
    const fn = api!.tutorialSearchStatus as () => Promise<SearchStatus>
    fn()
      .then((s) => {
        if (!cancelled) setStatus(s)
      })
      .catch((err) => {
        console.warn('[useHybridSearch] tutorialSearchStatus failed:', err)
        if (!cancelled) setStatus(null)
      })
    return () => {
      cancelled = true
    }
  }, [hasSearchStatus])

  // ===== 防抖搜索 =====
  // 用 ref 保存最新的 IPC 调用函数，避免 useEffect 频繁重建
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<number>(0) // 自增 ID，用于丢弃过期的异步结果

  useEffect(() => {
    // 清理上一次的防抖定时器
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current)
    }

    const trimmedQuery = query.trim()
    // 空查询：清空结果
    if (trimmedQuery === '') {
      setLoading(false)
      setError(null)
      setResults([])
      abortRef.current += 1 // 让进行中的异步结果失效
      return
    }

    // 启动 loading（防抖期间也显示 loading）
    setLoading(true)
    setError(null)

    // 防抖延迟后执行实际搜索
    searchTimerRef.current = setTimeout(() => {
      const currentCallId = abortRef.current + 1
      abortRef.current = currentCallId
      void doSearch(trimmedQuery, currentCallId)
    }, debounceMs)

    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current)
      }
    }
    // 依赖包含 semanticAvailable：模型加载完成（status 变化）后，
    // 语义模式才能走正常路径而非降级路径，需重建 effect 捕获最新闭包
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, mode, debounceMs, limit, type, hasHybridSearch, hasLegacySearch, semanticAvailable])

  /**
   * 实际执行搜索（根据 mode 和 API 可用性选择路径）
   */
  async function doSearch(q: string, callId: number): Promise<void> {
    try {
      // ===== 语义模式（需要 tutorialHybridSearch 可用 + 状态满足）=====
      if (mode === 'semantic') {
        if (!hasHybridSearch) {
          // 降级 1：tutorialHybridSearch 不可用，自动用关键词
          await doLegacySearch(q, callId)
          return
        }
        if (!semanticAvailable) {
          // 降级 2：模型未加载，自动用关键词
          // 同时提示用户（通过 status / banner 触发）
          await doLegacySearch(q, callId)
          return
        }
        // 正常路径：调用混合检索
        const fn = api!.tutorialHybridSearch as (
          query: string,
          options?: { type?: string; limit?: number; useVector?: boolean }
        ) => Promise<HybridSearchResult[]>
        const raw = await fn(q, { type, limit, useVector: true })
        // 丢弃过期结果
        if (abortRef.current !== callId) return
        const items = raw.map(toSearchResultItem)
        setResults(items)
        setError(null)
        return
      }

      // ===== 关键词模式 =====
      // 优先用 tutorialHybridSearch（关闭 vector），降级到 tutorialSearch
      if (hasHybridSearch) {
        const fn = api!.tutorialHybridSearch as (
          query: string,
          options?: { type?: string; limit?: number; useVector?: boolean }
        ) => Promise<HybridSearchResult[]>
        const raw = await fn(q, { type, limit, useVector: false })
        if (abortRef.current !== callId) return
        const items = raw.map(toSearchResultItem)
        setResults(items)
        setError(null)
        return
      }

      // 降级：tutorialSearch（Jaccard 关键词搜索）
      await doLegacySearch(q, callId)
    } catch (err) {
      // 丢弃过期结果
      if (abortRef.current !== callId) return
      const message = err instanceof Error ? err.message : String(err)
      console.error('[useHybridSearch] search failed:', err)
      setError(`搜索失败：${message}`)
      setResults([])
    } finally {
      if (abortRef.current === callId) {
        setLoading(false)
      }
    }
  }

  /**
   * 降级路径：调用 tutorialSearch（返回 TutorialEntry[]）并转换为 SearchResultItem
   *
   * 由于 tutorialSearch 返回 TutorialEntry[]（无 rrfScore/ftsScore/vecDistance），
   * 我们用占位值构造 SearchResultItem：
   * - source: 'fts'（标记为关键词命中）
   * - rrfScore: 0.02（占位，对应 scorePercent≈20）
   * - ftsScore: -1（占位）
   * - vecDistance: -1（未参与向量检索）
   */
  async function doLegacySearch(q: string, callId: number): Promise<void> {
    if (!hasLegacySearch) {
      if (abortRef.current !== callId) return
      setError('IPC 通道不可用：tutorialSearch 与 tutorialHybridSearch 均未暴露')
      setResults([])
      return
    }
    const fn = api!.tutorialSearch as (
      query: string,
      limit?: number
    ) => Promise<TutorialEntry[]>
    const list = await fn(q, limit)
    if (abortRef.current !== callId) return
    // 转换：TutorialEntry → HybridSearchResult → SearchResultItem
    const items: SearchResultItem[] = list.map((t) => {
      const hybrid: HybridSearchResult = {
        id: t.id,
        title: t.title,
        problem: t.summary || '',
        category: (t.tags ?? [])[0],
        ftsScore: -1, // 占位（Jaccard 搜索无原始分）
        vecDistance: -1, // 未参与向量检索
        rrfScore: 0.02, // 占位（让 UI 显示一个低分数，区分混合检索结果）
        source: 'fts',
      }
      return toSearchResultItem(hybrid)
    })
    setResults(items)
    setError(null)
  }

  // ===== backfill：触发模型下载 + embedding 回填 =====
  const backfill = useCallback(async (): Promise<void> => {
    if (!hasBackfill) {
      setError('IPC 通道不可用：tutorialBackfillEmbeddings 未暴露')
      return
    }
    // 进入下载阶段（indeterminate 进度）
    setProgress({
      phase: 'downloading-model',
      current: 0,
      total: -1, // 未知
    })
    setDismissed(false) // 重新显示 Banner
    try {
      const fn = api!.tutorialBackfillEmbeddings as (
        options?: { batchSize?: number }
      ) => Promise<BackfillResult>
      const result = await fn({ batchSize: 8 })
      if (result.failed > 0 && result.success === 0) {
        // 全部失败
        setProgress({
          phase: 'error',
          current: 0,
          total: 0,
          errorMessage: result.error ?? `全部 ${result.failed} 条目回填失败`,
        })
      } else {
        // 成功（或部分成功）
        setProgress({
          phase: 'done',
          current: result.success,
          total: result.total,
        })
        // 重新拉取 status（模型已加载）
        if (hasSearchStatus) {
          const statusFn = api!.tutorialSearchStatus as () => Promise<SearchStatus>
          const s = await statusFn()
          setStatus(s)
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[useHybridSearch] backfill failed:', err)
      setProgress({
        phase: 'error',
        current: 0,
        total: 0,
        errorMessage: message,
      })
    }
  }, [hasBackfill, hasSearchStatus])

  // ===== skip：跳过 Banner（持久化） =====
  const skip = useCallback((): void => {
    setSkipped(true)
    writeSkipped(storageKey, true)
  }, [storageKey])

  // ===== dismissBanner：仅当前会话关闭 =====
  const dismissBanner = useCallback((): void => {
    setDismissed(true)
    // 同时清空 progress（done/error 状态消失）
    setProgress(null)
  }, [])

  // ===== bannerVisible 综合判断 =====
  // 显示条件：
  // 1. bannerEnabled=true
  // 2. skipped=false
  // 3. dismissed=false
  // 4. status 不为 null（API 可用）
  // 5. status.embeddingModelLoaded=false 或 progress 在进行中/done/error
  const bannerVisible =
    bannerEnabled &&
    !skipped &&
    !dismissed &&
    status !== null &&
    (!status.embeddingModelLoaded ||
      progress?.phase === 'downloading-model' ||
      progress?.phase === 'generating-embeddings' ||
      progress?.phase === 'done' ||
      progress?.phase === 'error')

  return {
    results,
    loading,
    error,
    status,
    progress,
    skipped,
    semanticAvailable,
    backfill,
    skip,
    dismissBanner,
    bannerVisible,
  }
}
