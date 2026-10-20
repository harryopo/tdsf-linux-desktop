/**
 * Token 用量的输入/输出拆分必须对得上账（#132）
 *
 * 现场：TokenUsageChart 以前用 55/45 猜输入与输出，再拿猜出来的两个数算"输入/输出比"当第三张卡。
 * 底层每条记录其实都存了 inputTokens/outputTokens，只是 TokenStats 这一层没往上传，
 * 于是界面要么猜、要么不显示。现在聚合时把方向带上，并分成 input / output / unknown 三份。
 *
 * unknown 不是凑数项：老记录从 electron-store 恢复时只校验 totalTokens 与 timestamp
 * （见 token-stats.ts 的 loadPersisted），确实可能没有方向字段。把它们单列出来，
 * 界面上写明"未记方向"，而不是摊进输入或输出里把猜的当真的。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/tdsf-token-split', isReady: () => true },
}))

vi.mock('electron-store', () => {
  const store = new Map<string, unknown>()
  return {
    default: class {
      get(key: string, fallback?: unknown) {
        return store.has(key) ? store.get(key) : fallback
      }
      set(key: string, value: unknown) {
        store.set(key, value)
      }
    },
  }
})

import {
  getTokenStats,
  recordTokenUsage,
  resetTokenStats,
  persist,
} from '../../src/main/core/agent/providers/token-stats'
import { ConfigStore } from '../../src/main/services/storage/config-store'
import { logger } from '../../src/main/services/log/logger'
import type { TokenUsageRecord } from '../../src/shared/agent-types'

const NOW = Date.now()
const DAY = 86_400_000

function rec(over: Partial<TokenUsageRecord> = {}): TokenUsageRecord {
  return {
    providerId: 'deepseek',
    model: 'deepseek-chat',
    inputTokens: 100,
    outputTokens: 40,
    totalTokens: 140,
    subagent: 'direct',
    strength: 'fast',
    timestamp: NOW,
    ...over,
  }
}

beforeEach(() => {
  resetTokenStats()
})

describe('拆分与合计数同源于同一批记录', () => {
  it('每个窗口都满足 input + output + unknown = 合计数', () => {
    recordTokenUsage(rec())
    recordTokenUsage(rec({ inputTokens: 700, outputTokens: 201, totalTokens: 901 }))
    // 四十天前：落在本月之外，只进 total
    recordTokenUsage(
      rec({ inputTokens: 50, outputTokens: 50, totalTokens: 100, timestamp: NOW - 40 * DAY })
    )

    const s = getTokenStats()
    for (const key of ['today', 'week', 'month', 'total'] as const) {
      const d = s.split[key]
      expect(d.input + d.output + d.unknown, `${key} 三份加起来必须等于合计数`).toBe(s[key])
    }
  })

  it('窗口嵌套：今日 ⊆ 本周 ⊆ 本月 ⊆ 总计（一条记录不许同时进两个不重叠的窗）', () => {
    recordTokenUsage(rec({ inputTokens: 10, outputTokens: 5, totalTokens: 15 }))
    recordTokenUsage(
      rec({ inputTokens: 20, outputTokens: 20, totalTokens: 40, timestamp: NOW - 10 * DAY })
    )

    const s = getTokenStats()
    expect(s.today).toBeLessThanOrEqual(s.week)
    expect(s.week).toBeLessThanOrEqual(s.month)
    expect(s.month).toBeLessThanOrEqual(s.total)
    expect(s.split.today.input).toBe(10)
    expect(s.split.month.input).toBe(30)
    expect(s.split.today.input).toBeLessThanOrEqual(s.split.month.input)
  })

  it('数字来自记录本身：两条不同方向的记录，拆分不同（比例猜不出来）', () => {
    recordTokenUsage(rec({ inputTokens: 900, outputTokens: 10, totalTokens: 910 }))
    recordTokenUsage(rec({ inputTokens: 10, outputTokens: 900, totalTokens: 910 }))

    const s = getTokenStats()
    expect(s.split.total.input).toBe(910)
    expect(s.split.total.output).toBe(910)
  })

  it('缺方向字段的旧记录整条进 unknown，合计数照旧（不许悄悄丢）', () => {
    recordTokenUsage(rec({ inputTokens: undefined as unknown as number, outputTokens: undefined as unknown as number, totalTokens: 500 }))

    const s = getTokenStats()
    expect(s.split.total.unknown).toBe(500)
    expect(s.split.total.input).toBe(0)
    expect(s.split.total.output).toBe(0)
    expect(s.total).toBe(500)
  })

  it('provider 的 total 大于 input+output（推理/缓存只进合计）：差额进 unknown，账照样闭得上', () => {
    // 这是真实形状：client.ts:437 用的是 usage.total_tokens，不是 input+output
    recordTokenUsage(rec({ inputTokens: 600, outputTokens: 200, totalTokens: 1000 }))

    const s = getTokenStats()
    expect(s.split.total).toEqual({ input: 600, output: 200, unknown: 200, estimated: 0 })
    expect(s.split.total.input + s.split.total.output + s.split.total.unknown).toBe(s.total)
    expect(s.total).toBe(1000)
  })

  it('provider 的 total 小于 input+output：按方向数算，不少算用户的账', () => {
    recordTokenUsage(rec({ inputTokens: 80, outputTokens: 60, totalTokens: 100 }))

    const s = getTokenStats()
    expect(s.total).toBe(140)
    expect(s.split.total).toEqual({ input: 80, output: 60, unknown: 0, estimated: 0 })
    expect(s.split.total.input + s.split.total.output + s.split.total.unknown).toBe(s.total)
  })

  it('负数方向字段不算方向（否则会把合计拉低），整条进 unknown', () => {
    recordTokenUsage(rec({ inputTokens: -50, outputTokens: 50, totalTokens: 300 }))

    const s = getTokenStats()
    expect(s.split.total).toEqual({ input: 0, output: 0, unknown: 300, estimated: 0 })
    expect(s.total).toBe(300)
  })

  it('分布表与窗口合计用同一个数（byProvider/bySubagent 也不许和总数对不上）', () => {
    recordTokenUsage(rec({ inputTokens: 600, outputTokens: 200, totalTokens: 1000 }))
    recordTokenUsage(rec({ providerId: 'kimi', subagent: 'coding', inputTokens: 10, outputTokens: 5, totalTokens: 15 }))

    const s = getTokenStats()
    const sumProviders = Object.values(s.byProvider).reduce((a, b) => a + b, 0)
    const sumSubagents = Object.values(s.bySubagent).reduce((a, b) => a + b, 0)
    expect(sumProviders).toBe(s.total)
    expect(sumSubagents).toBe(s.total)
  })

  it('阴性对照：没有任何记录时四个窗口都是 0（判据不会把空库读出错）', () => {
    const s = getTokenStats()
    expect(s.total).toBe(0)
    expect(s.split.total).toEqual({ input: 0, output: 0, unknown: 0, estimated: 0 })
  })
})

describe('估算出来的量要单独说得出', () => {
  /**
   * 提供方没回 usage 时我们按字符估算记账（client.ts 带 estimated: true）。
   * 以前这些数和实测数混在一个合计里，界面没法说"这个月有 N 个 token 其实是估的"。
   * estimated 是前三个数的**子集**，所以它不许参与守恒式——否则等于凭空多出一块。
   */
  it('一条估算记录：贡献额整个进 estimated，守恒式不受影响', () => {
    recordTokenUsage(rec({ inputTokens: 300, outputTokens: 100, totalTokens: 400, estimated: true }))

    const s = getTokenStats()
    expect(s.split.total.estimated).toBe(400)
    expect(s.split.total.input + s.split.total.output + s.split.total.unknown).toBe(s.total)
    expect(s.split.total.estimated).toBeLessThanOrEqual(s.total)
  })

  it('实测与估算混在一起时，只把估算那条算进去', () => {
    recordTokenUsage(rec({ inputTokens: 100, outputTokens: 50, totalTokens: 150 }))
    recordTokenUsage(rec({ inputTokens: 20, outputTokens: 10, totalTokens: 30, estimated: true }))

    const s = getTokenStats()
    expect(s.split.total.estimated).toBe(30)
    expect(s.total).toBe(180)
  })

  it('窗口各算各的：本月外的估算记录只进 total，不进 today', () => {
    recordTokenUsage(rec({ inputTokens: 10, outputTokens: 5, totalTokens: 15, estimated: true }))
    recordTokenUsage(
      rec({
        inputTokens: 60,
        outputTokens: 40,
        totalTokens: 100,
        estimated: true,
        timestamp: NOW - 40 * DAY,
      })
    )

    const s = getTokenStats()
    expect(s.split.today.estimated).toBe(15)
    expect(s.split.total.estimated).toBe(115)
  })

  it('没标 estimated 的记录一律按实测算（缺省不许被当成估算，否则说明会虚高）', () => {
    recordTokenUsage(rec())
    expect(getTokenStats().split.total.estimated).toBe(0)
  })

  it('界面要把"这是估的"说出来，不许只给一个合计数', () => {
    const chart = readFileSync(
      join(process.cwd(), 'src', 'renderer', 'src', 'components', 'settings', 'TokenUsageChart.tsx'),
      'utf8'
    )
    expect(chart).toContain('split.estimated')
    expect(chart, '只写"估算"不写"不是实测"，用户仍会把它当账').toMatch(/不是实测|估算的/)
  })
})

describe('持久化真的写到 ConfigStore', () => {
  it('persist 写进去的记录，换一个模块实例能读回来', async () => {
    recordTokenUsage(rec({ totalTokens: 777 }))
    persist()

    // 重新加载模块 = 模拟进程重启：模块初始化时的 loadPersisted 应把记录读回内存
    vi.resetModules()
    const fresh = await import('../../src/main/core/agent/providers/token-stats')
    expect(fresh.getTokenStats().total).toBe(777)

    // 清掉本用例在原实例里留下的防抖定时器
    resetTokenStats()
  })

  it('ConfigStore 写失败时 persist 必须报失败，不能打"已持久化"', () => {
    recordTokenUsage(rec())
    const setSpy = vi.spyOn(ConfigStore, 'set').mockReturnValue(false)
    const warnSpy = vi.spyOn(logger, 'warn')
    try {
      expect(persist()).toBe(false)
      expect(warnSpy).toHaveBeenCalled()
    } finally {
      setSpy.mockRestore()
      warnSpy.mockRestore()
    }
  })
})

describe('界面不许回到按比例猜', () => {
  const chart = readFileSync(
    join(process.cwd(), 'src', 'renderer', 'src', 'components', 'settings', 'TokenUsageChart.tsx'),
    'utf8'
  )

  it('图表读的是 stats.split，不是把合计乘个系数', () => {
    expect(chart).toContain('stats.split')
    expect(chart, '又出现 0.55 / 0.45 这种拆分比例就是回到猜').not.toMatch(/0\.55|0\.45/)
  })

  it('没有方向的那部分要在界面上说出来', () => {
    expect(chart).toContain('未记方向')
  })
})
