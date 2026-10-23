/**
 * 落盘入参的 zod 形状与声明类型必须对得上（#177）
 *
 * 病根是这个形状有两份声明：`@shared/chat-types` 的 TS 接口（可以 `string | null`）
 * 和 `ipc-contract` 里挡渲染层写入的 zod（原先只写 `.optional()`，不接受 null）。
 * 于是类型上合法的载荷会在 preload 那侧当场抛错——而抛错被 persistMessage 的 catch 咽掉，
 * 只剩一行 console.warn。表现就是"本机（没连服务器）那档对话一条都存不下"，
 * 而单测按 TS 接口造的假数据全绿。两份声明对账只能拿真 zod 跑真类型形状的样例。
 */
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { contractFor, type InvokeContract } from '@shared/ipc-contract'
import type { ChatMessageRecord } from '@shared/chat-types'

/** 取 chat:append 的第一个入参 schema */
function appendSchema(): z.ZodTypeAny {
  const entry = contractFor('chatAppend')
  if (!entry) throw new Error('契约里没有 chatAppend：改名了还是删掉了（这条判据要跟着改）')
  if (entry.kind !== 'invoke') throw new Error('chatAppend 不再是 invoke 通道')
  const first = (entry as InvokeContract).args[0]
  if (!first) throw new Error('chatAppend 没有声明入参 schema')
  return first.schema
}

/**
 * 按 TS 接口"允许的取值范围"造样例：字段缺省、给字符串、给 null 三种都要放行。
 * 这张表来自接口声明本身，不是拍脑袋写的清单——接口说 `string | null`，schema 就都得接。
 */
const NULLABLE_STRING_FIELDS = ['correlationId', 'sshSessionId', 'errorMessage', 'contextNote'] as const
const NULLABLE_NUMBER_FIELDS = ['contextTokens'] as const
const NULLABLE_JSON_FIELDS = ['toolEvents', 'usage', 'cotEntropyTrajectory'] as const

const MINIMAL: ChatMessageRecord = {
  id: 'm-1',
  role: 'assistant',
  content: '这是回答',
  createdAt: 1_700_000_000_000,
}

describe('chat:append 的入参 schema 与声明类型对账', () => {
  const schema = appendSchema()

  it('必填四项齐了才放行（缺 role / content 这类必须拒）', () => {
    expect(schema.safeParse(MINIMAL).success, '最小合法载荷被拒').toBe(true)
    for (const k of ['id', 'role', 'content', 'createdAt']) {
      const bad = { ...MINIMAL } as Record<string, unknown>
      delete bad[k]
      expect(schema.safeParse(bad).success, `少了 ${k} 还放行等于写入口不设防`).toBe(false)
    }
  })

  it('声明为 string | null 的字段，给 null 必须放行（本机那档就靠它）', () => {
    for (const field of NULLABLE_STRING_FIELDS) {
      const withNull = { ...MINIMAL, [field]: null }
      expect(schema.safeParse(withNull).success, `${field}: null 被拒 → 本机对话整档存不下`).toBe(true)
      const withText = { ...MINIMAL, [field]: '一段文本' }
      expect(schema.safeParse(withText).success, `${field}: 正常字符串被拒`).toBe(true)
    }
  })

  it('声明为 number 的字段要接住 0（0 是合法读数，不是"没给"）', () => {
    for (const field of NULLABLE_NUMBER_FIELDS) {
      expect(schema.safeParse({ ...MINIMAL, [field]: 0 }).success, `${field}: 0 被拒`).toBe(true)
      expect(schema.safeParse({ ...MINIMAL, [field]: null }).success, `${field}: null 被拒`).toBe(true)
    }
  })

  it('JSON 列给 null 与给真数据都要放行', () => {
    for (const field of NULLABLE_JSON_FIELDS) {
      expect(schema.safeParse({ ...MINIMAL, [field]: null }).success, `${field}: null 被拒`).toBe(true)
      expect(schema.safeParse({ ...MINIMAL, [field]: [] }).success, `${field}: 空数组被拒`).toBe(true)
    }
  })

  it('敌意载荷仍要挡：角色越界、正文超长、时间戳非正', () => {
    expect(schema.safeParse({ ...MINIMAL, role: 'system' }).success, 'system 角色不该能从写入口进来').toBe(
      false
    )
    expect(schema.safeParse({ ...MINIMAL, content: 'x'.repeat(200_001) }).success).toBe(false)
    expect(schema.safeParse({ ...MINIMAL, createdAt: -1 }).success).toBe(false)
    expect(schema.safeParse({ ...MINIMAL, toolEvents: new Array(201).fill({}) }).success).toBe(false)
  })

  it('渲染层真发的那一份（persistMessage 的产物）必须过闸', () => {
    /*
     * 这条是整个对账的落点：不直接测 store（store 在 node 环境里会被 isElectronAPIAvailable 挡住），
     * 而是照 persistMessage 的字段搬运写一遍同样的取值——未连接会话 + 无工具 + 用量为空。
     * 第一版就是这一份载荷过不了：sshSessionId 走 `?? null` 变成 null，而 schema 只认 undefined。
     */
    const fromRenderer = {
      id: 'msg_1',
      correlationId: undefined,
      sshSessionId: null,
      role: 'assistant',
      content: '回答',
      reasoning: undefined,
      toolEvents: undefined,
      providerId: undefined,
      model: undefined,
      usage: undefined,
      cancelled: undefined,
      isError: undefined,
      errorCode: undefined,
      errorMessage: undefined,
      contextTokens: undefined,
      contextNote: undefined,
      cotEntropyTrajectory: undefined,
      createdAt: 1_700_000_000_000,
    }
    const parsed = schema.safeParse(fromRenderer)
    expect(parsed.success, '渲染层发的这一份被自己的契约挡在门外').toBe(true)
  })
})
