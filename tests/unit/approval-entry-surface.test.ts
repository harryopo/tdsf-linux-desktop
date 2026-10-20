/**
 * 审批入口结构闸（D2 的第二半）
 *
 * approval-fail-closed.test.ts 量的是判定函数本身，它的注释写着"五个 IPC 审批入口都走它"，
 * 但这句话从来没有一条断言撑着 —— 于是真的多出第六个入口（agent:confirm）把 approved 原样
 * 交给 JS 真值判断时，整套测试依然全绿。判"某条规矩被遵守"必须按结构取数，不能靠注释。
 *
 * 本闸做的事：
 *   1. 从通道清单里按名字捞出所有"渲染进程把批准位递给主进程"的通道（结尾是 approve / confirm）
 *   2. 逐个找到它的注册文件
 *   3. 断言该文件确实用了 readApproval —— 并且断言通道总数就是登记的那些（新增通道没被覆盖也会红）
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')
const CHANNELS_FILE = path.join(ROOT, 'src/shared/ipc-channels.ts')
const MAIN_DIR = path.join(ROOT, 'src/main')

/** 批准位的形状：agent:confirm / paor:approve / llm:tool-approve …（*-approval-request 是反方向推送，不算） */
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

describe('每个审批入口都走严格判定（结构闸）', () => {
  it('通道清单里审批形通道的数量与预期一致（新增/改名不许悄悄漏出闸外）', () => {
    expect(APPROVAL_CHANNELS.sort()).toEqual([
      'agent:confirm',
      'llm:tool-approve',
      'loop:confirm',
      'paor:approve',
      'sandbox:approve',
    ])
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
})
