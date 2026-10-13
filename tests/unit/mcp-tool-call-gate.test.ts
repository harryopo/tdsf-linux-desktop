/**
 * MCP 派发口的工具调用闸（#88）
 *
 * 这张形状表以前只有 4 个名字，而 handleToolCall 真会收到的工具是 24+ 个
 * （ssh_execute / sandbox_execute / ssh_file_write / kb_* / log_* / monitor_*…），
 * 所以那道闸当时接不上——接上就是把整个 MCP 服务全量误拒。
 * 现在表按真实清单补齐并接进派发口，覆盖性由本测试从各域 registry 现取名字来钉：
 * 以后新增一个 MCP 工具却没登记形状，这里就红，而不是等到线上被 fail-closed 拒死才发现。
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { assessToolCall } from '../../src/main/core/command-gate'
import { LEGACY_TOOLS } from '../../src/main/services/mcp/tools/legacy-handlers'
import { SSH_TOOL_NAMES } from '../../src/main/services/mcp/tools/registry-ssh'
import { MONITOR_TOOL_NAMES } from '../../src/main/services/mcp/tools/registry-monitor'
import { LOG_TOOL_NAMES } from '../../src/main/services/mcp/tools/registry-log'
import { KNOWLEDGE_TOOL_NAMES } from '../../src/main/services/mcp/tools/registry-knowledge'
import { CREDIBILITY_TOOL_NAMES } from '../../src/main/services/mcp/tools/registry-credibility'
import { SANDBOX_TOOL_NAMES } from '../../src/main/services/mcp/tools/registry-sandbox'
import { TOOL_IDS } from '../../src/shared/llm-tool-types'

const ROOT = path.resolve(__dirname, '../..')

/** legacy 处理器 switch 里的 case 标签，从源码现取（不手抄一份清单） */
function legacyCaseLabels(): string[] {
  const src = fs.readFileSync(
    path.join(ROOT, 'src/main/services/mcp/tools/legacy-handlers.ts'),
    'utf8'
  )
  return [...src.matchAll(/case '([a-z_0-9]+)':/g)].map((m) => m[1])
}

/** 派发口可能收到的全部名字（v2 六域 + v5 注册表 + legacy） */
function allDispatchableToolNames(): string[] {
  return [
    ...SSH_TOOL_NAMES,
    ...MONITOR_TOOL_NAMES,
    ...LOG_TOOL_NAMES,
    ...KNOWLEDGE_TOOL_NAMES,
    ...CREDIBILITY_TOOL_NAMES,
    ...SANDBOX_TOOL_NAMES,
    ...Object.values(TOOL_IDS),
    ...LEGACY_TOOLS.map((t) => t.name),
  ]
}

describe('形状表覆盖全部可派发工具', () => {
  it('每个真实工具名都能被认领（没登记就会被 fail-closed 拒死）', () => {
    const names = allDispatchableToolNames()
    expect(names.length).toBeGreaterThan(20)
    const unregistered = names.filter((n) => !assessToolCall(n, {}).allow)
    expect(unregistered, `这些工具没登记形状：${unregistered.join(', ')}`).toEqual([])
  })

  it('LEGACY_TOOLS 清单与处理器里的 case 分支双向对上', () => {
    const labels = legacyCaseLabels()
    // 先证明正则真取到了东西，否则下面的比对会假绿
    expect(labels).toContain('ssh_diagnose')
    expect(labels.length).toBeGreaterThanOrEqual(4)
    // 抄漏一项会让派发口把"真被闸拦下"误报成"未知工具"，所以两个方向都要相等
    expect(LEGACY_TOOLS.map((t) => t.name).sort()).toEqual([...labels].sort())
  })
})

describe('命令与写入仍按真实参数判', () => {
  it('ssh_execute 的高危命令被拒', () => {
    const v = assessToolCall('ssh_execute', { sessionId: 's1', command: 'rm -rf /' })
    expect(v.allow).toBe(false)
    expect(v.level).toBe('block')
  })

  it('ssh_execute 的只读诊断命令放行', () => {
    expect(assessToolCall('ssh_execute', { sessionId: 's1', command: 'df -h' }).allow).toBe(true)
  })

  it('sandbox_execute 走同一套判据', () => {
    expect(assessToolCall('sandbox_execute', { command: 'mkfs.ext4 /dev/sda' }).allow).toBe(false)
    expect(assessToolCall('sandbox_execute', { command: 'ls -la' }).allow).toBe(true)
  })

  it('ssh_file_write 按受保护路径判（参数名是 remotePath）', () => {
    expect(assessToolCall('ssh_file_write', { remotePath: '/etc/passwd', content: 'x' }).allow).toBe(false)
    expect(assessToolCall('ssh_file_write', { remotePath: '/tmp/app.conf', content: 'x' }).allow).toBe(true)
  })

  it('外部客户端用全限定名时同样能认领', () => {
    expect(assessToolCall('mcp__tdsf__ssh_execute', { command: 'rm -rf /' }).allow).toBe(false)
    expect(assessToolCall('mcp__tdsf__kb_search', { query: '磁盘' }).allow).toBe(true)
  })

  it('没登记的工具仍然 fail-closed', () => {
    const v = assessToolCall('totally_new_tool', { command: 'ls' })
    expect(v.allow).toBe(false)
    expect(v.reason).toContain('未登记')
  })
})
