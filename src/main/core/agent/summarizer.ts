/**
 * L4 摘要压缩的模型调用外壳
 *
 * 背景：5 层压缩里 L4 本该"把旧对话交给模型总结成一段"，代码里两条路都写好了
 * （compactIfNeeded 的首尾提取降级 / compactIfNeededAsync 的 LLM 摘要），
 * 但生产上只有一个调用点，且它调的是**降级那条**——LLM 摘要器从来没有被接上。
 * 于是所谓"摘要压缩"一直是取开头一条和末尾各 500 字符：中段整段丢掉，
 * 用户看到的"AI 忘了半小时前那条命令"就是这么来的。
 *
 * 这里补上那个断掉的接缝，并且只补一件事：摘要器自己也要过脱敏。
 * 摘要文本会作为 system 消息留在后续每一次请求里；模型有时会把上下文里的凭据原句复述回来，
 * 不做这一道就等于给凭据开了一条"永久驻留"的通道（比一次性出站更糟）。
 */
import { redactSecrets } from './providers/redact'
import type { SummarizeFn } from './context'

/** 摘要用的系统提示：只准输出正文，别加解释（解释会占掉刚省出来的窗口） */
export const SUMMARY_SYSTEM_PROMPT =
  '你是对话历史压缩器。把给定对话压成一段中文摘要，只写事实：做过什么判断、' +
  '执行过哪些命令、得到什么结论、还有哪些未决问题。不要开场白，不要分点解释格式。'

/**
 * 把"一次模型调用"包成压缩器要的 SummarizeFn，并对输出再过一次脱敏。
 *
 * 调用失败原样抛出：compactIfNeededAsync 自己有兜底（降级到首尾提取并记日志），
 * 这里再吞一次只会让"摘要一直失败"变成查不到原因。
 */
export function makeRedactingSummarizer(
  call: (prompt: string) => Promise<string>
): SummarizeFn {
  return async (prompt: string): Promise<string> => redactSecrets(await call(prompt))
}
