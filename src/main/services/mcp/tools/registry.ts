/**
 * MCP Server 工具注册表（v0.5.0）
 *
 * 复用 services/llm/tools/ 目录的 5 工具（同一份业务逻辑）
 * 桥接 MCP SDK 的 server.tool() 协议
 *
 * 单一来源原则：
 * - 业务逻辑（execute）写在 services/llm/tools/*.ts
 * - MCP 这里只做"参数包装 + 返回值适配"
 *
 * 加新工具只需：
 * 1. 在 services/llm/tools/ 加实现
 * 2. 在本文件 MCP_TOOLS 加映射
 */
import { z } from 'zod'
import type { DatabaseManager } from '../../db/database'
import { executeSshExec, sshExecArgsSchema } from '../../llm/tools/ssh-exec'
import { executeTutorialSearch, tutorialSearchArgsSchema } from '../../llm/tools/tutorial-search'
import { executeDeployList, deployListArgsSchema } from '../../llm/tools/deploy-list'
import { executeProfilerRun, profilerRunArgsSchema } from '../../llm/tools/profiler-run'
import { executeMonitorGet, monitorGetArgsSchema } from '../../llm/tools/monitor-get'
import { TOOL_IDS } from '@shared/llm-tool-types'
import type { ToolCallResult } from '@shared/llm-tool-types'

/** MCP 工具调用结果格式（@modelcontextprotocol/sdk 标准） */
export interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

/** MCP 工具元数据（用于 ListToolsRequest） */
export interface McpToolMeta {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

/** MCP 工具注册项 */
interface McpToolRegistration {
  meta: McpToolMeta
  /** 适配器：把 MCP SDK 的 args 转成工具 args，调 execute，再适配为 McpToolResult */
  call: (args: Record<string, unknown>) => Promise<McpToolResult>
}

/** zod schema → MCP JSON Schema 转换器（简化版，覆盖常见类型） */
function zodToJsonSchema(schema: z.ZodTypeAny): McpToolMeta['inputSchema'] {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>
    const properties: Record<string, unknown> = {}
    const required: string[] = []
    for (const [key, value] of Object.entries(shape)) {
      const def = value._def as { typeName: string; description?: string; innerType?: z.ZodTypeAny; values?: unknown[]; defaultValue?: () => unknown }
      properties[key] = {
        type: zodTypeToJsonType(def.typeName),
        description: def.description,
      }
      // 必填判定：有 defaultValue 或 optional 不算必填
      const isOptional = def.typeName === 'ZodOptional' || def.typeName === 'ZodDefault'
      if (!isOptional) {
        required.push(key)
      }
    }
    return { type: 'object', properties, required: required.length > 0 ? required : undefined }
  }
  return { type: 'object', properties: {} }
}

function zodTypeToJsonType(typeName: string): string {
  switch (typeName) {
    case 'ZodString': return 'string'
    case 'ZodNumber': return 'number'
    case 'ZodBoolean': return 'boolean'
    case 'ZodArray': return 'array'
    case 'ZodEnum': return 'string'
    default: return 'string'
  }
}

/** 把 ToolCallResult 转成 MCP 格式 */
function toMcpResult(result: ToolCallResult): McpToolResult {
  if (!result.success) {
    return {
      content: [{ type: 'text', text: `错误: ${result.error ?? '未知错误'}` }],
      isError: true,
    }
  }
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            toolId: result.toolId,
            success: true,
            data: result.data,
            durationMs: result.durationMs,
            timestamp: result.timestamp,
          },
          null,
          2
        ),
      },
    ],
  }
}

/** 5 工具 MCP 注册（复用 LLM tool 的 execute） */
export function createMcpTools(db: DatabaseManager | null): McpToolRegistration[] {
  return [
    {
      meta: {
        name: TOOL_IDS.SSH_EXEC,
        description: '在指定 SSH session 上执行一条 Linux 命令。high 风险命令需用户审批。',
        inputSchema: zodToJsonSchema(sshExecArgsSchema),
      },
      call: async (args) => {
        const parsed = sshExecArgsSchema.safeParse(args)
        if (!parsed.success) {
          return { content: [{ type: 'text', text: `参数错误: ${parsed.error.message}` }], isError: true }
        }
        return toMcpResult(await executeSshExec(parsed.data))
      },
    },
    {
      meta: {
        name: TOOL_IDS.MONITOR_GET,
        description: '拉取远程 Linux 服务器的最新一次监控数据（CPU/内存/磁盘/网络/负载）。',
        inputSchema: zodToJsonSchema(monitorGetArgsSchema),
      },
      call: async (args) => {
        const parsed = monitorGetArgsSchema.safeParse(args)
        if (!parsed.success) {
          return { content: [{ type: 'text', text: `参数错误: ${parsed.error.message}` }], isError: true }
        }
        return toMcpResult(await executeMonitorGet(parsed.data))
      },
    },
    {
      meta: {
        name: TOOL_IDS.DEPLOY_LIST,
        description: '列出可用的 Web 部署模板（LAMP/WordPress/Nginx/Docker 等）。',
        inputSchema: zodToJsonSchema(deployListArgsSchema),
      },
      call: async (args) => {
        const parsed = deployListArgsSchema.safeParse(args)
        if (!parsed.success) {
          return { content: [{ type: 'text', text: `参数错误: ${parsed.error.message}` }], isError: true }
        }
        return toMcpResult(await executeDeployList(parsed.data))
      },
    },
    {
      meta: {
        name: TOOL_IDS.PROFILER_RUN,
        description: '对远程 Linux 服务器执行 27 项并发系统探查，返回风险报告。',
        inputSchema: zodToJsonSchema(profilerRunArgsSchema),
      },
      call: async (args) => {
        const parsed = profilerRunArgsSchema.safeParse(args)
        if (!parsed.success) {
          return { content: [{ type: 'text', text: `参数错误: ${parsed.error.message}` }], isError: true }
        }
        return toMcpResult(await executeProfilerRun(parsed.data))
      },
    },
    // tutorial_search 需要 db，没传 db 时跳过
    ...(db
      ? ([
          {
            meta: {
              name: TOOL_IDS.TUTORIAL_SEARCH,
              description: '从官方权威教程库中搜索 Linux 教程。',
              inputSchema: zodToJsonSchema(tutorialSearchArgsSchema),
            },
            call: async (args: Record<string, unknown>) => {
              const parsed = tutorialSearchArgsSchema.safeParse(args)
              if (!parsed.success) {
                return { content: [{ type: 'text', text: `参数错误: ${parsed.error.message}` }], isError: true }
              }
              return toMcpResult(await executeTutorialSearch(parsed.data, db))
            },
          } as McpToolRegistration,
        ] as McpToolRegistration[])
      : []),
  ] as McpToolRegistration[]
}
