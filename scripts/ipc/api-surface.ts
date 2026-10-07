/**
 * preload 暴露面抽取器（测试与 CLI 共用，别各写一遍正则）
 *
 * 要解决的问题：同一个 electronAPI 的名字表在三个地方各写一份——
 *   1. src/preload/index.ts 里 contextBridge.exposeInMainWorld('electronAPI', { ... }) 的键
 *   2. src/preload/index.ts 末尾 export type ElectronAPI = { ... }（给 preload/index.d.ts 用）
 *   3. src/renderer/src/types/electron.d.ts 里 export interface ElectronAPI（渲染层真正吃的类型）
 *      + types/generated/ipc-contract.ts 里由契约生成的两个接口
 * 三份手抄表一旦漂移，症状是"运行时方法在、类型里没有"（渲染层只能 as any）
 * 或"类型里声明了、运行时 undefined"（点下去没反应），而 typecheck/lint/单测全都发现不了。
 *
 * 只做名字集合，不比签名——签名比对交给 TS 自己（typecheck:web）。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

/** 从 startIdx 处的 '{' 开始做括号配对，返回配对闭合的位置（跳过字符串里的括号靠简单启发：只认成对的 { }） */
function matchBrace(text: string, openIdx: number): number {
  let depth = 0
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** 取块体内"顶层键"（缩进 0–2 层的 name: 或 name<T>( 或 name(...)） */
function topLevelNames(body: string): Set<string> {
  const out = new Set<string>()
  for (const line of body.split(/\r?\n/)) {
    if (!/^[ ]{0,2}[A-Za-z_$][\w$]*\s*(<[^>]*>)?\s*[:(]/.test(line)) continue
    const m = line.trim().match(/^([A-Za-z_$][\w$]*)/)
    if (m) out.add(m[1])
  }
  return out
}

export function exposedApiNames(preloadSource: string): Set<string> {
  const start = preloadSource.indexOf("exposeInMainWorld('electronAPI'")
  if (start < 0) throw new Error('没找到 exposeInMainWorld(\'electronAPI\'，抽取器要跟着改')
  const open = preloadSource.indexOf('{', start)
  const close = matchBrace(preloadSource, open)
  if (close < 0) throw new Error('暴露对象括号没配对')
  return topLevelNames(preloadSource.slice(open + 1, close))
}

function namedBlockNames(source: string, declRe: RegExp, label: string): Set<string> {
  const m = source.match(declRe)
  if (!m || m.index === undefined) throw new Error(`${label} 没匹配到，抽取器要跟着改`)
  const open = source.indexOf('{', m.index)
  const close = matchBrace(source, open)
  if (close < 0) throw new Error(`${label} 括号没配对`)
  return topLevelNames(source.slice(open + 1, close))
}

/** preload 末尾那份派生类型（用 typeof 引用实现，天然与实现对齐） */
export function preloadTypeNames(preloadSource: string): Set<string> {
  return namedBlockNames(preloadSource, /^export type ElectronAPI = \{/m, 'export type ElectronAPI')
}

/** 渲染层吃的那份类型声明（interface 正文 + extends 来的生成物） */
export function rendererTypeNames(dtsSource: string, generatedSource: string): Set<string> {
  const own = namedBlockNames(dtsSource, /^export interface ElectronAPI[^{]*\{/m, 'export interface ElectronAPI')
  const generated = new Set<string>()
  for (const src of [generatedSource]) {
    for (const name of namedBlockNames(src, /^export interface ContractedInvokeApi \{/m, 'ContractedInvokeApi')) {
      generated.add(name)
    }
    for (const name of namedBlockNames(src, /^export interface ContractedEventApi \{/m, 'ContractedEventApi')) {
      generated.add(name)
    }
  }
  return new Set([...own, ...generated])
}

export function readSurface(root: string): {
  exposed: Set<string>
  preloadType: Set<string>
  rendererType: Set<string>
} {
  const preload = fs.readFileSync(path.join(root, 'src/preload/index.ts'), 'utf8')
  const dts = fs.readFileSync(path.join(root, 'src/renderer/src/types/electron.d.ts'), 'utf8')
  const gen = fs.readFileSync(path.join(root, 'src/renderer/src/types/generated/ipc-contract.ts'), 'utf8')
  return {
    exposed: exposedApiNames(preload),
    preloadType: preloadTypeNames(preload),
    rendererType: rendererTypeNames(dts, gen),
  }
}

/** 排序后的差集，测试失败时直接把名单打出来 */
export function missingFrom(target: Set<string>, source: Set<string>): string[] {
  return [...source].filter((n) => !target.has(n)).sort()
}
