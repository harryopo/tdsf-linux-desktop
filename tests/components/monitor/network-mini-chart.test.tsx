/**
 * 网络卡那条迷你折线画的是真采样（用户 2026-10-16："假的UI都检查一下，做成真功能"）
 *
 * 原来这块整条是写死的：两条 path 的坐标 + ↑1.2 / ↓0.8 两个标签全是字符串，
 * 而真实收发序列其实一直在算（旧字段 sparkline 四张卡都填、没人读）。
 * 于是监控页最上面那张卡每次都在讲一件没发生过的事。
 *
 * 判据分两层，缺一条都会留洞：
 *   1. 纯函数：值→点串要按给定满刻度线性映射；两个点以下或刻度<=0 返回 null（不画）
 *   2. 组件：喂两组不同的真实序列，画出来的 path 与标签必须不同（阳性对照——
 *      否则"path 存在"这个断言对写死的字符串同样成立）
 */
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { KpiCard } from '@renderer/components/monitor/KpiCard'
import { miniLinePoints } from '@renderer/components/monitor/monitor-model'
import type { KpiStat } from '@renderer/components/monitor/monitor-model'

function netStat(series: { in: number[]; out: number[] } | undefined): KpiStat {
  return {
    label: '网络 I/O',
    value: 12,
    unit: 'KB/s',
    sub: '↓12 ↑8',
    delta: null,
    trend: null,
    ringColor: 'var(--accent-text)',
    netSeries: series,
  }
}

describe('miniLinePoints：值到点串的映射', () => {
  const box = { x0: 8, x1: 64, baseY: 36, spanY: 28 }

  it('首点在左、末点在右，值最大的那点贴到刻度顶', () => {
    const pts = miniLinePoints([0, 5, 10], 10, box)
    expect(pts, '三个点画不出线就是量具坏了').not.toBeNull()
    const pairs = pts!.split(' ').map((p) => p.split(',').map(Number))
    expect(pairs[0]).toEqual([8, 36])
    expect(pairs[2]).toEqual([64, 8]) // 满刻度 → baseY - spanY
    expect(pairs[1][1]).toBeCloseTo(22, 1) // 半刻度
  })

  it('下行用带符号刻度：同一个值画到中线另一侧', () => {
    const up = miniLinePoints([0, 10], 10, box)
    const down = miniLinePoints([0, 10], 10, { ...box, spanY: -28 })
    expect(up!.endsWith('64.0,8.0'), `上行末点该在上方：${up}`).toBe(true)
    expect(down!.endsWith('64.0,64.0'), `下行末点该在下方：${down}`).toBe(true)
  })

  it('点不够或刻度非正就不画（一个点不能演成"一直很稳"）', () => {
    expect(miniLinePoints([], 10, box)).toBeNull()
    expect(miniLinePoints([7], 10, box)).toBeNull()
    expect(miniLinePoints([0, 0], 0, box)).toBeNull()
  })
})

describe('网络卡：折线与标签跟着数据变', () => {
  it('两组不同序列画出不同的 path 和标签', () => {
    const quiet = render(<KpiCard stat={netStat({ in: [1, 2], out: [3, 4] })} />)
    const busy = render(<KpiCard stat={netStat({ in: [40, 90], out: [5, 6] })} />)
    // 只量迷你图那个 svg：卡片右上角的图标也是 svg path，混在一起数会凭空多两条
    const pathsOf = (container: HTMLElement) =>
      Array.from(container.querySelectorAll('.mon-net-mini-wrap svg path')).map(
        (p) => p.getAttribute('d') ?? '',
      )

    const quietPaths = pathsOf(quiet.container)
    const busyPaths = pathsOf(busy.container)
    expect(quietPaths.length, '一条线都没画，说明序列没接上').toBeGreaterThanOrEqual(2)
    expect(busyPaths, '换了数据画出来一模一样 = 还是写死的').not.toEqual(quietPaths)

    // 标签取当拍真实值（写死的旧版永远是 ↑1.2 / ↓0.8）
    const textOf = (container: HTMLElement) =>
      Array.from(container.querySelectorAll('.mon-net-mini-wrap svg text'))
        .map((t) => t.textContent ?? '')
        .join('|')
    expect(textOf(quiet.container)).toBe('↑4.0|↓2.0')
    expect(textOf(busy.container)).toBe('↑6.0|↓90')
  })

  it('轻载速率保留一位小数（KB/s 常见 0.4，取整会显示成 0 而线明明非零）', () => {
    const { container } = render(<KpiCard stat={netStat({ in: [0.2, 0.4], out: [1, 1.2] })} />)
    const text = Array.from(container.querySelectorAll('.mon-net-mini-wrap svg text'))
      .map((t) => t.textContent ?? '')
      .join('|')
    expect(text).toBe('↑1.2|↓0.4')
    expect(text, '标签里出现 0 就是在把非零流量说成没有').not.toContain('↓0|')
  })

  it('采不到两个点时不画线，但也不留一句假读数', () => {
    const { container } = render(<KpiCard stat={netStat({ in: [3], out: [7] })} />)
    expect(
      container.querySelectorAll('.mon-net-mini-wrap svg path').length,
      '单点不该被连成趋势线',
    ).toBe(0)
    expect(container.textContent ?? '').not.toContain('1.2')
  })
})
