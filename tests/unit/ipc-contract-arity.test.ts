/**
 * 契约表与真实调用点的参数数量对账（P1-3 的"别把功能闸死"那一半）
 *
 * 主进程装了入参契约闸（src/main/ipc/contract-guard.ts）之后，一张写错的 schema
 * 就是生产事故：渲染层照旧调用，主进程开始回"入参不合契约"。而 TS 编译期看不见这件事 ——
 * 28 条契约里 `agentChat` 的调用点没走 invokeChecked（它自己调 assertContractArgs 再裸
 * invoke，并在第 4 位插了一个占位 undefined），于是"契约写 5 位、线上跑 6 位"这件事
 * 一直没人对账；这条闸装上后它会把每一次 AI 对话拒掉。第一轮跑就把这条抓出来了
 * （顺带暴露量具自己的坑：行尾逗号被多算一个参数，见下面那条取数自证）。
 *
 * 所以这里按**静态取数**判三件事：
 *   1. 同一个通道在契约表里只许出现一次（`contractByChannel` 是 find 语义，
 *      重复的话第二条永远不生效 —— 那是一条安静的假防护）；
 *   2. 已登记契约的通道，其 preload 调用点传的实参个数不得超过契约声明的个数；
 *   3. 少传的那些位必须是 optional（schema 能接受 undefined），否则闸门会当场拒掉正常调用。
 * 判据本身也要可否证：文件里那条"取数量具自己先能对上"用合成调用点跑同一套解析，
 * 数错了就红，不至于拿一把歪尺子去判别人。
 */
import { describe, it, expect } from 'vitest'
import * as path from 'node:path'
import { IPC_CONTRACT, type InvokeContract } from '@shared/ipc-contract'
import { listSourceFiles, readSourceFile } from '../helpers/source-scan'

const ROOT = path.resolve(__dirname, '../..')

/** ipc-channels 的双向索引：通道值 ↔ 代码里写的表达式（'SSH.CONNECT'） */
function parseChannels(): { byValue: Map<string, string>; byExpr: Map<string, string> } {
  const src = readSourceFile(path.join(ROOT, 'src/shared/ipc-channels.ts'))
  const byValue = new Map<string, string>()
  const byExpr = new Map<string, string>()
  for (const b of src.matchAll(/export const ([A-Z_0-9]+) = \{([\s\S]*?)\n\}/g)) {
    for (const f of b[2].matchAll(/^\s*([A-Z_0-9]+):\s*'([^']+)'/gm)) {
      const expr = `${b[1]}.${f[1]}`
      byValue.set(f[2], expr)
      byExpr.set(expr, f[2])
    }
  }
  return { byValue, byExpr }
}

/**
 * 数出一处 `ipcRenderer.invoke(...)` 的实参个数与通道表达式。
 * 括号感知 + 字符串感知：对象字面量里的逗号不算顶层分隔符。
 */
function readInvokeSite(text: string, openParen: number): { channelExpr: string; argCount: number } {
  let depth = 0
  let quote = ''
  const parts: string[] = []
  let cur = ''
  for (let i = openParen; i < text.length; i++) {
    const c = text[i]
    if (quote) {
      cur += c
      if (c === quote && text[i - 1] !== '\\') quote = ''
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c
      cur += c
      continue
    }
    if (c === '(' || c === '[' || c === '{') {
      depth++
      if (depth > 1) cur += c
      continue
    }
    if (c === ')' || c === ']' || c === '}') {
      depth--
      if (depth === 0) {
        parts.push(cur)
        break
      }
      cur += c
      continue
    }
    if (c === ',' && depth === 1) {
      parts.push(cur)
      cur = ''
      continue
    }
    cur += c
  }
  return {
    channelExpr: (parts[0] ?? '').trim(),
    // 末位逗号（`invoke(CH, a,)`）会多切出一段空串，不算一个参数
    argCount: Math.max(0, parts.filter((p, i) => i === 0 || p.trim() !== '').length - 1),
  }
}

/** 全 preload 的直接 invoke 位点（契约闸真正要面对的输入） */
function collectInvokeSites(): Array<{ file: string; channelExpr: string; argCount: number }> {
  const sites: Array<{ file: string; channelExpr: string; argCount: number }> = []
  for (const abs of listSourceFiles(path.join(ROOT, 'src/preload'))) {
    const text = readSourceFile(abs)
    const rel = path.relative(ROOT, abs).split(path.sep).join('/')
    const re = /ipcRenderer\.invoke\(/g
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const { channelExpr, argCount } = readInvokeSite(text, m.index + m[0].length - 1)
      sites.push({ file: rel, channelExpr, argCount })
    }
  }
  return sites
}

const INVOKE_CONTRACTS = IPC_CONTRACT.filter((c): c is InvokeContract => c.kind === 'invoke')

describe('契约表自身', () => {
  it('一个通道只许登记一条 invoke 契约（重复的第二条按 find 语义永远不生效）', () => {
    const seen = new Map<string, string[]>()
    for (const c of INVOKE_CONTRACTS) {
      seen.set(c.channel, [...(seen.get(c.channel) ?? []), c.api])
    }
    const dup = [...seen].filter(([, apis]) => apis.length > 1)
    expect(dup.map(([ch, apis]) => `${ch} → ${apis.join('/')}`), '重复登记的通道').toEqual([])
  })

  it('已登记契约的 invoke 通道数不许回退（这是覆盖面，不是装饰）', () => {
    // 2026-10-12 实测 28 条（IPC_CONTRACT 共 34 条，另 6 条是 event）。
    // 往表里加通道是 P1-8（渲染层类型全面由生成物接管）之后要做的扩面，
    // 数字只会往上走；这里钉的是下界，防止有人把契约当碍事的东西删掉。
    expect(INVOKE_CONTRACTS.length).toBeGreaterThanOrEqual(28)
  })
})

describe('契约表 × preload 直接调用点', () => {
  const channels = parseChannels()
  const sites = collectInvokeSites()

  it('取数量具自己先能对上（合成位点跑同一套解析，防止判据是假的）', () => {
    const probe = `
      ipcRenderer.invoke(SSH.CONNECT, config)
      ipcRenderer.invoke(PROVIDER.LIST)
      ipcRenderer.invoke(AGENT.PAOR, task, sshSessionId, { nested: 'a,b', more: [1, 2] })
      ipcRenderer.invoke(SSH.HOST_KEY_RESPONSE, { requestId, action: 'accept', extra: [1, 2] })
      ipcRenderer.invoke(SSH.DISCONNECT, sessionId,)
    `
    const parsed: number[] = []
    const re = /ipcRenderer\.invoke\(/g
    let m: RegExpExecArray | null
    while ((m = re.exec(probe)) !== null) {
      parsed.push(readInvokeSite(probe, m.index + m[0].length - 1).argCount)
    }
    // 第一版把行尾逗号当成了第 2 个参数（多算 1 个），于是 agent:chat 被读成 7 个参数，
    // 那条真缺陷反而被埋在一堆假阳里 —— 尾部空段必须丢掉。
    expect(parsed, '对象/数组/注释/行尾逗号被错当成参数分隔符').toEqual([1, 0, 3, 1, 1])
  })

  it('至少真的扫到了一批直接调用点（扫到 0 条等于这条闸没在办事）', () => {
    expect(sites.length).toBeGreaterThan(150)
    // 2026-10-12 实测 214 处；其中写成 DOMAIN.KEY 常量的那批才是能被对账的
    const constantForm = sites.filter((s) => channels.byExpr.has(s.channelExpr))
    expect(constantForm.length).toBeGreaterThan(150)
  })

  it('写成常量形式的通道表达式都能在 ipc-channels 里解析（解析不了就是漏账）', () => {
    const loose = sites
      .filter((s) => /^[A-Z_0-9]+\.[A-Z_0-9]+$/.test(s.channelExpr))
      .filter((s) => !channels.byExpr.has(s.channelExpr))
      .map((s) => `${s.file} ${s.channelExpr}`)
    expect(loose, '这些常量形态在 ipc-channels 里找不到对应通道值').toEqual([])
  })

  it('已登记契约的通道：调用点实参个数不许超过声明，少传的那几位必须是 optional', () => {
    const offenders: string[] = []
    for (const c of INVOKE_CONTRACTS) {
      const expr = channels.byValue.get(c.channel)
      if (!expr) continue // 通道值不是 'x:y' 字面量形态，本轮不判
      for (const s of sites.filter((x) => x.channelExpr === expr)) {
        if (s.argCount > c.args.length) {
          offenders.push(`${s.file} ${c.channel} 传 ${s.argCount} 个，契约只声明 ${c.args.length} 个`)
          continue
        }
        for (let i = s.argCount; i < c.args.length; i++) {
          if (!c.args[i].schema.safeParse(undefined).success) {
            offenders.push(
              `${s.file} ${c.channel} 没传第 ${i + 1} 个参数 ${c.args[i].name}，而契约把它当必填`
            )
          }
        }
      }
    }
    expect(offenders, '契约闸装上后会被自己拒掉的调用点').toEqual([])
  })
})
