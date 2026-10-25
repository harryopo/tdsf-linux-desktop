/**
 * 审计报告那几个出口收口（#214：四把报告键 + 一把校准样本键整删）
 *
 * 取证（2026-10-25）：`credibility:export/list/load/format-audit-report` 与
 * `credibility:add-calibration-sample` 五把在渲染层零调用。这一批判的是**减面**，不是还债，
 * 理由两条，都不是"没人按"这么简单：
 *
 * 1. 那四把报告键的形状是"渲染层把整份 `AuditReportInput` 递过来 → 主进程落盘 → 盖上
 *    reportId 与指纹"。主进程里没有任何一处能从库里那一行拼出这份输入：唯一的构造点在
 *    `buildSimplifiedAuditInput`（`src/main/ipc/credibility.ts`），它从 `DecisionCard` 派生，
 *    走的是一条已经接上界面的通道。所以"接上界面"等于让沙箱里的渲染层想写什么就写什么、
 *    再由主进程盖一张合规戳——那是假保证，比没功能更坏（与 #199/#211 判掉的
 *    "渲染层递整批数据就写库/写盘"同一族）。
 * 2. `add-calibration-sample` 的 handler 自己注释就写着"内存操作，不持久化"；真正的样本生产者
 *    在主进程（`calibration/decision-samples.ts` 从读者反馈喂）。按下去不会留下任何东西。
 *
 * 判据各钉一件事：
 * 1. 五把键不许回来（快照暴露面 / preload 域方法 / 渲染层类型声明 三处一起查）
 * 2. 主进程只注册剩下那六条 credibility 通道（第七把 credibility:dag 已于 #216 整删）
 * 3. 名单源里那五条常量不许回来，且名单源键数与注册数不许分叉
 * 4. 反过度砍：决策详情那条**活的**报告出口链完整（调用点、注册、引擎文件都在）
 * 5. 形状：活着的这条只收 decisionId；全仓 IPC 不许再有"渲染层递整份 AuditReportInput"的 handler
 * 6. 反过度砍：校准面板真在用的那四把不许被一起带走
 */
import { describe, it, expect } from 'vitest'
import * as path from 'node:path'
import * as ts from 'typescript'
import { CREDIBILITY } from '@shared/ipc-channels'
import { listSourceFiles, readSourceFile } from '../helpers/source-scan'

const ROOT = path.resolve(__dirname, '../..')

/** 本轮判掉的五把暴露名，任何一把回来都算回涨 */
const BANNED_KEYS = [
  'credibilityAddCalibrationSample',
  'credibilityExportAuditReport',
  'credibilityFormatAuditReport',
  'credibilityListAuditReports',
  'credibilityLoadAuditReport',
]

/** 本轮判掉的五条通道真值（写成字面量：常量本身要被删，不能再从名单源取） */
const BANNED_CHANNELS = [
  'credibility:add-calibration-sample',
  'credibility:export-audit-report',
  'credibility:format-audit-report',
  'credibility:list-audit-reports',
  'credibility:load-audit-report',
]

/** 本轮判掉的五个名单源常量名 */
const BANNED_CONSTS = [
  'ADD_CALIBRATION_SAMPLE',
  'EXPORT_AUDIT_REPORT',
  'FORMAT_AUDIT_REPORT',
  'LIST_AUDIT_REPORTS',
  'LOAD_AUDIT_REPORT',
]

/** 留下来的六条（校准面板那四把、assess，加决策详情真在用的那条导出）
 *  第七把 `credibility:dag` 已于 2026-10-25 随 #216 整删：它要渲染层整批递证据源，
 *  融合图描述的就成了"递什么算什么"，而界面上同源的那份融合读数一直在（判据见 zero-call-ipc-surface）。 */
const KEPT_CHANNELS = [
  CREDIBILITY.ASSESS,
  CREDIBILITY.CALIBRATE,
  CREDIBILITY.COMPUTE_ECE,
  CREDIBILITY.EXPORT_DECISION_HTML,
  CREDIBILITY.GET_CALIBRATION_STATE,
  CREDIBILITY.RESET_CALIBRATION,
].sort()

/** 校准面板真在按的四把 */
const KEPT_CALIBRATION_KEYS = [
  'credibilityCalibrate',
  'credibilityComputeEce',
  'credibilityGetCalibrationState',
  'credibilityResetCalibration',
]

const CRED_FILE = 'src/main/ipc/credibility.ts'
const PRELOAD_DOMAIN = 'src/preload/domains/cognition.ts'

interface HandlerShape {
  channel: string
  /** 业务形参（已跳过 `_event` 那类下划线前缀） */
  params: Array<{ name: string; type: string }>
}

function exposedNames(): string[] {
  return readSourceFile(path.join(ROOT, 'tests/unit/__fixtures__/preload-api-surface.txt'))
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}

/** 去掉注释行，只留代码正文（否则"我写的这段说明"会被当成还在引用） */
function codeOnly(src: string): string {
  return src
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n')
}

/**
 * 按 AST 取一份文件里每个 ipcMain.handle 的通道名与业务形参。
 * 通道名一律回单源取真值（CREDIBILITY.X → 真值），字面量原样取，照常量名猜是禁止的。
 */
function handlersOf(rel: string): HandlerShape[] {
  const src = readSourceFile(path.join(ROOT, rel))
  const file = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true)
  const out: HandlerShape[] = []
  const walk = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'handle' &&
      node.arguments.length >= 2
    ) {
      const a = node.arguments[0]
      let channel = ''
      if (ts.isStringLiteral(a)) channel = a.text
      else if (ts.isPropertyAccessExpression(a)) {
        channel =
          CREDIBILITY[a.name.text as keyof typeof CREDIBILITY] ?? `未知常量 CREDIBILITY.${a.name.text}`
      }
      const fn = node.arguments[1]
      if (channel && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) {
        out.push({
          channel,
          params: fn.parameters
            .filter((p) => !(ts.isIdentifier(p.name) && p.name.text.startsWith('_')))
            .map((p) => ({ name: p.name.getText(), type: p.type ? p.type.getText() : '' })),
        })
      }
    }
    ts.forEachChild(node, walk)
  }
  walk(file)
  return out
}

/** 名单源 CREDIBILITY 对象里声明的键名（AST 取，不按正文文本猜） */
function channelConstKeys(): string[] {
  const rel = 'src/shared/ipc-channels.ts'
  const src = readSourceFile(path.join(ROOT, rel))
  const file = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true)
  let keys: string[] = []
  let found = false
  const walk = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'CREDIBILITY'
    ) {
      // `= { … } as const`：初始化式外面套着一层 AsExpression，不剥掉就永远扫不到
      const init = node.initializer
      const obj = init && ts.isAsExpression(init) ? init.expression : init
      if (obj && ts.isObjectLiteralExpression(obj)) {
        found = true
        keys = obj.properties.filter(ts.isPropertyAssignment).map((p) => p.name.getText())
      }
    }
    ts.forEachChild(node, walk)
  }
  walk(file)
  expect(found, '没在名单源里扫到 CREDIBILITY 对象').toBe(true)
  return keys
}

/** 注册日志里那份手抄的通道清单（AST 取 `channels: [...]`，与实注册逐名对账用） */
function loggedChannels(): string[] {
  const src = readSourceFile(path.join(ROOT, CRED_FILE))
  const file = ts.createSourceFile(CRED_FILE, src, ts.ScriptTarget.Latest, true)
  let out: string[] = []
  let found = false
  const walk = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'channels' &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      found = true
      out = node.initializer.elements
        .filter(ts.isStringLiteral)
        .map((e) => e.text)
        .sort()
    }
    ts.forEachChild(node, walk)
  }
  walk(file)
  expect(found, '没扫到注册日志里的 channels 清单，取数面坏了').toBe(true)
  return out
}

describe('审计报告出口收口（#214）', () => {
  it('1. 五把键不许回来：快照、preload 域方法、渲染层类型声明三处一起查', () => {
    const names = exposedNames()
    const back = BANNED_KEYS.filter((k) => names.includes(k))
    expect(back, '这些 credibility 键又挂回 window.electronAPI 了').toEqual([])

    for (const rel of [PRELOAD_DOMAIN, 'src/preload/index.ts', 'src/renderer/src/types/electron.d.ts']) {
      const body = codeOnly(readSourceFile(path.join(ROOT, rel)))
      for (const banned of BANNED_KEYS) {
        expect(
          body,
          `${rel} 里还留着 ${banned}——快照里它已经消失，这里留着就是悬空声明`
        ).not.toContain(banned)
      }
    }
  })

  it('2. 主进程只注册那六条 credibility 通道', () => {
    const got = handlersOf(CRED_FILE)
      .map((h) => h.channel)
      .filter((c) => c.startsWith('credibility:'))
      .sort()
    for (const banned of BANNED_CHANNELS) {
      expect(got, `${banned} 又被注册了`).not.toContain(banned)
    }
    expect(got, '注册集合与留下来的六条逐名相等').toEqual(KEPT_CHANNELS)
    // 注册日志那份手抄清单不许继续写着已经删掉的通道（#210 就出过 handler 删了、日志还写着）
    expect(loggedChannels(), '注册日志里的通道清单与实注册分叉').toEqual(got)
  })

  it('3. 名单源里那五条常量不许回来，且键数与注册数不许分叉', () => {
    const keys = channelConstKeys()
    for (const banned of BANNED_CONSTS) {
      expect(keys, `CREDIBILITY.${banned} 又写回名单源了`).not.toContain(banned)
    }
    // 名单源与主进程注册必须一一对应：多一条常量就是第二条通道假死（没人注册也没人报错）
    expect(keys.length, '名单源的 CREDIBILITY 键数与主进程注册数分叉了').toBe(KEPT_CHANNELS.length)
  })

  it('4. 反过度砍：决策详情那条活着的报告出口链一格没少', () => {
    const page = readSourceFile(path.join(ROOT, 'src/renderer/src/pages/DecisionDetailPage.tsx'))
    expect(page, '决策页不再调 credibilityExportAudit：上面那句"活着的出口"就是假的').toContain(
      'credibilityExportAudit('
    )
    const ipc = codeOnly(readSourceFile(path.join(ROOT, CRED_FILE)))
    expect(ipc, 'export-decision-html 那条 handler 被一起带走了').toContain('export-decision-html')
    expect(ipc, '它不再引审计引擎：那条链已经空转').toContain('credibility/audit/exporter')
    expect(ipc, 'buildSimplifiedAuditInput 没了：主进程无从从库里取数拼报告').toContain(
      'buildSimplifiedAuditInput'
    )
    for (const rel of [
      'src/main/core/agent/credibility/audit/types.ts',
      'src/main/core/agent/credibility/audit/report-builder.ts',
      'src/main/core/agent/credibility/audit/exporter.ts',
      'src/main/core/agent/credibility/audit/formatters.ts',
    ]) {
      expect(readSourceFile(path.join(ROOT, rel)), `${rel} 被一起删了`).not.toBe('')
    }
  })

  it('5. 形状：活着的报告入口只收 decisionId，全仓 IPC 不许再有"递整份报告"的 handler', () => {
    const html = handlersOf(CRED_FILE).find((h) => h.channel === CREDIBILITY.EXPORT_DECISION_HTML)
    expect(html, '没扫到 export-decision-html 的 handler').toBeTruthy()
    const first = html!.params[0]
    expect(first, '这条入口的第一个业务参数不是 decisionId').toBeDefined()
    expect(first.name, '这条入口的第一个业务参数不再是 decisionId').toBe('decisionId')
    expect(first.type).toBe('string')

    const wholeReport: string[] = []
    for (const abs of listSourceFiles(path.join(ROOT, 'src/main/ipc'))) {
      const rel = path.relative(ROOT, abs).split(path.sep).join('/')
      for (const h of handlersOf(rel)) {
        if (h.params.some((p) => p.type.includes('AuditReportInput'))) {
          wholeReport.push(`${rel} → ${h.channel}`)
        }
      }
    }
    expect(wholeReport, '这些通道让渲染层递整份 AuditReportInput').toEqual([])
  })

  it('6. 反过度砍：校准面板真在用的那四把还在，且真有调用点', () => {
    const names = exposedNames()
    for (const kept of KEPT_CALIBRATION_KEYS) {
      expect(names, `误砍了校准面板在用的 ${kept}`).toContain(kept)
    }
    const page = readSourceFile(path.join(ROOT, 'src/renderer/src/pages/CalibrationSettings.tsx'))
    for (const kept of KEPT_CALIBRATION_KEYS) {
      expect(page, `CalibrationSettings 不再调 ${kept}：上面那句"真在用"是假的`).toContain(kept)
    }
  })
})
