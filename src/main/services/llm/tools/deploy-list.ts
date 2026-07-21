/**
 * Deploy List Templates 工具
 *
 * 列出可用的 Web 部署模板（LAMP/WordPress/Nginx/Docker 等）。
 * 复用 deployService.listTemplates()。
 *
 * 风险等级：safe（只读列表）
 */
import { z } from 'zod'
import type { ToolDefinition, ToolCallResult, ToolRiskLevel } from '@shared/llm-tool-types'
import { TOOL_IDS } from '@shared/llm-tool-types'
import { DeployService } from '../../deploy/deploy-service'

/** deploy_list_templates 参数 schema */
export const deployListArgsSchema = z.object({
  category: z.enum(['web-server', 'database', 'containers', 'all']).default('all')
    .describe('模板分类：web-server/database/containers/all'),
  difficulty: z.number().int().min(1).max(3).optional()
    .describe('难度过滤（1-3 颗星）'),
  distro: z.string().optional()
    .describe('Linux 发行版过滤（rhel/centos/ubuntu/debian）'),
})

export type DeployListArgs = z.infer<typeof deployListArgsSchema>

/** 返回数据（精简版） */
export interface DeployListData {
  category: string
  total: number
  templates: Array<{
    id: string
    name: string
    summary: string
    category: string
    difficulty: number
    estimatedMinutes: number
    stepCount: number
    source: string
    supportedDistros: string[]
    tutorialId?: string
  }>
}

/** deploy_list 工具的执行函数 */
export async function executeDeployList(args: DeployListArgs): Promise<ToolCallResult<DeployListData>> {
  const start = Date.now()
  const { category, difficulty, distro } = args

  try {
    const service = new DeployService()
    let templates = service.listTemplates()

    // 分类过滤
    if (category !== 'all') {
      const cat = category as 'web-server' | 'database' | 'containers'
      templates = templates.filter((t) => t.category === cat)
    }

    // 难度过滤
    if (difficulty !== undefined) {
      templates = templates.filter((t) => t.difficulty === difficulty)
    }

    // 发行版过滤
    if (distro) {
      const lower = distro.toLowerCase()
      templates = templates.filter((t) =>
        t.supportedDistros.some((d: string) => d.toLowerCase() === lower)
      )
    }

    return {
      toolId: TOOL_IDS.DEPLOY_LIST,
      success: true,
      data: {
        category,
        total: templates.length,
        templates: templates.map((t: typeof templates[number]) => ({
          id: t.id,
          name: t.name,
          summary: t.summary,
          category: t.category,
          difficulty: t.difficulty,
          estimatedMinutes: t.estimatedMinutes,
          stepCount: t.steps.length,
          source: t.source,
          supportedDistros: t.supportedDistros,
          tutorialId: t.tutorialId,
        })),
      },
      durationMs: Date.now() - start,
      timestamp: Date.now(),
    }
  } catch (err) {
    return {
      toolId: TOOL_IDS.DEPLOY_LIST,
      success: false,
      error: `列出部署模板失败: ${(err as Error).message}`,
      durationMs: Date.now() - start,
      timestamp: Date.now(),
    }
  }
}

/** deploy_list 工具定义 */
export const deployListTool: ToolDefinition = {
  name: TOOL_IDS.DEPLOY_LIST,
  description: '列出可用的 Web 部署模板（LAMP/WordPress/Nginx/Docker 等），可按分类/难度/发行版过滤。',
  parameters: deployListArgsSchema,
  execute: async (args: unknown) => {
    const parsed = deployListArgsSchema.safeParse(args)
    if (!parsed.success) {
      return {
        toolId: TOOL_IDS.DEPLOY_LIST,
        success: false,
        error: `参数校验失败: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
        durationMs: 0,
        timestamp: Date.now(),
      } satisfies ToolCallResult
    }
    return await executeDeployList(parsed.data)
  },
}

/** deploy_list 工具元数据 */
export const DEPLOY_LIST_META = {
  id: TOOL_IDS.DEPLOY_LIST,
  label: '部署模板列表',
  emoji: '🚀',
  description: '列出可用的 Web 部署模板',
  risk: 'safe' as ToolRiskLevel,
  requiresApproval: false,
} as const
