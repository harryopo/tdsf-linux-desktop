/**
 * 防线接线登记表（P1-5 的常驻闸）
 *
 * 巡检发现 5 个 P0 里 3 个是同一种病：防线代码写好了但没人调用
 * （审批层 663 行、决策卡 validateDecision、sandbox 链路）。
 * 一次性人工核对只对当天负责，所以把"谁必须调用谁"落成闸：
 *
 *   - 已登记的死防线：必须**确实还是死的**（修好了却不删条目 → 红，逼着登记表只缩不涨）
 *   - 新出现的死防线：必须显式加条目并写理由，否则红
 *
 * 判据取"调用方必须落在哪个目录"，不数文本命中数——
 * 定义文件自己也算命中，按文本数会永远绿。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(__dirname, '../..')

interface DefenseWiring {
  symbol: string
  /** 必须出现调用方的目录（相对仓库根） */
  mustBeCalledFrom: string
  /** 定义所在文件：自己引用自己不算接线 */
  definitionFiles: string[]
  /** 已确认尚未接线时写在这里（含原因）；修好后必须从这里删掉 */
  knownUnwiredReason?: string
}

const DEFENSES: DefenseWiring[] = [
  {
    symbol: 'installCrashGuard',
    mustBeCalledFrom: 'src/main',
    definitionFiles: ['src/main/core/crash-guard.ts'],
  },
  {
    symbol: 'assessToolCall',
    mustBeCalledFrom: 'src/main/core/agent',
    definitionFiles: ['src/main/core/command-gate.ts'],
  },
  {
    symbol: 'waitForSandboxApproval',
    mustBeCalledFrom: 'src/main/ipc',
    definitionFiles: ['src/main/ipc/sandbox-approval.ts'],
  },
  {
    symbol: 'taskPermissionApprove',
    mustBeCalledFrom: 'src/renderer/src',
    definitionFiles: [
      'src/preload/index.ts',
      'src/preload/types.ts',
      'src/preload/domains/events.ts',
    ],
    // 主进程侧 push 与 invoke handler 都在，缺的是渲染层那个弹窗：
    // 现在没有任何组件订阅 onTaskPermissionApprovalRequest。
    knownUnwiredReason: '审批 UI 未做：Task Protocol 的子代理审批没有渲染层订阅方',
  },
  {
    symbol: 'validateDecision',
    mustBeCalledFrom: 'src/main/ipc',
    definitionFiles: ['src/main/core/decision-engine.ts'],
  },
]

/** 在 dir 下找引用 symbol 的文件（排除定义文件与 .d.ts / 生成物） */
function findCallers(dir: string, symbol: string, defs: string[]): string[] {
  const abs = path.join(ROOT, dir)
  if (!fs.existsSync(abs)) throw new Error(`登记表里的目录不存在：${dir}（路径写错了要改这里）`)
  const out: string[] = []
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue
        walk(full)
        continue
      }
      if (!/\.tsx?$/.test(e.name) || e.name.endsWith('.d.ts')) continue
      const rel = path.relative(ROOT, full).replace(/\\/g, '/')
      if (defs.includes(rel)) continue
      if (rel.includes('types/generated')) continue
      if (fs.readFileSync(full, 'utf8').includes(symbol)) out.push(rel)
    }
  }
  walk(abs)
  return out
}

describe('防线接线登记表', () => {
  it('每条防线要么真的有人调用，要么在登记表里写明还没接', () => {
    const stillUnwired: string[] = []
    const newlyDead: string[] = []
    for (const d of DEFENSES) {
      const callers = findCallers(d.mustBeCalledFrom, d.symbol, d.definitionFiles)
      if (callers.length === 0) {
        if (d.knownUnwiredReason) stillUnwired.push(`${d.symbol}：${d.knownUnwiredReason}`)
        else newlyDead.push(`${d.symbol}（应被 ${d.mustBeCalledFrom} 调用）`)
      } else if (d.knownUnwiredReason) {
        // 已经接上了却还留在登记表里 —— 同样是红，保证这份表只会变短
        newlyDead.push(`${d.symbol} 已被 ${callers[0]} 调用，登记表里的条目该删了`)
      }
    }
    expect(newlyDead, '防线接线状态与登记表不符：\n' + newlyDead.join('\n')).toEqual([])
    console.log('[dead-defense] 已登记未接线：' + (stillUnwired.join('；') || '无'))
  })

  it('量具自证：临时造一条没人调的防线，闸必须报出来', () => {
    const probe: DefenseWiring = {
      symbol: 'thisSymbolHasNoCallerAnywhere_zzz',
      mustBeCalledFrom: 'src/renderer/src',
      definitionFiles: ['src/renderer/src/components/terminal/TerminalView.tsx'],
    }
    const callers = findCallers(probe.mustBeCalledFrom, probe.symbol, probe.definitionFiles)
    expect(callers, '凭空造的死防线都被判成"已接线"，说明这条闸不会说话').toEqual([])
    // 反向：真实存在的调用方必须数得出来，否则上面那条空集是"扫不到"而不是"没有"
    expect(findCallers('src/main', 'installCrashGuard', ['src/main/core/crash-guard.ts']).length).toBeGreaterThan(0)
  })

  it('登记表里写的目录与定义文件都真实存在（防止路径烂掉后静默通过）', () => {
    for (const d of DEFENSES) {
      for (const f of d.definitionFiles) {
        expect(fs.existsSync(path.join(ROOT, f)), `定义文件不存在：${f}`).toBe(true)
      }
    }
  })
})
