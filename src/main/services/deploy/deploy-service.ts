/**
 * 部署服务 - 顶层单例
 *
 * 提供：
 * - 列出所有模板
 * - 根据模板 + 变量构建计划
 * - 执行计划（含日志推送）
 * - 取消执行
 */

import { BrowserWindow } from 'electron'
import type { DeployTemplate, DeployPlan, DeployResult } from './types'
import { ALL_TEMPLATES, getTemplateById } from './templates'
import { buildPlan, validateVariables } from './plan-builder'
import { executePlan, cancelPlan, getPlanState } from './executor'

/** 部署服务 */
export class DeployService {
  /**
   * 列出所有模板
   */
  listTemplates(): DeployTemplate[] {
    return ALL_TEMPLATES
  }

  /**
   * 按 ID 获取模板
   */
  getTemplate(id: string): DeployTemplate | undefined {
    return getTemplateById(id)
  }

  /**
   * 校验变量
   *
   * @returns 错误信息数组（通过返回空数组）
   */
  validate(templateId: string, values: Record<string, string>): string[] {
    const tpl = this.getTemplate(templateId)
    if (!tpl) return [`模板 ${templateId} 不存在`]
    return validateVariables(tpl.variables, values)
  }

  /**
   * 构建计划
   */
  build(
    templateId: string,
    values: Record<string, string>,
    targetHost: string
  ): { plan?: DeployPlan; errors: string[] } {
    const tpl = this.getTemplate(templateId)
    if (!tpl) {
      return { errors: [`模板 ${templateId} 不存在`] }
    }
    const errs = validateVariables(tpl.variables, values)
    if (errs.length > 0) {
      return { errors: errs }
    }
    const plan = buildPlan(tpl, values, targetHost)
    return { plan, errors: [] }
  }

  /**
   * 执行计划
   */
  async execute(
    plan: DeployPlan,
    sessionId: string,
    window: BrowserWindow
  ): Promise<DeployResult> {
    return executePlan(plan, sessionId, window)
  }

  /**
   * 取消执行
   */
  cancel(planId: string): boolean {
    return cancelPlan(planId)
  }

  /**
   * 获取计划状态
   */
  getStatus(planId: string) {
    return getPlanState(planId)
  }
}
