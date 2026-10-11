/**
 * 工作台三栏的默认宽度（黄金分割）与持久化校验
 *
 * 为什么默认按 φ 切而不是写死像素：
 * VS Code / Trae / Cursor 的侧栏都是"内容区优先"——窗口一大，主视角（终端与编辑器）
 * 应该跟着变大，两侧停靠格只按占比长。写死 220/440 在 1080p 上合适，
 * 拉到 2K 就变成两边瘦、中间空。所以首帧用容器实宽算：
 *   左栏 = 宽度 × 0.16（夹在 200~300，太窄放不下文件名，太宽抢主区）
 *   右栏 = 余下空间 ÷ φ（≈ 38.2%），中间 = 余下 × 61.8% —— 中间∶右栏 = φ∶1
 * 之后窗口再变，两侧按**像素**保持（groupResizeBehavior），增量全部给中间，
 * 这才是 IDE 的手感：拖大窗口不会把 AI 面板一起撑宽。
 */
export const GOLDEN_RATIO = (1 + Math.sqrt(5)) / 2

/** 分隔条命中区宽度（与 ResizeBar 的 w-1 对齐） */
export const SEPARATOR_PX = 4

/** 各栏的硬下限：低于这些值界面就没法用了 */
export const TREE_MIN = 200
export const TREE_MAX = 300
export const AI_MIN = 320
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
 * 按容器实宽算三栏默认宽度。
 *
 * 关掉的栏不占宽度，余量重新按 φ 切——只开一栏时中间∶另一栏仍是 φ∶1，
 * 不会出现"关掉文件树，AI 面板突然变窄"这种跳动。
 */
export function defaultWidths(width: number, open: PanelOpenState): PanelWidths {
  const separators = (open.tree ? 1 : 0) + (open.ai ? 1 : 0)
  const tree = open.tree ? clamp(Math.round(width * 0.16), TREE_MIN, TREE_MAX) : 0
  const available = Math.max(0, width - tree - separators * SEPARATOR_PX)
  if (!open.ai) return { tree, editor: available, ai: 0 }
  const aiIdeal = Math.round(available / (1 + GOLDEN_RATIO))
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
