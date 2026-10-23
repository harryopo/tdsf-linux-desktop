/**
 * MemorySettings — AI 记忆（设置 → AI 记忆）
 *
 * 为什么有这一页：记忆一直只在后端跑——supervisor 自动沉淀、`memory_recall` 工具读它，
 * 但用户看不到 AI 到底记住了什么，也没法删。IPC 四件（list/search/delete/audit）
 * 早就实现了，渲染层零调用（`audit:ipc` 里那一批"已暴露但零调用"）。
 *
 * 这一页只做三件事，全部走真 IPC：
 *   1. 列出 AI 记住的条目（类型 / 正文 / 为什么记 / 使用次数）
 *   2. 按关键词检索（主进程 memory:search，不是前端过滤）
 *   3. 删除单条（确认后 memory:delete，删了不再被召回）
 * 以及"沉淀审计"：记忆从哪来、被跳过多少次——写入口在 supervisor，这里只读。
 *
 * 写入不在这里：记忆由主进程在对话后自动提取（含失败教训），界面不该提供"手写记忆"的入口，
 * 否则就变成第二个知识库了。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Brain, Loader2, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button, confirmDialog } from '@/ui'
import { Empty } from '@/components/trae/Empty'
import { SettingsPageHeader } from '@/components/settings/SettingsPageHeader'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { isElectronAPIAvailable } from '@/utils/electron-api'
import { settingsHeader } from './settings-sections'
import './Settings.css'

/** 与 memory-repo 的 MemoryType 同一组值（界面只做展示分组，不改写） */
type MemoryType = 'user_profile' | 'preference' | 'environment' | 'correction' | 'fact'

interface AgentMemoryRow {
  id: string
  type: MemoryType
  key: string
  text: string
  why: string | null
  useCount: number
  updatedAt: number
}

interface MemoryAuditRow {
  ts: number
  trigger: string
  op: string
  detail: string | null
}

const TYPE_LABELS: Record<MemoryType, string> = {
  user_profile: '用户画像',
  preference: '偏好',
  environment: '环境',
  correction: '纠正',
  fact: '事实',
}

function formatTime(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return '—'
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function isMemoryRow(value: unknown): value is AgentMemoryRow {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return typeof row.id === 'string' && typeof row.text === 'string'
}

export function MemorySettings() {
  const [memories, setMemories] = useState<AgentMemoryRow[]>([])
  const [audits, setAudits] = useState<MemoryAuditRow[]>([])
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  /** 只认最后一次检索（防抖 + 慢响应乱序） */
  const searchSeq = useRef(0)

  const loadAll = useCallback(async () => {
    if (!isElectronAPIAvailable() || !window.electronAPI?.memoryList) {
      setLoading(false)
      setError('当前环境读不到本机记忆库')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [list, audit] = await Promise.all([
        window.electronAPI.memoryList(),
        window.electronAPI.memoryAudit(20),
      ])
      setMemories(Array.isArray(list) ? (list as unknown[]).filter(isMemoryRow) : [])
      setAudits(Array.isArray(audit) ? (audit as MemoryAuditRow[]) : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  const runSearch = useCallback(async (value: string) => {
    const seq = ++searchSeq.current
    const trimmed = value.trim()
    if (!trimmed) {
      void loadAll()
      return
    }
    if (!isElectronAPIAvailable() || !window.electronAPI?.memorySearch) return
    setSearching(true)
    setError(null)
    try {
      const result = await window.electronAPI.memorySearch(trimmed, 50)
      if (seq !== searchSeq.current) return
      setMemories(Array.isArray(result) ? (result as unknown[]).filter(isMemoryRow) : [])
    } catch (err) {
      if (seq !== searchSeq.current) return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (seq === searchSeq.current) setSearching(false)
    }
  }, [loadAll])

  const handleDelete = async (memory: AgentMemoryRow) => {
    const ok = await confirmDialog({
      title: '删除这条记忆',
      description: `删掉之后 AI 不会再召回它（${memory.text.slice(0, 40)}${memory.text.length > 40 ? '…' : ''}）。此操作不可撤销。`,
      okText: '删除',
      danger: true,
    })
    if (!ok) return
    try {
      const done = await window.electronAPI.memoryDelete(memory.id)
      if (!done) throw new Error('主进程没有删掉这条记忆')
      setMemories((prev) => prev.filter((m) => m.id !== memory.id))
      toast.success('已删除，AI 不会再召回它')
    } catch (err) {
      toast.error(`删除失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <div className="set-subpage">
      <SettingsPageHeader {...settingsHeader('/settings/memory')} />

      <div className="set-subpage__body">
        <SettingsCard
          icon={Brain}
          title="AI 记住的内容"
          tag="memory.list"
          className="p-5"
          hideTag
          noHeadBorder
          headMb="lg"
        >
          <p className="mb-3 text-caption text-ink-dim">
            这些是 AI 在对话后自己沉淀的条目（偏好、环境、纠正、事实与失败教训），
            聊天时会按相关度召回。写入由主进程自动完成，这里只负责查看与删除。
          </p>

          <div className="flex items-center gap-2 mb-3">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-mute" />
              <input
                type="search"
                value={query}
                aria-label="检索记忆"
                placeholder="按关键词检索（回车）"
                className="w-full rounded-(--ui-radius-control) border border-line bg-canvas py-1.5 pl-8 pr-3 text-sm text-ink outline-none focus-visible:border-accent-solid"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void runSearch(query)
                  }
                }}
              />
            </div>
            <Button variant="outline" onClick={() => void runSearch(query)} disabled={searching}>
              {searching ? <Loader2 className="size-4 animate-spin" /> : '检索'}
            </Button>
            {query.trim() && (
              <Button
                variant="ghost"
                onClick={() => {
                  setQuery('')
                  void loadAll()
                }}
              >
                清空
              </Button>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-ink-dim">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              正在读取记忆…
            </div>
          ) : error ? (
            <div className="rounded-(--ui-radius-control) bg-sunken p-3 text-caption text-warning-text">
              记忆读不出来：{error}
              <Button variant="ghost" className="ml-2" onClick={() => void loadAll()}>
                重试
              </Button>
            </div>
          ) : memories.length === 0 ? (
            <Empty
              icon={Brain}
              title={query.trim() ? '没有匹配的记忆' : 'AI 还没有记住任何东西'}
              description={
                query.trim()
                  ? '换个关键词试试，或清空搜索看全部。'
                  : '多聊几次、做过几次修复后，AI 会把可复用的偏好与结论沉淀在这里。'
              }
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {memories.map((memory) => (
                <li
                  key={memory.id}
                  className="rounded-(--ui-radius-control) border border-line bg-canvas p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-caption text-ink-dim">
                        <span className="rounded-full bg-sunken px-2 py-0.5">
                          {TYPE_LABELS[memory.type] ?? memory.type}
                        </span>
                        <span className="font-mono">{memory.key}</span>
                        <span>· 用过 {memory.useCount ?? 0} 次</span>
                        <span>· {formatTime(memory.updatedAt)}</span>
                      </div>
                      <p className="mt-1.5 text-sm text-ink">{memory.text}</p>
                      {memory.why && (
                        <p className="mt-1 text-caption text-ink-mute">为什么记：{memory.why}</p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      aria-label={`删除记忆 ${memory.key}`}
                      onClick={() => void handleDelete(memory)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SettingsCard>

        <SettingsCard
          icon={Brain}
          title="沉淀审计"
          tag="memory.audit"
          className="p-5"
          hideTag
          noHeadBorder
          headMb="lg"
        >
          <p className="mb-3 text-caption text-ink-dim">
            每次提取、写入、跳过、淘汰都会记一行。只保留审计事实，不保存被拒绝的正文。
          </p>
          {audits.length === 0 ? (
            <p className="text-caption text-ink-mute">还没有沉淀记录。</p>
          ) : (
            <ul className="flex flex-col gap-1 font-mono text-caption text-ink-dim">
              {audits.map((row, index) => (
                <li key={`${row.ts}-${index}`} className="truncate">
                  {formatTime(row.ts)} · {row.trigger} · {row.op}
                  {row.detail ? ` · ${row.detail}` : ''}
                </li>
              ))}
            </ul>
          )}
        </SettingsCard>
      </div>
    </div>
  )
}
