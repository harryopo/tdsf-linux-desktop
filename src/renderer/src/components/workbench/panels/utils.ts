/**
 * 格式化 USD 成本展示（v0.9.3 §11 改进点 26 P2-F 辅助函数）
 *
 * - 0 → "$0.00"
 * - (0, 0.01) → "<$0.01"（避免显示 $0.00 失真，让用户知道有消耗）
 * - [0.01, 1) → 保留 3 位小数（如 $0.023）
 * - [1, 100) → 保留 2 位小数（如 $1.50 / $12.34）
 * - [100, ∞) → 保留 2 位小数 + 千位分隔符（如 $1,234.56）
 */
export function formatCost(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return '0.00'
  if (usd < 0.01) return '<0.01'
  if (usd < 1) return usd.toFixed(3)
  if (usd < 100) return usd.toFixed(2)
  return usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
