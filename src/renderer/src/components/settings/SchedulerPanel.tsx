/**
 * SchedulerPanel — 定时任务可视化分区
 *
 * 路由：嵌于 GeneralSettings「通知」Card 之后、ActionBar 之前。
 *
 * 功能：
 * - 展示 3 个定时任务（daily-health-check / daily-decision-archive / weekly-ops-report）
 * - 任务状态徽章（启用-绿 / 禁用-灰 / 运行中-蓝脉冲）+ Switch 开关
 * - cron 表达式 + 上次/下次执行时间 + 上次结果摘要
 * - 立即触发按钮（loading 状态用 triggering Set 维护）
 * - 实时订阅 scheduler:status 推送，更新对应任务
 *
 * 降级策略：
 * - window.electronAPI 不可用（非 Electron 环境 / preload 未加载）时
 *   显示占位提示「请在桌面应用中查看定时任务」，不崩溃、不显示 mock 数据。
 *
 * 数据流：
 *   挂载 → schedulerList() 拉取初始 tasks
 *   推送 → onSchedulerStatusChange(status) 局部更新对应 task
 *   用户 → schedulerToggle(id, enabled) / schedulerTrigger(id)
 *
 * 设计稿：spec §B（settings-general.html）
 * 视觉规范：全部使用 var(--trae-*) token，无硬编码颜色。
 */
import { useEffect, useState } from 'react'
import { Clock, CheckCircle2, XCircle, Zap } from 'lucide-react'
import type { SchedulerTaskId, SchedulerTaskStatus, TaskResult } from '@shared/scheduler-types'
import { SettingsCard } from './SettingsCard'
import { Switch } from '@/components/trae/Switch'
import { Button } from '@/components/trae/Button'

/** 调度器 API 局部类型（ElectronAPI 接口尚未补全 scheduler 字段，本地隔离） */
interface SchedulerAPI {
  schedulerList: () => Promise<SchedulerTaskStatus[]>
  schedulerToggle: (id: string, enabled: boolean) => Promise<SchedulerTaskStatus | null>
  schedulerTrigger: (id: string) => Promise<TaskResult>
  onSchedulerStatusChange: (
    callback: (status: SchedulerTaskStatus) => void,
  ) => () => void
}

/** 任务元数据：受控枚举 + 中文名 + cron + cron 描述 */
const SCHEDULER_TASKS_META: ReadonlyArray<{
  id: SchedulerTaskId
  name: string
  nameEn: string
  cron: string
  cronDescription: string
}> = [
  {
    id: 'daily-health-check',
    name: '每日健康巡检',
    nameEn: 'Daily Health Check',
    cron: '0 9 * * *',
    cronDescription: '每日 09:00 北京时间',
  },
  {
    id: 'daily-decision-archive',
    name: '每日决策归档',
    nameEn: 'Daily Decision Archive',
    cron: '0 18 * * *',
    cronDescription: '每日 18:00 北京时间',
  },
  {
    id: 'weekly-ops-report',
    name: '运维周报',
    nameEn: 'Weekly Ops Report',
    cron: '0 9 * * 1',
    cronDescription: '每周一 09:00 北京时间',
  },
]

/** 任务运行态（用于徽章配色） */
type TaskState = 'enabled' | 'disabled' | 'running'

/** 状态徽章样式（背景使用 color-mix 实现 var(--trae-*) 半透明） */
function getStatusStyle(state: TaskState): { bg: string; color: string; label: string } {
  if (state === 'enabled') {
    return {
      bg: 'color-mix(in srgb, var(--trae-status-success-default) 14%, transparent)',
      color: 'var(--trae-status-success-default)',
      label: '启用',
    }
  }
  if (state === 'running') {
    return {
      bg: 'color-mix(in srgb, var(--trae-bg-brand) 14%, transparent)',
      color: 'var(--trae-bg-brand)',
      label: '运行中',
    }
  }
  return {
    bg: 'var(--trae-bg-overlay-l2)',
    color: 'var(--trae-text-tertiary)',
    label: '禁用',
  }
}

/** 安全获取 scheduler API：不可用时返回 undefined */
function getSchedulerAPI(): SchedulerAPI | undefined {
  if (typeof window === 'undefined') return undefined
  const w = window as unknown as { electronAPI?: Partial<SchedulerAPI> }
  const api = w.electronAPI
  if (!api) return undefined
  if (
    typeof api.schedulerList !== 'function' ||
    typeof api.schedulerToggle !== 'function' ||
    typeof api.schedulerTrigger !== 'function' ||
    typeof api.onSchedulerStatusChange !== 'function'
  ) {
    return undefined
  }
  return api as SchedulerAPI
}

/** epoch ms → 'zh-CN' 字符串（hour12: false，例：2026-07-21 09:00:00） */
function formatTime(ts: number | null): string {
  if (ts == null) return '—'
  return new Date(ts).toLocaleString('zh-CN', { hour12: false })
}

export function SchedulerPanel() {
  const [tasks, setTasks] = useState<SchedulerTaskStatus[]>([])
  const [triggering, setTriggering] = useState<Set<string>>(new Set())
  const [available, setAvailable] = useState<boolean>(false)

  // 挂载时检测 API 可用性 + 拉取初始任务列表
  useEffect(() => {
    const api = getSchedulerAPI()
    if (!api) {
      setAvailable(false)
      return
    }
    setAvailable(true)
    let cancelled = false
    api.schedulerList()
      .then((list) => {
        if (!cancelled && Array.isArray(list)) setTasks(list)
      })
      .catch(() => {
        // 拉取失败保持空数组，不阻塞 UI
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 订阅任务状态变更推送（task-start / task-done / task-error 触发）
  useEffect(() => {
    const api = getSchedulerAPI()
    if (!api) return
    const off = api.onSchedulerStatusChange((status) => {
      setTasks((prev) => {
        const idx = prev.findIndex((t) => t.id === status.id)
        if (idx === -1) return [...prev, status]
        const next = prev.slice()
        next[idx] = status
        return next
      })
    })
    return off
  }, [])

  /** 切换任务启用状态（乐观更新，推送到达后由订阅纠正） */
  const handleToggle = (id: SchedulerTaskId, enabled: boolean): void => {
    const api = getSchedulerAPI()
    if (!api) return
    void api.schedulerToggle(id, enabled)
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, enabled } : t)),
    )
  }

  /** 立即触发任务（triggering Set 维护 loading 状态） */
  const handleTrigger = async (id: SchedulerTaskId): Promise<void> => {
    const api = getSchedulerAPI()
    if (!api) return
    setTriggering((prev) => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
    try {
      await api.schedulerTrigger(id)
    } finally {
      setTriggering((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  // 降级：electronAPI 不可用（非 Electron 环境）
  if (!available) {
    return (
      <SettingsCard icon={Clock} title="定时任务" tag="scheduler">
        <div
          className="flex items-center justify-center py-6 text-[12px] text-[var(--trae-text-tertiary)]"
          role="status"
        >
          请在桌面应用中查看定时任务
        </div>
      </SettingsCard>
    )
  }

  return (
    <SettingsCard icon={Clock} title="定时任务" tag="scheduler">
      <div className="flex flex-col gap-2 pt-1">
        {SCHEDULER_TASKS_META.map((meta, idx) => {
          const task = tasks.find((t) => t.id === meta.id)
          const enabled = task?.enabled ?? false
          const isRunning = triggering.has(meta.id)
          const state: TaskState = isRunning ? 'running' : enabled ? 'enabled' : 'disabled'
          const statusStyle = getStatusStyle(state)
          const lastResult = task?.lastResult ?? null
          const lastSuccess = lastResult?.success
          const lastSummary = lastResult?.summary ?? '尚未执行'
          const lastError = lastResult?.error
          const isLast = idx === SCHEDULER_TASKS_META.length - 1
          return (
            <div
              key={meta.id}
              className={
                'rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-overlay-l1)] p-3' +
                (isLast ? '' : ' mb-2')
              }
            >
              {/* 行 1：任务名 + cron + 状态徽章 + Switch */}
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[12px] font-semibold text-[var(--trae-text-default)]">
                      {meta.name}
                    </span>
                    <span className="text-[10px] text-[var(--trae-text-tertiary)]">
                      {meta.nameEn}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <code
                      className="text-[11px] text-[var(--trae-text-tertiary)]"
                      style={{ fontFamily: 'var(--trae-font-family-mono)' }}
                    >
                      {meta.cron}
                    </code>
                    <span className="text-[10px] text-[var(--trae-text-tertiary)]">
                      · {meta.cronDescription}
                    </span>
                  </div>
                </div>
                <span
                  role="status"
                  aria-label={`任务状态: ${statusStyle.label}`}
                  className={
                    'inline-flex h-5 items-center gap-1 rounded-full px-2 text-[10px] font-medium' +
                    (isRunning ? ' animate-pulse' : '')
                  }
                  style={{ backgroundColor: statusStyle.bg, color: statusStyle.color }}
                >
                  {statusStyle.label}
                </span>
                <Switch
                  checked={enabled}
                  onCheckedChange={(v) => handleToggle(meta.id, v)}
                  aria-label={`${meta.name} 启用开关`}
                />
              </div>

              {/* 行 2：上次执行 + 下次执行 */}
              <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]">
                <div className="flex items-center gap-1 text-[var(--trae-text-secondary)]">
                  <span className="text-[var(--trae-text-tertiary)]">上次:</span>
                  <span className="tabular-nums">{formatTime(task?.lastRunAt ?? null)}</span>
                  {lastResult != null &&
                    (lastSuccess ? (
                      <CheckCircle2 className="size-3 text-[var(--trae-status-success-default)]" />
                    ) : (
                      <XCircle className="size-3 text-[var(--trae-status-error-default)]" />
                    ))}
                </div>
                <div className="flex items-center gap-1 text-[var(--trae-text-secondary)]">
                  <span className="text-[var(--trae-text-tertiary)]">下次:</span>
                  <span className="tabular-nums">{formatTime(task?.nextRunAt ?? null)}</span>
                </div>
              </div>

              {/* 行 3：上次结果摘要 + 立即触发按钮 */}
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1 truncate text-[11px] text-[var(--trae-text-secondary)]">
                  {lastSuccess === false && lastError ? (
                    <span className="text-[var(--trae-status-error-default)]">{lastError}</span>
                  ) : (
                    lastSummary
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleTrigger(meta.id)}
                  disabled={isRunning}
                  aria-label={`立即触发 ${meta.name}`}
                  className="border-[var(--trae-bg-brand)] text-[var(--trae-bg-brand)] hover:bg-[var(--trae-bg-brand)] hover:text-[var(--trae-text-onbrand)]"
                >
                  <Zap className="size-3" />
                  {isRunning ? '执行中…' : '立即触发'}
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </SettingsCard>
  )
}
