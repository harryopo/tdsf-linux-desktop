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
 * 6. stepState 工作流步骤条 + 底部导航按钮（onNavigate）
 *
 * 关键决策：
 * - AgentMessage 直接构造纯数据对象，不依赖 zustand store（组件仅消费 props）
 * - 非 shell 语系代码块（```text）不应被提取为命令（v2.4 命令提取失控回归）
 */
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type {} from '@testing-library/jest-dom'

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
    expect(screen.getByText('检测到 1 条命令：')).toBeInTheDocument()
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

  it('7.1 检索类 toolEvents（kb_search）渲染折叠行：完成后默认收起，展开见查询与结果（v2.5）', () => {
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
              output: '1. [KB-021] Nginx连接数优化指南\n2. [KB-088] P99延迟排查',
            },
          ],
        })}
      />
    )
    // 折叠行：中文名 + 条数徽章；不得出现终端 $ 提示符
    expect(screen.getByText('检索知识库')).toBeInTheDocument()
    expect(screen.getByText('2 条匹配')).toBeInTheDocument()
    expect(screen.queryByText('$')).toBeNull()
    // 完成后默认收起：结果不可见
    expect(screen.queryByText(/KB-021/)).toBeNull()
    // 展开后可见查询与结果
    fireEvent.click(screen.getByRole('button', { name: /检索知识库/ }))
    expect(screen.getByText(/查询: /)).toBeInTheDocument()
    expect(screen.getByText(/KB-021/)).toBeInTheDocument()
  })

  it('7.2 检索无结果时徽章显示“无结果”', () => {
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
              output: '未在知识库找到与"磁盘"相关的条目',
            },
          ],
        })}
      />
    )
    expect(screen.getByText('无结果')).toBeInTheDocument()
  })

  it('8. stepState 渲染 7 步工作流标签；底部按钮触发 onNavigate', () => {
    const onNavigate = vi.fn()
    render(
      <LiveMessageRow
        message={makeAssistant({
          stepState: {
            currentStep: 'reason',
            completedSteps: ['collect', 'analyze'],
            stepDetails: {
              collect: '', analyze: '', reason: '', check: '',
              confirm: '', execute: '', verify: '',
            },
            waitingForConfirmation: false,
            decisionCard: null,
          },
        })}
        onNavigate={onNavigate}
      />
    )
    // 7 步标签全部渲染
    for (const label of ['采集', '分析', '推理', '检查', '确认', '执行', '验证']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
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
