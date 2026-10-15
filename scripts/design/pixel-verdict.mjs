/**
 * 像素判据（2026-10-15 全维度系统审查 F5）——纯函数，供 ui-audit.mjs 调用，也被单测直接证伪。
 *
 * 为什么审计之外还要看像素：ui-audit 的其余判据全读计算样式，读不出"导航根本没发生"。
 * 生产包卡在启动页那次（任务 R0），DOM 量测照样能拿到一份自洽的样式表，而截图张张相同——
 * 当时这件事靠人翻图看出来。搬进脚本后它自己说话，且这份逻辑能在单测里注入假读数验证。
 *
 * 三条各自躲开的假阳性：
 *   - 只比"模块页"那一组：弹窗、右键菜单、启动页早晚彼此长得像，不在这条射程里
 *   - 空白帧按字节数判：真件最小一张 24KB，下限压到 12KB，不会误伤简屏
 *   - --no-shots 时明确记"未跑"，不把没测当通过（沿用本仓"0 条不等于干净"的口径）
 */

export const PIXEL_LIMITS = {
  /** 本轮至少写出多少张（现量 26 张：18 模块页 + 启动 2 + 额外视口 2 + 规则表/弹窗/菜单 4） */
  shotMin: 18,
  /** 模块页至少多少张（路由表 18 页，留中途换页失败余量） */
  pageShotMin: 12,
  /** 小于这个字节数当空白帧 */
  blankBytes: 12000,
  /** 启动页稳定后的那张，模块页不许和它像素一致 */
  bootName: '00-boot-late.png'
}

/**
 * @param {Array<{name: string, kind: string, bytes: number, hash: string}>} shotLog 本轮真实写出的图
 * @param {{noShots?: boolean, limits?: Partial<typeof PIXEL_LIMITS>}} opts
 * @returns {{bad: string[], notes: string[]}}
 */
export function pixelVerdict(shotLog, opts = {}) {
  const L = { ...PIXEL_LIMITS, ...(opts.limits || {}) }
  if (opts.noShots) {
    return { bad: [], notes: ['本轮 --no-shots：截图张数/互不相同/非空白三条像素判据未跑'] }
  }
  const bad = []
  const blank = shotLog.filter((s) => s.bytes < L.blankBytes)
  if (blank.length) {
    bad.push(`截图疑似空白帧（<${L.blankBytes}B）— ${blank.map((b) => `${b.name}=${b.bytes}B`).join('，')}`)
  }
  if (shotLog.length < L.shotMin) {
    bad.push(`本轮只写出 ${shotLog.length} 张截图（下限 ${L.shotMin}），取证中途断了不算通过`)
  }
  const pages = shotLog.filter((s) => s.kind === 'page')
  if (pages.length < L.pageShotMin) {
    bad.push(`模块页截图只写出 ${pages.length} 张（下限 ${L.pageShotMin}，路由表有 18 页）——探针中途断了不算通过`)
  }
  const byHash = new Map()
  for (const s of pages) {
    const prev = byHash.get(s.hash)
    if (prev) bad.push(`${prev} 与 ${s.name} 像素完全一致 — 有一页根本没画出来（多半是导航没发生/卡在上一页）`)
    else byHash.set(s.hash, s.name)
  }
  const boot = shotLog.find((s) => s.name === L.bootName)
  if (!boot) {
    bad.push(`拿不到 ${L.bootName}，"卡在启动页"这条判据无从成立`)
  } else {
    const stuck = pages.filter((s) => s.hash === boot.hash).map((s) => s.name)
    if (stuck.length) bad.push(`这些"模块页"和启动页像素一致（${stuck.join('，')}）——路由没切过去`)
  }
  return { bad, notes: [] }
}
