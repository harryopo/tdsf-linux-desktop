/**
 * audit-ipc-contract.ts — IPC 契约三方对账脚本（防"假 UI/断链"复发门禁）
 *
 * 背景：本项目曾出现大量"链路断在中间"的问题（typecheck/lint/单测全绿也查不出）：
 * - preload 定义了方法但没被 contextBridge 暴露（mcp 系 6 方法）
 * - electron.d.ts 声明了方法但运行时不存在（类型撒谎）
 * - 渲染层调用了不存在的方法（运行时 undefined）
 * - preload invoke 的通道主进程没注册（invoke 直接 reject）
 *
 * 对账内容（三方集合做差集）：
 *   1. invoke 契约：preload ipcRenderer.invoke 的通道 ⊆ main ipcMain.handle 注册的通道
 *   2. 事件契约：preload 监听的通道 ⊆ main webContents.send/safeSend 推送的通道
 *   3. 调用契约：渲染层 window.electronAPI.xxx 调用 ⊆ contextBridge 实际暴露的方法
 *   4. 信息项（不阻断）：暴露了但渲染层零调用的方法清单（潜在白做的后端能力）
 *
 * 运行：npx tsx scripts/audit-ipc-contract.ts
 * 退出码：发现 FAIL 级断链时 exit 1（可直接挂 CI）
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { exposedApiNames } from './ipc/api-surface'
import { rendererMembersUsed } from './quality/renderer-calls'

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'src')

// ============================================================
// 工具函数
// ============================================================

/** 递归收集目录下所有 .ts/.tsx 文件 */
function collectFiles(dir: string, exts = ['.ts', '.tsx']): string[] {
  const out: string[] = []
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      out.push(...collectFiles(full, exts))
    } else if (exts.some((e) => entry.name.endsWith(e)) && !entry.name.endsWith('.d.ts')) {
      out.push(full)
    }
  }
  return out
}

function read(file: string): string {
  return fs.readFileSync(file, 'utf-8')
}

function rel(file: string): string {
  return path.relative(ROOT, file).replace(/\\/g, '/')
}

// ============================================================
// 1. 解析通道常量
// ============================================================

/** ipc-channels.ts 常量表：DOMAIN.KEY → 'channel:string' */
function parseChannelConstants(): Map<string, string> {
  const map = new Map<string, string>()
  const file = path.join(SRC, 'shared', 'ipc-channels.ts')
  const text = read(file)
  // 匹配 export const DOMAIN = { ... } 块
  const blockRe = /export const (\w+)\s*=\s*\{([\s\S]*?)\n\}/g
  let block: RegExpExecArray | null
  while ((block = blockRe.exec(text)) !== null) {
    const domain = block[1]
    const body = block[2]
    const entryRe = /(\w+):\s*'([^']+)'/g
    let entry: RegExpExecArray | null
    while ((entry = entryRe.exec(body)) !== null) {
      map.set(`${domain}.${entry[1]}`, entry[2])
    }
  }
  return map
}

/**
 * 全局标识符→通道映射：扫描 src 全部文件里的
 * - `const NAME = 'xxx:yyy'`（本地字符串常量，如 TASK_PERMISSION_APPROVE_INVOKE）
 * - `const NAME = DOMAIN.KEY`（常量别名，如 const LLM_ERROR_CHANNEL = LLM.ERROR）
 * 同名不同值时保留首个（跨文件同名常量极少且通常同值）。
 */
function buildIdentifierMap(constants: Map<string, string>): Map<string, string> {
  const map = new Map<string, string>()
  const strRe = /const (\w+)\s*=\s*'([\w][\w:.-]*:[\w:.-]+)'/g
  const aliasRe = /const (\w+)\s*=\s*(\w+\.\w+)\b/g
  for (const file of collectFiles(SRC)) {
    const text = read(file)
    let m: RegExpExecArray | null
    strRe.lastIndex = 0
    while ((m = strRe.exec(text)) !== null) {
      if (!map.has(m[1])) map.set(m[1], m[2])
    }
    aliasRe.lastIndex = 0
    while ((m = aliasRe.exec(text)) !== null) {
      const resolved = constants.get(m[2])
      if (resolved && !map.has(m[1])) map.set(m[1], resolved)
    }
  }
  return map
}

/** 把 handle/invoke/send 的通道参数解析为字符串（字面量 / DOMAIN.KEY / 标识符常量） */
let identMap: Map<string, string> = new Map()
function resolveChannelArg(arg: string, constants: Map<string, string>): string | null {
  const trimmed = arg.trim()
  const literal = /^['"`]([^'"`]+)['"`]$/.exec(trimmed)
  if (literal) return literal[1]
  const constRef = /^(\w+\.\w+)$/.exec(trimmed)
  if (constRef) return constants.get(constRef[1]) ?? null
  // 带命名空间别名的写法：CHANNELS.SYSTEM.PING —— 前缀只是 import 的别名，
  // 按后两段查常量表（不认它就会把真实存在的 handler 报成"主进程未注册"）
  const namespaced = /^\w+\.(\w+\.\w+)$/.exec(trimmed)
  if (namespaced) return constants.get(namespaced[1]) ?? null
  const ident = /^(\w+)$/.exec(trimmed)
  if (ident) return identMap.get(ident[1]) ?? null
  return null // 动态拼接的通道（如模板字符串），无法静态解析，跳过
}

// ============================================================
// 2. 收集各方集合
// ============================================================

interface ChannelHit {
  channel: string
  file: string
}

/** main 进程：ipcMain.handle/on 注册的通道 */
function collectMainHandled(constants: Map<string, string>): ChannelHit[] {
  const hits: ChannelHit[] = []
  const re = /ipcMain\.(?:handle|on)\(\s*([^,)]+)/g
  for (const file of collectFiles(path.join(SRC, 'main'))) {
    const text = read(file)
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const ch = resolveChannelArg(m[1], constants)
      if (ch) hits.push({ channel: ch, file: rel(file) })
    }
  }
  return hits
}

/** main 进程：webContents.send / safeSend 推送的事件通道 */
function collectMainSent(constants: Map<string, string>): ChannelHit[] {
  const hits: ChannelHit[] = []
  // 推送点的四种写法，逐个显式列出（不是"任何调用里出现大写常量都算"——
  // 那样 ipcMain.handle(SSH.X) 也会被当成推送源，把真的没源的通道洗白成盲区）：
  //   webContents.send(CH / safeSend(窗口表达式, CH / broadcastToWindows(CH（W4 多窗口）
  //   pushToRenderer(CH（调度器那类走统一转发函数的）
  const res = [
    /webContents\.send\(\s*([^,)]+)/g,
    /safeSend\(\s*[\w.]+\s*,\s*([^,)]+)/g,
    /broadcastToWindows\(\s*([^,)]+)/g,
    /pushToRenderer\(\s*([^,)]+)/g,
  ]
  for (const file of collectFiles(path.join(SRC, 'main'))) {
    const text = read(file)
    for (const re of res) {
      re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(text)) !== null) {
        const ch = resolveChannelArg(m[1], constants)
        if (ch) hits.push({ channel: ch, file: rel(file) })
      }
    }
  }
  return hits
}

/** preload：ipcRenderer.invoke 的通道 */
function collectPreloadInvoked(constants: Map<string, string>): ChannelHit[] {
  const hits: ChannelHit[] = []
  // 两条写法都要认：裸 ipcRenderer.invoke(CH)，和走契约校验的 invokeChecked('apiName', CH)。
  // 只认前者的话，D1 之后所有换成 invokeChecked 的通道都会被判成"主进程注册但 preload 没用"，
  // 而渲染层调用又会被判"未暴露"——整把闸变成 100 多条假红（2026-10-10 实测）。
  const re = /ipcRenderer\.(?:invoke|send)\(\s*([^,)]+)/g
  // 泛型形式也要认：invokeChecked<string>('sshShellStart', SSH.SHELL_START, ...)
  const checkedRe = /invokeChecked(?:<[^>]*>)?\(\s*['"][\w]+['"]\s*,\s*([^,)]+)/g
  for (const file of collectFiles(path.join(SRC, 'preload'))) {
    const text = read(file)
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const ch = resolveChannelArg(m[1], constants)
      if (ch) hits.push({ channel: ch, file: rel(file) })
    }
    checkedRe.lastIndex = 0
    while ((m = checkedRe.exec(text)) !== null) {
      const ch = resolveChannelArg(m[1], constants)
      if (ch) hits.push({ channel: ch, file: rel(file) })
    }
  }
  return hits
}

/** preload：createListener / ipcRenderer.on 监听的事件通道 */
function collectPreloadListened(constants: Map<string, string>): ChannelHit[] {
  const hits: ChannelHit[] = []
  const re = /(?:createListener|ipcRenderer\.on)\(\s*([^,)]+)/g
  for (const file of collectFiles(path.join(SRC, 'preload'))) {
    const text = read(file)
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const ch = resolveChannelArg(m[1], constants)
      if (ch) hits.push({ channel: ch, file: rel(file) })
    }
  }
  return hits
}

/**
 * preload 实际暴露的扁平方法名
 *
 * 解析交给 scripts/ipc/api-surface.ts —— 那才是名字表面的唯一事实（快照闸用它）。
 * 本脚本此前自己按"两空格缩进的 key 行"数一遍：拆域后 electronApi 里全是
 * `sshShellStart: ssh.shell.start` 这种引用，且暴露调用与对象字面量不再相邻，
 * 数出来的集合是错的，于是 126 条"方法未暴露"全是假红。
 */
function collectExposedMethods(): Set<string> {
  const file = path.join(SRC, 'preload', 'index.ts')
  const text = read(file)
  const names = exposedApiNames(text)
  if (names.size === 0) {
    console.error('未解析出 preload 暴露面（api-surface 的锚点漂了）')
    process.exit(2)
  }
  return names
}

function obsoleteExposedParser(): Set<string> {
  const file = path.join(SRC, 'preload', 'index.ts')
  const text = read(file)
  const startIdx = text.indexOf("contextBridge.exposeInMainWorld('electronAPI'")
  if (startIdx < 0) {
    console.error('未找到 contextBridge.exposeInMainWorld 调用')
    process.exit(2)
  }
  // 从对象字面量开括号起做括号配平，截取暴露块
  const objStart = text.indexOf('{', startIdx)
  let depth = 0
  let end = objStart
  for (let i = objStart; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  const block = text.slice(objStart, end)
  // 只取顶层 key（缩进 2 空格的 `xxx:` 行），嵌套对象内的 key 缩进更深
  const keys = new Set<string>()
  for (const line of block.split('\n')) {
    const m = /^ {2}(\w+):/.exec(line)
    if (m) keys.add(m[1])
  }
  return keys
}

/**
 * 渲染层用到的 electronAPI 成员名 → 出现在哪些文件。
 *
 * 识别规则本身在 scripts/quality/renderer-calls.ts（纯函数，两份方向的判据在
 * tests/unit/renderer-calls-instrument.test.ts）。这里只管遍历文件与记账。
 * 曾经内联的那两条正则漏掉解构式接线，把 settings-store.ts 里三条在用的键
 * 报成零调用——按那份清单删代码就会砍掉活线。
 */
function collectRendererCalls(): Map<string, Set<string>> {
  // method → 调用文件集合
  const calls = new Map<string, Set<string>>()
  for (const file of collectFiles(path.join(SRC, 'renderer'))) {
    for (const method of rendererMembersUsed(read(file))) {
      if (!calls.has(method)) calls.set(method, new Set())
      calls.get(method)!.add(rel(file))
    }
  }
  return calls
}

// ============================================================
// 3. 对账 + 报告
// ============================================================

function uniqueChannels(hits: ChannelHit[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const h of hits) {
    if (!map.has(h.channel)) map.set(h.channel, [])
    map.get(h.channel)!.push(h.file)
  }
  return map
}

function main(): void {
  const constants = parseChannelConstants()
  identMap = buildIdentifierMap(constants)
  const mainHandled = uniqueChannels(collectMainHandled(constants))
  const mainSent = uniqueChannels(collectMainSent(constants))
  const preloadInvoked = uniqueChannels(collectPreloadInvoked(constants))
  const preloadListened = uniqueChannels(collectPreloadListened(constants))
  const exposed = collectExposedMethods()
  const rendererCalls = collectRendererCalls()

  let failCount = 0
  let warnCount = 0
  const failLines: string[] = []
  const warnLines: string[] = []

  // --- 检查 1（FAIL）：preload invoke 的通道，主进程必须已注册 ---
  for (const [ch, files] of preloadInvoked) {
    if (!mainHandled.has(ch)) {
      failCount++
      failLines.push(`[FAIL][invoke断链] preload 调用通道 '${ch}' 但主进程未注册 handler（${files.join(', ')}）`)
    }
  }

  // --- 检查 2（WARN）：preload 监听的事件通道，主进程应有推送点 ---
  for (const [ch, files] of preloadListened) {
    if (!mainSent.has(ch)) {
      warnCount++
      warnLines.push(`[WARN][事件无源] preload 监听通道 '${ch}' 但主进程未发现推送点（${files.join(', ')}）`)
    }
  }

  // --- 检查 3（FAIL）：渲染层调用的方法必须已被 contextBridge 暴露 ---
  // 排除明显非 electronAPI 成员的误报（如类型断言产生的属性）
  for (const [method, files] of rendererCalls) {
    if (!exposed.has(method)) {
      failCount++
      failLines.push(
        `[FAIL][方法未暴露] 渲染层调用 electronAPI.${method} 但 preload 未暴露（${[...files].slice(0, 3).join(', ')}${files.size > 3 ? ` 等${files.size}处` : ''}）`,
      )
    }
  }

  // --- 检查 4（INFO）：暴露了但渲染层零调用（潜在白做能力，仅报告不阻断） ---
  const unused = [...exposed].filter((m) => !rendererCalls.has(m)).sort()

  // --- 检查 5（WARN）：主进程注册了但 preload 从未 invoke（暗接口） ---
  const darkChannels = [...mainHandled.keys()].filter((ch) => !preloadInvoked.has(ch)).sort()

  // ============================================================
  // 输出报告
  // ============================================================
  console.log('='.repeat(72))
  console.log('IPC 契约三方对账报告')
  console.log('='.repeat(72))
  console.log(`main 注册通道:        ${mainHandled.size}`)
  console.log(`main 事件推送通道:    ${mainSent.size}`)
  console.log(`preload invoke 通道:  ${preloadInvoked.size}`)
  console.log(`preload 监听通道:     ${preloadListened.size}`)
  console.log(`contextBridge 暴露方法: ${exposed.size}`)
  console.log(`渲染层调用方法:       ${rendererCalls.size}`)
  console.log('-'.repeat(72))

  if (failLines.length > 0) {
    console.log('\n■ FAIL 级断链（用户点了必然无响应/报错）：')
    for (const line of failLines) console.log('  ' + line)
  }
  if (warnLines.length > 0) {
    console.log('\n■ WARN 级问题：')
    for (const line of warnLines) console.log('  ' + line)
  }
  if (unused.length > 0) {
    console.log(`\n■ INFO：已暴露但渲染层零调用的方法（${unused.length} 个，潜在白做的能力）：`)
    console.log('  ' + unused.join(', '))
  }
  if (darkChannels.length > 0) {
    console.log(`\n■ INFO：主进程注册但 preload 未使用的通道（${darkChannels.length} 个）：`)
    console.log('  ' + darkChannels.join(', '))
  }

  console.log('\n' + '='.repeat(72))
  console.log(`结果：FAIL=${failCount} WARN=${warnCount} INFO(零调用方法)=${unused.length}/${UNUSED_CAP} INFO(暗通道)=${darkChannels.length}`)
  console.log('='.repeat(72))

  if (failCount > 0) {
    console.error('\n❌ 存在 FAIL 级 IPC 断链，请修复后再提交')
    process.exit(1)
  }
  if (unused.length > UNUSED_CAP) {
    console.error(
      `\n❌ 暴露但渲染层零调用的方法 ${unused.length} 个，超过刻度 ${UNUSED_CAP}（刻度只降不升）。`
    )
    console.error('  要么把这个键接到界面上（有真实调用点），要么整删（preload + 通道 + 类型 + 文案）。')
    console.error('  新增一个"后端有、前端没人按"的键，就是 §一 要判掉的那种白做能力——它不该静默进来。')
    console.error('  ' + unused.join(', '))
    process.exit(1)
  }
  console.log('\n✅ 无 FAIL 级断链')
}

/**
 * 零调用面的刻度：只降不升。
 *
 * 为什么现在要有这条（2026-10-20）：这一项原先只是 INFO，不阻断——于是它从 128 涨到 143
 * 的整段路上，报告每次都只是多打印一行，没有任何人会因此停下来。§一 的判决（逐个"接上或删"）
 * 要一批批做，判决还没做完之前先把口子焊住：想新增一个没人用的键，`pnpm audit:ipc` 就红。
 *
 * 降刻度必须和删除/接线同批提交（先降后接线会让 CI 立刻红在中间状态上）。
 * 143 → 141 是 2026-10-20 整删 Task Protocol 那两条 preload 键（同批提交，不是慢慢还的）。
 * 141 → 139 是 2026-10-21 实测：`historyBlocks` 上一批已接界面但刻度没跟着降，
 * `storageDeleteApiKey` 本轮接到「清除已保存的 Key」按钮。刻度只认实测，不认记忆。
 * 139 → 119 是 2026-10-24：整删 attention 7 + expectation 2 + promptfoo 3 共 12 键，
 * 另把 memory 4 键接到「AI 记忆」页（同批提交）。
 * 119 → 109 是同日：deploy 执行链整删（7 个 invoke + 3 个事件监听），只保留只读模板工具。
 * 109 → 106 是同日：@命令解析链整删（`at:list/parse/resolve` 三条 invoke 与对应 preload 键）。
 * 106 → 92 是同日：整删旧 AgentWorkflow 的 IPC 面（agent:start/confirm + agent:step 推送）
 * 与裸 llm:* 家族（chat/analyze/validate/chat-with-context/chat-with-tools/tool-approve
 * 六条 invoke 加 token/chunk/done/error/tool-progress/tool-approval 六条推送）。
 * 主对话只留一条路：agent:chat（Supervisor）；设置页「测试连接」是唯一的裸 llm 通道。
 * 92 → 89 是同日：整删五模式（`mode:list/set-default/get-current` 三条 invoke
 * 与对应 preload 键）——模式既不注入 prompt 也不拦工具，是纯壳。
 * 89 → 86 也是同日，但**这不是还债，是量具修正**：旧的采集器只认
 * `electronAPI.foo()` 与 `api.foo()` 两种写法，认不出
 * `const { foo } = window.electronAPI` 再调 `foo()`，于是把 settings-store.ts
 * 里在用的 configSaveLlm / storageHasApiKey / storageSaveApiKey 报成零调用。
 * 按那份清单动手就会砍掉活线（#60 是同一族错）。规则移到
 * scripts/quality/renderer-calls.ts，两个方向的可证伪判据在
 * tests/unit/renderer-calls-instrument.test.ts。
 * 86 → 80 是同日的第二次量具修正（同样不是还债）：别名那条规则把变量名写死成 `api`，
 * 又要求成员名后面紧跟 `(`，于是漏掉 `api.localTtyWrite?.(id, s)`（终端在这么写）
 * 和 `const call = api?.localTtyClose` 这种"取引用回头再调"的写法。
 * 新认出的 6 条 localTtyWrite / localTtyResize / localTtyClose / onLocalTtyExit /
 * sshShellClose / fileWatchStart 都回代码核过是真的调用点，不是把没用洗成在用。
 * 80 → 77 是同批的减法：整删三条"渲染层递整批数据就能写配置/写库、且界面从来不用"的通道
 * （`server:export` / `server:import` / `kb:import`）。在用的替代品都要求用户在原生
 * 对话框里挑文件（`server:export-file` / `server:import-file` / `kb:import-file`），
 * 少一把无人按的写入口，就少一条被 XSS 用到的路径。
 * 77 → 76 是同族第三次：链式调用会换行，`window.electronAPI` 下一行才写 `.riskGetRules()`
 * （RiskSettings.tsx:111 就是这样），而成员正则原来不容忍 `.` 前后的空白。
 * 风险控制页是真读真显示的，却被列进"没人用"——第三次证明**一次修正不算修完**。
 * 76 → 75 是同族第四次，也是这一轮**用真件横扫**抓出来的（不再等下一个假阳性自己冒头）：
 * 写法是 `const api = getElectronAPI()`（utils/electron-api.ts 的访问器函数）再 `api.dbGetStatus()`，
 * 别名不再直接等于 `window.electronAPI`，所以前面三条规则都碰不到它。
 * 横扫口径：把清单里每个键名在渲染层正文（剥注释、排除 .d.ts）里做一次宽松出现匹配，
 * 76 个键命中 4 个，其中 3 个只在生成的类型文件里（kbExport / providerGet / sftpStat，不算调用），
 * 剩下那 1 个 dbGetStatus 是真的第四种写法。**判"某键没人用"之前先问"我这把尺认得几种写法"。**
 * 数一下这份清单里有多少个键，等价于数"后端写了但界面从来没调用"的债，
 * 债的方向应该是零，不是"看着办"。
 */
const UNUSED_CAP = 75

main()
