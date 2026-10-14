/**
 * 能力就绪度表：内容自证 + 单源（阶段 F4 判据）
 *
 * 一张写给人看的状态表，最容易坏的方式是"代码变了表没变"。
 * 所以这里不只校验格式，还把每条 pending/degraded 的实际证据再查一遍：
 * 将来谁把那条链路接通了，这几条断言会红，提醒他同步改表。
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { listSourceFiles, readSourceFile } from '../helpers/source-scan'
import {
  CAPABILITIES,
  CAPABILITY_STATUS_LABELS,
  capabilityCounts,
  type CapabilityStatus,
} from '@shared/capabilities'

const ROOT = path.resolve(__dirname, '../..')
const READ = (rel: string) => readSourceFile(path.join(ROOT, rel))

/** 只扫代码文本，注释里提到被禁的名字不算接通 */
function codeOf(rel: string): string {
  return READ(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

function walk(dir: string, acc: string[] = []): string[] {
  const abs = path.join(ROOT, dir)
  // 取数口只有一份：跳过测试探针文件的规则写在 tests/helpers/source-scan.ts
  for (const f of listSourceFiles(abs)) {
    acc.push(path.relative(ROOT, f).split(path.sep).join('/'))
  }
  return acc
}

// 档位清单从单源派生：capabilityCounts() 返回的 Record<CapabilityStatus, number> 的键
// 就是全部合法档位。原先手抄一份 ['live','degraded','pending']，
// 产品加了第四档不会红，这条"单源"检查自己先变成两份真相。
const VALID = Object.keys(capabilityCounts()) as CapabilityStatus[]

describe('能力就绪度表', () => {
  it('表非空，id 唯一，状态合法，降级与待开发都写了原因', () => {
    expect(CAPABILITIES.length).toBeGreaterThanOrEqual(10)
    const ids = CAPABILITIES.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const c of CAPABILITIES) {
      expect(VALID).toContain(c.status)
      expect(CAPABILITY_STATUS_LABELS[c.status]).toBeTruthy()
      if (c.status !== 'live') {
        expect(c.note.length, `${c.id} 是 ${c.status}，必须写清缺什么`).toBeGreaterThan(10)
      }
    }
  })

  it('计数汇总与逐条状态一致', () => {
    const counts = capabilityCounts()
    expect(counts.live + counts.degraded + counts.pending).toBe(CAPABILITIES.length)
    for (const s of VALID) {
      expect(counts[s]).toBe(CAPABILITIES.filter((c) => c.status === s).length)
    }
  })

  // ===== 逐条证据复查：这几条断言变红 = 链路接通了，记得把表改成 live =====

  it('claude-agent-sdk 已退役：全仓源码不许再出现引用', () => {
    // 2026-10-12 决策：只留 Vercel AI SDK 一条 agent 路径。这条不是形式检查——
    // 该 SDK 非开源、只认 Anthropic 模型，而且镜像源缺 win32-x64 的二进制包，
    // 装回来会让 pnpm install 半途失败，所以引用一律不许回来。
    const hits = [
      ...walk('src/main'),
      ...walk('src/preload'),
      ...walk('src/renderer/src'),
      ...walk('src/shared'),
    ].filter((f) => /claude-agent-sdk|claudeSdk|ClaudeSdk|claude-sdk:/.test(codeOf(f)))
    expect(hits, `已退役的 Claude Agent SDK 又被引用：\n${hits.join('\n')}`).toEqual([])
  })

  it('trace-langfuse 仍是待开发：渲染层与 preload 都没有入口', () => {
    const hits = [...walk('src/renderer/src'), ...walk('src/preload')].filter((f) =>
      /langfuse/i.test(codeOf(f)),
    )
    expect(hits, `这些文件出现了 Langfuse 入口，请把表改成已接通：\n${hits.join('\n')}`).toEqual([])
  })

  it('terminal-blocks：表状态必须跟着发送端的真实情况走', () => {
    const producers = [...walk('src/main'), ...walk('src/preload')].filter((f) => {
      const t = codeOf(f)
      // 集成片段里发序列的形状是 printf '\033]%s;%s'，只查 "]133;" 会漏（那是拼出来的）
      return /\\033\]/.test(t) && t.includes('133') && t.includes('633')
    })
    // 量具自证：发送端文件改名/搬走时这里先红，而不是静默扫到 0 个然后放过表
    expect(
      producers,
      'OSC 发送端检测失效：src/main/services/ssh/shell-integration.ts 应该被认出来'
    ).toContain('src/main/services/ssh/shell-integration.ts')
    const row = CAPABILITIES.find((c) => c.id === 'terminal-blocks')
    expect(['live', 'degraded'], '已有 OSC 发送端，表里不许再写 pending').toContain(row?.status)
    expect(row?.note, '表里要点名发送端文件，否则它被搬走就查不到来源').toContain('shell-integration')
  })

  it('mcp-tools 仍是待开发：服务默认关，需要环境变量显式打开', () => {
    expect(codeOf('src/main/index.ts')).toMatch(/MCP_SERVER_ENABLED === 'true'/)
  })

  it('monitor-history 的降级说明里的采样上限与 store 实际值一致', () => {
    const m = codeOf('src/renderer/src/stores/monitor-store.ts').match(/MAX_HISTORY_COUNT\s*=\s*(\d+)/)
    expect(m, 'monitor-store 里找不到 MAX_HISTORY_COUNT，说明容量口径变了').not.toBeNull()
    const row = CAPABILITIES.find((c) => c.id === 'monitor-history')
    expect(row?.note).toContain(m![1])
  })

  it('关于页只消费这张表，自己不再写一套状态文案', () => {
    const about = codeOf('src/renderer/src/pages/AboutSettings.tsx')
    expect(about).toContain('CAPABILITIES')
    for (const label of Object.values(CAPABILITY_STATUS_LABELS)) {
      expect(about, `关于页里出现了写死的状态文案：${label}`).not.toContain(`'${label}`)
    }
  })
})
