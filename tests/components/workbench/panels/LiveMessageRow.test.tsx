/**
 * tests/components/workbench/panels/LiveMessageRow.test.tsx
 * LiveMessageRow 组件级 RTL 最小伴随测试（ui-story-snapshot 漂移修复）
 *
 * 覆盖范围：
 * 1. 用户消息：气泡文本 + 时间
 * 2. 流式 assistant 消息：实时 Markdown 渲染（v2.5），但不提取命令按钮
 * 3. 完成态 assistant 消息：MarkdownMessage 渲染 + shell 代码块命令提取
 *    （在终端执行 → onToolAction('execute', cmd)；v2.5 沙箱按钮已删除）
 * 4. 无 activeSessionId 时不渲染命令按钮（v2.4 命令按钮前置条件）
 * 5. toolEvents 工具调用卡片：中文工具名 + 输出
 * 6. 底部导航按钮（onNavigate）
 *
 * 关键决策：
 * - AgentMessage 直接构造纯数据对象，不依赖 zustand store（组件仅消费 props）
 * - 非 shell 语系代码块（```text）不应被提取为命令（v2.4 命令提取失控回归）
 */
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import LiveMessageRow from '@renderer/components/workbench/panels/LiveMessageRow'
import type { AgentMessage } from '@renderer/stores/agent-store'

/** 构造 assistant 消息 */
function makeAssistant(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: 'm1',
    role: 'assistant',
    content: '排查完成，磁盘使用率正常。',
    timestamp: Date.now(),
    ...overrides,
  }
}

describe('LiveMessageRow — 用户消息', () => {
  it('1. 渲染用户气泡文本', () => {
    render(
      <LiveMessageRow
        message={{ id: 'u1', role: 'user', content: '帮我查一下磁盘', timestamp: Date.now() }}
      />
    )
    expect(screen.getByText('帮我查一下磁盘')).toBeInTheDocument()
  })
})

describe('LiveMessageRow — assistant 消息', () => {
  it('2. 流式中实时渲染 Markdown（v2.5），但不渲染命令按钮', () => {
    const { container } = render(
      <LiveMessageRow
        message={makeAssistant({ content: '# 标题已出现```bash\nls\n```', isStreaming: true })}
        onToolAction={vi.fn()}
        activeSessionId="sess-1"
      />
    )
    // v2.5：流式中也走 Markdown 渲染，不再裸出 md 符号
    expect(container.querySelector('.md-h1')).toHaveTextContent('标题已出现')
    // 流式中即使包含 shell 代码块也不提取命令
    expect(screen.queryByText(/检测到 \d+ 条命令/)).toBeNull()
    expect(screen.queryByRole('button', { name: /执行/ })).toBeNull()
  })

  it('3. 完成态用 Markdown 渲染（标题变 h 标签）', () => {
    const { container } = render(
      <LiveMessageRow message={makeAssistant({ content: '# 诊断结论\n一切正常' })} />
    )
    expect(container.querySelector('.md-h1')).toHaveTextContent('诊断结论')
  })

  it('4. shell 代码块提取命令：“在终端执行”触发 execute，无沙箱按钮（v2.5）', () => {
    const onToolAction = vi.fn()
    render(
      <LiveMessageRow
        message={makeAssistant({ content: '建议执行：\n```bash\ndf -h\n```' })}
        onToolAction={onToolAction}
        activeSessionId="sess-1"
      />
    )
    // v2.11 起标题不再带全角冒号（`ba82df6` 命令检测 UI 改版），断言与 :274 渲染文本对齐
    expect(screen.getByText('检测到 1 条命令')).toBeInTheDocument()
    // 'df -h' 同时出现在 Markdown 代码块与命令行列表中 → 用 AllBy 断言
    expect(screen.getAllByText('df -h').length).toBeGreaterThanOrEqual(2)

    fireEvent.click(screen.getByRole('button', { name: /在终端执行/ }))
    expect(onToolAction).toHaveBeenCalledWith('execute', 'df -h')

    // v2.5：沙箱功能已全量移除，不得再出现沙箱按钮
    expect(screen.queryByRole('button', { name: /沙箱/ })).toBeNull()
  })

  it('5. 非 shell 语系代码块不提取命令（v2.4 回归）', () => {
    render(
      <LiveMessageRow
        message={makeAssistant({ content: '流程说明：\n```text\n步骤A → 步骤B\n```' })}
        onToolAction={vi.fn()}
        activeSessionId="sess-1"
      />
    )
    expect(screen.queryByText(/检测到 \d+ 条命令/)).toBeNull()
  })

  it('6. 无 activeSessionId 时不渲染命令按钮', () => {
    render(
      <LiveMessageRow
        message={makeAssistant({ content: '```bash\ndf -h\n```' })}
        onToolAction={vi.fn()}
        activeSessionId={null}
      />
    )
    expect(screen.queryByText(/检测到 \d+ 条命令/)).toBeNull()
  })

  it('7. 命令类 toolEvents（ssh_readonly）渲染终端命令卡（中文名 + 命令 + 输出）', () => {
    render(
      <LiveMessageRow
        message={makeAssistant({
          toolEvents: [
            {
              toolCallId: 't1',
              toolName: 'ssh_readonly',
              input: 'uptime',
              done: true,
              ok: true,
              output: 'load average: 0.10',
            },
          ],
        })}
      />
    )
    expect(screen.getByText('只读诊断命令')).toBeInTheDocument()
    expect(screen.getByText(/uptime/)).toBeInTheDocument()
    expect(screen.getByText(/load average: 0.10/)).toBeInTheDocument()
    expect(screen.getByText('执行成功')).toBeInTheDocument()
  })

  it('7.1 检索类 toolEvents（kb_search）折进过程行：展开过程→展开该行→见查询与结果', () => {
    render(
      <LiveMessageRow
        message={makeAssistant({
          toolEvents: [
            {
              toolCallId: 'kb1',
              toolName: 'kb_search',
              input: 'nginx 优化',
              done: true,
              ok: true,
              // 真信封里检索工具自己带 count（见 supervisor 的 tool-result 分支），
              // 界面显示的条数就是这个数，不是从 output 文本里数出来的
              count: 2,
              output: '1. [KB-021] Nginx连接数优化指南\n2. [KB-088] P99延迟排查',
            },
          ],
        })}
      />
    )
    // 第②笔：跑完的检索步骤不再各占一行，收成"过程 · N 步"一行
    expect(screen.getByRole('button', { name: /过程/ })).toBeInTheDocument()
    expect(screen.getByText('1 步')).toBeInTheDocument()
    expect(screen.queryByText('检索知识库'), '跑完了还摊在正文里＝没折').toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /过程/ }))
    // 折叠行：中文名 + 条数徽章；不得出现终端 $ 提示符
    expect(screen.getByText('检索知识库')).toBeInTheDocument()
    expect(screen.getByText('2 条结果')).toBeInTheDocument()
    expect(screen.queryByText('$')).toBeNull()
    // 步骤自己那一层仍然默认收起：结果不可见
    expect(screen.queryByText(/KB-021/)).toBeNull()
    // 再展开这一层才见查询与结果
    fireEvent.click(screen.getByRole('button', { name: /检索知识库/ }))
    expect(screen.getByText(/查询/)).toBeInTheDocument()
    expect(screen.getByText(/KB-021/)).toBeInTheDocument()
  })

  it('7.2 工具报了 count:0 才说"无结果"', () => {
    render(
      <LiveMessageRow
        message={makeAssistant({
          toolEvents: [
            {
              toolCallId: 'kb2',
              toolName: 'kb_search',
              input: '磁盘',
              done: true,
              ok: true,
              count: 0,
              output: '未在知识库找到与"磁盘"相关的条目',
            },
          ],
        })}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /过程/ }))
    expect(screen.getByText('无结果')).toBeInTheDocument()
  })

  it('7.3 没有 count 的卡片只说"完成"，不再把非编号列表的输出判成"无结果"', () => {
    // skill_match 的 output 是「决策 … | 原因 | 预计省 N token」一行散文。
    // 旧实现用正则数 "1. 2." 行，数到 0 就报"无结果"——明明匹配到了手册。
    render(
      <LiveMessageRow
        message={makeAssistant({
          toolEvents: [
            {
              toolCallId: 'sk1',
              toolName: 'skill_match',
              input: 'Nginx 调优手册',
              done: true,
              ok: true,
              output: '决策 ai-plus | 关键词命中 | 预计省 1200 token',
            },
          ],
        })}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /过程/ }))
    expect(screen.getByText('匹配技能')).toBeInTheDocument()
    expect(screen.getByText('完成')).toBeInTheDocument()
    expect(screen.queryByText('无结果'), '没发生过"无结果"这回事').toBeNull()
  })

  it('7.4 MCP 工具的 JSON 入参按代码排版，标签不写"查询"', () => {
    render(
      <LiveMessageRow
        message={makeAssistant({
          toolEvents: [
            {
              toolCallId: 'mcp1',
              toolName: 'filesystem__read_file',
              input: '{"path":"/etc/hosts","limit":10}',
              done: true,
              ok: true,
              output: '127.0.0.1 localhost',
            },
          ],
        })}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /过程/ }))
    fireEvent.click(screen.getByRole('button', { name: /filesystem · read_file/ }))
    expect(screen.getByText('入参：')).toBeInTheDocument()
    expect(screen.queryByText(/查询/), 'MCP 不是检索，别写"查询"').toBeNull()
    expect(screen.getByText('{"path":"/etc/hosts","limit":10}')).toBeInTheDocument()
  })

  describe('7.5 过程摘要行的折叠规则（第②笔）', () => {
    it('命令类不折：跑完了也单独留在正文里，不并进过程行', () => {
      render(
        <LiveMessageRow
          message={makeAssistant({
            toolEvents: [
              { toolCallId: 'c1', toolName: 'ssh_readonly', input: 'df -h', done: true, ok: true, output: 'Use% 45%' },
            ],
          })}
        />
      )
      expect(screen.getByText('只读诊断命令')).toBeInTheDocument()
      expect(screen.getByText(/Use% 45%/)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /过程/ }), '只有命令类步骤时不该冒出过程行').toBeNull()
    })

    it('失败的那一步不折：不能把问题收进折叠块里', () => {
      render(
        <LiveMessageRow
          message={makeAssistant({
            toolEvents: [
              { toolCallId: 'k1', toolName: 'kb_search', input: '磁盘', done: true, ok: false, output: '检索失败' },
            ],
          })}
        />
      )
      expect(screen.getByText('检索知识库')).toBeInTheDocument()
      expect(screen.getByText('失败')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /过程/ })).toBeNull()
    })

    it('还在跑的那一步不折，且过程行默认展开、报"正在做什么"', () => {
      render(
        <LiveMessageRow
          message={makeAssistant({
            isStreaming: true,
            toolEvents: [
              { toolCallId: 'k2', toolName: 'kb_search', input: '磁盘', done: false },
              { toolCallId: 's1', toolName: 'skill_match', input: '手册', done: true, ok: true, output: 'ok' },
            ],
          })}
        />
      )
      // 进行中的那一步留在正文里（看得见它在动），跑完的收进过程行
      expect(screen.getByText('检索知识库')).toBeInTheDocument()
      expect(screen.getByText('检索中…')).toBeInTheDocument()
      expect(screen.getByText('1 步')).toBeInTheDocument()
      // 过程行默认展开，所以已完成的技能卡直接可见
      expect(screen.getByText('匹配技能')).toBeInTheDocument()
    })

    it('一条消息只有一个过程块，位置在第一个被折叠的步骤那里，正文并回连续', () => {
      const { container } = render(
        <LiveMessageRow
          message={makeAssistant({
            content: '先看资料。\n\n然后给结论。',
            toolEvents: [
              { toolCallId: 'a', toolName: 'tool_route', input: 'x', done: true, ok: true, output: 'o' },
              { toolCallId: 'b', toolName: 'thinking_route', input: 'y', done: true, ok: true, output: 'o' },
            ],
          })}
        />
      )
      expect(container.querySelectorAll('.ai-process').length).toBe(1)
      expect(screen.getByText('2 步')).toBeInTheDocument()
      // 被两个折叠步骤切开的正文要并回来，不能碎成三段
      expect(screen.getByText(/先看资料/)).toBeInTheDocument()
      expect(screen.getByText(/然后给结论/)).toBeInTheDocument()
    })

    it('过程行不报耗时：工具事件里没有真实时间戳，没数据就不编', () => {
      render(
        <LiveMessageRow
          message={makeAssistant({
            toolEvents: [
              { toolCallId: 'z', toolName: 'kb_search', input: 'q', done: true, ok: true, count: 1, output: 'o' },
            ],
          })}
        />
      )
      expect(screen.getByRole('button', { name: /过程/ }).textContent).not.toMatch(/\d+\s*(s|秒|ms)/)
    })
  })

  it('8. 底部导航按钮触发 onNavigate', () => {
    const onNavigate = vi.fn()
    render(<LiveMessageRow message={makeAssistant()} onNavigate={onNavigate} />)
    // 底部导航按钮
    fireEvent.click(screen.getByRole('button', { name: '查看监控' }))
    expect(onNavigate).toHaveBeenCalledWith('/monitor')
    fireEvent.click(screen.getByRole('button', { name: '记录决策' }))
    expect(onNavigate).toHaveBeenCalledWith('/history')
    fireEvent.click(screen.getByRole('button', { name: '更新知识库' }))
    expect(onNavigate).toHaveBeenCalledWith('/knowledge')
  })

  it('9. 错误消息以纯文本渲染且无底部动作按钮', () => {
    render(
      <LiveMessageRow
        message={makeAssistant({ content: 'Agent 调用失败', isError: true })}
        onNavigate={vi.fn()}
      />
    )
    expect(screen.getByText('Agent 调用失败')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '查看监控' })).toBeNull()
  })

  it('10. reasoning 存在时渲染“深度思考”折叠块，点击可展开/收起（v2.5）', () => {
    render(
      <LiveMessageRow
        message={makeAssistant({
          content: '结论：一切正常',
          reasoning: '先检查磁盘→再看内存→最后看进程',
        })}
      />
    )
    // 完成态（非流式）默认收起：标题行可见，思考正文不可见
    expect(screen.getByText('深度思考')).toBeInTheDocument()
    expect(screen.queryByText(/先检查磁盘/)).toBeNull()
    // 点击展开
    fireEvent.click(screen.getByRole('button', { name: /深度思考/ }))
    expect(screen.getByText(/先检查磁盘/)).toBeInTheDocument()
    // 再点收起
    fireEvent.click(screen.getByRole('button', { name: /深度思考/ }))
    expect(screen.queryByText(/先检查磁盘/)).toBeNull()
  })

  it('11. 流式中有 reasoning 无正文时，思考块默认展开且显示“思考中…”', () => {
    render(
      <LiveMessageRow
        message={makeAssistant({
          content: '',
          reasoning: '正在分析磁盘使用率',
          isStreaming: true,
        })}
      />
    )
    expect(screen.getByText('思考中…')).toBeInTheDocument()
    // 流式中默认展开，思考正文可见
    expect(screen.getByText('正在分析磁盘使用率')).toBeInTheDocument()
  })
})

describe('LiveMessageRow — 被用户停止的回答（调研 P0-2）', () => {
  it('cancelled 要上屏说明"这是半截"，并且不报一个假的 0 tokens', () => {
    render(<LiveMessageRow message={makeAssistant({ content: '先看一眼 df -h，然后', cancelled: true, model: 'm1' })} />)
    expect(screen.getByText(/^已停止/)).toBeInTheDocument()
    expect(screen.queryByText(/tokens/)).not.toBeInTheDocument()
  })

  it('cancelled 且真拿到了部分用量：照常显示读数，不因为它被停就藏起来', () => {
    render(
      <LiveMessageRow
        message={makeAssistant({
          content: '先看一眼 df -h',
          cancelled: true,
          model: 'm1',
          usage: { inputTokens: 900, outputTokens: 12, totalTokens: 912 },
        })}
      />
    )
    expect(screen.getByText(/^已停止/)).toBeInTheDocument()
    expect(screen.getByText(/912 tokens/)).toBeInTheDocument()
  })

  it('cancelled 又没拿到用量：要明说"没拿到实测用量"，不许留一个后头空着的 "m1 ·"', () => {
    render(<LiveMessageRow message={makeAssistant({ content: '先看一眼 df -h，然后', cancelled: true, model: 'm1' })} />)
    const row = document.querySelector('[data-dom-id="message-usage-row"]')
    expect(row, '用量那一行要存在，并且说的是"没拿到"').not.toBeNull()
    expect(row!.textContent).toContain('没拿到实测用量')
    expect(row!.textContent, '分隔符后面空着＝这一行没说完话').not.toMatch(/·\s*$/)
  })

  it('正对照：正常跑完且有用量时，那一行只报读数，不出现"没拿到"', () => {
    render(
      <LiveMessageRow
        message={makeAssistant({
          content: '看完了',
          model: 'm1',
          usage: { inputTokens: 30, outputTokens: 7, totalTokens: 37 },
        })}
      />
    )
    const row = document.querySelector('[data-dom-id="message-usage-row"]')
    expect(row).not.toBeNull()
    expect(row!.textContent).toContain('37 tokens')
    expect(row!.textContent).not.toContain('没拿到')
  })
})
