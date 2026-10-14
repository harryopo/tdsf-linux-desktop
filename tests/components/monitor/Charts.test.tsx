/**
 * tests/components/monitor/Charts.test.tsx
 * recharts 图表在 React 19 + recharts 3 下的真渲染测试（阶段 B）
 *
 * 为什么必须有：监控页在无 SSH 会话时四个图表都走 EmptyMonitorState 占位，
 * 真机跑不到 recharts 的绘图分支 —— 而 recharts 2→3 恰恰是本轮唯一的大版本跳。
 * 这里灌入监控数据，让 AreaChart/LineChart/BarChart 真的画出来。
 *
 * 同时钉住升级引入的那个崩溃：无数据时选择器返回稳定空数组，
 * 有数据时正常出图，两种情况下都不许触发 "Maximum update depth exceeded"。
 *
 * 两处测试脚手架（都不进产品代码）：
 * - MemoryRouter：EmptyMonitorState 无条件调 useNavigate()，没有 Router 会抛
 * - 本地 ResizeObserver：全局 polyfill 的 observe() 是空实现，
 *   ResponsiveContainer 拿不到尺寸就不渲染任何 svg，等于什么都没测
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import {
  CpuAreaChart,
  DiskIoBarChart,
  MemoryLineChart,
  NetworkFlowChart,
} from '@renderer/components/monitor/Charts'
import { useMonitorStore } from '@renderer/stores/monitor-store'
import { useServerStore } from '@renderer/stores/server-store'
import type { MonitorData } from '@shared/models'

/** 容器上报的假尺寸（与 Charts.tsx 的 CHART_H 对齐） */
const BOX = { width: 600, height: 140 }

beforeAll(() => {
  globalThis.ResizeObserver = class {
    private readonly callback: ResizeObserverCallback
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback
    }
    observe(target: Element): void {
      const rect = { ...BOX, top: 0, left: 0, bottom: 0, right: 0, x: 0, y: 0 }
      this.callback(
        [{ contentRect: rect, target, borderBoxSize: [], contentBoxSize: [] }] as unknown as ResizeObserverEntry[],
        this as unknown as ResizeObserver,
      )
    }
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver
})

/** 造 n 条时间递增的监控数据（字段严格对齐 @shared/models 的 MonitorData） */
function makeSeries(count: number): MonitorData[] {
  const base = Date.now() - count * 1000
  return Array.from({ length: count }, (_, i) => ({
    timestamp: base + i * 1000,
    cpuUsage: 10 + i,
    memoryUsage: 20 + i,
    diskUsage: 30 + i,
    networkIn: 1024 * (i + 1),
    networkOut: 2048 * (i + 1),
    loadAverage: 0.5 + i / 10,
    uptime: 3600 + i,
    processCount: 100 + i,
  }))
}

/** 包一层 Router 再渲染 */
function renderChart(node: React.ReactElement) {
  return render(<MemoryRouter>{node}</MemoryRouter>)
}

beforeEach(() => {
  const monitor = useMonitorStore.getState()
  monitor.clearAllMonitorData()
  // 图表按 activeSessionId 取数，先把它钉成一个有数据的会话
  useServerStore.setState({ activeSessionId: 'sess-chart' })
  makeSeries(8).forEach((d) => monitor.addMonitorData('sess-chart', d))
})

describe('recharts 3 真渲染', () => {
  it('1. CPU 面积图画出 svg 与面积路径，不再退回空状态', () => {
    const { container } = renderChart(<CpuAreaChart />)
    expect(screen.queryByText(/暂无CPU监控数据/)).toBeNull()
    expect(container.querySelector('.recharts-surface')).not.toBeNull()
    expect(container.querySelector('.recharts-area-area')).not.toBeNull()
  })

  it('2. 内存折线图画出折线', () => {
    const { container } = renderChart(<MemoryLineChart />)
    expect(container.querySelector('.recharts-surface')).not.toBeNull()
    expect(container.querySelector('.recharts-line-curve')).not.toBeNull()
  })

  it('3. 磁盘 IO 柱状图画出柱子', () => {
    const { container } = renderChart(<DiskIoBarChart />)
    expect(container.querySelector('.recharts-surface')).not.toBeNull()
    expect(container.querySelector('.recharts-bar-rectangle')).not.toBeNull()
  })

  it('4. 网络流量图画出折线', () => {
    const { container } = renderChart(<NetworkFlowChart />)
    expect(container.querySelector('.recharts-surface')).not.toBeNull()
    expect(container.querySelector('.recharts-line-curve')).not.toBeNull()
  })

  it('5. 无数据会话下渲染不触发无限重渲染（React 19 + zustand 5 回归）', () => {
    useServerStore.setState({ activeSessionId: 'sess-empty' })
    // Maximum update depth exceeded 会以抛错形式冒出来，render 不抛即为通过
    expect(() => renderChart(<CpuAreaChart />)).not.toThrow()
    expect(screen.getByText(/暂无CPU监控数据/)).toBeInTheDocument()
  })

  it('6. x 轴刻度只能来自真实采样点（写死的 00:00/06:00/12:00 时间轴已删）', () => {
    const { container } = renderChart(<CpuAreaChart />)
    const ticks = [...container.querySelectorAll('.mon-chart-axis span')].map((el) => el.textContent)
    expect(ticks.length).toBeGreaterThan(0)
    const real = new Set(
      makeSeries(8).map((d) => {
        const t = new Date(d.timestamp)
        return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
      })
    )
    for (const tick of ticks) expect(real.has(tick ?? ''), `刻度 ${tick} 不在数据时间里`).toBe(true)
  })

  it('7. 无数据时不渲染时间轴（不给空图配一条假刻度）', () => {
    useServerStore.setState({ activeSessionId: 'sess-empty' })
    const { container } = renderChart(<CpuAreaChart />)
    expect(container.querySelector('.mon-chart-axis')).toBeNull()
  })
})