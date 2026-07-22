# TDSF-Linux Desktop - AI Agent 开发指南 v9.0 · 救赎版

> 更新日期：2026-07-23
> 联动文档：`CODING.md`（80 行核心规范，替代 CLAUDE.md + AGENTS.md 旧版）
> 
> **⚠️ 重大变更**：v9.0 从 895 行精简到本文件。旧版归档至 `docs/archive/AGENTS-v8.7.md`。
> 核心理念：**删比加重要 · 先验证再架构 · 为删而建**。
> 当前阶段：**Phase 1 冰冻期**（只做减法，冻结新功能）。

---

## 项目定位（重置）

**TDSF-Linux Desktop** = SSH 终端 + AI 辅助问答 + 高危命令拦截 + 日志分析

> ~~不是"AI Agent 可信决策平台"~~，不是"EU AI Act 合规工具"，不是"D-S + PCR5 + ECE 学术实验"。
> 就是一个帮助 Linux 初学者**不怕命令行**的桌面工具。

## 技术栈（精简后）

| 类别 | 技术选型 | 说明 |
|------|----------|------|
| GUI 框架 | Electron 30 + React 18 | 跨平台桌面 |
| 构建工具 | electron-vite + Vite 5 | HMR |
| 语言 | TypeScript 5.4+ strict | 类型安全 |
| UI 组件库 | Ant Design 5 | 企业级 UI |
| SSH 库 | ssh2 (mscdex) | 交互式 Shell |
| 终端组件 | xterm.js | WebGL 加速 |
| 状态管理 | Zustand | 轻量 |
| AI SDK | Vercel AI SDK (`ai`) | Agent 编排 |
| LLM Provider | 火山方舟 / DeepSeek | 国产优先 |
| LLM 可观测性 | Langfuse（DEV only） | trace 调试 |
| 日志分析 | Drain3（sidecar-a） | Python 子进程 |
| 本地数据库 | better-sqlite3 + sqlite-vec | 向量搜索 |
| 测试框架 | vitest | 单元测试 |

## 三进程架构

```
主进程 (main/)     — Node.js：SSH2/LLM/SQLite/核心算法
Preload (preload/) — contextBridge 安全桥接
渲染进程 (renderer/) — React 18 + Ant Design 5，沙箱隔离
```

## IPC 安全三原则（不可违反）

1. `contextIsolation: true` — 上下文隔离
2. `nodeIntegration: false` — 禁用 Node 集成
3. `sandbox: true` — 沙箱模式

## 开发命令

```bash
pnpm dev          # 启动开发模式
pnpm build        # 构建
pnpm build:win    # Windows 打包
pnpm test         # 单元测试
pnpm lint         # ESLint 检查
pnpm typecheck:node  # 主进程类型检查
pnpm typecheck:web   # 渲染进程类型检查
```

## 质量门禁（CI 硬编码 · 不靠人记）

- `pnpm typecheck:node` → exit 0
- `pnpm typecheck:web` → exit 0
- `pnpm lint` → 0 errors
- `pnpm test` → 全量通过
- `pnpm build:win` → 成功生成 .exe

**五条全过才能合并。没有 WIP 豁免、没有 B 级放宽、没有"开发阶段可临时违反"。**

## Git Commit 规范

```
feat: 添加SSH密钥认证
fix: 修复终端中文乱码
refactor: 删除 sidecar-b DoWhy 因果推断模块
test: 添加风险引擎单元测试
docs: 更新CODING.md
chore: 删除未使用的 npm 依赖
```

---

## 当前工作：Phase 1 冰冻期（Week 1-2）

> **目标**：冻结新功能，只做减法。缩减代码量 40%。

### Task 1a: 砍 Python Sidecar ✅
- [ ] 删除 `sidecar-b/`（DoWhy 因果推断，运维教学不需要）
- [ ] 删除 `sidecar-c/`（AgentScope，与 Mastra 功能重叠）
- [ ] 更新 IPC 通道删除 sidecar-b/c 相关
- [ ] 验证编译门禁三绿

### Task 1b: 砍过度学术模块
- [ ] 删除 ECE 校准模块（`src/main/core/agent/credibility/calibration/`）
- [ ] 删除 Temperature Scaling
- [ ] 删除 EU AI Act 合规格式化器（`formatters.ts` 的 HTML/Art.11/12/13）
- [ ] 降级 D-S 证据理论 4 引擎 → 高/中/低三档规则
- [ ] 降级 Langfuse → DEV only
- [ ] 验证编译门禁三绿

### Task 1c: 砍不用的 npm 依赖
- [ ] 删除 `@anthropic-ai/claude-agent-sdk`（Vercel AI SDK 已够用）
- [ ] 删除 `@ai-sdk/google`（主力是火山方舟 + DeepSeek）
- [ ] 删除 `@xenova/transformers`（浏览器端 ML 无场景）
- [ ] 删除 `three` + `@types/three`（3D 无场景）
- [ ] `npx depcheck` 审计剩余未使用依赖
- [ ] 验证编译门禁三绿

### Task 1d: 合并规范文档
- [ ] 创建 `CODING.md`（80 行核心规范）
- [ ] 归档 `CLAUDE.md` → `docs/archive/CLAUDE-v2.5.md`
- [ ] 归档 `AGENTS.md` 旧版 → `docs/archive/AGENTS-v8.7.md`

### Task 1e: 合并归档目录 + 砍历史方案书
- [ ] 5 个归档目录 → 1 个 `docs/archive/`
- [ ] 删除 10+ 份历史方案书（v0.7-v2.2）
- [ ] 删除 17 份调研报告中非活跃的部分

### Task 1f: 编译门禁三绿
- [ ] typecheck:node ✅
- [ ] typecheck:web ✅
- [ ] lint ✅
- [ ] test ✅

---

## Phase 2 重构期（Week 3-4）· 预告

1. 拆分 `src/preload/index.ts`（3283 行 → 15 个子模块）
2. 建立 GitHub Actions CI 自动门禁
3. 定 MVP 功能清单（SSH 终端 + AI 问答 + 高危拦截 + SFTP + 日志分析 + 监控面板）
4. `pnpm build:win` 验证打包成功

---

## 审查 Agent

### 内部 reviewer（每个 Task 完成后）

**配置文件**：`.claude/agents/reviewer.md`

7 维审查 + BLOCK 权限。typecheck/lint/test 任一失败直接 BLOCK。

### 外部 outsider-reviewer（每 3-5 版本）

**配置文件**：`.claude/agents/outsider-reviewer.md`

跳出项目规范，对一切（包括 CODING.md 本身）进行批判性审视。11 维审查。无 BLOCK 权限，仅建议。

---

## 文件所有权

单 AI 工作模式。无需 claim/release。commit message 无需 Session ID。
Git 是最终事实源，勤 commit 即可。
如有其他 AI 会话也在开发，通过 git pull/push 同步，不通过锁文件协调。

---

## 不采纳清单（保持更新）

- ❌ DoWhy 因果推断（运维教学不需要）
- ❌ AgentScope 多 Agent（Mastra 已够）
- ❌ ECE 校准 + Temperature Scaling（教学工具不需要）
- ❌ EU AI Act 合规格式化（比赛不需要）
- ❌ @xenova/transformers 浏览器端 ML（无场景）
- ❌ three.js 3D 渲染（无场景）
- ❌ D-S + PCR5 完整实现（降级为简单规则）
- ❌ 归档五件套（合并为 CHANGELOG.md）
- ❌ LangGraph.js（Vercel AI SDK 更轻量）
- ❌ LlamaIndex.TS（已废弃）
- ❌ keytar（safeStorage 替代）
- ❌ 知识图谱/因果超图（3 周无法可信复现）

---

*v9.0 救赎版 · 2026-07-23 · 删比加重要*
