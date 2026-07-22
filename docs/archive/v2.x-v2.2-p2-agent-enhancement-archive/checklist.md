# v2.2 P2 Agent 架构强化循环工程 · 勾选清单

> **归档时间**：2026-07-22
> **完成版本**：v2.2 P2 Agent 架构强化（commit: c5a5599）
> **完成率**：100%（11/11）

---

## P2-0 调研阶段

- [x] 调研第四波 Agent 架构强化方向
- [x] 确认 v0.9.3 §11 的 26 项改进清单
- [x] 评估范围（P2-A ~ P2-I 共 9 项纳入第四波）

## P2-A: DecisionDetailPage 校准状态 UI 接入

- [x] 读取 DecisionDetailPage 现有代码
- [x] 接入校准状态 IPC（getCalibrationState）
- [x] 展示 ECE / 最优 T / 校准时间
- [x] 展示校准状态徽章（已校准/未校准/校准过期）
- [x] typecheck:node ✅
- [x] typecheck:web ✅
- [x] lint 0 错误

## P2-B: task-protocol 14 步单测

- [x] 读取 task-protocol.ts + task-protocol-steps-early.ts + task-protocol-steps-late.ts
- [x] 编写 14 步单测（每步一个测试用例）
- [x] 覆盖 cancelled 中断场景
- [x] 覆盖 finally 块 cleanup + return-result 保证
- [x] 14/14 测试通过

## P2-C: sandbox 审批理由 UI 展示

- [x] 读取 SandboxApprovalDialog 现有代码
- [x] 展示审批理由字段
- [x] 展示风险等级标签
- [x] 展示命令预览（代码块）
- [x] typecheck:node ✅
- [x] typecheck:web ✅
- [x] lint 0 错误

## P2-D: AttentionBubble.tsx + ChatPanel 接入

- [x] 新建 AttentionBubble.tsx 组件
- [x] 浮动气泡展示当前 attention context
- [x] 展示文件/命令/错误三类信息
- [x] ChatPanel 接入（监听 attention 变化事件）
- [x] typecheck:node ✅
- [x] typecheck:web ✅
- [x] lint 0 错误

## P2-E: ExpectedOutput.tsx + IPC 4 步同步 + ChatPanel 接入

- [x] 新建 ExpectedOutput.tsx 组件
- [x] IPC 4 步同步（定义 + 注册 + 暴露 + 类型）
- [x] 展示任务预期输出 + 实际输出对比
- [x] ChatPanel 接入（任务执行时展示）
- [x] typecheck:node ✅
- [x] typecheck:web ✅
- [x] lint 0 错误

## P2-F: TokenMonitorPanel 增加本次会话/今日维度

- [x] 读取 TokenMonitorPanel 现有代码
- [x] 新增本次会话累计 token 统计
- [x] 新增今日累计 token 统计
- [x] UI 展示三维度（本次任务/本次会话/今日）
- [x] typecheck:node ✅
- [x] typecheck:web ✅
- [x] lint 0 错误

## P2-G: 编译门禁三绿验证

- [x] typecheck:node ✅
- [x] typecheck:web ✅
- [x] lint 0 错误

## P2-H: step 2 check-permission IPC 审批接入

- [x] task-protocol-types.ts 新增 defaultPermission/mode 字段
- [x] task-protocol-steps-early.ts 升级 stepCheckPermission 三态逻辑
  - [x] always: IPC 推送审批请求到 MainWindow
  - [x] auto: 自动允许（source=mode-auto）
  - [x] never: 自动拒绝
  - [x] 无 MainWindow 降级: 默认允许（source=default-allow-no-mainwindow）
- [x] 新建 task-permission-approval.ts IPC handler
- [x] IPC 4 步同步（定义 + 注册 + 暴露 + 类型）
- [x] 新建 TaskPermissionApprovalDialog.tsx + .css
- [x] ChatPanel.tsx 监听 task:permission:request 事件
- [x] 更新 task-protocol-steps-early.test.ts 断言
- [x] 新增测试 2.4（auto 模式）
- [x] 新增测试 2.5（never 模式）
- [x] 22/22 测试通过

## P2-I: 任务完成后自动记忆沉淀

- [x] 新建 src/main/core/memory/task-sediment.ts
- [x] 实现 sedimentTaskMemory(ctx) 主入口
- [x] 实现 generateSedimentId()（LRN-YYYYMMDD-NNN）
- [x] 实现 extractLessonsHeuristic(ctx)（5 类 lessons）
- [x] 实现 extractKeywords(ctx)
- [x] 实现 extractTags(ctx)
- [x] 实现 buildKnowledgeEntry(ctx, sedimentId, lessons)
- [x] 实现 writeToKnowledgeRepo(entry)（幂等）
- [x] 实现 getSedimentDir()（userData 优先 + homedir 降级）
- [x] 实现 buildMarkdownEntry(ctx, sedimentId, lessons)
- [x] 实现 appendToMarkdown(markdownEntry)（追加模式）
- [x] 实现 archiveAttention()（AttentionTracker.reset 调用）
- [x] 错误降级链（知识库失败 → Markdown → 日志 → 静默吞错）
- [x] task-protocol.ts finally 块集成（if !cancelled 守卫 + try-catch）
- [x] 新建 tests/unit/task-sediment.test.ts（14 单测）
  - [x] 1.1-1.6 主流程（成功/幂等/降级/异常）
  - [x] 2.1-2.2 lessons 提取
  - [x] 3.1-3.2 LRN 编号格式 + 递增
  - [x] 4.1-4.2 知识库条目字段完整性
  - [x] 5.1-5.2 Markdown 首次写入 + 已存在
- [x] 14/14 单测通过
- [x] task-protocol.test.ts 集成回归 14/14 通过

## 编译门禁三绿

- [x] typecheck:node ✅
- [x] typecheck:web ✅
- [x] lint 0 错误 ✅

## 全量测试套件

- [x] 1313/1314 通过（99.92%）
- [x] 唯一失败 llm-client.test.ts（历史已知问题，非本轮回归）
