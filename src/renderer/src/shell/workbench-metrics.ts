/**
 * 工作台三栏的默认宽度（终端优先）与持久化校验
 *
 * 2026-10-16 用户改口径：**默认终端最大化**。此前中间∶右栏 = φ∶1（AI 格吃掉 38%），
 * 首屏最显眼的是右侧聊天而不是命令行，与"这是个终端优先的运维工具"的定位相反。
 * 现在右侧停靠格按**像素**给默认宽（400px，够读工具卡与 diff），余量全给中间：
 *   左栏 = 宽度 × 0.16（夹在 200~300，太窄放不下文件名，太宽抢主区）
 *   右栏 = 400px（窄屏按占比与主区下限双重收敛）
 *   中间 = 剩下的全部
 * 窗口变大时两侧按像素保持（groupResizeBehavior），增量全部给中间——
 * 这条没变，变的只是首屏不再按黄金分割切。
 */
export const SEPARATOR_PX = 4

/** AI 停靠格的默认像素宽（终端优先：主区吃满其余空间） */
export const AI_DEFAULT_PX = 400

/** 各栏的硬下限：低于这些值界面就没法用了 */
export const TREE_MIN = 200
export const TREE_MAX = 300
export const AI_MIN = 320
/** 右栏再宽也不许超过可用宽度的这个比例（否则终端被挤成一条） */
export const AI_MAX_SHARE = 0.34
/** 中间主区至少留这么多，否则终端一行都放不下 */
export const EDITOR_MIN = 420

export interface PanelOpenState {
  tree: boolean
  ai: boolean
}

export interface PanelWidths {
  tree: number
  editor: number
  ai: number
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max)
}

/**
 * 按容器实宽算三栏默认宽度（终端优先：右栏按像素，中间吃满余量）。
 *
 * 关掉的栏不占宽度；窄屏下右栏先让位给主区下限（终端不能先没），
 * 再往下就按 AI_MIN 收敛，最后才允许缩到下限以下。
 */
export function defaultWidths(width: number, open: PanelOpenState): PanelWidths {
  const separators = (open.tree ? 1 : 0) + (open.ai ? 1 : 0)
  const tree = open.tree ? clamp(Math.round(width * 0.16), TREE_MIN, TREE_MAX) : 0
  const available = Math.max(0, width - tree - separators * SEPARATOR_PX)
  if (!open.ai) return { tree, editor: available, ai: 0 }
  const aiIdeal = Math.min(AI_DEFAULT_PX, Math.round(available * AI_MAX_SHARE))
  // 主区下限优先于右栏下限：挤无可挤时缩右栏，终端不能先没
  const aiCeil = Math.max(0, available - EDITOR_MIN)
  const ai = Math.min(Math.max(aiIdeal, AI_MIN), aiCeil)
  return { tree, editor: available - ai, ai }
}

/** 存进 localStorage 的布局：只认正有限数，脏值整条丢掉（旧版本残留/手改过） */
export function sanitizeSavedLayout(raw: unknown): Record<string, number> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const clean: Record<string, number> = {}
  for (const [id, size] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof size === 'number' && Number.isFinite(size) && size > 0) clean[id] = size
  }
  return clean
}
