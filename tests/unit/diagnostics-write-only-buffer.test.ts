/**
 * 诊断缓冲的界面出口必须关掉（#206 判决；日志那一腿的形状按 #222 之后重定）
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
 *
 * 来历（2026-10-25 #222）：**第 3 条换了靶子，不是放宽。** 它原来列两个生产者——sidecar 与
 * "循环工程 subagent"，靠那份文件里有一条写应用日志的路径来证明"删缓冲没把日志能力一起砍掉"。
 * 那份文件（`core/agent/subagents/loop-engineering-subagent.ts`）已在 #222 整删：那条链在渲染层
 * 没有任何一处能调用它的启动函数，多步编排与仍在跑的 PAOR 自主循环重复。`readSourceFile` 对
 * 不存在的文件返回空串，于是"应当还有一条写日志的路径"变成对着空串断言——本轮它就是红的
 * （实测：`expected '' to match /\bthis\.log\.(info|warn|error|debug)\(|\blogger\.(...)\(/`）。
 * 现在这一档只钉**今天真的那一个生产者** `core/sidecar/sidecar-manager.ts`（收 Python 子进程输出），
 * 并把口径从"文件里出现过 logger.x("升级成"从子进程输出到应用日志文件那四环都在"：
 * ① 用的是应用日志那把 logger（不是自己拼 console——打包后的 Windows 没有控制台）；
 * ② 在应用日志上起了 SIDECAR 分类前缀；③ 按级别分流真的写进去（含 stderr 升 WARN 那条规则）；
 * ④ stdout 与 stderr 两条 data 回调都真的接上了它（只接一条就是"看着在写、半个进程没人听"）。
 * 那份基类的文件面/通道面归 `tests/unit/loop-engineering-surface.test.ts` 钉，本文件不重复钉；
 * 第 3 条末尾留了一条"那个生产者不许悄悄回来"的对照，回来的话这一档的名单必须跟着长，不能装看不见。
 *
 * 顺带记两笔实测到的事实，免得下一个人再猜：
 * - `services/diagnostics/` 现在只剩 `log-analyzer.ts`（MCP 那条在用）与 `types.ts`
 *   （`LogLevel`/`LogEvent` 这些形状的单源）；sidecar 与 registry-log 还从 `types.ts` 取类型，
 *   那是**类型**依赖，不是又有人往那块缓冲里写——第 2 条只按缓冲的模块名取数，不受影响。
 * - 第 3 条钉的是"路径在"，不保证 DEBUG 档在生产构建里也落文件：`initLogger` 给的 minLevel
 *   在非 dev 是 INFO。这条口径写在这里，别把它当成"什么级别都留档了"。
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { listSourceFiles, readSourceFile } from '../helpers/source-scan'

const ROOT = path.resolve(__dirname, '../..')
const SIDECAR_REL = 'src/main/core/sidecar/sidecar-manager.ts'
const LOGGER_REL = 'src/main/services/log/logger.ts'

/** 快照闸那份暴露面清单（它与真 preload 由 preload-api-surface.test.ts 双向对账） */
function exposedKeys(): string[] {
  return readSourceFile(path.join(ROOT, 'tests/unit/__fixtures__/preload-api-surface.txt'))
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}

/** 只取代码正文：注释里提"以前递给 DiagnosticsService 的缓冲"是在解释为什么删，不算接线 */
function codeOnly(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n')
}

/** 从 from 起找第一个 {，做括号配平返回它内部的正文；取不到返回空串——判据会红，不会假绿 */
function bracedRegion(code: string, from: number): string {
  const open = code.indexOf('{', from)
  if (open < 0) return ''
  let depth = 0
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++
    else if (code[i] === '}') {
      depth--
      if (depth === 0) return code.slice(open + 1, i)
    }
  }
  return ''
}

/**
 * 判据 3 的实现体：四环缺一环就是断链，返回缺的那几环（空数组才算通过）。
 * 抽成纯函数，好让第 5 条拿"把某环剪掉"的样本复测同一个实现。
 */
function appLogGaps(text: string): string[] {
  const code = codeOnly(text)
  const gaps: string[] = []
  if (!code.includes('services/log/logger')) gaps.push('① 没 import 应用日志那个模块（写的是别的出口或干脆 console）')
  if (!code.includes("child('SIDECAR'")) gaps.push('② 没在应用日志上起 SIDECAR 分类前缀（落进去也认不出是谁写的）')

  const declAt = code.search(/forwardLog\s*\(/)
  const body = declAt < 0 ? '' : bracedRegion(code, declAt)
  if (body === '') {
    gaps.push('③ 取不到 forwardLog 的成员体（改名或换写法了——那这条判据得跟着改口径，不许当它还在）')
  } else {
    for (const lvl of ['debug', 'info', 'warn', 'error'] as const) {
      if (!body.includes(`logger.${lvl}(`)) gaps.push(`③ forwardLog 不再按 ${lvl.toUpperCase()} 档写应用日志（级别判断被砍了半截）`)
    }
    if (!body.includes('inferLogLevel(')) gaps.push('③ forwardLog 不再按推断出的级别分流')
    if (!body.includes('isStderr')) gaps.push('③ forwardLog 丢了"stderr 默认升 WARN"那条规则')
  }

  for (const stream of ['stdout', 'stderr']) {
    const at = code.indexOf(`${stream}?.on('data'`)
    const handler = at < 0 ? '' : bracedRegion(code, at)
    if (!handler.includes('this.forwardLog(')) gaps.push(`④ ${stream} 的输出没接到 forwardLog——半条链静默`)
  }
  return gaps
}

describe('diagnostics 只写不读的缓冲已关掉（#206）', () => {
  it('1. 暴露面清单里不许再出现任何 diagnostics 键', () => {
    const keys = exposedKeys()
    expect(keys.length, '暴露面清单是空的——那对账用的是空气').toBeGreaterThan(0)
    const left = keys.filter((k) => /^diagnostics/i.test(k) || /^onDiagnostics/i.test(k))
    expect(left, '这些键还在，说明"没人按也没人听"的那半套没删干净').toEqual([])
  })

  it('2. src 下除服务自身目录外，不许有文件引用这块缓冲（防止把死接口接回来）', () => {
    const files = listSourceFiles(path.join(ROOT, 'src'))
    expect(files.length, '一个源文件都没抽到——那不是零引用，那是没扫').toBeGreaterThan(0)
    const hits: string[] = []
    for (const abs of files) {
      if (!abs.endsWith('.ts')) continue
      const rel = path.relative(ROOT, abs).split(path.sep).join('/')
      if (rel.startsWith('src/main/services/diagnostics/')) continue
      const text = codeOnly(readSourceFile(abs))
      if (text.includes('diagnostics-service') || text.includes('getDiagnosticsService')) hits.push(rel)
    }
    expect(hits, '这些文件还 import 那块没人读的缓冲').toEqual([])
  })

  it('3. Sidecar 的输出仍真落应用日志（#206 删的是没人读的副本，不是日志能力）', () => {
    const text = readSourceFile(path.join(ROOT, SIDECAR_REL))
    expect(text, `${SIDECAR_REL} 读不到——那不是判过了，那是没查`).not.toBe('')
    expect(appLogGaps(text), '侧车到应用日志这条链断了这些环').toEqual([])
    // 生产者名单的来历对照：那个第二生产者已随 #222 整删。它要是回来了，这一档的名单必须跟着长，
    // 不能装作没看见（文件面与通道面的判决归 loop-engineering-surface.test.ts 第 1 条）
    expect(
      fs.existsSync(path.join(ROOT, 'src/main/core/agent/subagents/loop-engineering-subagent.ts')),
      '循环工程 subagent 又回来了——#222 的判决要重开，本条的生产者名单也得跟着补第二行'
    ).toBe(false)
  })

  it('4. 正向对照：MCP 的 log_analyze 仍然真走 LogAnalyzer（这条删前删后都该绿）', () => {
    const code = codeOnly(readSourceFile(path.join(ROOT, 'src/main/services/mcp/tools/registry-log.ts')))
    expect(code, 'registry-log.ts 读不到').not.toBe('')
    expect(code.includes("'log_analyze'"), 'MCP 那个日志分析工具不在了').toBe(true)
    expect(code.includes('diagnostics/log-analyzer'), 'log_analyze 不再从留下来的那个模块取 LogAnalyzer').toBe(true)
    expect(code.includes('new LogAnalyzer('), '只 import 不实例化——那这条出口是挂名的').toBe(true)
  })

  it('5. 应用日志那一头真的落盘，且启动时初始化过（否则"落进应用日志"是空话）', () => {
    const code = codeOnly(readSourceFile(path.join(ROOT, LOGGER_REL)))
    expect(code, `${LOGGER_REL} 读不到`).not.toBe('')
    expect(code.includes('appendFile('), 'logger 不再往文件追加——它只剩 console 那一份').toBe(true)
    expect(code.includes('app-'), '日志文件名不再按天（logs/app-YYYY-MM-DD.log）').toBe(true)
    expect(code.includes('child('), 'logger 没有 child()，那句 SIDECAR 分类前缀就是编的').toBe(true)
    // 真在启动链上初始化过；只 export 不 init 等于所有 logger.x() 都被 !initialized 挡回 console
    const main = codeOnly(readSourceFile(path.join(ROOT, 'src/main/index.ts')))
    expect(main.includes('initLogger('), '主进程不再初始化 logger——那第 3 条那条链写到不了文件').toBe(true)
  })

  it('6. 量具自证：把第 3 条那四环逐个剪掉，必须各自报出来；没剪的样本不许报', () => {
    const real = readSourceFile(path.join(ROOT, SIDECAR_REL))
    expect(appLogGaps(real), '真实现本身就带着缺口——那下面这些"剪一环"的比对没有意义').toEqual([])

    const cuts: Array<[string, string, string]> = [
      ['①', "from '../../services/log/logger'", "from 'somewhere/else'"],
      ['②', "child('SIDECAR')", "child('别的')"],
      ['③', 'logger.debug(', 'nothing.debug('],
      ['③', 'let level = this.inferLogLevel(trimmed)', 'let level = 0'],
      ['③', 'if (isStderr && level', 'if (false && level'],
      ['④', 'this.forwardLog(text, false)', 'void text'],
      ['④', 'this.forwardLog(text, true)', 'void text'],
    ]
    for (const [ring, from, to] of cuts) {
      expect(real.includes(from), `剪样的锚点「${from}」在真实文件里已经找不到了——量具与实现脱钩`).toBe(true)
      const gaps = appLogGaps(real.replace(from, to))
      // 只许报这一环：一次剪一环却报出一串，说明量具在"样本整体读不出来"时也喊缺环，那是另一种假绿
      expect(gaps.length, `剪掉 ${ring} 环（${from}）后应当只报那一环，实际：${gaps.join(' / ')}`).toBe(1)
      expect(gaps[0]?.startsWith(ring), `剪掉 ${ring} 环（${from}）后第 3 条没认出它`).toBe(true)
    }

    // 反面对照：整段"看起来在写日志"（其实只有 console）但没有那四环的样本，必须报满四类缺口
    const naive = `class M { private forwardLog(r: string) { console.log(r) } }\n`
    const gaps = appLogGaps(naive)
    expect(new Set(gaps.map((g) => g[0])), '只有 console 的那份样本被抓到的环数不对').toEqual(
      new Set(['①', '②', '③', '④'])
    )
  })
})
