/**
 * 工具身份表判据（AI 面板显示链路）
 *
 * 钉四件事：
 * 1. **主对话工具目录里的每个工具，界面都必须认得**。这条不是抄名单——它去读
 *    src/main/core/agent/tools/chat-tool-router.ts 的 ChatToolId 联合类型，
 *    主进程加一个工具而这里没登记，测试当场红（以前就是靠人肉同步，漏出来的
 *    就是界面上一个英文原名，甚至像 monitor_get 这种根本对不上的名字）。
 * 2. MCP 工具认得出来并显示成「server · tool」，不甩 `a__b` 这种原始串。
 * 3. 没登记过的工具**照原名显示**，绝不猜一个中文名糊弄。
 * 4. 每个类别都有进行中说法（以前所有非命令类都写死"检索中…"）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  TOOL_KIND_INPUT_LABELS,
  TOOL_KIND_LABELS,
  TOOL_KIND_RUNNING_LABELS,
  identifyTool,
  isCommandKind,
  isStructuredInput,
  type ToolKind,
} from '@renderer/components/workbench/panels/tool-identity'

/** 从主进程那份工具目录里读出 ChatToolId 联合类型的成员（不抄第二份名单） */
function chatToolIdsFromMainProcess(): string[] {
  const file = resolve(join(process.cwd(), 'src/main/core/agent/tools/chat-tool-router.ts'))
  const src = readFileSync(file, 'utf8')
  // 只取那一行：这条联合类型没有结尾分号，按分号切会一路吞到后面的注释里
  //（第一版就是这么把注释中的 'ssh' / 'db' 当成工具名读出来的）
  const hit = /^export type ChatToolId = (.+)$/m.exec(src)
  expect(hit, '找不到 ChatToolId 联合类型，主进程那份目录改名了？这条判据要跟着改').toBeTruthy()
  return [...hit![1].matchAll(/'([^']+)'/g)].map((m) => m[1])
}

describe('tool-identity', () => {
  it('主对话工具目录里的每个工具，界面都有中文名与类别', () => {
    const ids = chatToolIdsFromMainProcess()
    expect(ids.length, '一个工具都没读到，等于这条判据没在看').toBeGreaterThanOrEqual(7)
    for (const id of ids) {
      const it2 = identifyTool(id)
      expect(it2.kind, `${id} 没登记类别，会被画成通用检索行`).not.toBe('unknown')
      expect(it2.label, `${id} 没有中文名，界面会直接甩英文原名`).not.toBe(id)
    }
  })

  it('命令类才走终端命令卡', () => {
    expect(isCommandKind(identifyTool('ssh_readonly').kind)).toBe(true)
    expect(isCommandKind(identifyTool('ssh_write').kind)).toBe(true)
    expect(isCommandKind(identifyTool('kb_search').kind), '检索不是命令').toBe(false)
    expect(isCommandKind(identifyTool('sftp_read').kind), '读文件不是执行命令').toBe(false)
  })

  it('监控读数的真名是 monitor_get_data（旧表写的 monitor_get 从没命中过）', () => {
    expect(identifyTool('monitor_get_data').kind).toBe('metric')
    expect(identifyTool('monitor_get_data').label).toBe('采集监控指标')
  })

  it('MCP 工具显示成「server · tool」', () => {
    expect(identifyTool('github__create_issue')).toMatchObject({
      kind: 'mcp',
      label: 'github · create_issue',
    })
    expect(identifyTool('mcp__filesystem__read_file').label).toBe('filesystem · read_file')
  })

  it('没登记的工具照原名显示，不编中文名', () => {
    const unknown = identifyTool('brand_new_tool')
    expect(unknown.kind).toBe('unknown')
    expect(unknown.label, '猜一个中文名就是把没发生过的事写进界面').toBe('brand_new_tool')
    expect(identifyTool(undefined).label).toBe('tool')
  })

  it('每个类别都有徽标文案、进行中文案与入参标签（Record 全键，缺一个 TS 就拦）', () => {
    const kinds = Object.keys(TOOL_KIND_LABELS) as ToolKind[]
    expect(kinds.length).toBeGreaterThanOrEqual(8)
    for (const k of kinds) {
      expect(TOOL_KIND_LABELS[k], `${k} 缺徽标`).toBeTruthy()
      expect(TOOL_KIND_RUNNING_LABELS[k], `${k} 缺进行中文案`).toContain('中')
      expect(TOOL_KIND_INPUT_LABELS[k], `${k} 缺入参标签`).toBeTruthy()
    }
    // 入参标签不许全是"查询"：MCP 的入参、读文件的路径被叫成检索，是界面在替用户编动作
    expect(new Set(Object.values(TOOL_KIND_INPUT_LABELS)).size).toBeGreaterThanOrEqual(5)
  })

  it('结构化入参认得出来（MCP 的 JSON 串要按代码排版）', () => {
    expect(isStructuredInput('{"path":"/etc/hosts"}')).toBe(true)
    expect(isStructuredInput('  [{"id":1}]  ')).toBe(true)
    expect(isStructuredInput('nginx 优化'), '普通关键词不是结构化串').toBe(false)
    expect(isStructuredInput('df -h | head'), '命令不是结构化串').toBe(false)
  })
})
