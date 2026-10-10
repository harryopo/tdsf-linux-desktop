/**
 * 窗口几何收口（纯函数，不 import electron，便于单测）
 *
 * 为什么需要：BrowserWindow 的 width/height 是**外框**，外框里还有系统标题栏与边框
 * （175% 缩放下实测 14×63px）。原先按"外框 = 工作区尺寸"开窗口，主窗口就压过任务栏
 * 1px；再级联出第二窗口时整体右下移 36px，实测内容底边超工作区 26~39px——
 * 正好把 24px 状态栏和 AI 输入框下沿推到屏幕外（用户报"放大后下面的内容看不见"）。
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 把窗口收进工作区（任务栏之外），整框可见。
 *
 * 两步，顺序不能反：
 * ① 尺寸封顶——余量按"请求位置到工作区右/下边界"算，级联偏移多少就扣多少，
 *    这样第二窗口既保住错位可见，又不会顶出屏幕；再按 minSize 兜住下限。
 * ② 位置夹回——用①定稿后的尺寸算可活动区间；窗口和工作区一样大时区间退化为一点，
 *    用 max(0, …) 防止出现"上界小于下界"的负区间把窗口反向推出屏幕。
 */
export function fitRectToWorkArea(workArea: Rect, rect: Rect, minSize?: { width: number; height: number }): Rect {
  const roomRight = Math.max(0, workArea.x + workArea.width - rect.x)
  const roomBottom = Math.max(0, workArea.y + workArea.height - rect.y)
  const width = Math.max(minSize?.width ?? 0, Math.min(rect.width, roomRight))
  const height = Math.max(minSize?.height ?? 0, Math.min(rect.height, roomBottom))
  const maxX = workArea.x + Math.max(0, workArea.width - width)
  const maxY = workArea.y + Math.max(0, workArea.height - height)
  return {
    ...rect,
    width,
    height,
    x: Math.min(Math.max(rect.x, workArea.x), maxX),
    y: Math.min(Math.max(rect.y, workArea.y), maxY),
  }
}
