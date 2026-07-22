# v2.2 P2 Agent 架构强化循环工程 · 任务清单

> **归档时间**：2026-07-22
> **基准版本**：v2.1 功能修复循环工程已完成
> **完成版本**：v2.2 P2 Agent 架构强化（commit: c5a5599）
> **任务总数**：9 项（P2-0 + P2-A ~ P2-I）
> **完成率**：100%

---

## 任务清单

| ID | 任务 | 状态 | commit | 验证 |
|----|------|------|--------|------|
| P2-0 | 调研第四波 Agent 架构强化方向 | ✅ 完成 | — | 调研报告归档 |
| P2-1 | 确认 v0.9.3 §11 的 26 项改进清单 + 评估范围 | ✅ 完成 | — | 26 项分类评估 |
| P2-A | 遗留项 1: DecisionDetailPage 校准状态 UI 接入 | ✅ 完成 | （P2-G 合并 commit 取消，统一本次 c5a5599） | typecheck ✅ + lint ✅ |
| P2-B | 遗留项 3: task-protocol 14 步单测 | ✅ 完成 | 同上 | 14 单测 ✅ |
| P2-C | 改进点 4: sandbox 审批理由 UI 展示 | ✅ 完成 | 同上 | typecheck ✅ + lint ✅ |
| P2-D | 改进点 25: AttentionBubble.tsx + ChatPanel 接入 | ✅ 完成 | 同上 | typecheck ✅ + lint ✅ |
| P2-E | 改进点 26: ExpectedOutput.tsx + IPC 4 步同步 + ChatPanel 接入 | ✅ 完成 | 同上 | typecheck ✅ + lint ✅ |
| P2-F | 改进点 24: TokenMonitorPanel 增加本次会话/今日维度 | ✅ 完成 | 同上 | typecheck ✅ + lint ✅ |
| P2-G | 编译门禁三绿验证 | ✅ 完成 | 同上 | typecheck:node ✅ + typecheck:web ✅ + lint 0 错误 ✅ |
| P2-H | 遗留项 2: step 2 check-permission IPC 审批接入（含测试修复） | ✅ 完成 | c5a5599 | 22 单测 ✅（含新增 2.4/2.5） |
| P2-I | 任务完成后自动记忆沉淀 | ✅ 完成 | c5a5599 | 14 单测 ✅ + 集成回归 14/14 ✅ |

---

## 关键交付物

### P2-A: DecisionDetailPage 校准状态 UI 接入
- 文件：`src/renderer/src/pages/DecisionDetailPage.tsx`
- 功能：展示 ECE / 最优 T / 校准时间 / 校准状态徽章

### P2-B: task-protocol 14 步单测
- 文件：`tests/unit/task-protocol.test.ts`
- 覆盖：14 步全流程（validate-input → return-result）+ cancelled 中断 + finally 保证 cleanup
- 测试数：14 个

### P2-C: sandbox 审批理由 UI 展示
- 文件：`src/renderer/src/components/ai/SandboxApprovalDialog.tsx`
- 功能：展示审批理由 + 风险等级 + 命令预览

### P2-D: AttentionBubble.tsx
- 文件：`src/renderer/src/components/ai/AttentionBubble.tsx`
- 功能：浮动气泡展示当前 attention context（文件/命令/错误）

### P2-E: ExpectedOutput.tsx + IPC 4 步同步
- 文件：`src/renderer/src/components/ai/ExpectedOutput.tsx` + IPC 4 步
- 功能：展示任务预期输出 + 实际输出对比

### P2-F: TokenMonitorPanel 本次会话/今日维度
- 文件：`src/renderer/src/components/ai/TokenMonitorPanel.tsx`
- 功能：新增本次会话累计 + 今日累计 token 统计

### P2-H: step 2 check-permission 三态权限审批
- 文件：
  - `src/main/core/agent/subagents/task-protocol-steps-early.ts`（升级 stepCheckPermission）
  - `src/main/core/agent/subagents/task-protocol-types.ts`（新增 defaultPermission/mode 字段）
  - `src/main/ipc/task-permission-approval.ts`（新增 IPC handler）
  - `src/preload/index.ts` + `src/renderer/src/types/electron.d.ts`（4 步同步）
  - `src/renderer/src/components/ai/TaskPermissionApprovalDialog.tsx` + `.css`（UI 弹窗）
  - `src/renderer/src/components/ai/ChatPanel.tsx`（监听 + 弹窗）
- 三态权限：always（每次询问）/ auto（自动允许）/ never（自动拒绝）
- 测试：22/22 通过（含新增 2.4 auto 模式 + 2.5 never 模式）

### P2-I: 任务记忆沉淀服务
- 新建文件：
  - `src/main/core/memory/task-sediment.ts`（~450 行）
  - `tests/unit/task-sediment.test.ts`（14 单测）
- 集成点：`src/main/core/agent/subagents/task-protocol.ts` finally 块
- 双轨写入：知识库（KnowledgeRepository）+ Markdown（`~/.tdsf-linux/task-sediment/`）
- 幂等：`sediment-{taskId}` 跨进程幂等
- 错误降级链：知识库失败 → 仅 Markdown；Markdown 失败 → 仅日志；日志失败 → 静默吞错
- 启发式 lessons 提取：5 类（失败步骤/错误指示词/超时/token 消耗/attention errors）
- LRN-YYYYMMDD-NNN 编号：同进程递增，重启从 001 开始
- AttentionTracker.reset() 归档调用（补全全工程缺失的 reset 调用点）

---

## Hard Constraint 对齐

| 约束 | 描述 | 对齐方式 |
|------|------|----------|
| R12 | 三态权限审批（ALWAYS/AUTO/NEVER） | P2-H stepCheckPermission 升级 |
| R15 | 后台 Review 解耦 | P2-I AttentionTracker.reset 归档 |
| A7 | 质量绝对优先 | P2-I 双轨写入 + 错误降级链 + 幂等保证 |
| A9 | 技术栈 Skill 调用前置 | P2-0 调研阶段已对齐 |
