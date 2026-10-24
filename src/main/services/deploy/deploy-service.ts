/**
 * 部署模板服务
 *
 * 只读：列出模板、按 ID 取模板。供 AI 工具 deploy_list_templates 使用（主进程与 MCP 共用）。
 *
 * 原先的 validate/build/execute/cancel/getStatus 与 executor/plan-builder 已整删
 * （2026-10-24）：那半套执行链只有 ipc/deploy.ts 一个调用方，而界面从 2026-10 起
 * 已没有部署入口，等于一条没人能触发、却能通过 IPC 远程跑 SSH 命令的通道。
 * 模板本身仍是有用的教学资料，保留。
 */

import type { DeployTemplate } from './types'
import { ALL_TEMPLATES, getTemplateById } from './templates'

/** 部署模板服务 */
export class DeployService {
  /** 列出所有模板 */
  listTemplates(): DeployTemplate[] {
    return ALL_TEMPLATES
  }

  /** 按 ID 获取模板 */
  getTemplate(id: string): DeployTemplate | undefined {
    return getTemplateById(id)
  }
}
