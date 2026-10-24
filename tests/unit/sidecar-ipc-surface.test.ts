/**
 * Sidecar 的界面面只留两条（#207 判决）
 *
 * 取证（2026-10-24 实测）：渲染层真在调的只有 `sidecarStatus`（日志面板开机取状态）
 * 与 `sidecarPipeline`（AI 日志分析）。其余九把（start / stop / health / list-status /
 * start-one / stop-one / health-one / tool-call / parse-logs）在渲染层零调用：
 * - 引擎不需要按钮启动：pipeline 自己就是懒启动，非 ready 先拉起；
 * - 健康读数界面看的是"本机分析引擎（实测）"，数据由 app:get-info 现场量；
 * - -one 那一族与 list-status 是"多 Sidecar 管理面"，本应用只跑一个分析引擎，
 *   界面上从来没有 Sidecar 列表（这份文件旧注释里写的 SidecarStatusPanel 早不存在）；
 * - `sidecar:tool-call` 最要收：它让渲染层往本地端口 POST **任意 endpoint**，
 *   一道没人用的通用写入口就是白给的攻击面。
 *
 * 所以这一批不是"少了几把没人按的键"，是少了几条能被 XSS 用到的出口。
 * 这条判据的存在意义：将来谁再想"为了方便"开一条通用 sidecar 调用口，这里会红。
 */
import { describe, it, expect } from 'vitest'
import * as path from 'node:path'
import { listSourceFiles, readSourceFile } from '../helpers/source-scan'

const ROOT = path.resolve(__dirname, '../..')

/** 这九把键是本轮判掉的，任何一把回来都算回涨 */
const BANNED_KEYS = [
  'sidecarStart',
  'sidecarStop',
  'sidecarHealth',
  'sidecarHealthOne',
  'sidecarListStatus',
  'sidecarStartOne',
  'sidecarStopOne',
  'sidecarToolCall',
  'sidecarParseLogs'
]

function exposedKeys(): string[] {
  return readSourceFile(path.join(ROOT, 'tests/unit/__fixtures__/preload-api-surface.txt'))
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}

describe('sidecar 界面面收口（#207）', () => {
  it('暴露面清单里没有那九把键，且真在用的两条还在（双向：不许误砍）', () => {
    const keys = exposedKeys()
    const back = BANNED_KEYS.filter((k) => keys.includes(k))
    expect(back, '这些 sidecar 键又回来了').toEqual([])
    for (const kept of ['sidecarStatus', 'sidecarPipeline']) {
      expect(keys, `误砍了真在用的 ${kept}，日志页会直接坏`).toContain(kept)
    }
  })

  it('主进程只注册 status 与 pipeline 两条 sidecar 通道', () => {
    const text = readSourceFile(path.join(ROOT, 'src/main/ipc/sidecar.ts'))
    const channels = [...text.matchAll(/ipcMain\.handle\(\s*(?:SIDECAR\.([A-Z_]+)|'sidecar:([a-z-]+)')/g)]
      .map((m) => (m[1] ? m[1].toLowerCase().replace(/_/g, '-') : m[2]))
      .sort()
    expect(channels, '通道清单与判决不一致：多出来的就是新的界面出口').toEqual(['pipeline', 'status'])
  })

  it('渲染层拿不到任意 endpoint 的通用调用口（tool-call 不许以任何形式回来）', () => {
    const hits: string[] = []
    for (const abs of listSourceFiles(path.join(ROOT, 'src'))) {
      if (!/\.(ts|tsx)$/.test(abs)) continue
      const rel = path.relative(ROOT, abs).split(path.sep).join('/')
      if (readSourceFile(abs).includes('sidecar:tool-call')) hits.push(rel)
    }
    expect(hits, '这些文件还写着通用 sidecar 调用通道').toEqual([])
  })

  it('SidecarManager 的 start/stop/health 仍由主进程内部驱动（删的是界面出口，不是能力）', () => {
    const manager = readSourceFile(path.join(ROOT, 'src/main/core/sidecar/sidecar-manager.ts'))
    expect(manager).toMatch(/async start\(/)
    expect(manager).toMatch(/async stop\(/)
    const ipc = readSourceFile(path.join(ROOT, 'src/main/ipc/sidecar.ts'))
    expect(ipc, 'pipeline 不再懒启动的话，日志页会回到"引擎未就绪"').toMatch(/await manager\.start\(\)/)
    expect(readSourceFile(path.join(ROOT, 'src/main/core/quit-cleanup.ts'))).toContain('cleanupSidecar')
  })
})
