/**
 * risk-types — 风险规则相关类型与常量
 *
 * 从 RiskSettings.tsx 提取，供 RiskSettings.tsx 和 RiskRuleModal.tsx 共享，
 * 避免组件间的循环依赖。
 */
export type RiskLevel = 'none' | 'low' | 'medium' | 'high' | 'critical' | 'custom'
export type RiskAction = 'allow' | 'notify' | 'confirm' | 'block' | 'custom'

export interface RiskRule {
  id: string
  pattern: string
  level: RiskLevel
  action: RiskAction
}

export const INITIAL_RULES: RiskRule[] = [
  { id: 'r1', pattern: 'rm -rf *', level: 'critical', action: 'block' },
  { id: 'r2', pattern: 'chmod 777', level: 'high', action: 'confirm' },
  { id: 'r3', pattern: 'systemctl restart', level: 'medium', action: 'notify' },
  { id: 'r4', pattern: 'cat /var/log/*', level: 'low', action: 'allow' },
  { id: 'r5', pattern: 'grep / ps / ls', level: 'none', action: 'allow' },
  { id: 'r6', pattern: '自定义正则', level: 'custom', action: 'custom' },
]

export const LEVEL_LABEL: Record<RiskLevel, string> = {
  none: '无',
  low: '低',
  medium: '中',
  high: '高',
  critical: '极高',
  custom: '可配置',
}

export const ACTION_LABEL: Record<RiskAction, string> = {
  allow: '放行',
  notify: '通知',
  confirm: '确认',
  block: '拦截',
  custom: '可配置',
}

/** 风险等级标签样式（彩色背景 + 白字，对应设计稿 set-risk-tag--*） */
export const LEVEL_TAG_CLASS: Record<RiskLevel, string> = {
  critical: 'set-risk-tag--critical',
  high: 'set-risk-tag--high',
  medium: 'set-risk-tag--medium',
  low: 'set-risk-tag--low',
  none: 'set-risk-tag--none',
  custom: '',
}

/** 动作标签样式（灰底 + 边框，对应设计稿 set-action-tag） */
export const ACTION_TAG_CLASS = 'set-action-tag'
