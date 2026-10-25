/**
 * IPC「本地路径 / 外部地址」防线覆盖面闸（2026-10-09 安全审查 S3）
 *
 * 这份闸要回答的不是"这条通道现在挡不挡"（那由 path-confinement / navigation-policy
 * 的行为单测负责），而是"**有没有哪条通道开着目的地却没人管**"。
 * 这类问题的特点是不会让任何现有测试变红——新加一条 `fs.writeFile(渲染层给的路径)`
 * 的通道，全量测试照样绿。所以判据必须按结构取数：
 *
 * 1. 扫 `src/main/ipc/*.ts` 每个 `ipcMain.handle`，凡入参里出现本地路径形状的字、
 *    或函数体里出现本地写盘/删除汇、或把地址交给 `shell.openExternal`，
 *    **必须**在下面这张人工评审过的表里；不在就红，并列出缺的那条。
 * 2. 表里每条都按其声明的防线做结构核对（dialog / confinement / external-url /
 *    fixed-path / filename-check / remote-only / no-fs），执行体是 AST 上的调用名与实参，
 *    不是"源码里有没有这个字符串"。
 * 3. 表也不许虚胖：登记的通道如果代码里已经不存在，同样红（否则表会变成豁免名单）。
 * 4. 外加一条边界对账：SFTP 传输在 preload 上的入参**不许再有** localPath——
 *    这条通道曾经收渲染层给的本地绝对路径。
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as ts from 'typescript'

type Defense =
  | 'dialog'
  | 'confinement'
  | 'external-url'
  | 'fixed-path'
  | 'filename-check'
  | 'remote-only'
  | 'no-fs'

/** 人工评审过的表：通道注册写法 → 它靠哪道防线。新增通道必须在这里说明理由。 */
const LOCAL_DEST_CHANNELS: Record<string, Defense> = {
  'SFTP.UPLOAD': 'dialog',
  'SFTP.DOWNLOAD': 'dialog',
  'FS.UPLOAD_IMAGE': 'dialog',
  'SSH.UPLOAD_KEYPAIR': 'dialog',
  'SSH.DELETE_KEYPAIR': 'filename-check',
  "'profiler:exportMd'": 'confinement',
  "'profiler:exportPdf'": 'confinement',
  'APP.DOWNLOAD_UPDATE': 'external-url',
  'APP.EXPORT_MODEL_STATS': 'fixed-path',
  // 2026-10-21 服务器列表导入/导出：目的地与来源都由主进程弹框选，渲染层拿不到路径
  'SERVER.EXPORT_FILE': 'dialog',
  'SERVER.IMPORT_FILE': 'dialog',
  'SFTP.WRITE_FILE': 'remote-only',
  'SFTP.MKDIR': 'remote-only',
}

const DIALOG_FNS = ['pickExistingFiles', 'pickSavePath']
const CONFINEMENT_FNS = ['assertWithinConfinement', 'checkLocalPath']
const EXTERNAL_URL_FNS = ['assertSafeExternalUrl', 'isSafeWebUrl']
/** 本地写盘/删除汇（远程 sftp 的同名方法单独按调用对象区分） */
const FS_SINKS = [
  'writeFile',
  'writeFileSync',
  'appendFile',
  'createWriteStream',
  'mkdir',
  'mkdirSync',
  'copyFile',
  'copyFileSync',
  'rmSync',
  'unlinkSync',
  'renameSync',
]
const LOCAL_PATH_PARAM_RE =
  /(^|[^A-Za-z])(localPath|outputPath|destPath|targetPath|savePath|filePath|srcPath|dstPath|absolutePath|outputDir|destDir|saveDir|baseDir)/

interface HandlerInfo {
  file: string
  channel: string
  paramText: string
  /** 函数体里出现过的调用名（含 `a.b` 形式） */
  calls: Set<string>
  /** fs 写/删汇的调用节点 */
  sinks: ts.CallExpression[]
  usesOpenExternal: boolean
  params: readonly string[]
  /** 函数体里 `x.includes('<字面量>')` 的字面量集合（名称校验类防线的取证点） */
  includesLiterals: Set<string>
}

function calleeName(node: ts.CallExpression): string {
  const expr = node.expression
  if (ts.isPropertyAccessExpression(expr)) return `${expr.expression.getText()}.${expr.name.getText()}`
  if (ts.isIdentifier(expr)) return expr.getText()
  return ''
}

function collectHandlers(dir: string): HandlerInfo[] {
  const found: HandlerInfo[] = []
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith('.ts')) continue
    const file = path.join(dir, entry)
    const text = fs.readFileSync(file, 'utf8')
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)

    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.expression.getText() === 'ipcMain' &&
        node.expression.name.getText() === 'handle'
      ) {
        const channel = node.arguments[0]?.getText() ?? '?'
        const fn = node.arguments[1]
        if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && fn.body) {
          const params = fn.parameters.map((p) => p.name.getText())
          const paramText = fn.parameters.map((p) => p.getText()).join(' | ')
          const bodyText = fn.body.getText()
          const calls = new Set<string>()
          const sinks: ts.CallExpression[] = []
          const includesLiterals = new Set<string>()
          const walk = (n: ts.Node): void => {
            if (ts.isCallExpression(n)) {
              const name = calleeName(n)
              calls.add(name)
              const bare = name.split('.').pop() ?? name
              if (FS_SINKS.includes(bare)) sinks.push(n)
              if (bare === 'includes') {
                const first = n.arguments[0]
                if (first && ts.isStringLiteral(first)) includesLiterals.add(first.text)
              }
            }
            ts.forEachChild(n, walk)
          }
          walk(fn.body)
          found.push({
            file: entry,
            channel,
            paramText,
            calls,
            sinks,
            includesLiterals,
            usesOpenExternal: bodyText.includes('shell.openExternal'),
            params,
          })
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return found
}

/** 该调用的第一个实参（目的地）是否引用了处理函数的入参 */
function destUsesParam(call: ts.CallExpression, params: readonly string[]): boolean {
  const first = call.arguments[0]
  if (!first) return false
  const identifiers: string[] = []
  const walk = (n: ts.Node): void => {
    if (ts.isIdentifier(n)) identifiers.push(n.getText())
    ts.forEachChild(n, walk)
  }
  walk(first)
  return identifiers.some((id) => params.includes(id))
}

function satisfies(h: HandlerInfo, defense: Defense): [boolean, string] {
  switch (defense) {
    case 'dialog': {
      const viaHelper = DIALOG_FNS.some((f) => h.calls.has(f))
      const viaDirect = h.calls.has('dialog.showOpenDialog') || h.calls.has('dialog.showSaveDialog')
      return [viaHelper || viaDirect, '本地目的地没有走对话框（应调 pickExistingFiles/pickSavePath 或 dialog.show*Dialog）']
    }
    case 'confinement': {
      const ok = CONFINEMENT_FNS.some((f) => h.calls.has(f))
      return [ok, '本地路径没有过 confinement（应调 assertWithinConfinement/checkLocalPath）']
    }
    case 'external-url': {
      const ok = EXTERNAL_URL_FNS.some((f) => h.calls.has(f))
      return [ok, '交给系统的地址没有过协议+主机白名单']
    }
    case 'fixed-path': {
      const leaked = h.sinks.filter((s) => destUsesParam(s, h.params))
      return [leaked.length === 0, '写盘目的地由渲染层入参构成（应为固定路径拼接）']
    }
    case 'filename-check': {
      const needed = ['/', '\\', '..']
      const absent = needed.filter((s) => !h.includesLiterals.has(s))
      return [absent.length === 0, `名称校验缺分隔符分支：${absent.map((s) => JSON.stringify(s)).join(' ')}`]
    }
    case 'remote-only': {
      const local = h.sinks.filter((s) => {
        const bare = calleeName(s).split('.').pop() ?? ''
        return FS_SINKS.includes(bare) && !calleeName(s).startsWith('sftpManager.')
      })
      return [local.length === 0, '这条通道的写操作其实落在本地文件系统']
    }
    case 'no-fs': {
      return [h.sinks.length === 0, '这条通道声明不碰文件系统，却出现了写/删汇']
    }
  }
}

const IPC_DIR = path.join(process.cwd(), 'src/main/ipc')
const handlers = collectHandlers(IPC_DIR)

function isExposed(h: HandlerInfo): boolean {
  return LOCAL_PATH_PARAM_RE.test(h.paramText) || h.sinks.length > 0 || h.usesOpenExternal
}

describe('IPC 本地目的地防线覆盖面', () => {
  it('扫描确实取到了数据（0 条等于量具坏了）', () => {
    // 地板按现量留余量，不按某一天的数抄死：#216 合法整删了 10 个 handler（159→149），
    // 这条烟雾判据如果继续钉 150，红的是尺子不是产品。真要盯覆盖面看的是下面那两条逐名对账。
    expect(handlers.length).toBeGreaterThan(130)
  })

  it('每个暴露本地路径/外部地址的通道都在表里，且防线与声明一致', () => {
    const missing: string[] = []
    const weak: string[] = []
    for (const h of handlers) {
      if (!isExposed(h)) continue
      const defense = LOCAL_DEST_CHANNELS[h.channel]
      if (!defense) {
        missing.push(`${h.file} ${h.channel}（入参 ${h.paramText.slice(0, 80)}）`)
        continue
      }
      const [ok, why] = satisfies(h, defense)
      if (!ok) weak.push(`${h.channel}：${why}`)
    }
    expect(missing, `这些通道拿着本地目的地却没有声明防线：\n${missing.join('\n')}`).toEqual([])
    expect(weak, `这些通道声明了防线但代码里没有：\n${weak.join('\n')}`).toEqual([])
  })

  it('表里不许留死条目（登记的通道必须真的还在代码里）', () => {
    const present = new Set(handlers.map((h) => h.channel))
    const dead = Object.keys(LOCAL_DEST_CHANNELS).filter((c) => !present.has(c))
    expect(dead, `这些通道已经不存在，应从表里删掉：${dead.join(', ')}`).toEqual([])
  })

  it('判据可被证伪：把某条通道的防线声明改坏，检查必须报错', () => {
    // 拿真实扫描结果，人为要求 profiler:exportMd 走 dialog（它其实走 confinement），
    // 如果这种"防线名不副实"都能过，说明这张闸只是摆设
    const h = handlers.find((x) => x.channel === "'profiler:exportMd'")
    expect(h, '没扫到 profiler:exportMd，先修扫描本身').toBeTruthy()
    const [ok] = satisfies(h as HandlerInfo, 'dialog')
    expect(ok, 'profiler:exportMd 并不弹对话框，被要求走 dialog 时必须判不过').toBe(false)
    const [okNoFs] = satisfies(h as HandlerInfo, 'no-fs')
    expect(okNoFs).toBe(true)
  })
})

describe('SFTP 传输的边界对账', () => {
  const preloadText = fs.readFileSync(
    path.join(process.cwd(), 'src/preload/domains/sftp.ts'),
    'utf8',
  )
  const modelsText = fs.readFileSync(path.join(process.cwd(), 'src/shared/models.ts'), 'utf8')

  it('preload 的 upload/download 不再收本地路径（参数表里不许有 localPath）', () => {
    const sf = ts.createSourceFile('sftp.ts', preloadText, ts.ScriptTarget.Latest, true)
    const sigs: Record<string, string[]> = {}
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAssignment(node) && ['upload', 'download'].includes(node.name.getText())) {
        const init = node.initializer
        if (ts.isArrowFunction(init)) sigs[node.name.getText()] = init.parameters.map((p) => p.name.getText())
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
    expect(Object.keys(sigs).sort()).toEqual(['download', 'upload'])
    for (const [name, params] of Object.entries(sigs)) {
      expect(params, `sftp.${name} 的参数表${params.join(',')}里出现了本地路径`).not.toContain('localPath')
    }
  })

  it('IPC 契约表把 sftp:upload / sftp:download 的返回值钉成 SftpTransferResult', () => {
    expect(modelsText).toMatch(/'sftp:upload': \{ args: \[string, string, string\?\]; return: SftpTransferResult \}/)
    expect(modelsText).toMatch(/'sftp:download': \{ args: \[string, string, string\?\]; return: SftpTransferResult \}/)
  })
})
