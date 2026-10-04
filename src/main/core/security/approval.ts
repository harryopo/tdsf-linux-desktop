/**
 * 审批判定的唯一权威（D2：审批 fail-closed）
 *
 * 为什么要有这个文件：
 *   渲染进程送进来的"批准"是一个跨进程边界的外部输入，此前五个审批入口
 *   （paor:approve / sandbox:approve / llm:tool-approve / loop:confirm /
 *   task:permission-approve）都把它当可信布尔直接用。JS 的真值判定会让
 *   "true"（字符串）、1、{} 这些畸形值全部变成"用户批准了"。
 *
 * 规则（不可放宽）：
 *   只有字面量 true 算批准。其它一切 —— 字符串、数字、对象、undefined、null、
 *   缺字段 —— 一律算拒绝。超时和异常在各自的调用点同样落到拒绝。
 */

/** 值是否恰好是布尔 true */
export function isApprovedValue(value: unknown): boolean {
  return value === true
}

/**
 * 从审批载荷里取批准位
 *
 * 兼容两种既有形状：裸布尔（paor/sandbox/loop）和带 approved 字段的对象
 * （llm:tool-approve / task:permission-approve）。
 * 形状不认识就返回 false —— 宁可让用户重按一次，也不放行高危操作。
 */
export function readApproval(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw === true
  if (raw !== null && typeof raw === 'object' && 'approved' in raw) {
    return (raw as { approved: unknown }).approved === true
  }
  return false
}

/**
 * 取"记住这个决策"位
 *
 * 单独收紧是因为 remember=true 会被持久化成自动放行规则，
 * 拿一个宽松真值就等于把一次误传变成永久后门。
 */
export function readRemember(raw: unknown): boolean {
  if (raw === null || typeof raw !== 'object') return false
  return (raw as { remember?: unknown }).remember === true
}
