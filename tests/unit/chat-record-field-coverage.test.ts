/**
 * 回看不能比当场看到的少（#177 的字段覆盖闸）
 *
 * 病根：落盘记录 ChatMessageRecord 是手抄一份 AgentMessage 的字段清单。第一版抄漏了
 * errorMessage / contextTokens / contextNote / cotEntropyTrajectory 四个——
 * 后果全在界面上且全是静默的：重启后报错行是空的、上下文徽章拿各步之和虚高、
 * 压缩说明那行没了、可信度卡的熵轨迹不画。用户看到的就是"我明明问过的事，重启后说不清"。
 *
 * 所以这条闸不做"提醒记得加字段"，而是每次都从两份声明现场解出成员集合来对账：
 * 谁给 AgentMessage 加了字段而没交代落盘口径，这里立刻红。
 * 口径类清单手抄迟早分叉（本仓记过这笔账），能反查单源就别抄。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

const AGENT_STORE = join(process.cwd(), 'src', 'renderer', 'src', 'stores', 'agent-store.ts')
const CHAT_TYPES = join(process.cwd(), 'src', 'shared', 'chat-types.ts')

/** 解出某个 interface 的顶层成员名（不递归子对象：那是"卡片自己的字段"，不是消息的字段） */
function interfaceMembers(file: string, name: string): string[] {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true)
  const out: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === name) {
      for (const m of node.members) if (m.name && ts.isIdentifier(m.name)) out.push(m.name.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

/**
 * 不落盘的字段，逐个交代为什么。
 *
 * 这张名单是"例外"不是"漏网"：加一个就得写一句理由，删一个字段要回头看这里。
 */
const DELIBERATELY_NOT_PERSISTED: Record<string, string> = {
  isStreaming: '流动态是进程内的事。重启后那条回答要么已收尾要么被打断，落 isStreaming:true 会让界面永远转圈',
}

/** 名字换了但要落盘的字段（记录里的名字 → 消息里的名字） */
const RENAMED: Record<string, string> = {
  createdAt: 'timestamp',
}

/**
 * 声明对账之外，还要证明这四处是真断言不是摆设。
 *
 * 判据本身只认两份 interface 的成员名，所以这里用内存里的两份假清单跑同一段过滤逻辑：
 * 缺字段必须列出来、补上必须清空、补错名字不算补上。少了这一段，
 * "解不出成员＝两个空集合相等"就会把闸演成绿灯。
 */
function missingFrom(msgFields: string[], recordFields: string[]): string[] {
  // RENAMED 的值是"消息那一侧的名字"：createdAt 存的是 timestamp，所以 timestamp 算已覆盖
  const covered = new Set([...recordFields, ...Object.values(RENAMED)])
  return msgFields.filter((f) => !covered.has(f) && !DELIBERATELY_NOT_PERSISTED[f])
}

describe('对话落盘的字段覆盖', () => {
  const messageFields = interfaceMembers(AGENT_STORE, 'AgentMessage')
  const recordFields = interfaceMembers(CHAT_TYPES, 'ChatMessageRecord')

  it('两份 interface 都解出了成员（解出 0 个等于闸空转）', () => {
    expect(messageFields.length, 'AgentMessage 解不出字段：写法变了还是文件挪了').toBeGreaterThan(10)
    expect(recordFields.length, 'ChatMessageRecord 解不出字段').toBeGreaterThan(5)
  })

  it('消息里每个字段要么落盘、要么在例外名单里写明原因', () => {
    const missing = missingFrom(messageFields, recordFields)
    expect(
      missing,
      `这些字段界面上会读到但没地方存：${missing.join(', ')}。要么加进 ChatMessageRecord（含迁移与仓储），` +
        `要么进 DELIBERATELY_NOT_PERSISTED 并写清为什么界面不需要它`,
    ).toEqual([])
  })

  it('例外名单里的字段确实还在消息里（字段删了要回头删这条理由）', () => {
    const stale = Object.keys(DELIBERATELY_NOT_PERSISTED).filter((f) => !messageFields.includes(f))
    expect(stale, `例外名单里 these 字段已不在 AgentMessage 上，删掉：${stale.join(', ')}`).toEqual([])
  })

  it('记录里不许有消息没有的字段（改名表是唯一合法来源）', () => {
    const allowed = new Set([...messageFields, ...Object.keys(RENAMED)])
    const ghost = recordFields.filter((f) => !allowed.has(f))
    expect(ghost, `ChatMessageRecord 多出了消息里不存在的字段：${ghost.join(', ')}`).toEqual([])
  })

  it('阳性对照：缺字段能报出来、补齐能清零、补错名字不算补上（否则闸没有分辨力）', () => {
    const msgFields = ['id', 'content', 'errorMessage', 'cotEntropyTrajectory', 'isStreaming', 'createdAt']
    expect(
      missingFrom(msgFields, ['id', 'content', 'createdAt']).sort(),
      '界面上读得到但没落盘的字段必须被点名',
    ).toEqual(['cotEntropyTrajectory', 'errorMessage'])
    // 补齐后清零——同时证明 isStreaming 那条理由真的被例外名单接住了
    expect(missingFrom(msgFields, ['id', 'content', 'createdAt', 'errorMessage', 'cotEntropyTrajectory'])).toEqual([])
    // 名字对不上不许蒙混：记成 errorMassage 依然是缺
    expect(missingFrom(msgFields, ['id', 'content', 'createdAt', 'errorMassage'])).toContain('errorMessage')
  })
})
