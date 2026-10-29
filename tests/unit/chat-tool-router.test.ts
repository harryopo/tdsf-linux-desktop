/**
 * chat-tool-router 单元测试（意图识别 + 全量挂载主对话工具）
 *
 * 覆盖：
 * - 意图命中仍挂全部可用工具（2026-10-29：不再按关键词裁剪工具集）
 * - 无命中 → 同样全量挂载
 * - 依赖过滤（SSH 未连接 → SSH 类工具不参与且记入 unavailable）
 * - promptHints 覆盖全部可用工具
 */
import { describe, it, expect } from 'vitest'
import {
  routeChatTools,
  CHAT_TOOL_CATALOG,
} from '../../src/main/core/agent/tools/chat-tool-router'

const ALL = { ssh: true, db: true }

describe('chat-tool-router 意图路由', () => {
  it('目录包含 7 个工具且 id 唯一', () => {
    // v2.9：新增 ssh_write / ssh_journal_follow / sftp_read，目录 4 → 7
    expect(CHAT_TOOL_CATALOG).toHaveLength(7)
    const ids = CHAT_TOOL_CATALOG.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('系统诊断意图 → 仍挂全部可用工具（模型按需调用）', () => {
    const r = routeChatTools('帮我看下磁盘使用率和内存占用', ALL)
    expect(r.mounted).toHaveLength(7)
    expect(r.mounted).toContain('ssh_readonly')
    expect(r.intents).toContain('系统诊断/状态查询')
    expect(r.fallbackAll).toBe(false)
  })

  it('学习/配置意图 → 挂 tutorial_search 且不隐藏其它工具', () => {
    const r = routeChatTools('给我找个 nginx 反向代理怎么配置的教程', ALL)
    expect(r.mounted).toContain('tutorial_search')
    expect(r.mounted).toHaveLength(7)
    expect(r.fallbackAll).toBe(false)
  })

  it('经验检索意图 → 挂 kb_search', () => {
    const r = routeChatTools('这种 502 报错的问题以前有没有处理经验', ALL)
    expect(r.mounted).toContain('kb_search')
  })

  it('多意图同时命中 → 工具集合仍是全部', () => {
    const r = routeChatTools('查看 nginx 服务状态，顺便找找以前类似案例', ALL)
    expect(r.mounted).toEqual(expect.arrayContaining(['ssh_readonly', 'kb_search']))
    expect(r.mounted).toHaveLength(7)
  })

  it('无明确意图 → 兜底全量挂载', () => {
    const r = routeChatTools('你好，介绍一下自己', ALL)
    expect(r.fallbackAll).toBe(true)
    expect(r.mounted).toHaveLength(7)
    expect(r.reason).toContain('未识别到明确意图')
  })

  it('空消息 → 兜底全量挂载', () => {
    const r = routeChatTools('', ALL)
    expect(r.fallbackAll).toBe(true)
    expect(r.mounted).toHaveLength(7)
  })

  it('SSH 未连接 → SSH 类工具不挂载并记入 unavailable', () => {
    const r = routeChatTools('帮我看下磁盘使用率', { ssh: false, db: true })
    expect(r.mounted).not.toContain('ssh_readonly')
    expect(r.unavailable).toEqual([
      expect.objectContaining({ id: 'ssh_readonly', missing: 'SSH 未连接' }),
      expect.objectContaining({ id: 'ssh_write', missing: 'SSH 未连接' }),
      expect.objectContaining({ id: 'ssh_journal_follow', missing: 'SSH 未连接' }),
      expect.objectContaining({ id: 'sftp_read', missing: 'SSH 未连接' }),
    ])
    // 只挂剩下的 db 类工具
    expect(r.mounted).toEqual(['kb_search', 'tutorial_search', 'memory_recall'])
  })

  it('promptHints 覆盖全部可用工具（不再随意图裁剪）', () => {
    const r = routeChatTools('帮我看下磁盘使用率和内存占用', ALL)
    expect(r.promptHints).toContain('ssh_readonly')
    expect(r.promptHints).toContain('tutorial_search')
    expect(r.promptHints).toContain('kb_search')
  })

  it('超长输入被截断但不抛错', () => {
    const r = routeChatTools(`磁盘${'x'.repeat(10000)}`, ALL)
    expect(r.mounted).toContain('ssh_readonly')
  })
})
