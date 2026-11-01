// @vitest-environment jsdom
/**
 * 引擎健康横幅（2026-11-01）
 *
 * 判据只认三件事：崩溃/重启要说人话、彻底不重启要红色并保留、就绪要消失。
 * 另外钉一条容易被写漏的：同一次状态关掉后不再弹，但下一次状态跳变要重新出现
 * （否则"知道了"会把这个引擎永久静音，正好最该看见的时候看不见）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { SidecarHealthBanner } from '@/components/layout/SidecarHealthBanner'
import type { SidecarHealthState } from '@shared/sidecar-types'

let emit: ((s: SidecarHealthState) => void) | null = null
const sidecarStatus = vi.fn()

function installApi(status: Record<string, unknown> = { status: 'stopped', lastError: null, restartCount: 0 }) {
  sidecarStatus.mockResolvedValue(status)
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      sidecarStatus,
      onSidecarStateChanged: (cb: (s: SidecarHealthState) => void) => {
        emit = cb
        return () => {
          emit = null
        }
      },
    },
  })
}

function push(state: Partial<SidecarHealthState>): void {
  act(() => {
    emit?.({
      phase: 'crashed',
      restartAttempt: 1,
      nextRetryInMs: null,
      exhausted: false,
      detail: null,
      ...state,
    })
  })
}

beforeEach(() => {
  emit = null
  sidecarStatus.mockReset()
  installApi()
})

describe('SidecarHealthBanner', () => {
  it('没崩（stopped/ready）时什么都不渲染', async () => {
    await act(async () => {
      render(<SidecarHealthBanner />)
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    push({ phase: 'crashed', restartAttempt: 1, nextRetryInMs: 2_000 })
    expect(screen.getByRole('status')).toBeInTheDocument()
    push({ phase: 'ready', restartAttempt: 0, nextRetryInMs: null })
    expect(screen.queryByRole('status'), '恢复后必须消失').not.toBeInTheDocument()
  })

  it('说清"第几次 / 还有多久 / 为什么退出"', async () => {
    await act(async () => {
      render(<SidecarHealthBanner />)
    })
    push({
      phase: 'crashed',
      restartAttempt: 2,
      nextRetryInMs: 4_000,
      detail: '进程退出（code=1, signal=null）',
    })
    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent('第 2 次')
    expect(banner).toHaveTextContent('约 4 秒后重试')
    expect(banner).toHaveTextContent('code=1')
  })

  it('预算烧光是红色的一档，并说清"已停止自动重启"', async () => {
    await act(async () => {
      render(<SidecarHealthBanner />)
    })
    push({ phase: 'crashed', restartAttempt: 3, nextRetryInMs: null, exhausted: true })
    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent('已停止自动重启')
    expect(banner.className).toContain('is-critical')
  })

  it('"知道了"只静音这一次；下一次状态跳变要重新出现', async () => {
    await act(async () => {
      render(<SidecarHealthBanner />)
    })
    push({ phase: 'crashed', restartAttempt: 1, nextRetryInMs: 2_000 })
    act(() => {
      screen.getByRole('button', { name: '知道了' }).click()
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    // 同一状态再推一次：仍然静音
    push({ phase: 'crashed', restartAttempt: 1, nextRetryInMs: 2_000 })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    // 第二次重启：重新出现（否则最该看见的时候看不见）
    push({ phase: 'crashed', restartAttempt: 2, nextRetryInMs: 4_000 })
    expect(screen.getByRole('status')).toHaveTextContent('第 2 次')
  })
})
