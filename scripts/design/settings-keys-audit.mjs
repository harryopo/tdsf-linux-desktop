#!/usr/bin/env node
/**
 * 设置键登记闸：每个界面能写的设置键，必须在这里说清"谁真的在读它"
 *
 * 为什么要有这个闸：2026-10-06 扫出 25 个"拨了没反应"的设置——风险控制页的"自动拦截"
 * "二次确认等级"、终端页的"响铃""WebGL 渲染""右键粘贴"、决策页的"置信度阈值"等。
 * 用户拨完存进 config 就再没人读过，界面上却摆得像能用的功能。
 * 这类缺陷 typecheck 和单测都抓不到（写进去是合法调用），只能按"有没有登记消费者"来卡。
 *
 * 用法：
 *   node scripts/design/settings-keys-audit.mjs            # 打印对账结果
 *   node scripts/design/settings-keys-audit.mjs --dump      # 只列代码里扫到的键与写入方
 *   node scripts/design/settings-keys-audit.mjs --gate       # 门禁（新增未登记键 / 假设置回涨 → 退出码 1）
 *
 * 加一个新设置：在 WIRED 里补一行，写清消费者文件（真实存在、真的按这个键取值）。
 * 接不上消费者就别加控件——DESIGN.md §10：界面不写没实现的能力。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')
const SRC = path.join(ROOT, 'src')

const args = process.argv.slice(2)
for (const a of args) {
  if (a !== '--gate' && a !== '--dump') {
    console.error(`未知参数：${a}\n用法：node scripts/design/settings-keys-audit.mjs [--gate|--dump]`)
    process.exit(2)
  }
}
const GATE = args.includes('--gate')
const DUMP = args.includes('--dump')

/**
 * 已接上的设置键：值 -> 消费者（写"谁按这个键取值并改变行为"）。
 * 这里的每一行都是 2026-10-06 逐个 grep 核过的，不是猜的。
 */
const WIRED = {
  // 外观：main.tsx 把 store 字段落到 CSS 变量，TerminalView 取字体/行高
  'appearance.theme': 'stores/appearance-store.ts → themeMode，main.tsx 落到 data-theme',
  'appearance.fontSize': 'main.tsx（CSS 变量）、components/terminal/TerminalView.tsx',
  'appearance.lineHeight': 'main.tsx、components/terminal/TerminalView.tsx',
  'appearance.codeFont': 'components/terminal/TerminalView.tsx（xterm fontFamily）',
  'appearance.codeTheme': 'components/terminal/TerminalView.tsx（xterm 配色）',
  'appearance.density': 'main.tsx（密度类挂到根节点）',
  // 终端：TerminalView 挂载时逐个 configGet
  'terminal.fontSize': 'components/terminal/TerminalView.tsx',
  'terminal.lineHeight': 'components/terminal/TerminalView.tsx',
  'terminal.cursorStyle': 'components/terminal/TerminalView.tsx',
  'terminal.cursorBlink': 'components/terminal/TerminalView.tsx',
  'terminal.scrollback': 'components/terminal/TerminalView.tsx',
  'terminal.bellEnabled': 'components/terminal/TerminalView.tsx 听 onBell 闪终端（.term-bell-flash）',
  'terminal.autoCopy': 'components/terminal/TerminalView.tsx 选区监听里写剪贴板',
  'terminal.stripNewline': 'components/terminal/clipboard-format.ts（复制与选中即复制共用）',
  'terminal.stripControlChars': 'components/terminal/clipboard-format.ts',
  // 模型/预算：主进程运行时取值
  llmConfig: 'src/main/services/storage/config-store.ts',
  monthlyBudget: 'src/main/ipc/agent-runtime.ts',
  alertThreshold: 'src/main/ipc/agent-runtime.ts',
  // 告警阈值：设置页写、监控页与主进程读
  'monitor.threshold.cpu': 'pages/MonitorPage.tsx、src/main/ipc/monitor.ts',
  'monitor.threshold.memory': 'pages/MonitorPage.tsx、src/main/ipc/monitor.ts',
  'monitor.threshold.disk': 'pages/MonitorPage.tsx、src/main/ipc/monitor.ts',
  // SSH：store 回填 + 连接时按 authType/超时取值
  sshDefaults: 'stores/settings-store.ts 回填，pages/SshSettings.tsx 建连时取用',
  sshTimeout: 'stores/settings-store.ts 回填，pages/SshSettings.tsx 建连时取用',
  'ssh.allowPasswordAuth': "pages/SshSettings.tsx 换算成 sshDefaults.authType（'password'/'privateKey'）",
  // 决策与校准：主进程按键取值
  'decision.weights': 'src/main/ipc/credibility.ts',
  'decision.decisionTimeout': 'src/main/core/agent-workflow.ts resolveConfirmTimeoutMs（确认超时自动拒绝）',
  'calibration.minSamples': 'pages/CalibrationSettings.tsx 取出后当 IPC 入参 → tuneProvider → optimizeTemperature',
  // 纯界面态：本页读回来恢复展开/草稿，行为确实变了
  'decision.tierStates': 'pages/DecisionSettings.tsx 恢复风险层级展开状态',
  'decision.textAreas': 'pages/DecisionSettings.tsx 恢复审批补充说明草稿',
}

/**
 * 已知没接上的设置键（欠账登记，不是许可）。
 * 每一条要么接上消费者、要么把控件删掉；数量只许降不许升（见 FAKE_CAP）。
 */
const FAKE = {
  // 风险控制页：整页宣称的策略都没进主进程
  'risk.protectionLevel': '未接：主进程 command-gate 不看这个等级',
  'risk.autoBlock': '未接：拦截由 command-gate 决定，关掉此开关也照样拦',
  'risk.desensitize': '未接：日志脱敏没有读这个键',
  'risk.permissionMode': '未接：claude-sdk-provider 写死 bypassPermissions',
  'risk.auditCmdExec': '未接：审计日志无条件记录',
  'risk.auditFileMod': '未接：同上',
  'risk.auditAiDecision': '未接：同上',
  'risk.auditSshConn': '未接：同上',
  'risk.auditRetention': '未接：只读展示项，值写死 180',
  'risk.recordingRetention': '未接：没有操作录像功能',
  'risk.rules': '未接：真正生效的规则在 src/main/core/command-rules.json',
  // 决策控制页：本轮已删掉 4 条（置信度阈值/文件大小/批量数/回滚时长），剩这条要接进执行链
  // 终端设置页：剩下的两条要动主进程才接得上
  'terminal.shell': '未接：本地 pty 用固定 shell',
  'terminal.cmdTimeout': '未接',
}

/** 假设置上限：等于 2026-10-06 实测值，只能往下调 */
const FAKE_CAP = 13

/** 递归收集 .ts/.tsx（跳过 .d.ts） */
function sourceFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(p, acc)
    else if (/\.tsx?$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) acc.push(p)
  }
  return acc
}

const files = sourceFiles(SRC)
const sources = new Map(files.map((f) => [f, fs.readFileSync(f, 'utf8')]))
const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/')

/** appearance-store 的 CONFIG_KEY_MAP：{ fontSize: 'appearance.fontSize', ... } */
const CONFIG_MAP_RE = /(\w+):\s*'([a-z][a-zA-Z0-9.]*)',?/g
const fieldKey = new Map()
for (const [file, code] of sources) {
  if (!rel(file).includes('appearance-store')) continue
  const block = code.match(/CONFIG_KEY_MAP[^}]*}/s)
  if (!block) continue
  for (const m of block[0].matchAll(CONFIG_MAP_RE)) fieldKey.set(m[1], m[2])
}

/**
 * 写入侧模式。两个实测坑：
 * - 泛型参数里可以带 >（usePersistentState<Partial<SshConfig>>），用 [^()]* 兜住
 * - setAppearance('fontSize') 传的是 store 字段名，要换算成 'appearance.fontSize'，
 *   否则会冒出一堆"fontSize 没人读"的假键
 */
const WRITE_PATTERNS = [
  /usePersistentState\s*(?:<[^()]*>)?\(\s*'([^']+)'/g,
  /configSet\(\s*'([^']+)'/g,
  /setAppearance\(\s*'([^']+)'/g,
]

const writers = new Map()
for (const [file, code] of sources) {
  const r = rel(file)
  for (const re of WRITE_PATTERNS) {
    for (const m of code.matchAll(re)) {
      const key = /AppearanceSettings\.tsx$/.test(r) ? (fieldKey.get(m[1]) ?? m[1]) : m[1]
      if (!writers.has(key)) writers.set(key, new Set())
      writers.get(key).add(r)
    }
  }
  if (r.includes('appearance-store')) {
    const block = code.match(/CONFIG_KEY_MAP[^}]*}/s)
    if (block) {
      for (const m of block[0].matchAll(CONFIG_MAP_RE)) {
        if (!writers.has(m[2])) writers.set(m[2], new Set())
        writers.get(m[2]).add(r)
      }
    }
  }
}

if (DUMP) {
  for (const [key, wset] of [...writers].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`${key}\t${[...wset].join(',')}`)
  }
  console.log(`TOTAL\t${writers.size}`)
  process.exit(0)
}

const problems = []

const unregistered = [...writers.keys()].filter((k) => !(k in WIRED) && !(k in FAKE))
if (unregistered.length) {
  problems.push(
    `这些设置键没登记消费者：${unregistered.join(', ')}\n` +
      '       → 在 WIRED 里补上"谁按这个键取值"，或者把界面上的控件删掉',
  )
}

const staleWired = Object.keys(WIRED).filter((k) => !writers.has(k))
if (staleWired.length) {
  problems.push(`WIRED 里这些键的写入方已经不在了，请删掉条目：${staleWired.join(', ')}`)
}
const staleFake = Object.keys(FAKE).filter((k) => !writers.has(k))
if (staleFake.length) {
  problems.push(`FAKE 里这些键已经没了（控件删了或接上了），请删掉条目：${staleFake.join(', ')}`)
}

const fakeCount = Object.keys(FAKE).length
if (fakeCount > FAKE_CAP) {
  problems.push(`假设置从 ${FAKE_CAP} 涨到 ${fakeCount}（每加一个拨了没反应的开关，用户就多被骗一次）`)
}

console.log(
  `设置键 ${writers.size} 个：已登记消费者 ${Object.keys(WIRED).length}，` +
    `未接（欠账）${fakeCount} / 上限 ${FAKE_CAP}`,
)
if (fakeCount < FAKE_CAP) {
  console.log(`  欠账从 ${FAKE_CAP} 降到 ${fakeCount}，可以把 FAKE_CAP 收紧到 ${fakeCount}`)
}
if (fakeCount) {
  console.log('\n=== 未接清单（界面上有、行为上没有）===')
  for (const [k, why] of Object.entries(FAKE)) {
    console.log(`  ${k.padEnd(30)} ${writers.has(k) ? '' : '（写入方已消失）'}${why}`)
  }
}

if (problems.length) {
  console.error('\nFAIL：')
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
if (GATE) console.log('\nPASS：每个设置键都登记了消费者或已记入欠账清单')
process.exit(0)
