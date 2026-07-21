/**
 * 部署计划构建器
 *
 * 职责：
 * - 把用户填入的变量插入到模板命令的 ${var} 占位符
 * - 对变量值做 shell 安全转义（防注入）
 * - 生成可执行的 DeployPlan（含插值后的步骤）
 */

import type { DeployTemplate, DeployStep, DeployPlan, DeployVariable } from './types'

/** shell 单引号转义：' -> '\\'' */
function escapeShellSingleQuote(value: string): string {
  return value.replace(/'/g, "'\\''")
}

/**
 * 转义变量值（用于 shell 单引号包裹的字符串）
 *
 * 规则：
 * - 包含特殊字符（空格、$、&、| 等）→ 用 '...' 包裹并转义单引号
 * - 仅字母数字下划线 → 直接使用（无需引号）
 * - 空字符串 → 使用 ''
 */
export function escapeShellValue(value: string): string {
  if (value === '' || value === null || value === undefined) {
    return "''"
  }
  // 简单字面量（数字、字母数字下划线、点、横线、斜杠、冒号、@）：直接使用
  if (/^[a-zA-Z0-9_./:@\-]+$/.test(value)) {
    return value
  }
  // 复杂值：用单引号包裹
  return `'${escapeShellSingleQuote(value)}'`
}

/**
 * 校验变量值（正则 + 必填）
 *
 * @returns 错误信息；通过返回 null
 */
export function validateVariable(variable: DeployVariable, value: string): string | null {
  // 必填
  if (variable.required && (!value || value.trim() === '')) {
    return `${variable.label}不能为空`
  }
  // 可选 + 空 → 用默认值（不校验）
  if (!value && !variable.required) {
    return null
  }
  // 正则
  if (variable.pattern) {
    try {
      const re = new RegExp(variable.pattern)
      if (!re.test(value)) {
        return `${variable.label}格式不正确`
      }
    } catch {
      // 正则不合法则跳过校验
    }
  }
  return null
}

/**
 * 批量校验所有变量
 *
 * @returns 错误信息数组（通过返回空数组）
 */
export function validateVariables(
  variables: DeployVariable[],
  values: Record<string, string>
): string[] {
  const errors: string[] = []
  for (const v of variables) {
    const value = values[v.name] ?? ''
    const err = validateVariable(v, value)
    if (err) errors.push(err)
  }
  return errors
}

/**
 * 插值命令字符串
 *
 * 把 ${var} 替换为 escapeShellValue(values[var])
 *
 * 规则：
 * - 匹配 ${name} 形式（name 为字母数字下划线）
 * - 未提供值则保留原 ${name} 不动
 */
export function interpolateCommand(command: string, values: Record<string, string>): string {
  return command.replace(/\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_match, name) => {
    const v = values[name]
    if (v === undefined) {
      // 保留原样，由 SSH 执行时报错
      return `\${${name}}`
    }
    return escapeShellValue(v)
  })
}

/**
 * 展开模板步骤为可执行计划
 */
function expandSteps(template: DeployTemplate, values: Record<string, string>): DeployStep[] {
  return template.steps.map((step) => ({
    ...step,
    command: interpolateCommand(step.command, values),
    rollback: step.rollback ? interpolateCommand(step.rollback, values) : null
  }))
}

/**
 * 构建部署计划
 *
 * @param template 部署模板
 * @param values 用户填入的变量
 * @param targetHost 目标主机（host:port）
 * @returns 部署计划
 */
export function buildPlan(
  template: DeployTemplate,
  values: Record<string, string>,
  targetHost: string
): DeployPlan {
  return {
    id: `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    templateId: template.id,
    templateName: template.name,
    targetHost,
    variables: values,
    steps: expandSteps(template, values),
    createdAt: Date.now(),
    status: 'pending'
  }
}
