/**
 * 外部 MCP 工具并进主对话工具集（任务 #173 第三步）
 *
 * 这一批要钉住的是"AI 能不能真的用外部工具，而用之前还是不是每次都问人"。
 * 前两条最要紧，因为它们各自能被一种"看起来没问题"的实现骗过去：
 * - 名字不加来源前缀：两台服务器都有 search 时，后一台会静默覆盖前一台，
 *   模型调的到底是哪个程序，界面上永远读不出来；
 * - 审批回调没注入就默认放行：那是把"每次都要有人点头"写成"没人时也算点头"。
 *
 * 判据引擎是 ai@7 的 tool()/jsonSchema()（与 supervisor 主对话同一套），
 * 所以这里测的就是真上链路的那一份工具定义。
 */
import { describe, it, expect, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as ts from 'typescript'
import {
  buildExternalChatTools,
  externalChatToolName,
  EXTERNAL_TOOL_MOUNT_LIMIT,
  type ExternalChatToolDeps,
  type ExternalChatToolMount,
  type ExternalToolDescriptor,
} from '@main/core/agent/tools/external-mcp-tools'
import type { PaorApprovalRequest } from '@shared/approval-types'

function desc(overrides: Partial<ExternalToolDescriptor> = {}): ExternalToolDescriptor {
  return {
    serverId: 'srv-1',
    serverName: '天气服务器',
    name: 'get_forecast',
    description: '查未来三天天气',
    inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
    ...overrides,
  }
}

/** 一条都批不成的审批：用来证明"没点头就不会执行" */
const DENY = async (): Promise<boolean> => false
const APPROVE = async (): Promise<boolean> => true

function mount(
  tools: ExternalToolDescriptor[],
  opts: {
    approve?: (input: Omit<PaorApprovalRequest, 'expiresAt'>) => Promise<boolean>
    call?: ExternalChatToolDeps['call']
  } = {}
): ExternalChatToolMount {
  return buildExternalChatTools({
    tools: () => tools,
    approve: opts.approve ?? DENY,
    onDenied: () => {},
    call:
      opts.call ??
      (async () => ({ success: true, content: [{ type: 'text' as const, text: '晴，23 度' }] })),
  })
}

describe('外部 MCP 工具的名字与数量', () => {
  it('名字带服务器来源，两台同名的工具各占一格', () => {
    const m = mount([
      desc({ serverId: 'a', name: 'search' }),
      desc({ serverId: 'b', name: 'search' }),
    ])
    expect(Object.keys(m.tools)).toEqual([
      externalChatToolName('a', 'search'),
      externalChatToolName('b', 'search'),
    ])
    expect(externalChatToolName('a', 'search'), '前缀要能看出是外部 MCP').toContain('mcp')
  })

  it('超出挂载上限时如实报被跳过的条数（静默丢工具等于界面在骗人）', () => {
    const many = Array.from({ length: EXTERNAL_TOOL_MOUNT_LIMIT + 3 }, (_, i) =>
      desc({ serverId: 'a', name: `t${i}` })
    )
    const m = mount(many)
    expect(Object.keys(m.tools)).toHaveLength(EXTERNAL_TOOL_MOUNT_LIMIT)
    expect(m.skipped).toBe(3)
    expect(m.names).toEqual(Object.keys(m.tools))
  })

  it('没有一台连着 → 空集，而不是"挂了但一调就错"', () => {
    const m = mount([])
    expect(Object.keys(m.tools)).toEqual([])
    expect(m.skipped).toBe(0)
  })

  it('第三方自报的怪名字要洗成各家 API 收得下的键，但调用仍用原名', async () => {
    // 工具名是第三方自己定的：中文、空格、点号都可能出现。原样拼进键名，
    // 请求会在 provider 侧整条 400——一个不守规矩的服务器不该把对话弄坏。
    const weird = desc({ serverId: 'srv-2', name: '查询 天气.today' })
    const m = mount([weird], { approve: APPROVE })
    const keys = Object.keys(m.tools)
    expect(keys).toHaveLength(1)
    expect(keys[0], '键名里有 provider 不认的字符').toMatch(/^[A-Za-z0-9_-]{1,64}$/)
    const call = vi.fn(async () => ({ success: true, content: [{ type: 'text' as const, text: '晴' }] }))
    const withCall = buildExternalChatTools({
      tools: () => [weird],
      approve: APPROVE,
      onDenied: () => {},
      call,
    })
    await (withCall.tools[keys[0]] as { execute: (i: unknown) => Promise<unknown> }).execute({})
    expect(call, '洗名字时把真去调用的原名也改了').toHaveBeenCalledWith(
      'srv-2',
      '查询 天气.today',
      {}
    )
  })

  it('两个名字洗完撞在一起 → 后一个不覆盖前一个，并计入未挂载', () => {
    const a = desc({ serverId: 's', name: 'a.b' })
    const b = desc({ serverId: 's', name: 'a_b' })
    const m = mount([a, b])
    expect(Object.keys(m.tools)).toHaveLength(1)
    expect(m.skipped, '撞名被静默丢掉：卡片上的数字就不诚实了').toBe(1)
  })

  it('键名总长不许超过 64（前缀 + 服务器 id + 工具名一起算）', () => {
    const m = mount([desc({ serverId: 'mcp-' + 'x'.repeat(30), name: 'y'.repeat(80) })])
    const key = Object.keys(m.tools)[0]
    expect(key.length, '超长键名会被 provider 直接拒').toBeLessThanOrEqual(64)
  })
})

describe('每次调用都要有人点头', () => {
  it('审批为假 → 一次都不落到外部服务器，并留下拒绝痕迹', async () => {
    const call = vi.fn()
    const onDenied = vi.fn()
    const m = buildExternalChatTools({
      tools: () => [desc()],
      approve: DENY,
      call,
      onDenied,
    })
    const t = m.tools[externalChatToolName('srv-1', 'get_forecast')] as {
      execute: (i: unknown) => Promise<{ ok: boolean; error?: string }>
    }
    const r = await t.execute({ city: '上海' })
    expect(r.ok).toBe(false)
    expect(r.error, '拒绝的话要能让模型就此收尾').toContain('没有被批准')
    // 一条 12 步的工具链，模型完全可以拿着同一个参数再试一次；不写清"别再试"，
    // 用户会被同一张卡反复追问到 60 秒超时（ssh_write 那条早写了，这里同规格）。
    expect(r.error).toContain('不要重复')
    expect(call, '没批准却执行了外部工具').not.toHaveBeenCalled()
    expect(onDenied, '被拒的调用要能进拦截记录').toHaveBeenCalled()
  })

  it('审批为真 → 才落到外部服务器，文本进卡片认得的字段', async () => {
    const call = vi.fn(async () => ({
      success: true,
      content: [{ type: 'text' as const, text: '晴，23 度' }],
    }))
    const m = buildExternalChatTools({
      tools: () => [desc()],
      approve: APPROVE,
      onDenied: () => {},
      call,
    })
    const t = m.tools[externalChatToolName('srv-1', 'get_forecast')] as {
      execute: (i: unknown) => Promise<{ ok: boolean; summary?: string; output?: string }>
    }
    const r = await t.execute({ city: '上海' })
    expect(call).toHaveBeenCalledWith('srv-1', 'get_forecast', { city: '上海' })
    expect(r.ok).toBe(true)
    // 界面只认 error/stdout/summary 三个可读字段（core/agent/tool-result-view.ts）。
    // 自造一个 output 键，卡片就会退化成把整个返回体 JSON 贴给用户。
    expect(r.summary, '返回体没有落在 tool-result-view 认得的字段上').toBe('晴，23 度')
    expect(r.output, 'output 这个键没人读').toBeUndefined()
  })

  it('递给审批的那份载荷带着服务器名字与工具名', async () => {
    const seen: Array<Omit<PaorApprovalRequest, 'expiresAt'>> = []
    const m = buildExternalChatTools({
      tools: () => [desc()],
      approve: async (input) => {
        seen.push(input)
        return false
      },
      onDenied: () => {},
      call: async () => ({ success: true, content: [] }),
    })
    const key = externalChatToolName('srv-1', 'get_forecast')
    await (m.tools[key] as { execute: (i: unknown) => Promise<unknown> }).execute({ city: '上海' })
    expect(seen).toHaveLength(1)
    expect(seen[0].origin).toBe('mcp')
    expect(seen[0].command).toContain('天气服务器')
    expect(seen[0].command).toContain('get_forecast')
    expect(seen[0].riskLevel, '外部工具的默认风险档不能写成"安全"').toBe('HIGH')
  })

  it('审批抛异常按未批准处理（判不了就先问人，问不到就不执行）', async () => {
    const call = vi.fn()
    const m = buildExternalChatTools({
      tools: () => [desc()],
      approve: async () => {
        throw new Error('审批通道断了')
      },
      onDenied: () => {},
      call,
    })
    const key = externalChatToolName('srv-1', 'get_forecast')
    const r = await (m.tools[key] as {
      execute: (i: unknown) => Promise<{ ok: boolean }>
    }).execute({})
    expect(r.ok).toBe(false)
    expect(call).not.toHaveBeenCalled()
  })

  it('外部服务器报错 → ok:false 并把原因带回给模型，不装成成功', async () => {
    const m = buildExternalChatTools({
      tools: () => [desc()],
      approve: APPROVE,
      onDenied: () => {},
      call: async () => ({
        success: false,
        error: '上游 500',
        content: [{ type: 'text' as const, text: '上游 500' }],
      }),
    })
    const key = externalChatToolName('srv-1', 'get_forecast')
    const r = await (m.tools[key] as {
      execute: (i: unknown) => Promise<{ ok: boolean; error?: string }>
    }).execute({})
    expect(r.ok).toBe(false)
    expect(r.error).toContain('上游 500')
  })
})

describe('工具定义本身', () => {
  it('描述里写清"第三方程序、每次调用都要审批"，并带上它自己的说明', () => {
    const m = mount([desc()])
    const t = m.tools[externalChatToolName('srv-1', 'get_forecast')] as { description: string }
    expect(t.description).toContain('天气服务器')
    expect(t.description).toContain('查未来三天天气')
    expect(t.description).toContain('审批')
  })

  it('服务器给的 JSON Schema 原样交给模型（不是自己编一个空参数表）', () => {
    const m = mount([desc()])
    const t = m.tools[externalChatToolName('srv-1', 'get_forecast')] as {
      inputSchema: { jsonSchema: { properties?: Record<string, unknown> } }
    }
    expect(t.inputSchema.jsonSchema.properties?.city).toBeDefined()
  })

  it('挂上了才往 system prompt 里加一句；一台都没连上就一个字都不加', () => {
    expect(mount([desc()]).promptHint).toContain('审批')
    expect(mount([desc()]).promptHint).toContain('天气服务器')
    expect(mount([]).promptHint, '没有外部工具却告诉模型"你有外部工具"，那是假承诺').toBe('')
    expect(mount([desc()]).servers, '装配卡片要按服务器说，不能只报一串工具名').toEqual([
      '天气服务器',
    ])
  })

  it('服务器没给 schema 时退回空对象表，批准后仍然可调', async () => {
    const m = mount([desc({ inputSchema: undefined })], { approve: APPROVE })
    const t = m.tools[externalChatToolName('srv-1', 'get_forecast')] as {
      inputSchema: { jsonSchema: { type?: string } }
      execute: (i: unknown) => Promise<{ ok: boolean }>
    }
    expect(t.inputSchema.jsonSchema.type).toBe('object')
    expect((await t.execute({})).ok).toBe(true)
  })
})

/**
 * 载荷好用不等于接上了。这一组按 AST 核对两处装配点：
 * agent-runtime 有没有真把 mountExternalTools 递进 supervisor.chat，
 * supervisor 有没有把返回的工具并进交给 streamText 的那张表。
 * 缺任一条，"AI 能调外部工具"就是一份没人调的漂亮函数
 * （同一类账在 #173 第一步已经吃过一次，判据见 tests/unit/mcp-external-call-gate.test.ts）。
 */
describe('装配点真的接上了', () => {
  function analyze(file: string): {
    props: Record<string, string>
    vars: Record<string, string[]>
    binds: Set<string>
    sigs: Set<string>
  } {
    const sf = ts.createSourceFile(
      path.basename(file),
      fs.readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true
    )
    const props: Record<string, string> = {}
    const vars: Record<string, string[]> = {}
    const binds = new Set<string>()
    const sigs = new Set<string>()
    const walk = (node: ts.Node): void => {
      if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
        props[node.name.text] = node.initializer.getText()
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        vars[node.name.text] = [...(vars[node.name.text] ?? []), node.initializer.getText()]
      }
      if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) binds.add(node.name.text)
      if (ts.isPropertySignature(node) && ts.isIdentifier(node.name)) sigs.add(node.name.text)
      ts.forEachChild(node, walk)
    }
    walk(sf)
    return { props, vars, binds, sigs }
  }

  const ROOT = path.resolve(__dirname, '../..')
  const runtime = analyze(path.join(ROOT, 'src/main/ipc/agent-runtime.ts'))
  const sup = analyze(path.join(ROOT, 'src/main/core/agent/supervisor.ts'))

  /** 同名变量可能有多处声明，只要有一处真把外部工具并进去就算接上 */
  const anyVarMentions = (name: string, needle: string): boolean =>
    (sup.vars[name] ?? []).some((text) => text.includes(needle))

  it('agent-runtime 把 mountExternalTools 递进了 supervisor.chat，四样东西都在里面', () => {
    const text = runtime.props.mountExternalTools
    expect(text, 'agent-runtime 里没有 mountExternalTools：AI 侧根本没有外部工具').toBeDefined()
    expect(text).toContain('buildExternalChatTools')
    expect(text, '外部工具没从"此刻已连上的"那份取数').toContain('getConnectedExternalTools')
    expect(text, '审批没串进外部工具的调用').toContain('requestApproval')
    expect(text, '被拒的调用没落拦截记录').toContain('emitBlockTrace')
  })

  it('supervisor 声明了参数、也真的取用了它', () => {
    expect(sup.sigs.has('mountExternalTools'), 'chat 参数里没有这个字段').toBe(true)
    expect(sup.binds.has('mountExternalTools'), '声明了却没从 params 里解构').toBe(true)
    expect(anyVarMentions('externalMount', 'mountExternalTools'), '解构了却没调用').toBe(true)
  })

  it('外部工具并进交给 streamText 的表，提示并进 system prompt，剪枝按名字走', () => {
    expect(anyVarMentions('tools', 'externalMount.tools'), '工具表里没并上外部工具').toBe(true)
    expect(anyVarMentions('systemPrompt', 'externalMount.promptHint'), '提示没进 system prompt').toBe(
      true
    )
    expect(anyVarMentions('pruned', 'externalMount.names'), '外部工具的输出没进历史剪枝').toBe(true)
  })

  it('阴性对照：不存在的属性与变量读出来是空（证明上面几条不是恒真）', () => {
    expect(runtime.props.definitelyNotARealOption).toBeUndefined()
    expect(sup.vars.definitelyNotARealVariable).toBeUndefined()
    expect(anyVarMentions('tools', 'definitelyNotARealThing'), '这条若能通过，判据就废了').toBe(false)
  })
})
