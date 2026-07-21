/**
 * @命令模块出口
 *
 * 导出 v0.9 §4（@命令 UI 集成）的全部组件和 hook：
 * - AtCommandChip：可删除 Chip（输入框下方）
 * - AtCommandPicker：@触发选择器
 * - AtCommandBadge：消息气泡内徽章
 * - useAtCommandInjection：注入状态管理 hook
 */
export { default as AtCommandChip } from './AtCommandChip'
export type { AtCommandChipProps, AtCommandChipData } from './AtCommandChip'

export { default as AtCommandPicker } from './AtCommandPicker'
export type { AtCommandPickerProps } from './AtCommandPicker'

export { default as AtCommandBadge } from './AtCommandBadge'
export type { AtCommandBadgeProps } from './AtCommandBadge'

export { default as useAtCommandInjection } from './useAtCommandInjection'
export type { UseAtCommandInjectionResult } from './useAtCommandInjection'
