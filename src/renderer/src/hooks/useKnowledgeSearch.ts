/**
 * 知识库搜索（#184）
 *
 * 页面原来只是对「已加载的前 100 条」做本地子串过滤，库里更多条目永远搜不到；
 * 而 `kb:search` 通道一直存在、也在做真实检索（关键词 + 相似度）。这里把它接上：
 *   - 有查询词 → 防抖后走 IPC 检索（主进程口径，含中文分词与全库范围）
 *   - 空查询 → 不检索，页面继续用已加载列表（浏览模式）
 *
 * 防抖是为了不在每个按键都发一次 IPC；返回的 searching 供界面显示"正在搜"。
 */
import { useEffect, useRef, useState } from 'react'
import type { KnowledgeEntry } from '@shared/models'

export interface KnowledgeSearchState {
  /** 检索结果（空查询时为 null，调用方自行决定展示什么） */
  results: KnowledgeEntry[] | null
  /** 是否正在等 IPC 返回 */
  searching: boolean
  /** 最近一次失败的原始原因（成功后清空） */
  error: string | null
}

interface KbSearchApi {
  kbSearch: (query: string, type?: undefined, limit?: number) => Promise<KnowledgeEntry[]>
}

function resolveApi(): KbSearchApi | null {
  if (typeof window === 'undefined') return null
  const api = (window as unknown as { electronAPI?: Partial<KbSearchApi> }).electronAPI
  return typeof api?.kbSearch === 'function' ? (api as KbSearchApi) : null
}

export function useKnowledgeSearch(
  query: string,
  opts: { limit?: number; debounceMs?: number } = {}
): KnowledgeSearchState {
  const limit = opts.limit ?? 50
  const debounceMs = opts.debounceMs ?? 250
  const [state, setState] = useState<KnowledgeSearchState>({
    results: null,
    searching: false,
    error: null,
  })
  // 只认最后一次请求：慢请求晚回来不能覆盖新查询的结果
  const requestSeq = useRef(0)

  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      requestSeq.current++
      setState({ results: null, searching: false, error: null })
      return
    }
    const api = resolveApi()
    if (!api) {
      setState({ results: [], searching: false, error: '当前环境不支持知识库检索' })
      return
    }

    const seq = ++requestSeq.current
    setState((prev) => ({ ...prev, searching: true, error: null }))
    const timer = setTimeout(() => {
      api
        .kbSearch(trimmed, undefined, limit)
        .then((entries) => {
          if (seq !== requestSeq.current) return
          setState({ results: Array.isArray(entries) ? entries : [], searching: false, error: null })
        })
        .catch((err: unknown) => {
          if (seq !== requestSeq.current) return
          const reason = err instanceof Error ? err.message : String(err)
          setState({ results: [], searching: false, error: reason })
        })
    }, debounceMs)

    return () => clearTimeout(timer)
  }, [query, limit, debounceMs])

  return state
}
