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

/**
 * 温度预设按钮（点一下直接填进数字框，不再有可拖动滑块）
 *
 * 运维分析建议落在「精确/均衡」之间：值太低回答死板，太高容易编造命令。
 */
export const TEMP_PRESETS: TempPreset[] = [
  { label: '精确', value: 0.1 },
  { label: '均衡', value: 0.3 },
  { label: '发散', value: 0.7 },
]

// 思考档位不再放在这里：它随模型能力变化，由 thinking-capabilities.ts 的
// resolveThinkingCapability() 按"Provider 类型 + 模型名白名单"给出可用档位，
// 判据见 tests/unit/thinking-capabilities.test.ts。

// 注：v2.3.3 起删除了 CONVERSATIONS 静态假数据。
// 真实对话记录来自 tokenRecords IPC；无数据时显示空状态而非假数据。
// 详见 ModelSettings.tsx 中 tokenRecords 的加载逻辑。
