/**
 * shellId 契约判据（2026-10-10 W2）
 *
 * 为什么必须有这条闸：sessionId 与 shellId 都是 string，
 * 把会话 ID 传给"写终端"这种参数，**TypeScript 一声不响**，运行时才变成
 * "终端已关闭（shellId: …）"，而且症状是"有时候能用"——最难查的那一类。
 * 所以闸写在结构上：
 *   1. 六个 shell 通道都在 IPC_CONTRACT 里（跨进程形状有唯一出处）
 *   2. preload 不许绕过契约裸 invoke 这些通道（绕了就没有运行时校验）
 *   3. 渲染层把 sshShellWrite / sshShellResize / sshRunAuthored 的第一个参数
 *      写成 sessionId 形状的直接报（正确写法是 shell.shellId 之类）
 * 每条都配"坏写法必须被抓到"的自证，否则它就是一张放行证。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { IPC_CONTRACT } from '../../src/shared/ipc-contract'
import { SSH } from '../../src/shared/ipc-channels'

const RENDERER = join(process.cwd(), 'src', 'renderer', 'src')
const PRELOAD = join(process.cwd(), 'src', 'preload')

/** 终端三件套：第一个参数必须是 shellId */
const SHELL_TARGET_API = ['sshShellWrite', 'sshShellResize', 'sshRunAuthored']

function collectSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) collectSources(full, out)
    else if (/\.(tsx|ts)$/.test(entry) && !entry.endsWith('.d.ts')) out.push(full)
  }
  return out
}

/** 找出"把 sessionId 传给终端 API"的调用点 */
function wrongIdentityCalls(fileName: string, src: string): number[] {
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
  const hits: number[] = []
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const api = node.expression.name.text
      if (SHELL_TARGET_API.includes(api)) {
        const first = node.arguments[0]
        const name =
          first && ts.isIdentifier(first)
            ? first.text
            : first && ts.isPropertyAccessExpression(first)
              ? first.expression.getText(sf) + '.' + first.name.text
              : ''
        // 认 sessionId / activeSessionId 这两种名字（它们就是"传错了"的形态）
        if (/^(sessionId|activeSessionId)$/.test(name) || /SessionId$/.test(name)) {
          hits.push(line(node))
        }
      }
    }
    node.forEachChild(visit)
  }
  visit(sf)
  return hits
}

describe('shellId 契约', () => {
  it('六个终端通道都在 IPC_CONTRACT 里，且通道名来自常量表', () => {
    const byApi = new Map(IPC_CONTRACT.map((c) => [c.api, c]))
    const expected: Array<[string, string]> = [
      ['sshShellStart', SSH.SHELL_START],
      ['sshShellClose', SSH.SHELL_CLOSE],
      ['sshShellList', SSH.SHELL_LIST],
      ['sshShellWrite', SSH.SHELL_WRITE],
      ['sshRunAuthored', SSH.SHELL_RUN_AUTHORED],
      ['sshShellResize', SSH.SHELL_RESIZE],
    ]
    for (const [api, channel] of expected) {
      const entry = byApi.get(api)
      expect(entry, `契约里没有 ${api}`).toBeTruthy()
      expect(entry!.channel, `${api} 的通道对不上`).toBe(channel)
    }
  })

  it('preload 对这些通道不许绕过契约裸 invoke（invokeChecked 才有运行时校验）', () => {
    const offenders: string[] = []
    for (const file of collectSources(PRELOAD)) {
      const src = readFileSync(file, 'utf8')
      for (const channel of [
        SSH.SHELL_START,
        SSH.SHELL_CLOSE,
        SSH.SHELL_LIST,
        SSH.SHELL_WRITE,
        SSH.SHELL_RUN_AUTHORED,
        SSH.SHELL_RESIZE,
      ]) {
        const constName = Object.keys(SSH).find((k) => SSH[k as keyof typeof SSH] === channel)
        if (!constName) continue
        const re = new RegExp(`ipcRenderer\\.invoke\\(\\s*SSH\\.${constName}\\b`)
        if (re.test(src)) offenders.push(`${file.replace(PRELOAD, 'src/preload')}: SSH.${constName}`)
      }
    }
    expect(offenders, `这些通道绕过了契约：\n${offenders.join('\n')}`).toEqual([])
  })

  it('渲染层没有把 sessionId 当 shellId 传给终端 API', () => {
    const offenders: string[] = []
    for (const file of collectSources(RENDERER)) {
      const hits = wrongIdentityCalls(file, readFileSync(file, 'utf8'))
      for (const line of hits) {
        offenders.push(`${file.replace(RENDERER, 'src/renderer/src')}:${line}`)
      }
    }
    expect(offenders, `终端 API 的第一个参数应是 shellId：\n${offenders.join('\n')}`).toEqual([])
  })

  it('自证：写错的形态确实被抓、写对的形态确实放过', () => {
    const bad = [
      'declare const api: { sshShellWrite(s: string, d: string): Promise<boolean>; sshRunAuthored(s: string, c: string): Promise<boolean> }',
      'declare const activeSessionId: string',
      'api.sshShellWrite(activeSessionId, "ls")',
      'const sh = { shellId: "x" }',
      'api.sshRunAuthored(sh.shellId, "ls")',
    ].join('\n')
    const hits = wrongIdentityCalls('probe.ts', bad)
    expect(hits, 'activeSessionId 传进终端 API 必须被报').toEqual([3])
    // 同一份里正确那行（第 5 行）不许被误伤
    expect(hits).not.toContain(5)

    // 全仓确实扫到了调用点（不是"一个文件都没读到"式的假绿）
    const total = collectSources(RENDERER).reduce(
      (n, f) => n + (SHELL_TARGET_API.some((api) => readFileSync(f, 'utf8').includes(`${api}(`)) ? 1 : 0),
      0,
    )
    expect(total, '一个终端 API 调用点都没扫到，说明扫描面断了').toBeGreaterThan(0)
  })
})
