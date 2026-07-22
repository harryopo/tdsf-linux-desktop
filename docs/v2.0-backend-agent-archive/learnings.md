# v2.0 后端 + Agent 架构循环工程 — 经验沉淀

> **日期**：2026-07-22
> **范围**：Phase A-G 循环工程执行经验

---

## LRN-20260722-001 · 并行 subagent 工作区隔离

**场景**：Phase D 派发两个并行 subagent（D.1-D.4 task-protocol + D.5 Langfuse trace），两者都修改了 langfuse-trace.ts。

**问题**：D.1 subagent 顺带修复了 langfuse-trace.ts 的 TS2339（caughtError 控制流分析），D.5 subagent 是该文件的创建者。并行运行时可能覆盖。

**解决**：两个 subagent 都报告 typecheck:node exit 0，最终文件状态正确。但并行 subagent 修改同一文件有风险。

**方案**：后续并行 subagent 必须在派发前明确划分文件所有权，不允许两个 subagent 修改同一文件。

---

## LRN-20260722-002 · task-protocol 大文件拆分策略

**场景**：task-protocol-steps.ts 1142 行严重超过 500 行硬约束。

**方案**：按步骤阶段拆分：
- task-protocol-types.ts（类型 + 常量）
- task-protocol-helpers.ts（共享辅助函数）
- task-protocol-steps-early.ts（step 1-5）
- task-protocol-steps-mid.ts（step 6-10）
- task-protocol-steps-late.ts（step 11-14）
- task-protocol-steps.ts（STEP_FUNCTIONS 注册表 + re-export）
- task-protocol.ts（入口：executeTaskProtocol + createTaskProtocolContext）

**关键**：外部 import 路径完全兼容（通过 re-export 链），无需修改调用方。

---

## LRN-20260722-003 · Langfuse 流式 trace 两种包装器

**场景**：spec 要求 `withStreamTrace<T>(fn: () => AsyncIterable<T>)` 接口，但项目中 ClaudeSdkProvider.stream() 和 Supervisor.chat() 实际基于回调（onToken/onDone/onError），非 AsyncIterable。

**方案**：同时提供两个包装器：
- `withStreamTrace<T>`（AsyncIterable 版，满足 spec 接口，预留给 ai-sdk streamText）
- `withCallbackStreamTrace<TParams>`（回调版，实际集成用）

**教训**：spec 接口设计与实际代码模式不一致时，不要强行适配，应同时提供两种包装器。

---

## LRN-20260722-004 · MCP registry 按域拆分

**场景**：MCP 工具从 9 扩展到 30，如果全部放 registry.ts 会超 1000 行。

**方案**：按域拆分 6 文件：
- registry-ssh.ts（SSH 域 5 工具）
- registry-monitor.ts（监控域 3 工具）
- registry-log.ts（日志域 3 工具）
- registry-knowledge.ts（知识域 4 工具）
- registry-credibility.ts（决策域 3 工具）
- registry-sandbox.ts（沙箱域 3 工具）
- legacy-handlers.ts（legacy 4 工具 handler）
- registry.ts（共享接口 + 工具函数 + re-export）

server.ts 通过 `createV2Tools()` 聚合所有域，单一入口分发。

---

## LRN-20260722-005 · 前端并行重构期后端 commit 策略

**场景**：前端正在重构（大量 .tsx 未提交修改），后端同时开发。git status 显示 40+ 文件修改。

**方案**：
1. subagent 硬约束"不碰 src/renderer/"
2. commit 时精确 `git add` 后端文件路径（不用 `git add -A`）
3. 前端修改保留在工作区，不混入后端 commit

**教训**：并行开发时必须严格区分文件所有权，commit 时逐文件 add。

---

## LRN-20260722-006 · TypeScript 控制流分析与闭包赋值

**场景**：langfuse-trace.ts 中 `caughtError` 变量在 try-catch 的 catch 块赋值，在 try-finally 的 if 块读取，TS 控制流分析推断为 `never`。

**根因**：TS CFA 不跟踪闭包内对变量的赋值，在 `if (caughtError)` 块内推断为 `never`。

**方案**：使用显式类型断言 `(caughtError as Error).message`，将值存入中间变量 `errMsg`。

**教训**：跨 try-catch-finally 块的变量传递，不要依赖 TS CFA，用显式断言或中间变量。

---

## LRN-20260722-007 · MCP resources/prompts role 适配

**场景**：MCP GetPromptResultSchema 仅支持 user/assistant role，但 prompt 模板内部使用 system role 定义角色。

**方案**：server.ts 新增 `adaptPromptMessagesForMcp()` 函数，将内部 system role 合并到第一条 user 消息前置。

**教训**：MCP 协议规范与内部设计的差异，需要在序列化层适配，不要修改内部数据结构。

---

## LRN-20260722-008 · subagent 上下文隔离与完整指令

**场景**：subagent 没有父 agent 的对话历史，需要完整上下文。

**方案**：每个 subagent 指令必须包含：
1. 项目背景（路径 + 技术栈）
2. 硬约束（违反必失败，明确列出）
3. 当前状态（文件路径 + 行数 + 完成度）
4. 任务清单（具体 Task 编号 + 内容）
5. 执行步骤（1-7 步）
6. 验证命令（pnpm typecheck:node）
7. 报告格式（7 项结构化输出）

**教训**：subagent 指令越详细，返工率越低。硬约束必须用"违反必失败"措辞强调。
