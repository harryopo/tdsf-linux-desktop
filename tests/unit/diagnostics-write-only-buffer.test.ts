/**
 * 诊断缓冲的界面出口必须关掉（#206 判决）
 *
 * 取证（2026-10-24 实测）：
 * - `diagnostics:*` 七个 invoke 键加一个 `diagnostics:log-batch` 事件在渲染层零调用；
 *   事件有真生产者（`diagnostics-service.ts:311` 每秒 flush 往窗口推），**没有任何监听者**；
 * - 服务里 getLogs / getFindings / getReport / getStats / clear / setEnabled 的调用点
 *   只在 `ipc/diagnostics.ts` 这一层，也就是说"读"只有界面能读，而界面从不读；
 * - 结果就是两个生产者（sidecar、循环工程 subagent）往一块内存里写，谁都不看——
 *   只写不读，与 #136 判掉的那批 ai-store 键是同一类。
 *
 * 保留的是真的那条能力：MCP 的 `log_analyze` 走 `LogAnalyzer` 直接分析远程日志
 * （`services/mcp/tools/registry-log.ts`），它压根不经过这块缓冲。所以这一批删的是
 * "没人读的副本 + 没人听的推送"，不是日志分析能力。
 */
import { describe, it, expect } from 'vitest'
import * as path from 'node:path'
import { listSourceFiles, readSourceFile } from '../helpers/source-scan'

const ROOT = path.resolve(__dirname, '../..')

/** 快照闸那份暴露面清单（它与真 preload 由 preload-api-surface.test.ts 双向对账） */
function exposedKeys(): string[] {
  return readSourceFile(path.join(ROOT, 'tests/unit/__fixtures__/preload-api-surface.txt'))
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}

describe('diagnostics 只写不读的缓冲已关掉（#206）', () => {
  it('暴露面清单里不许再出现任何 diagnostics 键', () => {
    const left = exposedKeys().filter((k) => /^diagnostics/i.test(k) || /^onDiagnostics/i.test(k))
    expect(left, '这些键还在，说明"没人按也没人听"的那半套没删干净').toEqual([])
  })

  it('src 下除服务自身目录外，不许有文件引用这块缓冲（防止把死接口接回来）', () => {
    const hits: string[] = []
    for (const abs of listSourceFiles(path.join(ROOT, 'src'))) {
      if (!abs.endsWith('.ts')) continue
      const rel = path.relative(ROOT, abs).split(path.sep).join('/')
      if (rel.startsWith('src/main/services/diagnostics/')) continue
      const text = readSourceFile(abs)
      if (text.includes('diagnostics-service') || text.includes('getDiagnosticsService')) hits.push(rel)
    }
    expect(hits, '这些文件还 import 那块没人读的缓冲').toEqual([])
  })

  it('循环工程与 Sidecar 的日志仍要落进应用日志（内容不许因为删缓冲而丢掉）', () => {
    for (const rel of [
      'src/main/core/agent/subagents/loop-engineering-subagent.ts',
      'src/main/core/sidecar/sidecar-manager.ts',
    ]) {
      const text = readSourceFile(path.join(ROOT, rel))
      expect(text, `${rel} 里应当还有一条把日志写进应用日志的路径`).toMatch(
        /\bthis\.log\.(info|warn|error|debug)\(|\blogger\.(info|warn|error|debug)\(/
      )
    }
  })

  it('正向对照：MCP 的 log_analyze 仍然真走 LogAnalyzer（这条删前删后都该绿）', () => {
    const text = readSourceFile(path.join(ROOT, 'src/main/services/mcp/tools/registry-log.ts'))
    expect(text).toContain('LogAnalyzer')
    expect(text).toContain("'log_analyze'")
  })
})
