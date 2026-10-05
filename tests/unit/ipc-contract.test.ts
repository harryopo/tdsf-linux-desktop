/**
 * IPC 四步同步不变量测试（D1：类型化消息契约的地基）
 *
 * 计划原本要求"用 zod 判别联合替掉 electron.d.ts 2221 行 + 拆分 3902 行 preload"。
 * 先量了一下现状：247 个通道里，主进程 0 处未引用、preload 只有 1 处未引用（且是
 * 僵尸栈留下的），也就是说四步同步其实没漂。这种情况下做 6000 行的机械重写
 * 换不来任何行为变化，反而会在阶段 F 要动外壳之前先制造一次不可评审的大 diff。
 *
 * 但这条闸一立起来就抓到了三类真问题（本轮已修）：
 * - 14 个推送通道名只写在代码里，中央表 `ipc-channels.ts` 根本没有
 *   （mcp:state-changed、claude-sdk:chunk/done/error、deploy:log/stepUpdate/done、
 *    tutorial:crawlProgress/crawlDone、sandbox:approval-request、paor:approval-request、
 *    agent:tool-event、agent:paor:iteration、task:permission-approval-request）
 * - `MCP_EXTERNAL` 组把 `mcp:external-*` 4 个通道重复声明了一遍
 * - `IpcChannelMap` 契约表里的 `kb:recentViews` 拼错（真实通道是 `kb:recent-views`）
 *
 * 所以 D1 这一轮交付的是"让四步同步变成机器可查"——漂移才是真正的失效模式，
 * 而它此前只靠人自觉。通道名打错、常量重复定义、直写字面量绕过中央表、
 * 契约表写了一个不存在的通道，现在都会在 pnpm test 里红。
 *
 * 用静态引用检查而不是真去 registerAllIpcHandlers()：后者要把 ssh/mcp/claude-sdk
 * 一整串原生模块拖进测试环境，慢且脆；引用检查抓的正是"写了没人用/用了没声明"。
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')
const CHANNELS_FILE = path.join(ROOT, 'src/shared/ipc-channels.ts')
const PRELOAD_FILE = path.join(ROOT, 'src/preload/index.ts')
const MODELS_FILE = path.join(ROOT, 'src/shared/models.ts')
const MAIN_DIR = path.join(ROOT, 'src/main')

/** GROUP.KEY → channel 字符串 */
function loadChannels(): Map<string, string> {
  const src = fs.readFileSync(CHANNELS_FILE, 'utf8')
  const map = new Map<string, string>()
  const groupRe = /export const ([A-Z_]+) = \{([\s\S]*?)\n\} as const/g
  let g: RegExpExecArray | null
  while ((g = groupRe.exec(src))) {
    const keyRe = /([A-Z_0-9]+)\s*:\s*'([^']+)'/g
    let k: RegExpExecArray | null
    while ((k = keyRe.exec(g[2]))) map.set(`${g[1]}.${k[1]}`, k[2])
  }
  return map
}

function walkTs(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) walkTs(p, acc)
    else if (/\.ts$/.test(entry.name)) acc.push(p)
  }
  return acc
}

const channels = loadChannels()
const channelValues = new Set(channels.values())
const preloadSrc = fs.readFileSync(PRELOAD_FILE, 'utf8')
const mainFiles = walkTs(MAIN_DIR)
const mainSrc = mainFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n')

const rel = (file: string): string => path.relative(ROOT, file).replace(/\\/g, '/')

/**
 * 主进程注册了、但渲染层拿不到的通道
 *
 * 每条都要写理由。加新条目等于承认"这里有个够不着的能力"，
 * 所以宁可显式记账，也不要让测试变绿得无声无息。
 */
const PRELOAD_UNREACHABLE: Record<string, string> = {
  'AGENT.CANCEL':
    'v0.8 AgentWorkflow 的取消通道。渲染层的取消走 AGENT.CHAT_CANCEL + CLAUDE_SDK.CANCEL。' +
    '僵尸栈是否整体删除由用户拍板（见 AGENTS.md 降级保留原则），本轮不动',
}

/** 注释行跳过：文件头注释里罗列通道名是本项目的写法，不算引用 */
function codeLines(src: string): string[] {
  return src
    .split(/\r?\n/)
    .map((line) => ({ line, t: line.trim() }))
    .filter(({ t }) => !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*'))
    .map(({ line }) => line)
}

describe('IPC 通道声明与引用', () => {
  it('通道总数与预期量级一致（防止解析器静默漏读一整组）', () => {
    expect(channels.size).toBeGreaterThan(200)
  })

  it('同一个通道字符串不在两个组里重复定义', () => {
    const byValue = new Map<string, string[]>()
    for (const [ref, value] of channels) {
      byValue.set(value, [...(byValue.get(value) ?? []), ref])
    }
    const dups = [...byValue.entries()].filter(([, refs]) => refs.length > 1)
    expect(dups.map(([v, refs]) => `${v} ← ${refs.join(' | ')}`)).toEqual([])
  })

  it('每个通道都在主进程被引用', () => {
    const orphans = [...channels]
      .filter(([ref, value]) => !mainSrc.includes(ref) && !mainSrc.includes(`'${value}'`))
      .map(([ref, value]) => `${ref}=${value}`)
    expect(orphans).toEqual([])
  })

  it('每个通道都能在 preload 里找到，除非记在例外表里', () => {
    const missing = [...channels]
      .filter(([ref, value]) => !preloadSrc.includes(ref) && !preloadSrc.includes(`'${value}'`))
      .map(([ref]) => ref)
    expect(missing.sort()).toEqual(Object.keys(PRELOAD_UNREACHABLE).sort())
  })

  it('例外表里的通道确实够不着（防止例外表变成过期账）', () => {
    for (const ref of Object.keys(PRELOAD_UNREACHABLE)) {
      const value = channels.get(ref)
      expect(value, `例外表写了不存在的通道 ${ref}`).toBeTruthy()
      const reachable = preloadSrc.includes(ref) || preloadSrc.includes(`'${value as string}'`)
      expect(reachable, `${ref} 已经能到达了，请把它从例外表里删掉`).toBe(false)
    }
  })
})

describe('IPC 调用上下文不许直写通道字面量', () => {
  // 只按调用上下文匹配：按形状匹配会把 'node:fs'、'qwen3:32b' 误当通道名（实测噪声 114 条）。
  // 局限：不处理代码行尾的注释；那种位置写通道名的情况实测为 0，不值得上 tokenizer。
  const CALL_CONTEXTS = [
    /ipcMain\.(?:handle|on|once|removeAllListeners)\(\s*'([^']+)'/g,
    /ipcRenderer\.(?:invoke|send|sendSync|on|once|addListener|removeListener)\(\s*'([^']+)'/g,
    /webContents\.send\(\s*'([^']+)'/g,
    /createListener\(\s*'([^']+)'/g,
  ]

  function literalsIn(src: string): string[] {
    const out: string[] = []
    for (const line of codeLines(src)) {
      for (const re of CALL_CONTEXTS) {
        re.lastIndex = 0
        for (const m of line.matchAll(re)) out.push(m[1])
      }
    }
    return out
  }

  it('主进程与 preload 的通道名都来自中央表', () => {
    const offenders: string[] = []
    for (const file of [...mainFiles, PRELOAD_FILE]) {
      for (const value of literalsIn(fs.readFileSync(file, 'utf8'))) {
        offenders.push(`${rel(file)} → ${value}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('匹配器自身有效（防止正则退化让这条闸永久绿）', () => {
    const sample = "  ipcMain.handle('probe:channel', () => {})\n"
    expect(literalsIn(sample)).toEqual(['probe:channel'])
    // 注释里的通道名不该被算进来
    expect(literalsIn("  // ipcMain.handle('probe:channel', () => {})\n")).toEqual([])
  })
})

describe('IpcChannelMap 契约表不许写不存在的通道', () => {
  it('表里每个键都是已声明的通道', () => {
    const src = fs.readFileSync(MODELS_FILE, 'utf8')
    const start = src.indexOf('export interface IpcChannelMap')
    expect(start).toBeGreaterThan(-1)
    const body = src.slice(start, src.indexOf('\n}', start))
    const keys = [...body.matchAll(/^\s{2}'([^']+)':/gm)].map((m) => m[1])
    expect(keys.length).toBeGreaterThan(0)
    const unknown = keys.filter((k) => !channelValues.has(k))
    expect(unknown, `契约表里有 ${unknown.length} 个通道不存在于 ipc-channels.ts`).toEqual([])
  })
})
