/**
 * 通用组件统一导出（v2.0 UI 规范）
 *
 * 提供空状态/错误状态/区块标题/风险标签/工具标签/图标/动画 等可复用组件
 */
export { default as EmptyState } from './EmptyState'
export type { EmptyStateProps } from './EmptyState'

export { default as ErrorState } from './ErrorState'
export type { ErrorStateProps, ErrorStateType } from './ErrorState'

export { default as SectionTitle } from './SectionTitle'
export type { SectionTitleProps } from './SectionTitle'

export { default as RiskTag } from './RiskTag'
export type { RiskTagProps, RiskLevel } from './RiskTag'

export { default as ToolTag } from './ToolTag'
export type { ToolTagProps } from './ToolTag'

// v2.0 新增：动画容器组件
export { default as FadeInUp } from './FadeInUp'
export type { FadeInUpProps } from './FadeInUp'

export { default as StaggerList } from './StaggerList'
export type { StaggerListProps } from './StaggerList'

export * as Icons from './icons'
