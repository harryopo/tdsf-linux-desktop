# TDSF-Linux Desktop - AI Agent 开发指南 v10.1

> 更新日期：2026-07-25
> 编码规范见 `CODING.md`（v1.1 核心）
> AI 入口指引见 `CLAUDE.md`（v1.1，6 条核心红线 + 三绿硬门禁）
> 旧版归档：`docs/archive/CLAUDE-v2.5.md` · `docs/archive/AGENTS-v8.7.md`
> 前期调研文档索引：`docs/archive/README.md`
> 当前阶段：**比赛冲刺**（截止 2026-07-30，剩 5 天）

---

## 项目定位

**TDSF-Linux Desktop** = SSH 终端 + AI 辅助 + 高危命令拦截 + 日志分析 + 可信决策

> 帮助 Linux 初学者不怕命令行的桌面工具。

> 详细的 6 条核心红线、三绿硬门禁、两绿软门禁、降级保留原则见 `CLAUDE.md`。
> AI 协作模式的唯一权威是本文件 §文件所有权。

---

## Agent 模块当前状态（2026-07-23 评估）

| 模块 | 代码量 | 完成度 | 说明 |
|------|--------|--------|------|
| Task Protocol（14步） | ~1,920 行 | 95% | 全部真实逻辑，借鉴 Kilo Code |
| MCP 工具（25个） | ~1,500 行 | 90% | 6 域覆盖，SSH 域最完整 |
| Credibility（D-S+PCR5） | ~2,000 行 | 90% | 代码完整但生产降级为简单规则 |
| Langfuse 追踪 | ~600 行 | 95% | 3 主干路径集成，无 Key 自动降级 |
| Supervisor（PAOR） | ~1,146 行 | 95% | 流式 + 审批 + 循环编排 |
| Claude SDK 集成 | ~1,000 行 | 90% | 双重包装 + 动态 import |
| 前端 AI UI | ~5,000 行 | 85% | 25+ 组件，CoT 可视化待实现 |
| IPC 暴露 | ~3,000 行 | 90% | 55+ 通道，90% 符合 4 步规范 |

**Agent 整体：~16,000 行代码，核心逻辑完整可用。**

---

## 比赛冲刺路线（2026-07-25 至 2026-07-30）

详细 Day 1-6 行动清单见 `../TDSF高质量做大方案-终稿.md` §14。

### Day 1（2026-07-25）：基线建立
- 治理工具：Knip + Playwright + Stop Hook + PreEdit Hook + CI
- 基线验证：三绿 + deadcode + test:e2e + verifier subagent

### Day 2（2026-07-26）：Demo 9 步主路径验收
- 走通 Demo 9 步主路径 + 完整 E2E 测试
- 修复 P0 阻塞 + 视觉对比设计稿

### Day 3（2026-07-27）：打包 + 演示材料
- windows-latest CI build:win + 本地安装测试
- PPT 演示脚本 + 5 分钟录屏

### Day 4（2026-07-28）：Bug 修复 + 质量加固
- 修复 P1 严重问题 + 死占位 UI
- deadcode 清理 + E2E 回归

### Day 5（2026-07-29）：冻结 + 演示彩排
- 全量回归测试（五绿全过）
- 演示彩排 + git tag v1.0

### Day 6（2026-07-30）：比赛日
- 上午仅修紧急 Bug，下午演示

---

## 降级策略（接口保留，待后续迭代）

以下模块**保留代码和接口**，Demo 阶段走简化路径：

| 模块 | Demo 策略 | 保留内容 | 后续计划 |
|------|-----------|----------|----------|
| D-S 证据理论 | 简单规则（高/中/低） | ds-theory.ts + pcr5.ts + fusion-engine.ts | v3.1 恢复完整融合 |
| PCR5 融合 | 简单加权 | 同上 | v3.1 |
| Langfuse | DEV 自动降级（无 Key 不启用） | langfuse.ts + langfuse-trace.ts | 按需开启 |
| Claude SDK | 与 Vercel AI SDK 双通道可用 | claude-sdk-provider.ts + wrapper | 稳定后择一 |
| ECE 校准 | 跳过 | 接口保留在 credibility/audit/types.ts | v3.2 |
| EU AI Act 合规 | 跳过 | formatters.ts 接口保留 | v3.x 按需 |
| CoT 熵轨迹 | 数据收集保留，可视化跳过 | cot-trace-collector.ts | v3.2 |

---

## 三进程架构

```
主进程 (main/)     — Node.js：SSH2/LLM/SQLite/核心算法
Preload (preload/) — contextBridge 安全桥接
渲染进程 (renderer/) — React 18 + Ant Design 5，沙箱隔离
```

> Electron 安全三原则（contextIsolation:true / nodeIntegration:false / sandbox:true）见 `CLAUDE.md` 第 4 条核心红线。

---

## 审查 Agent

- **reviewer**：`.claude/agents/reviewer.md` — 每个 Task 完成后 7 维审查
- **outsider-reviewer**：`.claude/agents/outsider-reviewer.md` — 每 3-5 版本 11 维审查
- **verifier subagent**：声明"任务完成"前必须 dispatch（见 `CLAUDE.md` 第 6 条核心红线）

---

## 文件所有权

> **本节是协作模式的唯一权威声明**：允许几个 AI 并行、工作流、禁并行清单、分支策略均以此处为准；
> 其他文件（`CLAUDE.md`、Qoder 规则镜像等）只引用本节，不得另行定义。

比赛冲刺阶段启用**有限多 AI 并行模式**。Git 是最终事实源，`.ai-coordination.json` 是中央登记簿。

### 多 AI 并行工作流（v10.2 启用）

1. **启动预检**：每个 AI 会话开始前运行 `pnpm ai:check`
2. **声明所有权**：修改文件前 `pnpm ai:claim -f <file> -t <task>`
3. **释放所有权**：修改完成后 `pnpm ai:release -f <file>` 或 `--all`
4. **提交规范**：commit message 包含 sessionId，例如 `feat(xxx): [ai-20260725-001] ...`
5. **高共享文件中央协调**：以下文件禁止并行修改，需由当前主导 AI 串行处理
   - `src/shared/ipc-channels.ts`
   - `src/shared/agent-types.ts`
   - `src/shared/models.ts`
   - `src/preload/index.ts`
   - `src/preload/index.d.ts`
   - `src/main/ipc/index.ts`
   - `package.json`
   - `AGENTS.md`
   - `CLAUDE.md`

### 模块分工建议

| AI 角色 | 负责目录 | 禁止触碰 |
|---------|----------|----------|
| 后端 AI | `src/main/`, `src/shared/`, Python sidecar | `src/renderer/src/components/`（除非修复类型错误） |
| 前端 AI | `src/renderer/src/`, 设计稿还原 | `src/main/core/`, `src/main/services/ssh/` |
| 质量 AI | `tests/`, E2E, 死代码审计 | 业务代码只读 |

### 分支策略

- `master`：单一可发布状态，仅合并已通过 4/5 绿的 PR/commit
- `ai-coordination-staging-YYYYMMDD`：多 AI WIP 临时汇总分支
- 每个 AI 在自己的 feature 分支工作，完成后先合并到 staging，再由主导 AI 合并到 master

### 冲突处理

- 发现冲突先 `git status`，不要覆盖他人修改
- 高共享文件冲突时，优先与相关 AI 协商，或统一由后端 AI 串行处理
- 过期 claim 由任一 AI 在修改 `.ai-coordination.json` 时清理

---

*v10.2 · 2026-07-25 · 比赛冲刺有限多 AI 模式启用*
