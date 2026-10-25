/**
 * 零调用面收口（#216：十一把"后端有、界面没人按"的出口整删）
 *
 * 取证（2026-10-25，`pnpm audit:ipc` 现量 12 把零调用，本轮判掉 11 把，留 1 把待接线——
 * 那把已在同日的 #217 接上界面，刻度跟着降到 0）：
 * 判决口径和 #204/#207/#210/#211/#214 一样，问的是"那件事本来由谁做"——
 * - system:ping / getProtocolVersion：一个回 `{ok,timestamp,protocolVersion}` 的空声、
 *   一个把 @shared 常量原样递给渲染层。渲染层没有任何心跳循环（全仓无 setInterval 调它），
 *   协议版本主进程启动时自己打进日志（src/main/index.ts）。留着只多一个"看起来在体检"的口。
 * - log:flush：logger.flush() 真正的执行体在退出收尾（src/main/index.ts），界面从来不需要手动刷盘。
 * - log:setMinLevel：级别只在 initLogger 时按配置定一次；日志页按级别过滤读的是 log:read 的结果，
 *   运行时改级别这件事界面上没有开关，`logger.setMinLevel` 除这条 handler 外没有第二个读者。
 * - token:reset：按下只把内存计数器清零，而成本页的数来自同一份内存——清一次就把用户的历史读数抹了，
 *   界面上还没有这颗按钮。`resetTokenStats` 本体留着（测试拿它清场是它的正当用途）。
 * - risk:check：桥接 assessCommandRisk，而那个函数本来就被沙箱审批自己用着（sandbox-approval.ts 内）；
 *   界面读规则走 riskGetRules，AI 侧走 MCP 的 risk_check。这条只是重复出口。
 * - sftp:stat：文件树的大小/权限来自 sftp:list，预览与 shell 集成走 sftpManager.stat 的主进程直 call；
 *   唯一"读者"是 ssh-live-sftp 那份真靶机 e2e 顺手用它验 stat——那是量具挑了条没人走的路，
 *   本轮把它改回界面真走的那条（见判据第 5 条）。
 * - subagent:list / subagent:reload + agent-loader：`.tdsf/agent/*.md` 这套自定义 Agent 只有这两把键在读，
 *   界面上从来没有 Agent 列表；supervisor 用的是内置 9 个 Subagent，不经过这个加载器。
 *   留着一个能往主进程塞自定义提示词的口子而没人看得见，正是 #196/#207 判掉的那一类。
 * - terminal-completion:import：补全引擎的历史导入只有这条 IPC 在调（`engine.importHistory` 无第二个调用者），
 *   界面只用 complete / accept。没有导入入口也没有导入的用处。
 *
 * 留着的那一把 `mcpExternalCall` 不在这份名单里：它的 handler 带人工审批与拦截留痕，
 * 两份 e2e 正走它验审批（#173），所以归"接界面"而不是"整删"——2026-10-25 #217 已把它接到
 * 工具行那颗「试调用」上，`UNUSED_CAP` 因此从 1 降到 0。判"零调用"要分两件事：没人按是债，
 * 按下去没执行体才是假功能。
 *
 * 判据各钉一件事：
 * 1. 十一把暴露名不许回来，仍在用的邻近键不许误砍（双向，读的是那份快照）
 * 2. 主进程不许再注册这十一条通道（AST 扫 src/main/ipc 的每个 ipcMain.handle，通道名回单源取真值）
 * 3. 实现体不许回来（三个文件 + 六个符号）；risk.ts 反过来必须还在——它带着活的 risk:rules，
 *    本轮第一版按文件判死把它一起砍了，是 audit:ipc 抓住的（判"死"要按通道与调用点判）。
 * 4. 反过度砍：这五条活链的调用点必须还在（logger.flush / resetTokenStats / assessCommandRisk /
 *    sftpManager.stat / log:read），砍了它们产品会当场坏
 * 5. 两个方向的自证：造一份"注册了被禁通道"的源码必须被第 2 条抓到，造一份"只注册活通道"的必须不被抓
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as ts from 'typescript'
import * as CH from '@shared/ipc-channels'
import { listSourceFiles, readSourceFile } from '../helpers/source-scan'

const ROOT = path.resolve(__dirname, '../..')

/** 本轮判掉的十一把（任何一把回来都算回涨） */
const BANNED_KEYS = [
  'credibilityDag',
  'getProtocolVersion',
  'logFlush',
  'logSetMinLevel',
  'riskCheck',
  'sftpStat',
  'subagentList',
  'subagentReload',
  'systemPing',
  'terminalCompletionImport',
  'tokenReset',
]

/** 同族里真在用的那些：误砍任何一条，界面就少一格 */
const KEPT_KEYS = [
  'mcpExternalCall', // #216 判"留着接线"的那一把，2026-10-25 #217 已接到工具行的「试调用」上
  'logRead',
  'logStats',
  'logClearBuffer',
  'logRenderer',
  'tokenStats',
  'tokenRecords',
  'tokenCostStats',
  'riskGetRules',
  'sftpList',
  'sftpSearch',
  'credibilityAssess',
  'terminalCompletionComplete',
  'terminalCompletionAccept',
]

/** 这十一条通道不许再被 ipcMain 注册（值一律回单源取，不在这里照常量名猜） */
const BANNED_CHANNELS = [
  'credibility:dag',
  'log:flush',
  'log:setMinLevel',
  'risk:check',
  'sftp:stat',
  'subagent:list',
  'subagent:reload',
  'system:ping',
  'terminal-completion:import',
  'token:reset',
]

/** 单源两张索引：'家族.键' → 通道值，以及 通道值 → '家族.键'（后者只用于红话说清楚） */
function channelIndexes(): { byConst: Map<string, string>; byValue: Map<string, string> } {
  const byConst = new Map<string, string>()
  const byValue = new Map<string, string>()
  for (const [familyName, family] of Object.entries(CH as Record<string, unknown>)) {
    if (!family || typeof family !== 'object') continue
    for (const [key, value] of Object.entries(family as Record<string, unknown>)) {
      if (typeof value !== 'string') continue
      byConst.set(`${familyName}.${key}`, value)
      byValue.set(value, `${familyName}.${key}`)
    }
  }
  return { byConst, byValue }
}

function exposedKeys(): string[] {
  return readSourceFile(path.join(ROOT, 'tests/unit/__fixtures__/preload-api-surface.txt'))
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}

/** 从一段源码里取出每个 ipcMain.handle 的第一参（字面量直接取，常量按"家族.键"记下来） */
function handleTargetsOf(src: string, fileName: string): string[] {
  const file = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true)
  const out: string[] = []
  const walk = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'handle' &&
      node.arguments.length > 0
    ) {
      const a = node.arguments[0]
      if (ts.isStringLiteral(a)) out.push(a.text)
      else if (ts.isPropertyAccessExpression(a)) {
        // 形如 LOG.FLUSH / CHANNELS.SYSTEM.PING：末两段当 家族.键 去单源查真值。
        // 注意要先走完属性链、再把最外层那个标识符补进数组，否则 `LOG.FLUSH` 只会剩一段 ['FLUSH']
        // ——第一版就栽在这里：常量写法全被判成"无法解析"，被禁通道一条都没点出来。
        const parts: string[] = []
        let cur: ts.Expression = a
        while (ts.isPropertyAccessExpression(cur)) {
          parts.unshift(cur.name.text)
          cur = cur.expression
        }
        if (ts.isIdentifier(cur)) parts.unshift(cur.text)
        out.push(parts.length >= 2 ? parts.slice(-2).join('.') : `无法解析 ${fileName}`)
      } else out.push(`无法解析 ${fileName}`)
    }
    ts.forEachChild(node, walk)
  }
  walk(file)
  return out
}

/** 主进程全部 handler 的通道集合：'家族.键' 回单源解成真值，解不出来的原样留着（好让红话说清楚） */
function registeredChannels(): { channel: string; file: string }[] {
  const { byConst } = channelIndexes()
  const rows: { channel: string; file: string }[] = []
  for (const abs of listSourceFiles(path.join(ROOT, 'src/main/ipc'))) {
    const rel = path.relative(ROOT, abs).split(path.sep).join('/')
    for (const t of handleTargetsOf(readSourceFile(abs), rel)) {
      rows.push({ channel: byConst.get(t) ?? t, file: rel })
    }
  }
  return rows
}

/** 去掉注释行，只留代码正文——注释里讲"删了什么"不该被算成引用 */
function codeOnly(src: string): string {
  return src
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\*|\/\/)/.test(l))
    .join('\n')
}

describe('零调用面收口（#216）', () => {
  it('1. 十一把不许回来，十四把真在用的还在（双向：不许误砍）', () => {
    const keys = exposedKeys()
    const back = BANNED_KEYS.filter((k) => keys.includes(k))
    expect(back, '这些零调用键又回来了：' + back.join(', ')).toEqual([])
    for (const kept of KEPT_KEYS) {
      expect(keys, `误砍了真在用的 ${kept}`).toContain(kept)
    }
  })

  it('2. 主进程不许再注册这十一条通道（通道名回单源取真值）', () => {
    const rows = registeredChannels()
    // 自证 A：扫描面真的抽到了东西，而且活通道在里面
    expect(rows.length, '一条 handler 都没扫到，判据已经失明').toBeGreaterThan(100)
    expect(rows.map((r) => r.channel)).toContain('log:read')
    expect(rows.map((r) => r.channel)).toContain('credibility:assess')

    const hits = rows.filter((r) => BANNED_CHANNELS.includes(r.channel))
    expect(hits, '这些通道还在注册：' + hits.map((h) => `${h.channel} ← ${h.file}`).join('、')).toEqual([])
    // 通道名也必须在单源里消失：handler 删了、常量表还留着，就是半删
    const { byValue } = channelIndexes()
    const stale = BANNED_CHANNELS.filter((c) => byValue.has(c))
    expect(stale, '单源 ipc-channels 里还挂着这些通道名（半删）：' + stale.join(', ')).toEqual([])
    // 无法解析的第一参也算红：拿常量名猜或留个变量通道，都会让这条判据失明
    expect(
      rows.filter((r) => /无法解析/.test(r.channel)),
      '有 handler 的通道名解不出来，先补齐再谈通过'
    ).toEqual([])
  })

  it('3. 实现体不许回来（三个文件 + 六个符号 + risk.ts 只准留 risk:rules）', () => {
    const goneFiles = [
      'src/main/ipc/subagent.ts',
      'src/main/core/agent/subagents/agent-loader.ts',
      'src/main/core/agent/credibility/visualizer.ts',
    ]
    for (const rel of goneFiles) {
      expect(fs.existsSync(path.join(ROOT, rel)), `${rel} 又回到盘上`).toBe(false)
    }
    const goneSymbols: [string, RegExp][] = [
      ['src/shared/agent-types.ts', /SystemPingResponse/],
      ['src/shared/ipc-channels.ts', /\bSYSTEM\s*=\s*\{/],
      ['src/main/services/log/logger.ts', /\bsetMinLevel\b/],
      ['src/main/services/terminal/terminal-completion-engine.ts', /\bimportHistory\b/],
      ['src/main/core/agent/subagents/index.ts', /\bagent-loader\b/],
      ['src/preload/domains/system.ts', /\bgetProtocolVersion\b/],
    ]
    for (const [rel, re] of goneSymbols) {
      expect(re.test(codeOnly(readSourceFile(path.join(ROOT, rel)))), `${rel} 里还留着 ${re}`).toBe(false)
    }

    // risk.ts 必须还在：它里面那条 risk:rules 是设置页风险控制区在读的活出口。
    // #216 第一版把整个文件当死面删了，是 `pnpm audit:ipc` 报"preload 调了但主进程未注册"才拦下来的
    // ——判"死"要按通道与调用点判，不能按文件判。所以这里禁的是那一把通道，并要求活的那条注册点没被带走。
    const risk = codeOnly(readSourceFile(path.join(ROOT, 'src/main/ipc/risk.ts')))
    expect(risk, 'risk:check 那把有第二个出口，不许回来').not.toMatch(/RISK\.CHECK/)
    expect(risk, '同文件的活出口 risk:rules 被一起带走了：设置页会读不到规则').toMatch(/RISK\.RULES/)
  })

  it('4. 反过度砍：五条活链的调用点都还在', () => {
    // 4-1 退出收尾真的刷盘（删 log:flush 不许顺手把 logger.flush 的调用也带走）
    expect(codeOnly(readSourceFile(path.join(ROOT, 'src/main/index.ts')))).toMatch(/logger\.flush\(/)
    // 4-2 测试清场用的 resetTokenStats 还在（本轮只删 IPC 那层包装）
    expect(codeOnly(readSourceFile(path.join(ROOT, 'src/main/core/agent/providers/token-stats.ts')))).toMatch(
      /export function resetTokenStats/
    )
    // 4-3 沙箱审批自己还在用 assessCommandRisk
    expect(codeOnly(readSourceFile(path.join(ROOT, 'src/main/ipc/sandbox-approval.ts')))).toMatch(
      /await assessCommandRisk\(/
    )
    // 4-4 SFTP stat 的主进程直 call 三家消费者都还在（删的是 IPC 出口，不是能力）
    for (const rel of [
      'src/main/services/preview/preview-service.ts',
      'src/main/services/ssh/shell-integration.ts',
      'src/main/services/mcp/tools/registry-ssh.ts',
    ]) {
      expect(codeOnly(readSourceFile(path.join(ROOT, rel))), `${rel} 不再用 stat：这条链断了`).toMatch(/\bstat\(/)
    }
    // 4-5 日志页读的那条通道还在
    expect(rowsOfChannels()).toContain('log:read')
  })

  it('5. 真靶机 e2e 改走界面真用的那条路（不许再让测试替产品选一条没人走的路）', () => {
    const rel = 'tests/e2e/ssh-live-sftp.spec.ts'
    const src = codeOnly(readSourceFile(path.join(ROOT, rel)))
    expect(src, `${rel} 还在按 sftpStat 取数：界面走的是 sftpList`).not.toMatch(/sftpStat/)
    expect(src, `${rel} 得改成走界面真用的 sftpList，否则这条真靶机取证照不到产品`).toMatch(/sftpList/)
  })

  it('6. 两个方向的自证：这套解析认得出坏形状、也不误伤好形状', () => {
    const { byConst } = channelIndexes()
    expect(byConst.get('LOG.READ'), '单源索引没建起来（连活通道都解不出真值）').toBe('log:read')
    const bad = handleTargetsOf(
      `import { ipcMain } from 'electron'\nipcMain.handle('log:flush', () => true)\n`,
      '__synthetic__.ts'
    )
    expect(bad, '注入的被禁通道没被抓到，第 2 条判据是恒真的').toEqual(['log:flush'])
    // 常量写法与带别名前缀的写法都要解成同一个真值（#211 那批就是这么漏过一遍的）
    const good = handleTargetsOf(
      `ipcMain.handle(LOG.READ, () => true)\nipcMain.handle(CHANNELS.SYSTEM.PING, () => true)\n`,
      '__synthetic__.ts'
    )
    expect(good, "'家族.键' 与带别名前缀的写法都要取到末两段").toEqual(['LOG.READ', 'SYSTEM.PING'])
    expect(byConst.get(good[0]), '活通道解不出真值').toBe('log:read')
  })
})

function rowsOfChannels(): string[] {
  return registeredChannels().map((r) => r.channel)
}
