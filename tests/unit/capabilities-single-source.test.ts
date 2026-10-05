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
import { CAPABILITIES, CAPABILITY_STATUS_LABELS, capabilityCounts } from '@shared/capabilities'

const ROOT = path.resolve(__dirname, '../..')
const READ = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

/** 只扫代码文本，注释里提到被禁的名字不算接通 */
function codeOf(rel: string): string {
  return READ(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

function walk(dir: string, acc: string[] = []): string[] {
  const abs = path.join(ROOT, dir)
  if (!fs.existsSync(abs)) return acc
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx)$/.test(e.name)) acc.push(p.split(path.sep).join('/'))
  }
  return acc
}

const VALID = ['live', 'degraded', 'pending']

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
      expect(counts[s as (typeof VALID)[number]]).toBe(CAPABILITIES.filter((c) => c.status === s).length)
    }
  })

  // ===== 逐条证据复查：这几条断言变红 = 链路接通了，记得把表改成 live =====

  it('claude-sdk 仍是待开发：渲染层没有任何调用点', () => {
    const callers = walk('src/renderer/src').filter(
      (f) => !f.endsWith('types/electron.d.ts') && codeOf(f).includes('claudeSdk'),
    )
    expect(callers, `Claude SDK 已被这些渲染层文件调用，请把表改成已接通：\n${callers.join('\n')}`).toEqual([])
  })

  it('trace-langfuse 仍是待开发：渲染层与 preload 都没有入口', () => {
    const hits = [...walk('src/renderer/src'), ...walk('src/preload')].filter((f) =>
      /langfuse/i.test(codeOf(f)),
    )
    expect(hits, `这些文件出现了 Langfuse 入口，请把表改成已接通：\n${hits.join('\n')}`).toEqual([])
  })

  it('terminal-blocks 仍是待开发：主进程与 preload 都不发 OSC 133/633', () => {
    const hits = [...walk('src/main'), ...walk('src/preload')].filter((f) => {
      const t = codeOf(f)
      return t.includes('\\u001b]133') || t.includes(']133;') || t.includes(']633;')
    })
    expect(hits, `出现了 OSC 133/633 发送端，请把表改成已接通：\n${hits.join('\n')}`).toEqual([])
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
