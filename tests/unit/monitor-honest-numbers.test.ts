/**
 * tests/unit/monitor-honest-numbers.test.ts —— 监控页那两个假数字（#102 真机验收）
 *
 * 真机实测到的两件事，都在这里钉住：
 *   1. 趋势行写"较昨日"，算的却是 data[length-2] 与 data[length-1] 之差——
 *      采样间隔 3 秒，所以 "-6% 较昨日" 其实是"较 3 秒前"。本机根本没有
 *      跨重启的 24 小时历史（monitor-store 只留 60 个点）。
 *   2. 四张图标题固定写 "(24h)"，而手里最多 3 分钟数据。
 * 判据口径：宁可少画一行，也不许画一个没有依据的箭头。
 */
import { describe, it, expect } from 'vitest'
import {
  computeKpiStats,
  trendOf,
  spanLabel,
  humanSpan,
} from '../../src/renderer/src/components/monitor/monitor-model'
import type { MonitorData } from '../../src/shared/models'

function sample(over: Partial<MonitorData>): MonitorData {
  return {
    timestamp: Date.now(),
    cpuUsage: 0,
    memoryUsage: 45,
    diskUsage: 28,
    networkIn: 0,
    networkOut: 1,
    loadAverage: 0.03,
    uptime: 44 * 3600,
    processCount: 150,
    ...over,
  }
}

describe('趋势差值：没有可信基准就不许给方向', () => {
  it('只有一拍时没有"上一次"可比 → delta 与 trend 都是 null', () => {
    const [cpu] = computeKpiStats([sample({})])!
    expect(cpu.delta).toBeNull()
    expect(cpu.trend).toBeNull()
  })

  it('两拍相同 → 仍然是 null（差值 0 配箭头是在制造主张）', () => {
    const r = computeKpiStats([sample({ cpuUsage: 10 }), sample({ cpuUsage: 10 })])!
    expect(r[0].delta).toBeNull()
    expect(r[0].trend).toBeNull()
  })

  it('差值四舍五入后为 0（45.4 → 45.2）→ 不给箭头', () => {
    expect(trendOf(45.2, 45.4)).toEqual({ delta: null, trend: null })
  })

  it('正向对照：真有变化时方向与数值都对', () => {
    expect(trendOf(51, 45)).toEqual({ delta: 6, trend: 'up' })
    expect(trendOf(45, 51)).toEqual({ delta: -6, trend: 'down' })
    const r = computeKpiStats([sample({ memoryUsage: 45 }), sample({ memoryUsage: 51 })])!
    expect(r[1].delta).toBe(6)
    expect(r[1].trend).toBe('up')
  })

  /** 剥掉注释：只有代码里的字面量才算"界面上会写出来的话" */
  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  /** 在代码（非注释）里找"较昨日"这个口径 */
  const findYesterdayClaim = (src: string): string[] =>
    [...stripComments(src).matchAll(/["'`][^"'`\n]*较昨日[^"'`\n]*["'`]/g)].map((m) => m[0])

  it('量具自证：同样的写法放进代码里就必须被抓到（抓不到就是这条判据是死的）', () => {
    expect(findYesterdayClaim('const a = "较昨日"')).toEqual(['"较昨日"'])
    expect(findYesterdayClaim('/* 这里说的是"较昨日"这个旧口径 */')).toEqual([])
  })

  it('整页代码不许再出现"较昨日"这个口径', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const dir = path.resolve(__dirname, '../../src/renderer/src/components/monitor')
    const files = fs.readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f))
    const offenders: string[] = []
    for (const f of files) {
      for (const hit of findYesterdayClaim(fs.readFileSync(path.join(dir, f), 'utf8'))) {
        offenders.push(`${f}: ${hit}`)
      }
    }
    expect(offenders, `又把 3 秒前的差值说成昨日：${offenders.join(' | ')}`).toEqual([])
    // 阳性对照：扫描器读得到文件（读到 0 个就是量具坏了）
    expect(files.length).toBeGreaterThan(3)
  })
})

describe('图表标题：写真实跨度而不是 24h', () => {
  it('空数据 / 单点各有说法', () => {
    expect(spanLabel([])).toBe('（暂无数据）')
    expect(spanLabel([{ timestamp: 1 }])).toBe('（1 个采样点）')
  })

  it('三点跨 6 秒 → 标题里就是 6 秒，不是 24h', () => {
    const t = 1_700_000_000_000
    expect(spanLabel([{ timestamp: t }, { timestamp: t + 3000 }, { timestamp: t + 6000 }])).toBe(
      '（实际跨度 6 秒 · 3 点）'
    )
  })

  it('秒/分两种单位', () => {
    expect(humanSpan(45_000)).toBe('45 秒')
    expect(humanSpan(150_000)).toBe('2 分 30 秒')
    expect(humanSpan(180_000)).toBe('3 分钟')
  })

  it('四张图的标题都接了 spanLabel（不再写死 24h）', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync(
      __dirname + '/../../src/renderer/src/components/monitor/Charts.tsx',
      'utf8'
    )
    expect(src.match(/title=\{`[^`]*\$\{spanLabel\(recent\)\}`\}/g) ?? []).toHaveLength(8)
    expect(src).not.toMatch(/title="[^"]*\(24h\)"/)
  })
})
