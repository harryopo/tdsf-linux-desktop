/**
 * ModelSettings 静态常量（M5 Task 6 拆分）
 *
 * 从 ModelSettings.tsx 抽取的静态数据与类型，避免主文件过长。
 * 仅包含纯静态数据，不包含运行时状态。
 */

/** 可选模型卡片 */
export interface ModelOption {
  name: string
  tag: string
  tagType: 'brand' | 'default'
  desc: string
  selected: boolean
}

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

/** 默认可选模型列表（无真实 Provider 时降级使用） */
export const MODELS: ModelOption[] = [
  {
    name: 'DeepSeek-R1',
    tag: '推荐',
    tagType: 'brand',
    desc: '推理强 · 适合复杂分析',
    selected: true,
  },
  {
    name: 'GPT-4o',
    tag: '可选',
    tagType: 'default',
    desc: '通用强 · 速度快',
    selected: false,
  },
  {
    name: 'Claude-3.5',
    tag: '可选',
    tagType: 'default',
    desc: '代码强 · 上下文长',
    selected: false,
  },
]

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

/** 对话记录静态回退数据（IPC 不可用或返回空时使用） */
export const CONVERSATIONS: ConversationRow[] = [
  {
    time: '14:23',
    input: 'nginx延迟排查',
    model: 'DeepSeek-R1',
    modelTagType: 'brand',
    inputTokens: '1,245',
    outputTokens: '890',
    status: '成功',
    statusType: 'success',
  },
  {
    time: '13:45',
    input: 'MySQL连接数',
    model: 'DeepSeek-R1',
    modelTagType: 'brand',
    inputTokens: '980',
    outputTokens: '670',
    status: '成功',
    statusType: 'success',
  },
  {
    time: '12:30',
    input: '高危命令拦截',
    model: 'DeepSeek-R1',
    modelTagType: 'brand',
    inputTokens: '320',
    outputTokens: '150',
    status: '已拦截',
    statusType: 'warning',
  },
  {
    time: '11:15',
    input: 'nginx reload',
    model: 'GPT-4o',
    modelTagType: 'neutral',
    inputTokens: '450',
    outputTokens: '280',
    status: '成功',
    statusType: 'success',
  },
  {
    time: '10:08',
    input: 'Docker重启',
    model: 'DeepSeek-R1',
    modelTagType: 'brand',
    inputTokens: '680',
    outputTokens: '520',
    status: '失败',
    statusType: 'danger',
  },
]
