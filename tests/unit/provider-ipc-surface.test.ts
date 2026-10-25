/**
 * Provider 的查询面收口（#210 判决）
 *
 * 取证（2026-10-24 实测，`pnpm audit:ipc` 的零调用清单）：渲染层从来没调过这五把键
 * `providerGet` / `providerCapabilities` / `providerCapabilitiesAll` / `providerPricing` /
 * `providerPricingAll`。逐条问"那件事本来就由谁做"，答案都在别的路上：
 * - 能力：`provider:list` 已经把解析好的 capabilities 带出来
 *   （`src/main/core/agent/providers/provider-registry.ts` 里 getProviderCapabilities），
 *   界面读的就是这一份——`Composer.tsx` 的上下文窗口分母、
 *   `components/settings/model/provider-capability-override.ts` 的覆盖判定都是它。
 * - 成本：定价表在主进程算好（`providers/token-stats.ts` 用 getProviderPricing），
 *   界面看的是 `token:cost-stats` 那一个数，不需要自己再拿一张价目表去乘。
 * - 单读一个 Provider：配置页一次读全表（providerList），没有第二个读者。
 *
 * 所以这一批是**减面**（把没有执行体的第二真相源关掉），不是还债，也不是修量具。
 * 要防的两件事：① 将来再开一条"绕过 provider:list 单独问能力/价目"的口子；
 * ② 砍出口时把两张表和解析函数一起砍掉——那三条在跑的路会直接坏。
 *
 * 判据（正向那两条）：
 * - `tests/unit/provider-list-capabilities.test.ts` 证 provider:list 真带 capabilities
 * - `tests/unit/provider-capabilities.test.ts` / `tests/unit/provider-pricing*.test.ts`
 *   证两张表的回退规则还在
 *
 * 第 6 条是这批删到一半时抓出来的错法固化成的闸：handler 删了、注册日志那份
 * channels 清单还写着 provider:get（日志说十条、实际九条）。
 * 清单与实际 handler 必须逐名相等，日志不能再当免检的说明文字。
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { AGENT, PROVIDER, TOKEN } from '@shared/ipc-channels'
import { listSourceFiles, readSourceFile } from '../helpers/source-scan'

const ROOT = path.resolve(__dirname, '../..')

/** 这五把是本轮判掉的界面出口，任何一把回来都算回涨 */
const BANNED_KEYS = [
  'providerGet',
  'providerCapabilities',
  'providerCapabilitiesAll',
  'providerPricing',
  'providerPricingAll',
]

/** 真在用的 Provider 配置面，不许被这批一起带走 */
const KEPT_KEYS = ['providerList', 'providerSave', 'providerSetDefault', 'providerGetDefault']

function exposedKeys(): string[] {
  return readSourceFile(path.join(ROOT, 'tests/unit/__fixtures__/preload-api-surface.txt'))
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}

describe('Provider 查询面收口（#210）', () => {
  it('1. 暴露面清单里没有那五把键，配置 CRUD 那四把还在', () => {
    const keys = exposedKeys()
    const back = BANNED_KEYS.filter((k) => keys.includes(k))
    expect(back, '这些 provider 查询键又回来了').toEqual([])
    for (const kept of KEPT_KEYS) {
      expect(keys, `误砍了真在用的 ${kept}，模型配置页会直接坏`).toContain(kept)
    }
  })

  it('2. PROVIDER 常量族只剩配置面四条', () => {
    expect(Object.keys(PROVIDER).sort(), '通道常量与判决不一致：多出来的就是新的界面出口').toEqual([
      'GET_DEFAULT',
      'LIST',
      'SAVE',
      'SET_DEFAULT',
    ])
  })

  it('3. 全仓再没有那五条通道的字面量或常量引用（单读一条也不许绕过 list）', () => {
    const hits: string[] = []
    for (const abs of listSourceFiles(path.join(ROOT, 'src'))) {
      if (!/\.(ts|tsx)$/.test(abs)) continue
      const text = readSourceFile(abs)
      const rel = path.relative(ROOT, abs).split(path.sep).join('/')
      if (/provider:(capabilities-all|capabilities|pricing-all|pricing)(?![-\w])/.test(text)) hits.push(`${rel} 通道名`)
      // 'provider:get' 是 'provider:get-default' 的前缀，必须用否定前瞻把单读那条挑出来
      if (/provider:get(?!-default)(?![-\w])/.test(text)) hits.push(`${rel} 单读通道名`)
      if (/PROVIDER\.(GET\b|CAPABILITIES|PRICING)/.test(text)) hits.push(`${rel} 常量引用`)
    }
    expect(hits, '这些地方还在引用已判掉的 provider 出口').toEqual([])
  })

  it('4. 反过度砍：两张表和解析函数还在，且仍由在跑的那三条路 import', () => {
    for (const f of [
      'src/main/core/agent/providers/provider-capabilities.ts',
      'src/main/core/agent/providers/provider-pricing.ts',
    ]) {
      expect(fs.existsSync(path.join(ROOT, f)), `${f} 不该随出口一起删掉`).toBe(true)
    }
    const live = {
      'src/main/core/agent/providers/provider-registry.ts': 'getProviderCapabilities',
      'src/main/core/agent/supervisor.ts': 'getProviderCapabilities',
      'src/main/core/agent/providers/token-stats.ts': 'getProviderPricing',
    } as const
    for (const [file, symbol] of Object.entries(live)) {
      expect(readSourceFile(path.join(ROOT, file)), `${file} 不再用 ${symbol}，能力/成本那条活线断了`).toContain(
        symbol
      )
    }
  })

  it('5. provider-info.ts 那层没有执行体的包装不许回来', () => {
    expect(
      fs.existsSync(path.join(ROOT, 'src/main/ipc/provider-info.ts')),
      '又建了一个"单独问能力/价目"的 IPC 面板——它没有消费者，就是第二真相源'
    ).toBe(false)
  })

  it('6. 注册日志里那份通道清单必须与真注册的 handler 一致', () => {
    // 这条是本轮实测抓到的错法抓出来的：handler 删掉了，logger.info 那份 channels 数组
    // 还写着 provider:get —— 日志说注册了十条、实际注册九条，接手的人按日志找东西就找不到。
    const text = readSourceFile(path.join(ROOT, 'src/main/ipc/agent-runtime.ts'))
    const domains = { AGENT, PROVIDER, TOKEN } as const
    const registered: string[] = []
    for (const m of text.matchAll(/ipcMain\.handle\(\s*(?:'([^']+)'|([A-Z][A-Z_]*)\.([A-Z_]+))/g)) {
      if (m[1]) {
        registered.push(m[1])
        continue
      }
      const map = domains[m[2] as keyof typeof domains]
      if (!map) throw new Error(`判据不认识这个通道常量域：${m[2]}`)
      const name = (map as Record<string, string>)[m[3]]
      if (!name) throw new Error(`${m[2]}.${m[3]} 在 ipc-channels 里找不到，判据不能当成没注册`)
      registered.push(name)
    }
    const loggedBlock = text.match(/channels: \[([\s\S]*?)\]/)?.[1]
    if (!loggedBlock) throw new Error('agent-runtime.ts 里那份注册日志清单不见了，判据失去比较对象')
    const logged = loggedBlock
      .split(',')
      .map((s) => s.trim().replace(/^'|'$/g, ''))
      .filter(Boolean)
      .sort()
    expect(logged, '注册日志与实际 handler 对不上（多出来的就是已删的出口，少掉的是没登记的）').toEqual(
      [...registered].sort()
    )
    // 11 → 10：#216 判掉了 token:reset（按下只清内存计数器，界面上没有这颗按钮）
    expect(registered.length, 'Agent Runtime 这层实际注册的通道数').toBe(10)
  })
})
