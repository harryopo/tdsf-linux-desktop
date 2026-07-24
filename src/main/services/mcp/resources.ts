/**
 * MCP Resources 注册表与读取器
 *
 * 职责：
 * - 定义 TDSF MCP Server 暴露给 Client 的 resources 清单（list resources）
 * - 实现 readResource(uri)：根据 URI 协议（tdsf://）分发到对应数据源
 *
 * 资源分类：
 * - tdsf://knowledge/*  知识库内容（command_skill / incident_case）
 * - tdsf://config/*     运行时配置（Agent 模式 / 风险规则）
 * - tdsf://runtime/*    运行时状态（当前 SSH 会话 / 近期决策记录）
 *
 * 调研依据：MCP 官方规范 https://modelcontextprotocol.io/docs/concepts/resources
 * 方案书依据：v2.0 循环工程 Phase F.4
 *
 * ⚠️ 设计要点：
 * - 所有数据源读取都做防御式处理（try/catch），失败时返回占位内容 + 错误说明，
 *   而不是抛异常，避免 MCP Client 因单个资源读取失败而中断会话。
 * - 不直接抛 ReadResourceNotFoundError，由 server.ts 统一处理未知 URI。
 */
import { DatabaseManager } from '../../services/db/database'
import { KnowledgeRepository } from '../../services/db/knowledge-repo'
import { DecisionRepository } from '../../services/db/decision-repo'
import { ConfigStore } from '../../services/storage/config-store'
import { getSessionRegistry } from '../../core/agent/session-registry'
import { getCurrentMode, getModeConfig, getAllModes } from '../../core/agent/modes/mode-registry'
import {
  HIGH_RISK_COMMANDS,
  HIGH_RISK_PATTERNS,
  MEDIUM_RISK_COMMANDS,
  MEDIUM_RISK_PATTERNS
} from '../../core/risk-engine-rules'
import type { KnowledgeEntry } from '@shared/models'

// ============================================================================
// 类型定义
// ============================================================================

/** MCP Resource 元数据（用于 resources/list 响应） */
export interface McpResource {
  /** 资源 URI，如 'tdsf://knowledge/linux-basics' */
  uri: string
  /** 资源名（短标识，展示用） */
  name: string
  /** 资源描述 */
  description?: string
  /** MIME 类型，如 'text/markdown' / 'application/json' */
  mimeType?: string
}

/** MCP Resource 内容（用于 resources/read 响应的单条 contents） */
export interface McpResourceContent {
  /** 资源 URI（与请求一致） */
  uri: string
  /** MIME 类型 */
  mimeType?: string
  /** 资源文本内容（MCP 资源默认以文本形式返回） */
  text: string
}

// ============================================================================
// Resources 注册表
// ============================================================================

/**
 * TDSF MCP Server 暴露的资源清单
 *
 * 共 8 个资源，覆盖 3 大类：
 * - 知识库（4）：linux-basics / selinux / samba / troubleshooting
 * - 配置（2）：agent-mode / risk-rules
 * - 运行时（2）：sessions / decisions
 */
export const MCP_RESOURCES: McpResource[] = [
  // ── 知识库资源 ──────────────────────────────────────────────────────────
  {
    uri: 'tdsf://knowledge/linux-basics',
    name: 'Linux 基础',
    description: 'Linux 基础命令与操作技能知识库（command_skill 类型）',
    mimeType: 'text/markdown'
  },
  {
    uri: 'tdsf://knowledge/selinux',
    name: 'SELinux 安全',
    description: 'SELinux 故障案例与排查方法（incident_case 类型）',
    mimeType: 'text/markdown'
  },
  {
    uri: 'tdsf://knowledge/samba',
    name: 'Samba 服务',
    description: 'Samba 服务配置与故障案例',
    mimeType: 'text/markdown'
  },
  {
    uri: 'tdsf://knowledge/troubleshooting',
    name: '故障排查手册',
    description: '综合故障排查案例库（incident_case 类型）',
    mimeType: 'text/markdown'
  },

  // ── 配置资源 ────────────────────────────────────────────────────────────
  {
    uri: 'tdsf://config/agent-mode',
    name: 'Agent 模式配置',
    description: '当前 Agent 模式（chat/ask/plan/code/debug）及所有可用模式配置',
    mimeType: 'application/json'
  },
  {
    uri: 'tdsf://config/risk-rules',
    name: '风险规则配置',
    description: '命令风险评估规则（高危命令集 + 中危命令集 + 模式匹配规则）',
    mimeType: 'application/json'
  },

  // ── 运行时资源 ──────────────────────────────────────────────────────────
  {
    uri: 'tdsf://runtime/sessions',
    name: '当前 SSH 会话',
    description: '当前所有活跃的 Agent 会话（含 sessionId / kind / provider / 启动时间）',
    mimeType: 'application/json'
  },
  {
    uri: 'tdsf://runtime/decisions',
    name: '近期决策记录',
    description: '最近 20 条 Agent 决策卡片（按时间倒序）',
    mimeType: 'application/json'
  }
]

// ============================================================================
// 读取器实现
// ============================================================================

/**
 * 读取 MCP 资源
 *
 * 根据 URI 协议（tdsf://）路由到对应数据源：
 * - tdsf://knowledge/<topic>     → KnowledgeRepository 搜索相关条目，渲染为 Markdown
 * - tdsf://config/<key>          → 直接读取对应配置源
 * - tdsf://runtime/<key>         → 直接读取运行时状态
 *
 * 防御式设计：所有分支均 try/catch，失败返回占位内容（不抛异常）。
 *
 * @param uri 资源 URI，必须以 'tdsf://' 开头
 * @returns 资源内容（含 mimeType + text）
 * @throws Error 当 URI 不以 'tdsf://' 开头或路径不匹配任何已知资源时
 */
export async function readResource(uri: string): Promise<McpResourceContent> {
  if (!uri.startsWith('tdsf://')) {
    throw new Error(`不支持的 URI 协议: ${uri}（仅支持 tdsf://）`)
  }

  const path = uri.slice('tdsf://'.length) // 如 'knowledge/linux-basics'
  const [category, ...rest] = path.split('/')
  const subKey = rest.join('/')

  switch (category) {
    case 'knowledge':
      return readKnowledgeResource(uri, subKey)
    case 'config':
      return readConfigResource(uri, subKey)
    case 'runtime':
      return readRuntimeResource(uri, subKey)
    default:
      throw new Error(`未知资源分类: ${category}（URI: ${uri}）`)
  }
}

// ----------------------------------------------------------------------------
// 知识库资源读取
// ----------------------------------------------------------------------------

/**
 * 知识库主题 → 查询关键词映射
 *
 * 由于知识库采用关键词检索（Jaccard 相似度），需要为每个主题预定义查询词。
 */
const KNOWLEDGE_TOPIC_QUERIES: Record<string, string> = {
  'linux-basics': 'linux 基础 命令 文件 权限 进程',
  'selinux': 'selinux avc denial 上下文 标签',
  'samba': 'samba 共享 smb 配置',
  'troubleshooting': '故障 排查 诊断 高负载 网络'
}

/**
 * 读取知识库资源
 *
 * 实现：根据主题从 KnowledgeRepository 检索，渲染为 Markdown 文档。
 * 数据库不可用或无匹配时，返回占位 Markdown（标注 TODO 真实集成点）。
 */
function readKnowledgeResource(uri: string, topic: string): McpResourceContent {
  const query = KNOWLEDGE_TOPIC_QUERIES[topic] ?? topic
  const title = KNOWLEDGE_TOPIC_QUERIES[topic]
    ? topic.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    : topic

  try {
    const db = DatabaseManager.getInstance()
    if (!db.isAvailable()) {
      return {
        uri,
        mimeType: 'text/markdown',
        text: renderKnowledgePlaceholder(title, query, '数据库未初始化（DatabaseManager.isAvailable()=false）')
      }
    }

    const repo = new KnowledgeRepository(db)
    let entries = repo.search(query, undefined, 10)

    // P0-3 修复：关键词无命中时，用热门条目兜底，避免返回 TODO 占位内容。
    if (entries.length === 0) {
      entries = repo.getHot(5)
    }

    if (entries.length === 0) {
      return {
        uri,
        mimeType: 'text/markdown',
        text: renderKnowledgePlaceholder(title, query, '知识库暂无条目，请导入教程种子或执行自动归档')
      }
    }

    return {
      uri,
      mimeType: 'text/markdown',
      text: renderKnowledgeMarkdown(title, query, entries)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      uri,
      mimeType: 'text/markdown',
      text: renderKnowledgePlaceholder(title, query, `读取失败: ${msg}`)
    }
  }
}

/**
 * 渲染知识库 Markdown（成功时）
 */
function renderKnowledgeMarkdown(title: string, query: string, entries: KnowledgeEntry[]): string {
  const lines: string[] = [
    `# ${title}`,
    '',
    `> 查询关键词: \`${query}\` · 命中 ${entries.length} 条`,
    ''
  ]
  for (const entry of entries) {
    lines.push(`## ${entry.title}`)
    lines.push('')
    lines.push(`- **类型**: ${entry.type}`)
    lines.push(`- **问题**: ${entry.problem}`)
    if (entry.rootCause) {
      lines.push(`- **根因**: ${entry.rootCause}`)
    }
    if (entry.commands.length > 0) {
      lines.push(`- **修复命令**:`)
      for (const cmd of entry.commands) {
        lines.push(`  \`\`\`bash`)
        lines.push(`  ${cmd}`)
        lines.push(`  \`\`\``)
      }
    }
    if (entry.verification) {
      lines.push(`- **验证**: ${entry.verification}`)
    }
    if (entry.tags.length > 0) {
      lines.push(`- **标签**: ${entry.tags.join(', ')}`)
    }
    lines.push(`- **成功率**: ${(entry.successRate * 100).toFixed(0)}% · **使用次数**: ${entry.useCount}`)
    lines.push('')
  }
  return lines.join('\n')
}

/**
 * 渲染知识库占位 Markdown（无数据 / 失败时）
 *
 * 当知识库确实为空时返回友好提示，不再使用 TODO 占位文案。
 */
function renderKnowledgePlaceholder(title: string, query: string, reason: string): string {
  return [
    `# ${title}`,
    '',
    `> 知识库资源`,
    '',
    `**查询关键词**: \`${query}\``,
    '',
    `**当前状态**: ${reason}`,
    '',
    `**可用操作**:`,
    `- 导入 Linux 教程种子数据`,
    `- 执行运维决策并启用每日自动归档`,
    `- 通过知识库页面手动添加条目`,
    ''
  ].join('\n')
}

// ----------------------------------------------------------------------------
// 配置资源读取
// ----------------------------------------------------------------------------

/**
 * 读取配置资源
 */
function readConfigResource(uri: string, key: string): McpResourceContent {
  switch (key) {
    case 'agent-mode':
      return readAgentModeConfig(uri)
    case 'risk-rules':
      return readRiskRulesConfig(uri)
    default:
      throw new Error(`未知配置资源: ${key}（URI: ${uri}）`)
  }
}

/**
 * 读取 Agent 模式配置
 *
 * 返回：当前模式 + 所有可用模式的配置（含 systemPrompt 摘要）
 */
function readAgentModeConfig(uri: string): McpResourceContent {
  try {
    const currentMode = getCurrentMode()
    const currentConfig = getModeConfig(currentMode)
    const allModes = getAllModes().map((mode) => {
      const cfg = getModeConfig(mode)
      return {
        mode: cfg.mode,
        displayName: cfg.displayName,
        description: cfg.description,
        allowedTools: cfg.allowedTools,
        canWriteFiles: cfg.canWriteFiles,
        canExecuteCommands: cfg.canExecuteCommands,
        canModifySandbox: cfg.canModifySandbox
      }
    })

    const payload = {
      currentMode,
      currentConfig: {
        mode: currentConfig.mode,
        displayName: currentConfig.displayName,
        description: currentConfig.description,
        allowedTools: currentConfig.allowedTools,
        canWriteFiles: currentConfig.canWriteFiles,
        canExecuteCommands: currentConfig.canExecuteCommands,
        canModifySandbox: currentConfig.canModifySandbox
      },
      allModes,
      mcpServerConfig: ConfigStore.getMcpConfig()
    }

    return {
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(payload, null, 2)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      uri,
      mimeType: 'application/json',
      text: JSON.stringify({ error: `读取 Agent 模式配置失败: ${msg}` }, null, 2)
    }
  }
}

/**
 * 读取风险规则配置
 *
 * 返回：高危命令集 + 中危命令集 + 模式匹配规则
 * 注意：HIGH_RISK_PATTERNS / MEDIUM_RISK_PATTERNS 含函数（matchArgs），
 * 不可直接序列化，需要提取可序列化字段（command + 描述）。
 */
function readRiskRulesConfig(uri: string): McpResourceContent {
  try {
    const payload = {
      highRiskCommands: Array.from(HIGH_RISK_COMMANDS),
      mediumRiskCommands: Array.from(MEDIUM_RISK_COMMANDS),
      highRiskPatterns: HIGH_RISK_PATTERNS.map((p) => ({
        command: p.command,
        // matchArgs 是函数，不可序列化，仅保留命令名
        description: `命令 ${p.command} 的危险参数模式匹配规则`
      })),
      mediumRiskPatterns: MEDIUM_RISK_PATTERNS.map((p) => ({
        command: p.command,
        description: `命令 ${p.command} 的中危参数模式匹配规则`
      })),
      summary: {
        highRiskCommandCount: HIGH_RISK_COMMANDS.size,
        mediumRiskCommandCount: MEDIUM_RISK_COMMANDS.size,
        highRiskPatternCount: HIGH_RISK_PATTERNS.length,
        mediumRiskPatternCount: MEDIUM_RISK_PATTERNS.length
      }
    }

    return {
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(payload, null, 2)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      uri,
      mimeType: 'application/json',
      text: JSON.stringify({ error: `读取风险规则配置失败: ${msg}` }, null, 2)
    }
  }
}

// ----------------------------------------------------------------------------
// 运行时资源读取
// ----------------------------------------------------------------------------

/**
 * 读取运行时资源
 */
function readRuntimeResource(uri: string, key: string): McpResourceContent {
  switch (key) {
    case 'sessions':
      return readSessionsResource(uri)
    case 'decisions':
      return readDecisionsResource(uri)
    default:
      throw new Error(`未知运行时资源: ${key}（URI: ${uri}）`)
  }
}

/**
 * 读取当前 SSH 会话资源
 *
 * 数据源：SessionRegistry.list()（仅主进程内部可读，含 agent:chat / claude-sdk:stream / sandbox:execute 等）
 */
function readSessionsResource(uri: string): McpResourceContent {
  try {
    const registry = getSessionRegistry()
    const sessions = registry.list().map((s) => ({
      sessionId: s.sessionId,
      correlationId: s.correlationId,
      kind: s.kind,
      providerId: s.providerId,
      model: s.model,
      startedAt: s.startedAt,
      cancelled: s.cancelled
    }))

    const payload = {
      count: sessions.length,
      sessions
    }

    return {
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(payload, null, 2)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      uri,
      mimeType: 'application/json',
      text: JSON.stringify({ error: `读取当前会话失败: ${msg}` }, null, 2)
    }
  }
}

/**
 * 读取近期决策记录资源
 *
 * 数据源：DecisionRepository.list(1, 20)（按时间倒序，最近 20 条）
 */
function readDecisionsResource(uri: string): McpResourceContent {
  try {
    const db = DatabaseManager.getInstance()
    if (!db.isAvailable()) {
      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({ error: '数据库未初始化，无法读取决策记录' }, null, 2)
      }
    }

    const repo = new DecisionRepository(db)
    const cards = repo.list(1, 20).map((c) => ({
      id: c.id,
      problem: c.problem,
      hypothesis: c.hypothesis,
      confidence: c.confidence,
      riskLevel: c.risk.level,
      fixCommand: c.fixCommand,
      status: c.status,
      timestamp: c.timestamp
    }))

    const payload = {
      count: cards.length,
      decisions: cards
    }

    return {
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(payload, null, 2)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      uri,
      mimeType: 'application/json',
      text: JSON.stringify({ error: `读取近期决策记录失败: ${msg}` }, null, 2)
    }
  }
}
