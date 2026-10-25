/**
 * 审批入口结构闸（D2 的第二半）
 *
 * approval-fail-closed.test.ts 量的是判定函数本身，它的注释写着"审批入口都走它"，
 * 但这句话从来没有一条断言撑着 —— 于是真的多出一个入口（当年那条 agent:confirm）把 approved 原样
 * 交给 JS 真值判断时，整套测试依然全绿。判"某条规矩被遵守"必须按结构取数，不能靠注释。
 *
 * 本闸做的事：
 *   1. 从通道清单里按名字捞出所有"渲染进程把批准位递给主进程"的通道（结尾是 approve / confirm）
 *   2. 逐个找到它的注册文件
 *   3. 断言该文件确实用了 readApproval —— 并且断言通道总数就是登记的那些（新增通道没被覆盖也会红）
 *   4. 再收一层：批准位必须是从**这条通道自己的 handler 入参**递给 readApproval 的
 *      （第 3 条按文件粒度看，同文件里为别的通道调 readApproval 也能蒙过去）
 *
 * 2026-10-25 #222：`loop:confirm` 连同它的注册、preload 键与两个决策页上的审批出口整删——
 * 那条链在渲染层没有任何调用点能启动，挂在它上面的按钮点了必然落空，所以它连"入口"都算不上。
 * 名单从三条收到两条，第 2、3、4 条对剩下的 `paor:approve` / `sandbox:approve` 一字未松。
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import ts from 'typescript'

const ROOT = path.resolve(__dirname, '../..')
const CHANNELS_FILE = path.join(ROOT, 'src/shared/ipc-channels.ts')
const MAIN_DIR = path.join(ROOT, 'src/main')

/** 批准位的形状：paor:approve / sandbox:approve …（*-approval-request 是反方向推送，不算） */
const APPROVAL_CHANNEL = /(?:approve|confirm)$/

function listTsFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return listTsFiles(p)
    return e.isFile() && e.name.endsWith('.ts') ? [p] : []
  })
}

/** 把 ipc-channels.ts 读成 通道值 -> 引用它的常量路径（如 'paor:approve' -> 'PAOR.APPROVE'） */
function channelConstIndex(): Map<string, string> {
  const src = fs.readFileSync(CHANNELS_FILE, 'utf8')
  const index = new Map<string, string>()
  const objRe = /export const ([A-Z_0-9]+)\s*=\s*\{([\s\S]*?)^\}/gm
  for (const [, objName, body] of src.matchAll(objRe)) {
    for (const [, key, value] of body.matchAll(/^\s*([A-Z_0-9]+):\s*'([^']+)'/gm)) {
      index.set(value, `${objName}.${key}`)
    }
  }
  return index
}

const CHANNELS = channelConstIndex()
const APPROVAL_CHANNELS = [...CHANNELS.keys()].filter((c) => APPROVAL_CHANNEL.test(c)).sort()

/**
 * 谁注册了这条通道：源文件里出现通道字面量，或出现对应的常量引用
 *
 * 只看 ipcMain.handle/on 是不够的——注册都写在多行调用里，按文件粒度判已经足够严格：
 * 同文件内别的通道不可能替它做批准判定。
 */
function registrants(channel: string): string[] {
  const ref = CHANNELS.get(channel)
  return listTsFiles(MAIN_DIR)
    .filter((f) => {
      const src = fs.readFileSync(f, 'utf8')
      const byLiteral = src.includes(`'${channel}'`) || src.includes(`"${channel}"`)
      const byConst = ref ? new RegExp(`\\b${ref.replace('.', '\\.')}\\b`).test(src) : false
      return byLiteral || byConst
    })
    .map((f) => path.relative(ROOT, f).replaceAll('\\', '/'))
}

/** 一条 `ipcMain.handle(这条通道, handler)` 的现场：handler 的入参名 + 它递给 readApproval 的名字 */
type ApprovalSite = { file: string; params: string[]; approvalArgs: string[] }

/**
 * 找出某条通道在主进程里的**真实注册点**
 *
 * 只认 `ipcMain.handle(<通道字面量 | 对应的 GROUP.KEY 常量>, handler)` 这一种形状：
 * 通道名出现在注释里、出现在注册完成后的 `logger.info({channels: [...]})` 清单里，
 * 都不算"有人注册了它"。（上一版按文件粒度判，这两种出现方式都能把闸喂饱。）
 */
function approvalSites(channel: string): ApprovalSite[] {
  const ref = CHANNELS.get(channel)
  const out: ApprovalSite[] = []
  for (const abs of listTsFiles(MAIN_DIR)) {
    const src = fs.readFileSync(abs, 'utf8')
    // 字符串预筛：整仓 main/ 做一遍 AST 太慢，先用最粗的判据把不可能的文件剔掉
    if (!(src.includes(`'${channel}'`) || (ref !== undefined && src.includes(ref)))) continue
    const sf = ts.createSourceFile(abs, src, ts.ScriptTarget.Latest, true)
    const rel = path.relative(ROOT, abs).replaceAll('\\', '/')
    function visit(node: ts.Node): void {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.expression.getText(sf) === 'ipcMain' &&
        node.expression.name.text === 'handle' &&
        node.arguments.length >= 2
      ) {
        const chanText = node.arguments[0].getText(sf)
        const isThisChannel =
          chanText === `'${channel}'` || chanText === `"${channel}"` || (ref !== undefined && chanText === ref)
        const handler = node.arguments[1]
        if (isThisChannel && (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler))) {
          const params = handler.parameters
            .map((p) => (ts.isIdentifier(p.name) ? p.name.text : ''))
            .filter((n) => n !== '')
          const approvalArgs: string[] = []
          function walk(n: ts.Node): void {
            if (ts.isCallExpression(n) && n.expression.getText(sf) === 'readApproval') {
              const arg = n.arguments[0]
              if (arg !== undefined && ts.isIdentifier(arg)) approvalArgs.push(arg.text)
            }
            n.forEachChild(walk)
          }
          walk(handler)
          out.push({ file: rel, params, approvalArgs })
        }
      }
      node.forEachChild(visit)
    }
    visit(sf)
  }
  return out
}

describe('每个审批入口都走严格判定（结构闸）', () => {
  it('通道清单里审批形通道的数量与预期一致（新增/改名不许悄悄漏出闸外）', () => {
    // 双向相等：多一条（新审批入口没被覆盖）和少一条（名单漂了）都红
    expect(APPROVAL_CHANNELS.sort()).toEqual(['paor:approve', 'sandbox:approve'])
  })

  it('每条审批通道都能在 main 里找到注册点', () => {
    for (const channel of APPROVAL_CHANNELS) {
      expect(registrants(channel), `${channel} 找不到注册文件（通道还在，实现已丢）`).not.toEqual([])
    }
  })

  it('每条审批通道的注册文件都调用 readApproval', () => {
    for (const channel of APPROVAL_CHANNELS) {
      for (const file of registrants(channel)) {
        const src = fs.readFileSync(path.join(ROOT, file), 'utf8')
        expect(src, `${file} 注册了 ${channel}，但没走 readApproval（等于按 JS 真值判批准）`).toContain(
          'readApproval('
        )
      }
    }
  })

  it('批准位只能来自这条通道自己 handler 的入参（按注册点判，不按文件判）', () => {
    expect(APPROVAL_CHANNELS.length, '审批通道名单空了 = 这条闸变成放行证').toBeGreaterThan(0)
    for (const channel of APPROVAL_CHANNELS) {
      const sites = approvalSites(channel)
      expect(
        sites.length,
        `${channel} 在 main 里找不到 ipcMain.handle 注册点（只在注释或日志通道清单里出现不算注册）`
      ).toBeGreaterThan(0)
      for (const s of sites) {
        // 红的方向一：这条 handler 根本没调 readApproval —— 上面按文件判的那条会被同文件
        // 里为别的通道调 readApproval 蒙过去，这里蒙不住
        const fromParams = s.approvalArgs.filter((a) => s.params.includes(a))
        expect(
          fromParams.length,
          `${s.file} 里 ${channel} 的 handler 没把自己的入参递给 readApproval（批准位按 JS 真值判）`
        ).toBeGreaterThan(0)
        // 红的方向二：调了 readApproval，但吃的不是这条 handler 的入参（多半是从别处
        // 捞的第二个真相，跨进程递进来的那份原样绕过判定）
        const notFromParams = s.approvalArgs.filter((a) => !s.params.includes(a))
        expect(
          notFromParams,
          `${s.file} 里 ${channel}：readApproval 吃的不是本 handler 的入参：${notFromParams.join('、')}`
        ).toEqual([])
      }
    }
  })
})
