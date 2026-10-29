/**
 * 剖析报告的导出面：落点归主进程，界面只递内容（#212）
 *
 * 背景：`profiler:exportMd` / `exportPdf` 原来要**渲染层递一个绝对路径**。
 * 而沙箱里的渲染层既拿不到 userData、也没有保存对话框（全仓只有 showOpenDialog），
 * 这条路按原样接谁都会失败；更要紧的是它是一条能把文件写到任意位置的口。
 * 现在改成渲染层只递报告正文 + 主机名，文件名与目录由主进程定，
 * 写完把 filePath 回给界面原样显示；"帮你生成默认文件名"那把键因此整删。
 *
 * 这条判据不是为了今天的实现好看，是为了挡住三种回潮：
 * 1. 有人为了"方便保存"把路径参数加回 handler 形参表；
 * 2. 有人把 `assertWithinConfinement` 那一步当成多余校验删掉；
 * 3. 有人把整条引擎连带删了——体检这格现在是界面能力，不是死代码。
 *
 * 形状一律按 AST 取（形参名与调用点），不钉源码字符串：改格式不该红，改语义才该红。
 */
import { describe, it, expect } from 'vitest'
import * as path from 'node:path'
import * as ts from 'typescript'
import { readSourceFile } from '../helpers/source-scan'

const ROOT = path.resolve(__dirname, '../..')
const PROFILER_IPC = path.join(ROOT, 'src/main/ipc/profiler.ts')

/** 把 profiler.ts 解析成 AST，抓出每个 ipcMain.handle 的通道名、handler 形参名与函数体 */
function handlers(): Array<{ channel: string; params: string[]; body: ts.Node }> {
  const src = readSourceFile(PROFILER_IPC)
  const file = ts.createSourceFile('profiler.ts', src, ts.ScriptTarget.Latest, true)
  const out: Array<{ channel: string; params: string[]; body: ts.Node }> = []
  const walk = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'handle' &&
      node.arguments.length >= 2 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      const fn = node.arguments[1]
      const params =
        ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)
          ? fn.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : '?'))
          : []
      out.push({ channel: node.arguments[0].text, params, body: fn })
    }
    ts.forEachChild(node, walk)
  }
  walk(file)
  return out
  }

/** 函数体里出现的 `assertWithinConfinement(...)` 调用次数 */
function confinementCalls(body: ts.Node): number {
  let n = 0
  const walk = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'assertWithinConfinement') {
      n += 1
    }
    ts.forEachChild(node, walk)
  }
  walk(body)
  return n
}

function exposedKeys(): string[] {
  return readSourceFile(path.join(ROOT, 'tests/unit/__fixtures__/preload-api-surface.txt'))
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}

describe('剖析导出面：路径由主进程定（#212）', () => {
  it('主进程只注册 run / exportMd / exportPdf 三条 profiler 通道', () => {
    const channels = handlers()
      .map((h) => h.channel)
      .sort()
    expect(channels).toEqual(['profiler:exportMd', 'profiler:exportPdf', 'profiler:run'])
  })

  it('两个导出 handler 收不到路径：形参逐名等于 (_event, md, host)', () => {
    for (const channel of ['profiler:exportMd', 'profiler:exportPdf']) {
      const h = handlers().find((x) => x.channel === channel)
      expect(h, `${channel} 没被扫到，先怀疑扫描本身`).toBeTruthy()
      expect(h!.params, `${channel} 的入参形状变了：多出来的那一个就是渲染层能写的目的地`).toEqual([
        '_event',
        'md',
        'host',
      ])
    }
  })

  it('run 的入参形状与界面调用点对得上（sessionId, host）', () => {
    const h = handlers().find((x) => x.channel === 'profiler:run')
    expect(h, 'profiler:run 没被扫到').toBeTruthy()
    expect(h!.params).toEqual(['_event', 'sessionId', 'host'])
  })

  it('两条导出路都还在受管路径校验里（一道都没省）', () => {
    for (const channel of ['profiler:exportMd', 'profiler:exportPdf']) {
      const h = handlers().find((x) => x.channel === channel)
      expect(h, `${channel} 没被扫到`).toBeTruthy()
      expect(confinementCalls(h!.body), `${channel} 不再校验落点`).toBeGreaterThan(0)
    }
  })

  it('暴露面里没有 profilerDefaultFileName，三把 profiler 键还在（双向）', () => {
    const keys = exposedKeys()
    expect(keys, '那把"给渲染层生成文件名"的键又回来了').not.toContain('profilerDefaultFileName')
    for (const kept of ['profilerRun', 'profilerExportMd', 'profilerExportPdf']) {
      expect(keys, `误砍了界面在用的 ${kept}，体检这格会直接坏`).toContain(kept)
    }
  })

  it('引擎本体一个没删：删的是重复入口，不是能力', () => {
    for (const f of [
      'src/main/services/profiler/system-profiler.ts',
      'src/main/services/profiler/risk-detector.ts',
      'src/main/services/profiler/markdown-renderer.ts',
      'src/main/services/profiler/pdf-exporter.ts',
    ]) {
      expect(readSourceFile(path.join(ROOT, f)), `${f} 不在了`).not.toBe('')
    }
    // AI 那条工具出口也还在（对话里调 profiler 这条路不能被这批改口带走）
    // 2026-10-29 #281：那份 AI 工具外壳（llm/tools/profiler-run）随入站 MCP 派发口一起整删，
    // 剖析的活入口是监控页那张体检卡走的 ipc/profiler —— 引擎本体照旧一个没删。
    expect(readSourceFile(path.join(ROOT, 'src/main/ipc/profiler.ts'))).toContain('runProfiler')
  })

  it('监控页真的挂着这张体检卡（键有界面消费者，不是又一把零调用键）', () => {
    const page = readSourceFile(path.join(ROOT, 'src/renderer/src/pages/MonitorPage.tsx'))
    expect(page).toContain('ServerProbeCard')
    const card = readSourceFile(
      path.join(ROOT, 'src/renderer/src/components/monitor/ServerProbeCard.tsx')
    )
    // 渲染层递给导出的第二个参数是主机名，不是路径
    for (const key of ['Md', 'Pdf']) {
      expect(
        card,
        `界面调用 profilerExport${key} 的第二个参数不再是 host —— 那是把目的地交回渲染层`
      ).toMatch(new RegExp(`api\\.profilerExport${key}\\(\\s*resp\\.md,\\s*host\\s*\\)`))
    }
  })
})
