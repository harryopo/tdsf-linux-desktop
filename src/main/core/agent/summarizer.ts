/**
 * L4 摘要压缩的模型调用外壳
 *
 * 背景：5 层压缩里 L4 本该"把旧对话交给模型总结成一段"，代码里两条路都写好了
 * （compactIfNeeded 的首尾提取降级 / compactIfNeededAsync 的 LLM 摘要），
 * 但生产上只有一个调用点，且它调的是**降级那条**——LLM 摘要器从来没有被接上。
 * 于是所谓"摘要压缩"一直是取开头一条和末尾各 500 字符：中段整段丢掉，
 * 用户看到的"AI 忘了半小时前那条命令"就是这么来的。
 *
 * 这里补上那个断掉的接缝，并且只补两件事：
 * 1. 摘要器自己也要过脱敏。摘要文本会作为 system 消息留在后续每一次请求里；模型有时会把
 *    上下文里的凭据原句复述回来，不做这一道就等于给凭据开一条"永久驻留"的通道。
 * 2. **同一段提示词只让模型算一次**（2026-10-28，#255）。压缩提示词取的是被丢弃段的
 *    **最前面** 12000 字符，老对话超过这个长度后每轮的提示词逐字相同——不去重就每轮白付一次。
 *    缓存表是模块级的：工厂每次请求都会重新调用，但表要跨请求才有意义。
 */
import { redactSecrets } from './providers/redact'
import { createMemoizedSummarizer } from './summary-cache'
import type { SummarizeFn } from './context'

/** 摘要用的系统提示：只准输出正文，别加解释（解释会占掉刚省出来的窗口） */
export const SUMMARY_SYSTEM_PROMPT =
  '你是对话历史压缩器。把给定对话压成一段中文摘要，只写事实：做过什么判断、' +
  '执行过哪些命令、得到什么结论、还有哪些未决问题。不要开场白，不要分点解释格式。'

/** 模块级缓存表：跨请求共享，才能把"每轮同一段摘要"压成一次 */
const summaryCache = new Map<string, string>()

/**
 * 把"一次模型调用"包成压缩器要的 SummarizeFn：输出再过一次脱敏，并按内容去重。
 *
 * 调用失败原样抛出：compactIfNeededAsync 自己有兜底（降级到首尾提取并记日志），
 * 这里再吞一次只会让"摘要一直失败"变成查不到原因。
 *
 * @param cacheNamespace 一般传 Provider id：不同模型算出的摘要不互相顶替
 */
export function makeRedactingSummarizer(
  call: (prompt: string) => Promise<string>,
  opts: { cacheNamespace?: string } = {}
): SummarizeFn {
  // 只在显式给了 namespace 时才用模块级共享表：没给就各自一份，
  // 避免"同一个进程里两个不相干的摘要器莫名其妙共用缓存"（测试也靠这条隔离）
  return createMemoizedSummarizer(
    async (prompt: string) => redactSecrets(await call(prompt)),
    opts.cacheNamespace
      ? { cache: summaryCache, namespace: opts.cacheNamespace }
      : undefined
  )
}
