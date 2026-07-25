/**
 * CoT-shape 熵轨迹信号（v0.9.6 P2 M4）
 *
 * **位置变化**（v0.9.6 P2 M6 重构）：
 * - 算法实现已迁移至 `src/shared/cot-trace-analyzer.ts`（共享层）
 * - 本文件保留为 **re-export shim**，保持向后兼容（不破坏 ai-param-source.ts、28 个测试）
 * - 新代码应直接 import 自 `@shared/cot-trace-analyzer`
 *
 * ---
 *
 * 背景：
 * - 现代 LLM 在 Chain-of-Thought 推理中经常产生"看起来很自信但实际错误"的答案
 * - 单点置信度（verbalized / logprob）无法捕捉推理过程的"形状"
 * - Zhao 2026 (arXiv:2603.18940) 揭示：**熵轨迹的形状**（是否单调递减）比熵的标量大小更具预测力
 *
 * 论文依据：见 shared/cot-trace-analyzer.ts 头部注释
 *
 * 公式：见 shared/cot-trace-analyzer.ts 头部注释
 *
 * 方案书依据：v0.9.6 §P2 M4 + v0.9.6 §P2 M6（Trace 可视化）
 */
export {
  analyzeCotEntropyTrajectory,
  cotEntropyTrajectoryConfidence,
} from '@shared/cot-trace-analyzer'
export type { CotEntropyTrajectory, CotTraceAnalysis } from '@shared/cot-trace-analyzer'
