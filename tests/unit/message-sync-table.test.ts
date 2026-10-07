/**
 * 流式事件分类表测试（阶段 C）
 *
 * 这张表的价值在于"它是真的"，所以最重要的一个用例是拿 preload 的实际监听点
 * 反解出通道清单来对表 —— 表里多一条（写了个不存在的通道）或者少一条
 * （新加推送没归类）都必须红，否则表会跟代码脱节，比没有更坏。
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { preloadWiring } from './preload-sources'
import {
  STREAM_EVENT_RULES,
  ruleOf,
  type StreamEventName,
} from '../../src/renderer/src/lib/messageSync'

const ROOT = path.resolve(__dirname, '../..')

/** 把 ipc-channels.ts 解析成 GROUP.KEY → 'channel:string' */
function loadChannelMap(): Record<string, string> {
  const src = fs.readFileSync(path.join(ROOT, 'src/shared/ipc-channels.ts'), 'utf8')
  const map: Record<string, string> = {}
  const groupRe = /export const ([A-Z_]+) = \{([\s\S]*?)\n\} as const/g
  let g: RegExpExecArray | null
  while ((g = groupRe.exec(src))) {
    const keyRe = /([A-Z_0-9]+)\s*:\s*'([^']+)'/g
    let k: RegExpExecArray | null
    while ((k = keyRe.exec(g[2]))) map[`${g[1]}.${k[1]}`] = k[2]
  }
  return map
}

/** 从 preload 反解渲染进程真正订阅的通道 */
function loadPreloadListeners(): string[] {
  // 拆域后监听位点分散在 index.ts 与 domains/*.ts，只读 index.ts 会漏（见 tests/unit/preload-sources.ts）
  const src = preloadWiring(ROOT)
  const refs = new Set<string>()
  for (const m of src.matchAll(/createListener\(\s*([A-Z_]+\.[A-Z_0-9]+)/g)) refs.add(m[1])
  for (const m of src.matchAll(/ipcRenderer\.on\(\s*([A-Z_]+\.[A-Z_0-9]+)/g)) refs.add(m[1])
  const map = loadChannelMap()
  const unresolved = [...refs].filter((r) => !map[r])
  expect(unresolved, 'preload 里有解析不出来的通道常量').toEqual([])
  return [...refs].map((r) => map[r])
}

describe('STREAM_EVENT_RULES 与真实推送面对表', () => {
  it('表覆盖的通道集合 == preload 实际监听集合（不多不少）', () => {
    const actual = new Set(loadPreloadListeners())
    const tabled = new Set(Object.keys(STREAM_EVENT_RULES))
    expect([...tabled].filter((c) => !actual.has(c))).toEqual([])
    expect([...actual].filter((c) => !tabled.has(c))).toEqual([])
    expect(tabled.size).toBe(actual.size)
  })

  it('每条都有中文依据，且 class 是八类之一', () => {
    const CLASSES = new Set([
      'DELTA',
      'LATEST_ONLY',
      'DISPOSABLE',
      'SNAPSHOT',
      'SNAPSHOT_TAIL',
      'RESET_BOUNDARY',
      'CRITICAL',
      'LIFECYCLE',
    ])
    for (const [channel, rule] of Object.entries(STREAM_EVENT_RULES)) {
      expect(CLASSES.has(rule.class), `${channel} 的 class 非法`).toBe(true)
      expect(rule.note.length, `${channel} 缺归类依据`).toBeGreaterThan(3)
    }
  })

  it('CRITICAL 一律不许合并（丢了就丢答案的事件不能进合并窗口）', () => {
    const critical = Object.entries(STREAM_EVENT_RULES).filter(([, r]) => r.class === 'CRITICAL')
    expect(critical.length).toBeGreaterThan(0)
    for (const [channel, rule] of critical) {
      expect(rule.coalescable, `${channel} 被标成 CRITICAL 却允许合并`).toBe(false)
    }
  })

  it('只有 payload 真带 correlationId、且代码确实按它归属的通道才标 ownership', () => {
    const owned = Object.keys(STREAM_EVENT_RULES).filter(
      (c) => STREAM_EVENT_RULES[c as StreamEventName].ownership
    )
    // agent:step / llm:* 的 payload 不带 correlationId，标了就是骗人
    expect(owned.sort()).toEqual(['agent:chunk', 'agent:done', 'agent:error'])
  })

  it('未归类通道按最严格处置（要认会话、不许合并）', () => {
    const fallback = ruleOf('brand:new-channel' as StreamEventName)
    expect(fallback.class).toBe('CRITICAL')
    expect(fallback.ownership).toBe(true)
    expect(fallback.coalescable).toBe(false)
  })
})
