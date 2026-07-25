# TDSF Linux Desktop — P1 后端开发计划与多 AI 交接建议

> 生成时间：2026-07-25
> 适用版本：v2.5 + v4.0 UI 架构
> 生成 AI：`ai-kimi-20260725-backend`
> 用途：指导多 AI 并行开发阶段的后端收尾与前后端交接

---

## 0. 一分钟速读

1. **多 AI 并行开发已启用**：`.ai-coordination.json` 中央登记 + `scripts/ai-coordination/*.cjs` 工具链 + `AGENTS.md` v10.2 规范已就位。
2. **后端完成度 95%+**，剩余 P1 任务 3 个：
   - 调度器 `daily-decision-archive` 注入真实仓储（当前占位）
   - 调度器 `weekly-ops-report` 注入真实仓储（当前占位）
   - `context.ts` L5 跨会话长期记忆（v1.0 实现，非阻塞）
3. **前端 P0 项已明确**：主要集中在 `CalibrationSettings.tsx`、教程回填进度 UI、ElectronAPI 类型补齐，由前端 AI 负责。
4. **交接原则**：后端 AI 不碰 `src/renderer/src/`，前端 AI 不碰 `src/main/core/` 与 `src/main/services/ssh/`。
5. **高共享文件**（IPC 通道、共享类型、preload、package.json）需由主导 AI 串行处理。

---

## 1. 多 AI 并行开发工作流

### 1.1 核心机制

| 机制 | 文件/工具 | 说明 |
|------|-----------|------|
| 中央登记簿 | `.ai-coordination.json` | 记录每个 AI 会话声明的文件所有权 |
| 声明工具 | `scripts/ai-coordination/claim.cjs` | 修改文件前 claim 所有权 |
| 释放工具 | `scripts/ai-coordination/release.cjs` | 完成后释放所有权 |
| 状态查看 | `scripts/ai-coordination/status.cjs` | 查看当前占用情况 |
| 冲突预检 | `scripts/ai-coordination/check-conflict.cjs` | 启动前/写入前检查 |
| 规范文档 | `AGENTS.md` v10.2 | 多 AI 并行工作流、模块分工、分支策略 |

### 1.2 标准工作流

```text
1. 启动预检：pnpm ai:check
2. 声明所有权：pnpm ai:claim -f <path> -t <task>
3. 开发与测试（保持门禁通过）
4. 释放所有权：pnpm ai:release -f <path>
5. 提交：git add .ai-coordination.json <changed-files> && git commit -m "feat(xxx): [ai-kimi-20260725-backend] ..."
```

### 1.3 模块分工

| AI 角色 | 负责目录 | 禁止触碰 |
|---------|----------|----------|
| 后端 AI | `src/main/`、`src/shared/`、Python sidecar、`docs/handoff/` | `src/renderer/src/components/`（除非修复类型错误） |
| 前端 AI | `src/renderer/src/`、设计稿还原 | `src/main/core/`、`src/main/services/ssh/` |
| 质量 AI | `tests/`、E2E、死代码审计 | 业务代码只读 |

### 1.4 高共享文件（禁止并行修改）

- `src/shared/ipc-channels.ts`
- `src/shared/agent-types.ts`
- `src/shared/models.ts`
- `src/preload/index.ts`
- `src/preload/index.d.ts`
- `src/main/ipc/index.ts`
- `package.json`
- `AGENTS.md`
- `CLAUDE.md`

---

## 2. P1 后端开发计划

> 来源：`docs/handoff/backend-completion-audit.md` §5.1

### 2.1 任务总览

| # | 任务 | 文件 | 优先级 | 阻塞前端？ | 估计工时 |
|---|------|------|--------|------------|----------|
| 1 | 每日决策归档注入真实仓储 | `src/main/services/scheduler/daily-decision-archive.ts` | P1 | 否 | 中 |
| 2 | 每周运维周报注入真实仓储 | `src/main/services/scheduler/weekly-ops-report.ts` | P1 | 否 | 中 |
| 3 | L5 跨会话长期记忆 | `src/main/core/agent/context.ts` | P1/v1.0 | 否 | 大 |

### 2.2 任务 1：每日决策归档真实化

**当前问题**：
- `createDailyDecisionArchiveTask()` 返回的 handler 未注入 repository
- 调用时 `console.warn` 并以 `success=true + skipped` 跳过
- 调度器每日 18:00 触发归档任务时不执行真实归档

**修复路径**：
1. 复用 `DecisionRepository` 与 `KnowledgeRepository`
2. 实现 `createDailyDecisionArchiveTaskWithRepos(repos)`
3. 在 `scheduler.ts` 中将占位 handler 替换为带仓储的版本
4. 补充单元测试：模拟 repository 调用并验证归档行为

**依赖接口**：
- `querySuccessfulDecisions(startMs, endMs)`
- `findByRelatedDecisionId(decisionId)`
- `countBySource(source)`
- `runInTransaction(fn)`

### 2.3 任务 2：每周运维周报真实化

**当前问题**：
- `PlaceholderDecisionRepo` 与 `PlaceholderKnowledgeRepo` 返回空统计数据
- 周报任务生成空数据报告

**修复路径**：
1. 实现 `createWeeklyOpsReportTaskWithRepos(repos)`
2. 注入真实 `DecisionRepository` 与 `KnowledgeRepository`
3. 汇总本周决策数、成功/失败率、高频命令、知识库新增条目
4. 补充单元测试

### 2.4 任务 3：L5 跨会话长期记忆

**当前问题**：
- `L5_CROSS_SESSION: -1` 占位
- 会话超 90% max 时仅做语义去重，未写入长期记忆层

**修复路径**：
1. 设计 L5 持久化记忆层（复用 SQLite + embedding）
2. 在 `context.ts` 中实现跨会话记忆检索与写入
3. 不阻塞当前前端接入，可放在 v1.0 完成

---

## 3. 多 AI 交接建议

### 3.1 给前端 AI 的交接清单

1. **校准设置页**：
   - 后端已暴露 6 个 IPC：`credibilityCalibrate`、`credibilityGetCalibration`、`credibilityGetCalibrationState`、`credibilityResetCalibration`、`credibilityComputeEce`、`credibilityAddCalibrationSample`
   - 只需在 `src/preload/index.d.ts` 补齐 6 个类型声明（P0-2 已部分修复）
   - 新建/完善 `pages/CalibrationSettings.tsx`

2. **教程回填进度 UI**：
   - 后端已提供 `tutorialBackfillStart/Cancel/Status` + `onTutorialBackfillProgress`
   - 在 `TutorialPage` 接入异步启动、取消、进度条

3. **ModelSettings**：
   - `exportModelStats` 命名不符合规范但调用一致，类型声明需补齐

4. **FileTree SFTP**：
   - `onSftpProgress`、`sftpUpload`、`sftpDownload` 类型已补齐，前端可直接使用

### 3.2 给后端 AI（下一个）的交接清单

1. **先跑五绿门禁**：`pnpm typecheck:node && pnpm typecheck:web && pnpm lint && pnpm test --run`
2. **claim 本计划涉及的 3 个 P1 任务文件**
3. **优先完成调度器两个真实仓储注入**（任务 1、2）
4. **L5 跨会话记忆可延后到 v1.0**
5. **修改共享层类型时必须在 `docs/handoff/ipc-contract.md` 同步更新**

### 3.3 给质量 AI 的交接清单

1. **死代码审计**：关注 `src/renderer/src/` 中未使用的 preload API 调用
2. **E2E 覆盖**：重点覆盖 PAOR 循环、校准设置、教程回填
3. **类型一致性**：检查 `ElectronAPI` 接口与 `preload/index.ts` 暴露的方法是否 1:1

---

## 4. 风险与冲突预防措施

| 风险 | 影响 | 预防措施 |
|------|------|----------|
| 多个 AI 同时修改 `src/preload/index.ts` | 合并冲突、API 丢失 | 高共享文件由主导 AI 串行处理 |
| 前端 AI 误改后端逻辑 | 功能回归 | 严格遵守模块分工，禁止触碰后端目录 |
| 未 claim 就修改文件 | 覆盖他人工作 | 每次修改前 `pnpm ai:check` + `pnpm ai:claim` |
| claim 过期未释放 | 登记簿堆积 | 任一 AI 修改 `.ai-coordination.json` 时清理过期 session |
| 提交遗漏 `.ai-coordination.json` | 状态不同步 | commit 时务必 `git add .ai-coordination.json` |
| 前端遗留文件未提交 | 污染工作区 | 交接时明确归属，由对应 AI 分批提交 |

---

## 5. 当前工作区状态（截至 2026-07-25）

| 项目 | 状态 |
|------|------|
| 编译门禁 | ✅ typecheck:node / typecheck:web / lint / test 全绿 |
| 后端完成度 | 95%+，3 个 P1 占位待补齐 |
| 前端重构 | 进行中，有 3 个未提交文件 |
| 本 AI 声明 | `src/main/core/agent/`、`src/main/services/terminal/`、`src/main/services/ssh/`、`docs/handoff/` |

### 未提交文件（前端 AI 遗留，本 AI 不处理）

- `src/renderer/src/pages/SettingsPage.tsx`（M）
- `src/renderer/src/router.tsx`（M）
- `src/renderer/src/pages/CalibrationSettings.tsx`（??）

---

*文档结束。下一步建议：前端 AI 提交上述 3 个文件，后端 AI 按 §2 的 P1 任务继续开发。*
