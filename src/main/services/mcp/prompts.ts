/**
 * MCP Prompts 注册表与读取器
 *
 * 职责：
 * - 定义 TDSF MCP Server 暴露给 Client 的 prompts 清单（list prompts）
 * - 实现 getPrompt(id, args)：根据 prompt id 返回预定义的消息序列
 *
 * 5 个 Prompt 模板（覆盖典型 Linux 运维场景）：
 * - diagnose-high-load       诊断系统高负载
 * - fix-selinux-denial       修复 SELinux 拒绝
 * - configure-samba-share    配置 Samba 共享
 * - review-security-hardening 安全加固审查
 * - explain-command          命令解释
 *
 * 调研依据：MCP 官方规范 https://modelcontextprotocol.io/docs/concepts/prompts
 * 方案书依据：v2.0 循环工程 Phase F.4
 *
 * ⚠️ MCP 协议约束：
 * - GetPromptResultSchema.messages[].role 仅支持 'user' | 'assistant'（不支持 'system'）
 * - 因此本模块内部使用 McpPromptMessage（含 'system'）方便模板编写，
 *   server.ts 在序列化时会将 'system' 消息合并到第一条 'user' 消息前置。
 */
import type { KnowledgeEntry } from '@shared/models'
import { DatabaseManager } from '../../services/db/database'
import { KnowledgeRepository } from '../../services/db/knowledge-repo'

// ============================================================================
// 类型定义
// ============================================================================

/** Prompt 参数定义（用于 prompts/list 响应中的 arguments） */
export interface McpPromptArgument {
  /** 参数名 */
  name: string
  /** 参数描述 */
  description?: string
  /** 是否必填 */
  required?: boolean
}

/** MCP Prompt 元数据（用于 prompts/list 响应） */
export interface McpPrompt {
  /** Prompt 唯一标识（同时作为 MCP 协议中的 name 字段） */
  id: string
  /** 展示名（人类可读） */
  name: string
  /** 描述 */
  description?: string
  /** 参数定义 */
  arguments?: McpPromptArgument[]
}

/** Prompt 消息内容（文本类型） */
export interface McpPromptMessage {
  /** 角色（注：'system' 在 MCP 协议层会合并到 user 前置） */
  role: 'user' | 'assistant' | 'system'
  /** 消息内容（仅支持 text 类型） */
  content: { type: 'text'; text: string }
}

// ============================================================================
// Prompts 注册表
// ============================================================================

/**
 * TDSF MCP Server 暴露的 Prompt 模板清单
 */
export const MCP_PROMPTS: McpPrompt[] = [
  {
    id: 'diagnose-high-load',
    name: '诊断高负载',
    description: '分析系统高负载根因（CPU/IO/内存/进程），输出排查步骤与修复建议',
    arguments: [
      { name: 'loadAverage', description: '平均负载（如 8.5, 7.2, 4.1）', required: true },
      { name: 'topProcess', description: 'CPU 占用最高的进程（如 PID 1234 java 200%）' }
    ]
  },
  {
    id: 'fix-selinux-denial',
    name: '修复 SELinux 拒绝',
    description: '分析 SELinux AVC 拒绝日志并生成修复方案（策略/上下文/布尔值）',
    arguments: [
      { name: 'denialLog', description: 'AVC 拒绝日志（audit.log 中的 type=AVC 行）', required: true }
    ]
  },
  {
    id: 'configure-samba-share',
    name: '配置 Samba 共享',
    description: '生成 Samba 共享配置（smb.conf 片段 + 创建目录 + SELinux/权限设置命令）',
    arguments: [
      { name: 'shareName', description: '共享名', required: true },
      { name: 'path', description: '共享路径（如 /srv/samba/share）', required: true }
    ]
  },
  {
    id: 'review-security-hardening',
    name: '安全加固审查',
    description: '审查系统安全配置并提出加固建议（SSH/防火墙/SELinux/审计/权限）'
  },
  {
    id: 'explain-command',
    name: '命令解释',
    description: '解释 Linux 命令的作用、参数、风险与替代方案',
    arguments: [
      { name: 'command', description: '要解释的 Linux 命令', required: true }
    ]
  }
]

// ============================================================================
// 读取器实现
// ============================================================================

/**
 * 获取 Prompt 消息序列
 *
 * 根据 prompt id 返回预定义的 system + user 消息序列，填入 args。
 *
 * 实现策略：
 * - system 消息：定义 Agent 角色、行为约束、输出格式
 * - user 消息：包含用户输入的参数 + 相关知识库条目（如有）
 *
 * 防御式设计：
 * - 必填参数缺失时抛 Error（让 server.ts 返回错误响应）
 * - 知识库查询失败时不阻断，仅省略相关条目
 *
 * @param id Prompt ID（如 'diagnose-high-load'）
 * @param args 参数键值对
 * @returns 消息序列（system + user）
 * @throws Error 当 prompt id 未知或必填参数缺失时
 */
export async function getPrompt(
  id: string,
  args: Record<string, string>
): Promise<McpPromptMessage[]> {
  const prompt = MCP_PROMPTS.find((p) => p.id === id)
  if (!prompt) {
    throw new Error(`未知 prompt: ${id}`)
  }

  // 校验必填参数
  if (prompt.arguments) {
    for (const arg of prompt.arguments) {
      if (arg.required && (args[arg.name] === undefined || args[arg.name] === '')) {
        throw new Error(`缺少必填参数: ${arg.name}（prompt: ${id}）`)
      }
    }
  }

  switch (id) {
    case 'diagnose-high-load':
      return buildDiagnoseHighLoad(args)
    case 'fix-selinux-denial':
      return buildFixSelinuxDenial(args)
    case 'configure-samba-share':
      return buildConfigureSambaShare(args)
    case 'review-security-hardening':
      return buildReviewSecurityHardening(args)
    case 'explain-command':
      return buildExplainCommand(args)
    default:
      throw new Error(`Prompt 未实现: ${id}`)
  }
}

// ----------------------------------------------------------------------------
// 辅助：知识库检索（可选，失败时返回空数组）
// ----------------------------------------------------------------------------

/**
 * 安全检索知识库（失败时返回空数组，不阻断 prompt 生成）
 */
function safeSearchKnowledge(query: string, limit: number = 3): KnowledgeEntry[] {
  try {
    const db = DatabaseManager.getInstance()
    if (!db.isAvailable()) {
      return []
    }
    const repo = new KnowledgeRepository(db)
    return repo.search(query, undefined, limit)
  } catch {
    return []
  }
}

/**
 * 渲染知识库条目为文本（嵌入 user 消息）
 */
function renderKnowledgeForPrompt(entries: KnowledgeEntry[]): string {
  if (entries.length === 0) {
    return ''
  }
  const lines: string[] = ['', '## 相关知识库条目', '']
  for (const entry of entries) {
    lines.push(`### ${entry.title}`)
    lines.push(`- 问题: ${entry.problem}`)
    if (entry.rootCause) {
      lines.push(`- 根因: ${entry.rootCause}`)
    }
    if (entry.commands.length > 0) {
      lines.push(`- 修复命令: ${entry.commands.join(' | ')}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

// ----------------------------------------------------------------------------
// Prompt 模板：diagnose-high-load
// ----------------------------------------------------------------------------

function buildDiagnoseHighLoad(args: Record<string, string>): McpPromptMessage[] {
  const loadAverage = args['loadAverage'] ?? ''
  const topProcess = args['topProcess'] ?? '（未提供）'
  const kbEntries = safeSearchKnowledge('高负载 CPU 负载 top')
  const kbText = renderKnowledgeForPrompt(kbEntries)

  const system: McpPromptMessage = {
    role: 'system',
    content: {
      type: 'text',
      text: `你是一名 Linux 运维专家，擅长系统性能诊断。请基于用户提供的负载数据，按以下结构输出诊断报告：

1. **负载评估**：判断当前负载是否异常（结合 CPU 核数）
2. **根因分析**：从 CPU / IO / 内存 / 进程 / 网络 5 个维度分析
3. **排查步骤**：列出具体命令（如 top / iostat / vmstat / pidstat）
4. **修复建议**：分紧急止血 / 长期优化两档
5. **验证方法**：执行后如何确认问题已解决

输出格式：Markdown，命令用 \`\`\`bash 代码块包裹。`
    }
  }

  const user: McpPromptMessage = {
    role: 'user',
    content: {
      type: 'text',
      text: `请诊断以下系统高负载问题：

- **平均负载**: ${loadAverage}
- **CPU 最高进程**: ${topProcess}
${kbText}`
    }
  }

  return [system, user]
}

// ----------------------------------------------------------------------------
// Prompt 模板：fix-selinux-denial
// ----------------------------------------------------------------------------

function buildFixSelinuxDenial(args: Record<string, string>): McpPromptMessage[] {
  const denialLog = args['denialLog'] ?? ''
  const kbEntries = safeSearchKnowledge('selinux avc denial')
  const kbText = renderKnowledgeForPrompt(kbEntries)

  const system: McpPromptMessage = {
    role: 'system',
    content: {
      type: 'text',
      text: `你是一名 SELinux 安全专家。请基于用户提供的 AVC 拒绝日志，按以下结构输出修复方案：

1. **拒绝分析**：解析 AVC 日志，识别 source / target / class / permission / scontext / tcontext
2. **修复方案**（按优先级排序）：
   - 方案 A：调整 SELinux 上下文（chcon / semanage fcontext）
   - 方案 B：开启布尔值（setsebool）
   - 方案 C：生成并加载自定义策略模块（audit2allow）
3. **推荐方案**：标注最稳妥的选项及理由
4. **回滚步骤**：如何撤销修改
5. **验证命令**：如何确认修复生效

输出格式：Markdown，命令用 \`\`\`bash 代码块包裹。`
    }
  }

  const user: McpPromptMessage = {
    role: 'user',
    content: {
      type: 'text',
      text: `请分析以下 SELinux AVC 拒绝日志并生成修复方案：

\`\`\`
${denialLog}
\`\`\`
${kbText}`
    }
  }

  return [system, user]
}

// ----------------------------------------------------------------------------
// Prompt 模板：configure-samba-share
// ----------------------------------------------------------------------------

function buildConfigureSambaShare(args: Record<string, string>): McpPromptMessage[] {
  const shareName = args['shareName'] ?? ''
  const path = args['path'] ?? ''
  const kbEntries = safeSearchKnowledge('samba 共享 smb')
  const kbText = renderKnowledgeForPrompt(kbEntries)

  const system: McpPromptMessage = {
    role: 'system',
    content: {
      type: 'text',
      text: `你是一名 Linux 文件共享服务专家。请基于用户输入的共享名与路径，生成完整的 Samba 共享配置方案：

1. **smb.conf 配置片段**：[<shareName>] 段落（含 path / browseable / writable / valid users / guest ok）
2. **目录创建与权限命令**：mkdir / chown / chmod / chcon（SELinux）
3. **Samba 用户管理命令**：smbpasswd / pdbedit（如需要）
4. **SELinux 配置**：samba_share_t 上下文 + 必要的布尔值
5. **防火墙规则**：firewalld 放行 SMB 端口（137-139, 445）
6. **验证命令**：testparm / smbclient 连接测试

输出格式：Markdown，命令用 \`\`\`bash 代码块包裹。`
    }
  }

  const user: McpPromptMessage = {
    role: 'user',
    content: {
      type: 'text',
      text: `请生成 Samba 共享配置：

- **共享名**: ${shareName}
- **路径**: ${path}
${kbText}`
    }
  }

  return [system, user]
}

// ----------------------------------------------------------------------------
// Prompt 模板：review-security-hardening
// ----------------------------------------------------------------------------

function buildReviewSecurityHardening(_args: Record<string, string>): McpPromptMessage[] {
  const system: McpPromptMessage = {
    role: 'system',
    content: {
      type: 'text',
      text: `你是一名 Linux 安全加固专家。请按以下维度审查系统安全配置并提出加固建议：

1. **SSH 加固**：是否禁用 root 登录 / 密码登录 / 默认端口 / MaxAuthTries
2. **防火墙**：firewalld/iptables 是否启用，默认区域是否合理，开放端口是否最小化
3. **SELinux**：是否 enforcing，是否有遗留 permissive 域
4. **审计**：auditd 是否运行，关键事件是否记录
5. **文件权限**：/etc/passwd / /etc/shadow / sudoers / crontab 权限
6. **内核参数**：sysctl 安全项（如禁用 IP 转发、ICMP 重定向）
7. **服务最小化**：关闭无用服务（telnet / rsh / ftp）

输出格式：Markdown，每项给出【现状检查命令】+ 【加固命令】+ 【回滚命令】。`
    }
  }

  const user: McpPromptMessage = {
    role: 'user',
    content: {
      type: 'text',
      text: `请对当前 Linux 系统进行安全加固审查，覆盖 SSH / 防火墙 / SELinux / 审计 / 文件权限 / 内核参数 / 服务最小化 7 个维度。

假设你已通过 SSH 连接到目标主机，可执行只读命令收集现状（如 ss -tlnp / getenforce / systemctl list-unit-files / sysctl -a）。`
    }
  }

  return [system, user]
}

// ----------------------------------------------------------------------------
// Prompt 模板：explain-command
// ----------------------------------------------------------------------------

function buildExplainCommand(args: Record<string, string>): McpPromptMessage[] {
  const command = args['command'] ?? ''
  const kbEntries = safeSearchKnowledge(command.split(' ')[0] ?? command)
  const kbText = renderKnowledgeForPrompt(kbEntries)

  const system: McpPromptMessage = {
    role: 'system',
    content: {
      type: 'text',
      text: `你是一名 Linux 命令专家。请按以下结构解释用户提供的命令：

1. **作用概述**：一句话说明命令用途
2. **参数解析**：逐个解释关键参数（含短参数与长参数）
3. **工作原理**：命令内部如何执行（涉及的系统调用 / 配置文件 / 服务）
4. **风险等级**：low / medium / high，并说明原因
5. **常见用法示例**：3-5 个典型场景
6. **替代方案**：功能相近但更安全 / 更现代的命令
7. **回滚方法**：如命令有副作用，说明如何撤销

输出格式：Markdown，命令示例用 \`\`\`bash 代码块包裹。`
    }
  }

  const user: McpPromptMessage = {
    role: 'user',
    content: {
      type: 'text',
      text: `请解释以下 Linux 命令：

\`\`\`bash
${command}
\`\`\`
${kbText}`
    }
  }

  return [system, user]
}
