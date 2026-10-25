/**
 * 审批判定的唯一权威（D2：审批 fail-closed）
 *
 * 为什么要有这个文件：
 *   渲染进程送进来的"批准"是一个跨进程边界的外部输入，此前各处审批入口
 *   （paor:approve / sandbox:approve / llm:tool-approve / agent:confirm，
 *   以及 2026-10-25 已整删的那条工作流确认口）
 *   都把它当可信布尔直接用。JS 的真值判定会让
 *   "true"（字符串）、1、{} 这些畸形值全部变成"用户批准了"。
 *
 * 规则（不可放宽）：
 *   只有字面 true 算批准。其它一切 —— 字符串、数字、对象、undefined、null、
 *   缺字段 —— 一律算拒绝。超时和异常在各自的调用点同样落到拒绝。
 *
 * 这个文件以前还导出过 `isApprovedValue` 与 `readRemember`，2026-10-20 删了：
 * 前者被 `readApproval` 完全覆盖且零调用者；后者读的是「记住这个决策」那一位，
 * 而全仓没有任何界面、载荷或存储带 remember 字段——它只在注释里承诺了一件不存在的事
 * （「会被持久化成自动放行规则」）。留着它，下一个接手的人会以为自动放行做了一半。
 * 真要上这个功能，得连同规则表、界面入口和撤销入口一起设计，不是补一个读位的事。
 */

/**
 * 从审批载荷里取批准位
 *
 * 兼容两种既有形状：裸布尔（paor/sandbox/loop）和带 approved 字段的对象
 * （llm:tool-approve）。
 * 形状不认识就返回 false —— 宁可让用户重按一次，也不放行高危操作。
 */
export function readApproval(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw === true
  if (raw !== null && typeof raw === 'object' && 'approved' in raw) {
    return (raw as { approved: unknown }).approved === true
  }
  return false
}
