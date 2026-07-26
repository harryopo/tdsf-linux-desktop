/**
 * ModelSettings 静态常量（M5 Task 6 拆分）
 *
 * 从 ModelSettings.tsx 抽取的静态数据与类型，避免主文件过长。
 * 仅包含纯静态数据，不包含运行时状态。
 */

/** 温度预设按钮 */
export interface TempPreset {
  label: string
  value: number
}

/** 对话记录行 */
export interface ConversationRow {
  time: string
  input: string
  model: string
  modelTagType: 'brand' | 'neutral'
  inputTokens: string
  outputTokens: string
  status: string
  statusType: 'success' | 'warning' | 'danger'
}

/** 测试连接日志行（动态渲染真实 llmTest 结果） */
export interface TestLogLine {
  time: string
  text: string
  tone: 'default' | 'success' | 'error'
}

/** 温度预设按钮 */
export const TEMP_PRESETS: TempPreset[] = [
  { label: '保守', value: 0.1 },
  { label: '平衡', value: 0.3 },
  { label: '创新', value: 0.7 },
]

/** 思考强度分段控件选项 */
export const THINKING_LEVELS = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
] as const

// 注：v2.3.3 起删除了 CONVERSATIONS 静态假数据。
// 真实对话记录来自 tokenRecords IPC；无数据时显示空状态而非假数据。
// 详见 ModelSettings.tsx 中 tokenRecords 的加载逻辑。
