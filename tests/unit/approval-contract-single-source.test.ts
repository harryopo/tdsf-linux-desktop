/**
 * 审批载荷跨进程单源（#111）
 *
 * 这四个形状以前在三个地方各抄一份：主进程 ipc/*.ts、src/preload/types.ts、
 * src/renderer/src/types/electron.d.ts。没有东西强制对齐，实测已经漂了：
 * `SandboxApprovalRequest` 的 sessionId / sideEffects / rollbackCommand / saferAlternative
 * 四个字段主进程算好了，preload 那份根本没写——界面拿不到，
 * 沙箱审批弹窗上只剩一条光命令，用户看不到"为什么高危"和"怎么回滚"。
 *
 * 另一处假数字顺手一起修：审批卡标题原本是"PAOR 请求批准 — 第 {stepIndex+1} 步"，
 * 而两个构造点都把 stepIndex 写死成 0，于是对话里 AI 提的写命令也被说成
 * "PAOR 的第 1 步"。现在来源与步骤都由主进程如实带上。
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import * as ts from 'typescript'

const ROOT = resolve(__dirname, '../..')

/** 唯一声明位 */
const SHARED = join('src', 'shared', 'approval-types.ts')

/** 受管的名字（新增审批载荷要一并加进来，否则等于开了个洞） */
const MANAGED = [
  'SandboxCommandRiskLevel',
  'SandboxApprovalRequest',
  'PaorApprovalOrigin',
  'PaorApprovalRequest',
] as const

function tsFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    const full = join(dir, name)
    if (statSync(join(ROOT, full)).isDirectory()) tsFiles(full, out)
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) out.push(full)
  }
  return out
}

const ALL_FILES = tsFiles(join('src', 'main')).concat(tsFiles(join('src', 'preload')), tsFiles(join('src', 'renderer')), tsFiles(join('src', 'shared')))

/**
 * 每个受管名字分别被哪些文件"声明"过（interface / type 别名算声明，
 * `export type { X } from ...` 只算转发，不算第二份）。
 *
 * 一趟解析收全部名字：逐名重扫会把「受管名 × 上千个文件」各解析一遍，单条判据跑到 4.7 秒。
 */
function declarationsByName(): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const name of MANAGED) map.set(name, [])
  for (const rel of ALL_FILES) {
    const src = readFileSync(join(ROOT, rel), 'utf8')
    // 先按文本快筛：一个候选名字都没有就不必建 AST
    if (!MANAGED.some((n) => src.includes(n))) continue
    const file = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true)
    const walk = (node: ts.Node): void => {
      if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
        const list = map.get(node.name.text)
        if (list) list.push(rel)
      }
      ts.forEachChild(node, walk)
    }
    walk(file)
  }
  return map
}

const DECLARATIONS = declarationsByName()

describe('审批载荷只许有一处声明', () => {
  it('阳性对照：量具认得真声明，也不会把转发当成声明', () => {
    const probe = (source: string): number => {
      const file = ts.createSourceFile('probe.ts', source, ts.ScriptTarget.Latest, true)
      const found: string[] = []
      const walk = (node: ts.Node): void => {
        if ((ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) && node.name.text === 'PaorApprovalRequest') {
          found.push('hit')
        }
        ts.forEachChild(node, walk)
      }
      walk(file)
      return found.length
    }
    expect(probe('export interface PaorApprovalRequest { callId: string }'), '重复声明必须抓得到').toBe(1)
    expect(probe("export type { PaorApprovalRequest } from '@shared/approval-types'"), '转发不该算第二份').toBe(0)
  })

  it('每个受管名字在整个 src 里只被声明一次，且就在 shared', () => {
    for (const name of MANAGED) {
      const found = DECLARATIONS.get(name) ?? []
      expect(found.map((f) => relative(ROOT, f)), `${name} 被声明了 ${found.length} 次`).toEqual([SHARED])
    }
  })

  it('三个进程都从 shared 取数（少一个就是那份又会开始自己漂）', () => {
    for (const f of [
      join('src', 'preload', 'types.ts'),
      join('src', 'renderer', 'src', 'types', 'electron.d.ts'),
      join('src', 'main', 'core', 'security', 'approval-request.ts'),
      join('src', 'main', 'ipc', 'sandbox-approval.ts'),
    ]) {
      expect(readFileSync(join(ROOT, f), 'utf8'), `${f} 没有引用 shared 的审批契约`).toContain(
        '@shared/approval-types'
      )
    }
  })

  it('主进程只有一张审批等待表（谁要问用户都走 approval-request）', () => {
    // 2026-10-22 #173：agent-runtime 不再自己拿着表——外部 MCP 调用也要问人，
    // 两处各写一把 60 秒迟早漂。所以这条不变量从"这个文件 import shared"改成
    // "这两个入口都 import 那唯一的等待器"，同时禁止再出现第二份超时常量。
    for (const f of [
      join('src', 'main', 'ipc', 'agent-runtime.ts'),
      join('src', 'main', 'ipc', 'mcp.ts'),
    ]) {
      expect(readFileSync(join(ROOT, f), 'utf8'), `${f} 绕过了共享审批等待器`).toContain(
        'core/security/approval-request'
      )
    }
    const src = readFileSync(join(ROOT, 'src/main/ipc/agent-runtime.ts'), 'utf8')
    expect(src, '60 秒只能在 approval-request 里写一次').not.toMatch(/60_000|60000/)
  })

  it('沙箱审批的四个字段在契约里（曾只写在主进程那份，preload 少了它们）', () => {
    const shared = readFileSync(join(ROOT, SHARED), 'utf8')
    for (const field of ['sessionId?', 'sideEffects?', 'rollbackCommand?', 'saferAlternative?']) {
      expect(shared, `缺字段 ${field}`).toContain(field)
    }
  })
})

describe('审批卡上的来源与步骤号不许是常量', () => {
  /** 找出所有形如 { … stepIndex: <字面量> … } 的属性，返回那些钉死为数字字面量的位置 */
  function hardcodedStepIndex(rel: string): string[] {
    const src = readFileSync(join(ROOT, rel), 'utf8')
    const file = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true)
    const hits: string[] = []
    const walk = (node: ts.Node): void => {
      if (ts.isObjectLiteralExpression(node)) {
        const isApprovalPayload = node.properties.some(
          (p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'riskLevel'
        )
        if (isApprovalPayload) {
          for (const p of node.properties) {
            if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'stepIndex') {
              if (ts.isNumericLiteral(p.initializer)) {
                hits.push(`${rel}: stepIndex 写死成 ${p.initializer.text}`)
              }
            }
          }
        }
      }
      ts.forEachChild(node, walk)
    }
    walk(file)
    return hits
  }

  it('agent-runtime 两处审批载荷都不许把 stepIndex 钉成字面量', () => {
    const rel = join('src', 'main', 'ipc', 'agent-runtime.ts')
    expect(hardcodedStepIndex(rel), hardcodedStepIndex(rel).join(' | ')).toEqual([])
  })

  it('阳性对照：把 0 钉回去，这条判据必须能抓住', () => {
    const sample = 'const p = { callId: "x", riskLevel: "HIGH", stepIndex: 0, timestamp: 1 }'
    const file = ts.createSourceFile('s.ts', sample, ts.ScriptTarget.Latest, true)
    let found = false
    const walk = (node: ts.Node): void => {
      if (ts.isObjectLiteralExpression(node)) {
        for (const p of node.properties) {
          if (
            ts.isPropertyAssignment(p) &&
            ts.isIdentifier(p.name) &&
            p.name.text === 'stepIndex' &&
            ts.isNumericLiteral(p.initializer)
          ) {
            found = true
          }
        }
      }
      ts.forEachChild(node, walk)
    }
    walk(file)
    expect(found).toBe(true)
  })

  it('每个审批载荷都带上 origin（标题文案分 PAOR 与对话两条路）', () => {
    const src = readFileSync(join(ROOT, 'src', 'main', 'ipc', 'agent-runtime.ts'), 'utf8')
    expect(src.split("origin: 'paor'").length - 1).toBe(1)
    expect(src.split("origin: 'chat'").length - 1).toBe(1)
  })

  it('supervisor 把计划里的真 stepIndex 交给审批回调', () => {
    const src = readFileSync(join(ROOT, 'src', 'main', 'core', 'agent', 'supervisor.ts'), 'utf8')
    expect(src).toContain('approveRisk?: (command: string, level: string, description: string, stepIndex: number)')
    expect(src).toContain('options.approveRisk(command, risk.level, risk.description, stepIndex)')
  })
})
