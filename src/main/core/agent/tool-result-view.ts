/**
 * 工具返回体 → 界面卡片要显示的那几个字段（唯一一处翻译规则）
 *
 * 为什么单独一个文件：这段映射原先写死在 supervisor 的流式循环里，
 * 而界面徽标的"几条结果"完全依赖它。放在循环里就没法单测，
 * 于是"检索工具自己报了 count"这条链路一度只能靠真机 + 真 Key 才看得到——
 * 缺一样就直接跳过，等于没人验证。
 *
 * 口径：
 * - ok：工具明确给了布尔就用它；给了非空 error 一律算失败（有些工具不填 ok）
 * - output：按 error → stdout → summary → 整个对象 JSON 的顺序取一个可读文本
 * - count：**只有工具自己在返回体里报了才有**。界面据此显示条数；
 *   没有就只显示成/败。此前是前端用正则数摘要里的 "1. 2. 3." 行，
 *   于是技能匹配、工具装配这些输出不是编号列表的卡片一律被判成"无结果"。
 */
export interface ToolResultView {
  ok: boolean
  output: string
  count?: number
}

export function toToolResultView(rawOut: unknown): ToolResultView {
  let ok = true
  let output = ''
  let count: number | undefined

  if (rawOut && typeof rawOut === 'object') {
    const obj = rawOut as Record<string, unknown>
    if (typeof obj.ok === 'boolean') ok = obj.ok
    if (typeof obj.count === 'number' && Number.isFinite(obj.count) && obj.count >= 0) {
      count = Math.trunc(obj.count)
    }
    if (typeof obj.error === 'string' && obj.error) {
      ok = false
      output = obj.error
    } else if (typeof obj.stdout === 'string') {
      output = obj.stdout || (typeof obj.stderr === 'string' ? obj.stderr : '')
    } else if (typeof obj.summary === 'string') {
      // kb_search / tutorial_search / memory_recall 的 summary 就是给人看的那段
      output = obj.summary
    } else {
      output = JSON.stringify(rawOut)
    }
  } else if (typeof rawOut === 'string') {
    output = rawOut
  }

  return count === undefined ? { ok, output } : { ok, output, count }
}
