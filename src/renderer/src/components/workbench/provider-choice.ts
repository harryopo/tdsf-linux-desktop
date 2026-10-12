/**
 * 模型选择器的取数口径（AI 对话输入框用）
 *
 * 两条规则，都是用户实测反馈逼出来的：
 * 1. 只列"真能用"的 Provider。以前 providerList(true) 会把所有启用的内置模板都拉下来，
 *    没配 Key 的在菜单里画成灰色不可点，一屏十来条读不动；现在进菜单前先过滤，
 *    一条都不剩时由 Composer 的空态把人带去设置页。
 * 2. 默认选中优先用**用户设的默认 Provider**（设置页那个默认标记），
 *    不是列表第一条 —— 原来 `list[0].id` 让设置页与对话框各说各话。
 */
import type { PersistedProviderConfig } from '@shared/agent-types'

/**
 * 有 Key 才算可用
 *
 * hasApiKey 由主进程 provider:list 运行时附加；字段缺失（老数据/别处塞进来的列表）
 * 不当成"不可用"直接抹掉，否则用户自建的条目会在界面上凭空消失。
 */
export function usableProviders(list: PersistedProviderConfig[]): PersistedProviderConfig[] {
  return list.filter((p) => p.hasApiKey !== false)
}

/**
 * 该选中哪一条：仍可用的当前选择 → 用户设的默认 → 第一个可用 → 没有就 null
 *
 * @param providers 已经过 usableProviders 过滤的列表（传原表也能用，但白过滤一遍）
 * @param current 界面当前已选 ID（可能已不可用/已不存在）
 * @param defaultId 设置页里用户标的默认 Provider ID
 */
export function resolveSelectedProvider(opts: {
  providers: PersistedProviderConfig[]
  current: string | null
  defaultId?: string | null
}): string | null {
  // 传原表也能用：这里自己再过一道过滤。"用户把默认设成了一条没配 Key 的"是真实状态，
  // 那时必须退到能用的那条，而不是选中一条发出去必然失败的。
  const providers = usableProviders(opts.providers)
  const { current, defaultId } = opts
  if (current && providers.some((p) => p.id === current)) return current
  if (defaultId) {
    const hit = providers.find((p) => p.id === defaultId)
    if (hit) return hit.id
  }
  return providers[0]?.id ?? null
}
