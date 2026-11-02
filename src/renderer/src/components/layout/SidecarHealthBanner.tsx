/**
 * SidecarHealthBanner — Python 分析引擎崩溃/重启的全局横幅（2026-11-01）
 *
 * 为什么需要它：引擎（Sidecar-A）崩溃后只在日志里、或在日志页「AI 日志分析」里按一下才看得到；
 * 用户在工作台只会觉得"AI 日志分析忽然不好使"。本横幅把 sidecar:state-changed 的事实
 * 摊到所有页面顶部：崩了没、正在第几次自动重启、还有几秒、还是彻底不重启了。
 *
 * 显示规则：
 * - ready / stopped / starting → 不显示（懒启动那几秒由日志面板自己说）
 * - crashed 且还有预算 → 黄色「正在自动重启（第 N 次，约 X 秒后）」
 * - crashed 且预算烧光 → 红色「已停止自动重启」，要一直说到有人处理
 * - degraded → 黄色「降级运行」
 * - 同一个状态（同一次尝试）关掉后不再弹；下一次状态跳变会重新出现
 */
import { type FC, useEffect, useState } from 'react'
import type { SidecarHealthState } from '@shared/sidecar-types'
import './SidecarHealthBanner.css'

/** 初始取值：横幅刚挂上时引擎可能已经崩过，先问一次当前状态 */
async function readInitialState(): Promise<SidecarHealthState | null> {
  const api = window.electronAPI
  if (!api?.sidecarStatus) return null
  try {
    const st = await api.sidecarStatus()
    return {
      phase: st.status,
      restartAttempt: st.restartCount ?? 0,
      nextRetryInMs: null,
      exhausted: false,
      detail: st.lastError ?? null,
    }
  } catch {
    return null
  }
}

function describe(state: SidecarHealthState): { title: string; detail: string; critical: boolean } | null {
  if (state.phase === 'ready' || state.phase === 'starting') return null
  if (state.phase === 'stopped') {
    // 没被叫过（懒启动）不打扰用户；但"试起来过、起不来"必须说——这台机器就是缺 Python，
    // 以前这一档被当成"只是没运行"静默掉，用户只知道 AI 日志分析点了没结果。
    return state.detail ? { title: 'AI 日志分析引擎没能启动', detail: state.detail, critical: false } : null
  }
  if (state.phase === 'degraded') {
    return {
      title: 'AI 日志分析引擎正在降级运行',
      detail: state.detail ?? '部分分析能力不可用，日志与教程不受影响',
      critical: false,
    }
  }
  if (state.exhausted) {
    return {
      title: 'AI 日志分析引擎已停止自动重启',
      detail: state.detail ?? '短时间内连续崩溃多次，已放弃自动重试',
      critical: true,
    }
  }
  const attempt = Math.max(1, state.restartAttempt)
  const seconds = state.nextRetryInMs === null ? null : Math.max(1, Math.round(state.nextRetryInMs / 1000))
  return {
    title: `AI 日志分析引擎崩溃，正在自动重启（第 ${attempt} 次）`,
    detail: `${seconds === null ? '即将重试' : `约 ${seconds} 秒后重试`}${state.detail ? ` · ${state.detail}` : ''}`,
    critical: false,
  }
}

export const SidecarHealthBanner: FC = () => {
  const [state, setState] = useState<SidecarHealthState | null>(null)
  const [dismissedKey, setDismissedKey] = useState<string | null>(null)

  useEffect(() => {
    const api = window.electronAPI
    let cancelled = false
    void readInitialState().then((initial) => {
      if (!cancelled && initial) setState((prev) => prev ?? initial)
    })
    const off = api?.onSidecarStateChanged?.((next) => {
      if (!cancelled) setState(next)
    })
    return () => {
      cancelled = true
      off?.()
    }
  }, [])

  if (!state) return null
  const view = describe(state)
  if (!view) return null

  const key = `${state.phase}:${state.restartAttempt}:${state.exhausted}`
  if (key === dismissedKey) return null

  return (
    <div
      className={`sidecar-health-banner ${view.critical ? 'is-critical' : 'is-warning'}`}
      role="status"
      data-dom-id="sidecar-health-banner"
    >
      <span className="sidecar-health-banner__mark">!</span>
      <span className="sidecar-health-banner__text">
        <strong>{view.title}</strong>
        <span className="sidecar-health-banner__detail">{view.detail}</span>
      </span>
      <button
        type="button"
        className="sidecar-health-banner__close"
        data-dom-id="sidecar-health-dismiss"
        onClick={() => setDismissedKey(key)}
      >
        知道了
      </button>
    </div>
  )
}
