# TDSF-Linux Desktop - AI Agent 开发指南 v8.6

> 本文件是所有 AI Agent（Claude Code / Trae / Codex 等）在本项目工作时的通用入口。
> 更新日期：2026-07-22
> 版本：v8.6（新增"技术栈 Skill 索引"章节 + 联动 CLAUDE.md v2.4 A9 + B5-B10 开发约束）
>
> **⚠️ 阅读指引**：
> - **开发时必读**：本文件第 1-310 行（项目概述 + 技术栈 + 技术栈 Skill 索引 + 协作规范 + 质量门禁 + 审查 Agent）
> - **开发时必读**：`CLAUDE.md` v2.4（A1-A9 红线 + B1-B10 开发约束 + C1-C3 白名单）
> - **开发时必读**：`.claude/agents/reviewer.md`（审查 agent 配置）
> - **按需查阅**：本文件第 310 行之后的归档内容（循环工程经验/IPC 清单/polish 经验），开发时无需通读

## 项目概述

**TDSF-Linux Desktop** = FinalShell 的 SSH 能力 + AI 运维助手 + 可信决策内核

- **定位**：面向 Linux 运维的人机协同可信决策桌面助手
- **参赛**：2026 火山杯 Agent 创新大赛
- **核心叙事**：TDSF 不是"AI 替代运维"，而是"AI 让运维可解释"
- **License**：MIT

## 技术栈（v7.0 定稿）

### 核心技术栈

| 类别 | 技术选型 | 版本 | 说明 |
|------|----------|------|------|
| GUI 框架 | Electron + React 18 | 30+ / 18 | 跨平台桌面应用主流 |
| 构建工具 | electron-vite + Vite 5 | 2.3+ / 5.x | 亚秒级 HMR |
| 语言 | TypeScript | 5.4+ | strict 模式 |
| UI 组件库 | Ant Design | 5.x | 现代化 UI |
| 图表库 | Recharts | 2.x | React 原生声明式 |
| SSH 库 | ssh2 (mscdex) | 1.15+ | 唯一支持交互式 Shell+跳板机 |
| 终端组件 | xterm.js + Addon | 5.x | WebGL 加速 |
| 状态管理 | Zustand + persist | 4.5+ | 轻量 2KB |
| 本地数据库 | better-sqlite3 | 12+ | Electron 生态最成熟 |
| 向量搜索 | @photostructure/sqlite-vec | 1.2+ | 零服务，SQL 集成 |
| 安全存储 | safeStorage (Electron 内置) | - | OS 原生加密 |
| 配置存储 | electron-store | 8+ | JSON 格式 |
| 打包工具 | electron-builder | 24+ | 多平台 + 自动更新 |
| 测试框架 | vitest + Playwright | 2.x / 1.61+ | 单元 + E2E |

### v7.0 新增技术栈（基于开源调研）

| 类别 | 技术选型 | 版本 | 用途 | 调研来源 |
|------|----------|------|------|---------|
| **Agent 框架** | Vercel AI SDK (`ai`) | 4.0+ | TS 原生 Agent，补充自研 workflow | AI Agent 调研 Top1（9.5分） |
| **LLM 可观测性** | Langfuse SDK | 3.30+ | LLM trace 可视化 + 审计日志 | AIOps 调研 Top2 |
| **MCP Server** | @modelcontextprotocol/sdk | 1.0+ | 暴露 SSH/AI 能力给 Claude Code | AI Agent 调研 Top5 |
| **火山方舟 SDK** | @volcengine/ark-runtime | 1.0+ | 国产 LLM 原生接入 | 国产闭环叙事 |
| **Schema 验证** | zod | 3.23+ | 运行时类型验证 | Vercel AI SDK 依赖 |

### v8.5 评估中技术栈（2026-07-22 · 质量优先 · CLAUDE.md A7）

> **背景**：用户要求"质量优先而不是轻量优先"，LangGraph.js 是 2026 年主流 Agent 框架。
> LangChain 官方 2026 报告："超过 60% 的 Agent 生产事故都和状态管理有关"——LangGraph.js 专攻状态管理。

| 类别 | 技术选型 | 用途 | 状态 | 评估依据 |
|------|----------|------|------|---------|
| **Agent 状态编排** | LangGraph.js (`@langchain/langgraph`) | 状态机图编排，解决 60% Agent 生产事故（状态管理） | 🔄 评估中 | 2026 年主流框架，质量优先（CLAUDE.md A7） |
| **死代码检测** | knip | 未引用导出/依赖检测 | 🔄 评估中 | Kilo Code 源码分析 P2 → 质量优先下应做 |
| **git 沙箱回滚** | Aider RepoMap + checkpointing | PageRank + tree-sitter 拓扑图 + 影子 git 回滚 | 🔄 评估中 | Aider 源码分析 P0 → 质量优先下必须做 |
| **Cline Checkpointing** | 影子 git 回滚 | 独立验证 + 思维外显 | 🔄 评估中 | Cline 源码分析 P0 → 质量优先下必须做 |

## 技术栈 Skill 索引（v8.6 新增 · 2026-07-22 · 联动 CLAUDE.md A9）

> **配套调研**：`docs/tech-stack-skills/`（10 份调研文档）
> **强制要求**：开发任何技术栈组件前，**必须先查对应调研文档 + 必装 Skill 的 SKILL.md**（CLAUDE.md A9 红线）。

### 10 个核心 Skill 清单（全部已装 ✅）

| # | 技术栈 | Skill 名称 | 评级 | 调研文档 | 项目应用 |
|---|--------|-----------|------|---------|---------|
| 1 | Electron 43 | `electron-dev` | ⭐⭐⭐ | `01-electron.md` | ✅ 已用（IPC 4 步 + 12 大安全） |
| 2 | Electron E2E | `electron` | ⭐⭐ | `01-electron.md` | ⚪ 待用（v1.0 dogfood CDP 自动化） |
| 3 | React 18 | `vercel-react-best-practices` | ⭐⭐⭐ | `02-react.md` | ✅ 已用（65 条规则 8 大类） |
| 4 | React 架构 | `react-expert` | ⭐⭐ | `02-react.md` | ⚪ 部分待用（6 大 reference） |
| 5 | React 组合 | `vercel-composition-patterns` | ⭐⭐ | `02-react.md` | ⚪ 待用（重构时用，4 大类 8 条规则） |
| 6 | TypeScript | `typescript` | ⭐⭐⭐ | `03-typescript.md` | ✅ 已用（18 章规范 + 双 tsconfig） |
| 7 | Tailwind v4 | `tailwind-v4-shadcn` | ⭐⭐⭐ | `05-tailwind.md` | ✅ 已用（4 步主题架构） |
| 8 | shadcn | `shadcn` | ⭐⭐⭐ | `05-tailwind.md` | ✅ 已用（5 大类 25 条规则） |
| 9 | Zustand | `zustand-patterns` | ⭐⭐⭐ | `08-state-data.md` | ✅ 已用（14 模块经验） |
| 10 | SQLite | `sqlite` | ⭐⭐⭐ | `08-state-data.md` | ✅ 已用（9 大主题避坑） |

> Skill 本地路径：`c:\Users\Lenovo\.trae-cn\skills\<skill-name>\SKILL.md`

### 开发时 Skill 调用时机表

| 开发场景 | 必调 Skill | 用途 |
|---------|-----------|------|
| 新建 IPC 通道 | `electron-dev` | IPC 4 步同步 + 安全铁律 |
| Electron 安全审查 | `electron-dev` | 12 大安全原则 + 架构陷阱 |
| Electron E2E 测试 | `electron` | agent-browser CDP 自动化 |
| React 组件开发 | `vercel-react-best-practices` | 65 条规则（Bundle/异步/Re-render/渲染） |
| React 组件架构设计 | `vercel-composition-patterns` | compound components / context |
| React Hooks 深度问题 | `react-expert` | 6 大 reference + React 19 特性 |
| TypeScript 类型设计 | `typescript` | 18 章风格指南 + 8 大错误码 |
| TS 跨进程类型同步 | `typescript` + `electron-dev` | `src/shared/` 规约 + electron.d.ts 4 步 |
| Vite 构建配置 | `vercel-react-best-practices` | manualChunks / lazy / barrel-imports |
| Tailwind v4 主题 | `tailwind-v4-shadcn` | 4 步主题架构 + 8 大错误预防 |
| shadcn 组件使用 | `shadcn` | 5 大类 25 条规则 |
| Antd 业务组件 | 官方文档 + `shadcn`（Form 参考） | Form / Table / Modal / 主题 token |
| Monaco 编辑器集成 | `vercel-react-best-practices` + 官方文档 | lazy load + 显式类型标注 |
| xterm 终端集成 | 官方文档 + `vercel-react-best-practices` | WebGL renderer + ResizeObserver |
| Zustand Store 设计 | `zustand-patterns` | 14 模块经验 + Slice 模式 + persist |
| SQLite 数据持久化 | `sqlite` | 9 大主题（并发/外键/类型/索引/事务） |
| IPC 输入校验 | `typescript` + `zustand-patterns` | zod schema 校验 |
| Bug 调试 | `systematic-debugging` | 系统化调试不拍脑袋 |

### 联动硬约束（CLAUDE.md v2.4 · A9 + B5-B10）

| 硬约束 | 内容 | 关联 Skill |
|--------|------|-----------|
| A9 | 技术栈 Skill 调用前置（触发条件下：新增模块/重构/集成新库/修技术栈 bug） | 所有 10 个 Skill |
| B5 | UI 选型决策树（快速验证随意，发布前收敛） | `shadcn` + `tailwind-v4-shadcn` |
| B6 | 跨进程类型放 `src/shared/`（发布前） | `typescript` + `electron-dev` |
| B7 | 重组件 lazy + Suspense（发布前） | `vercel-react-best-practices` |
| B8 | 禁止 barrel imports（发布前） | `vercel-react-best-practices` |
| B9 | IPC handler 入参 zod 校验（发布前，仅用户输入 IPC） | `electron-dev` + `zustand-patterns` |
| B10 | SQLite 三大 Pragma（发布前） | `sqlite` |

> **v2.4 放宽策略**：A10-A14 从 A 红线降级为 B6-B10 开发约束，开发阶段加 `// WIP:` 标注即可临时违反，发布前必须满足。后续优化时再逐渐缩减回 A 红线。

## 三进程架构

```
主进程 (main/)     — Node.js 完整权限：SSH2/LLM/SQLite/safeStorage/核心算法/MCP Server
Preload (preload/) — contextBridge 安全桥接，只暴露 invoke/handle API
渲染进程 (renderer/) — 沙箱隔离，React 18 + Ant Design 5
```

## IPC 安全三原则（不可违反）

1. `contextIsolation: true` — 上下文隔离
2. `nodeIntegration: false` — 禁用 Node 集成
3. `sandbox: true` — 沙箱模式

## 文件所有权（v8.4 简化 · 2026-07-22）

> 单 AI 工作模式：无需 claim/release/check-conflict/session ID 等多 AI 协作开销。
> 以下情况可重新启用多 AI 协议（`.ai-coordination.json` + `pnpm ai:*` 脚本仍保留备用）：
> - 用户明确要求并发开多个 AI 会话
> - 跨 AI 任务分派（如 Trae + Claude Code 同时工作）

**单 AI 模式约定**：
- 无需 `pnpm ai:check` / `pnpm ai:claim` / `pnpm ai:release`
- commit message 无需带 Session ID（但仍需符合 Git Commit 规范）
- 无域级写限制（单 AI 可跨 main/renderer/shared 写）
- Git 仍是最终事实源，勤 commit 即可

## 核心算法层（TypeScript 重写自 Python）

| 模块 | 文件 | 功能 |
|------|------|------|
| 置信度计算 | `src/main/core/confidence.ts` | 0.7×Drain3匹配度 + 0.3×来源先验 |
| 证据溯源 | `src/main/core/grounding.ts` | Ground-Check：验证证据来自真实工具调用 |
| 风险引擎 | `src/main/core/risk-engine.ts` | 4层风险控制（语法→风险→人确认→审计） |
| 决策引擎 | `src/main/core/decision-engine.ts` | 整合置信度+风险+证据 → DecisionCard |
| 自适应采样 | `src/main/core/sampling.ts` | 置信度≥0.7单次，<0.7三次重采样 |
| 规则引擎 | `src/main/core/rule-engine.ts` | 降级路径，LLM 不可用时用规则 |
| Agent 工作流 | `src/main/core/agent-workflow.ts` | 7步 HITL：collect→analyze→reason→check→confirm→execute→verify |

## v7.0 新增模块

| 模块 | 文件 | 功能 | 调研来源 |
|------|------|------|---------|
| LLM 可观测性 | `src/main/services/observability/langfuse.ts` | LLM trace + 审计 | AIOps 调研 |
| MCP Server | `src/main/services/mcp/server.ts` | 暴露 SSH/AI 能力 | AI Agent 调研 |
| Skill 包仓库 | `src/main/services/skills/skill-repo.ts` | 按教学章节组织 Skill | databuff 借鉴 |
| Brain+Experts | `src/main/core/brain.ts` | 多智能体派发 | databuff 借鉴 |
| Drain3 桥接 | `src/main/services/log/drain3-bridge.ts` | Python 子进程日志模板 | AIOps 调研 |

## 6大核心机制（v4.0方案书）

1. **证据置信度公式**：0.7×Drain3匹配度 + 0.3×来源先验
2. **证据溯源校验 Ground-Check**：每条证据必须来自真实工具调用
3. **自适应自洽采样**：置信度≥0.7单次推理，<0.7触发3次重采样
4. **4层风险控制**：语法检查→风险评估→证据展示+人确认→审计日志
5. **双推理模式**：快速（简单问题）vs 深度（多步推理+证据核验）
6. **知识双轨制**：command_skills（操作能力）+ incident_cases（故障案例）

## v7.0 新增机制（基于开源调研）

7. **Tool Calling 替代 RAG**：LLM 直查真实命令输出（借鉴 databuff）
8. **Brain+Experts 多智能体**：诊断 Brain + 命令/教学/报告专家（借鉴 databuff）
9. **Skill 包分层文件系统**：按教学章节组织 SKILL.md（借鉴 databuff）
10. **Langfuse 可观测性**：LLM trace 实时可视化 + 审计日志
11. **MCP Server 暴露**：让 Claude Code/Cursor 调用 TDSF 能力

## SSH 连接方式（必须全部支持）

1. **密码认证**：username + password
2. **密钥文件认证**：username + privateKeyPath + passphrase（可选）
3. **交互式 Shell**：pty = true，支持 vim/top 等全屏程序
4. **SFTP 文件管理**：上传/下载/删除/重命名/权限修改
5. **端口转发**：本地/远程端口转发
6. **跳板机**：通过跳板机连接目标服务器

## LLM 接入（用户自配）

- API Key 通过 safeStorage 加密存储（OS 钥匙串）
- 支持 Base URL 自定义（火山方舟/OpenAI/任意兼容API）
- 模型名可配置（doubao-seed-1-6-250615 / gpt-4o / 等）
- 降级机制：API Key 为空或调用失败时降级到规则引擎
- **v7.0 新增**：火山方舟原生 SDK（@volcengine/ark-runtime）
- **v7.0 新增**：Langfuse trace 记录每次 LLM 调用

## 开发命令

```bash
pnpm dev          # 启动开发模式（electron-vite dev）
pnpm build        # 构建生产版本
pnpm test         # 运行单元测试（vitest）
pnpm test:e2e     # 运行 E2E 测试（Playwright）
pnpm lint         # ESLint 检查
pnpm typecheck    # TypeScript 类型检查
pnpm rebuild      # 重新编译原生模块（适配 Electron）
```

## 质量门禁

- TypeScript strict 模式
- ESLint 0 错误（max-warnings=0）
- 测试覆盖率 ≥ 85%
- 单文件 ≤ 500 行（B 级开发约束，开发阶段可标注 WIP 临时违反）
- 单函数圈复杂度 ≤ 15
- **v7.0 新增**：所有 LLM 调用必须有 Langfuse trace
- **v7.0 新增**：所有高危命令必须有 Ground-Check 证据
- **v8.3 新增**：每个 Task 完成后必须 dispatch reviewer agent（CLAUDE.md A6）
- **v8.3 新增**：禁止用 mock/空函数/TODO 伪装已完成（CLAUDE.md A4 诚实标注）
- **v8.3 新增**：开发类 skill 必须充分调用（CLAUDE.md A5）

## 审查 Agent（v8.3 新增 · 强制）

> **配置文件**：`.claude/agents/reviewer.md`
> **调用时机**：每个 Task 完成后**必须** dispatch（不是 Phase 7.7 才做）
> **核心原则**：做事的 Agent 和打分的 Agent 必须不是同一个（Anthropic 官方推荐）

### 审查 Agent 的 7 大维度

1. **代码质量审查**：贴 typecheck/lint/test 实际输出（禁止用"测试通过"总结）
2. **安全审查**：敏感数据/IPC 审批/输入验证/命令注入/脱敏
3. **IPC 4 步同步验证**：main + ipc/index + preload + d.ts 缺一不可
4. **Skill 使用审查**：检查 implementer 是否充分调用了开发类 skill
5. **死代码与占位 UI 检测**：knip + grep TODO/空函数/mock 数据
6. **诚实标注未完成审查**：检查"声称完成"是否有证据
7. **视觉验证**（UI 改动时）：截图对比设计稿

### BLOCK 权限

reviewer agent 拥有 BLOCK 权限，以下情况直接 BLOCK：
- implementer 声称完成但未贴测试输出
- implementer 声称 UI 已实现但 onClick 调空函数
- implementer 声称功能完成但 IPC 通道无 handler
- implementer 用 mock 数据伪装已完成
- typecheck / lint / test 任一失败

## Git Commit 规范

```
feat: 添加SSH密钥认证
fix: 修复终端中文乱码
refactor: 提取置信度计算为独立模块
test: 添加风险引擎单元测试
docs: 更新AGENTS.md
chore: 升级依赖版本
perf: 优化终端渲染性能
```

## 开源复用纪律（v8.5 强化 · 2026-07-22 · CLAUDE.md A8）

> **强制要求**：动工前必须先查 `d:\ai\linux教学一体\开源项目复用清单.md`（636 行主清单）。
> 已积累 17 份调研报告 + 8 份源码分析报告 + 18 个已 clone 项目，必须充分利用，**禁止重复造轮子**。

### 复用方式分级

| 标记 | 含义 | 示例 |
|------|------|------|
| 🟢 直接依赖 | npm 安装即用 | ssh2 / xterm.js / Mastra / Vercel AI SDK 7 |
| 🟡 借鉴架构 | 参考设计思想，TS 等价实现 | Cline plan-and-act / Aider git 沙箱回滚 |
| ⚪ 待评估 | 列入待办，调研后决策 | LangGraph.js / knip |
| 🔴 红线 | 仅架构参考，禁止代码复用 | AGPL/GPL/闭源项目 |

### 已 clone 全量分析的开源项目（18 个 · `../opensource-reference/`）

| 项目 | License（已核验） | 项目内角色 | 复用方式 | 源码分析报告 |
|------|------------------|-----------|---------|-------------|
| **mastra** | Apache-2.0 | Agent 编排主框架 | 🟢 直接依赖 | 24-源码分析-Mastra框架.md |
| **OpenHands** | MIT | 沙箱方案参考 | 🟡 借鉴架构 | 25-源码分析-OpenHands沙箱.md |
| **cline** | Apache-2.0 | plan-and-act + 工具系统 + MCP + Checkpointing | 🟡 借鉴架构 | 28-源码分析-Cline-VSCode扩展型Agent.md |
| **kilo-code** | MIT | 多模式 Subagent + Permission.ask + knip | 🟡 借鉴架构 | 29-源码分析-KiloCode-多模式Subagent.md |
| **continue-dev** | Apache-2.0（已停维护）| 多模型调度 + 代码库索引 | 🟡 借鉴架构（禁 fork）| 30-源码分析-ContinueDev.md |
| **aider** | Apache-2.0 | git 沙箱回滚 + Architect Mode + RepoMap | 🟡 借鉴架构 | 31-源码分析-Aider-终端优先与git沙箱回滚.md |
| **claw-code** | MIT | 沙箱 unshare + permission_enforcer + hooks | 🟡 借鉴架构 | 33-源码分析-claw-code.md |
| **grok-build** | Apache-2.0 | Hooks + Sandbox 组合 + Memory sqlite-vec | 🟡 借鉴架构 | 34-源码分析-grok-build.md |
| **claude-code** | ⚠️ 闭源（Anthropic Commercial Terms）| 行为参考 | 🔴 仅通过 Claude Agent SDK 集成 | 20-开源调研-Claude-Code.md |
| **MetaGPT** | Apache-2.0 | 多 Agent 协作 SOP 参考 | 🟡 参考架构 | 无源码分析（仅调研） |
| **crewAI** | MIT | 多 Agent 协作框架对比 | 🟡 参考架构 | 无源码分析（仅调研） |
| **tabby** | MIT | SSH 客户端最接近 TDSF 技术栈 | 🟡 借鉴架构 | 无源码分析（07/15 调研） |
| **electerm** | MIT | Electron SSH 客户端架构参考 | 🟡 借鉴架构 | 无源码分析（已用于架构参考） |
| **superpowers** | MIT | Claude Code skill 插件设计参考 | 🟡 借鉴架构 | 无源码分析（已用于 skill 设计参考） |
| **agent-skills** | ⚠️ 无 LICENSE（Vercel Labs 公开 skill 集合） | skill 格式参考 | ⚪ 待评估 | 无源码分析（已用于 skill 格式参考） |
| **cube-shell** | ⚠️ LGPL-3.0 | SSH 客户端 UI 参考 | 🔴 仅 UI 借鉴，禁代码复用 | 无 |
| **databuff** | ⚠️ AGPL-3.0 | 运维监控平台架构参考 | 🔴 仅架构参考，禁代码复用 | 无 |
| **nterm-ng** | ⚠️ 未标注 License | 终端 UI 早期实验 | 🔴 不推荐复用 | 无 |

### ⚠️ License 红线清单（仅架构参考，禁止代码复用）

- **AGPL-3.0**：databuff / Coder / Warp
- **SSPL**：所有 SSPL 项目
- **GPL-3.0**：JumpServer / judge0 / bashlex
- **LGPL-3.0**：cube-shell
- **闭源/专有**：claude-code（仅通过 Claude Agent SDK 集成）/ Gemini CLI（已闭源）/ Roo Code（已归档）
- **未标注 License**：nterm-ng

### 已确认主推方案（无需重复评估）

| 功能 | 主推方案 | License | 状态 |
|------|---------|---------|------|
| Agent 编排 | Mastra v1.34.x + Vercel AI SDK 7 | Apache-2.0 | ⚪ v0.9 集成中 |
| SSH 协议 | ssh2（mscdex） | MIT | ✅ 已用 |
| 终端渲染 | xterm.js + addons | MIT | ✅ 已用 |
| 凭证加密 | Electron safeStorage | MIT | ✅ 已用（替代 keytar） |
| Bash 解析 | web-tree-sitter + tree-sitter-bash WASM | MIT | ⚪ 待集成 |
| 代码编辑器 | monaco-editor + @monaco-editor/react | MIT | ✅ 已用 |
| 沙箱主方案 | OpenHands Docker runtime 借鉴 | MIT | 🟡 借鉴架构 |

### 配套文档索引

- **主清单**：`d:\ai\linux教学一体\开源项目复用清单.md`（636 行，15 个功能模块分类表）
- **调研索引**：`d:\ai\linux教学一体\idea-to-dev-output\00-调研索引.md`（17 份调研报告入口）
- **源码分析**：`d:\ai\linux教学一体\idea-to-dev-output\` 下的 24/25/28/29/30/31/33/34 号报告
- **已 clone 源码**：`d:\ai\linux教学一体\opensource-reference\`（18 个项目全量源码）

## 环境变量配置

参见 `.env.example`，关键配置：

- `VOLC_API_KEY`：火山方舟 API Key
- `LANGFUSE_SECRET_KEY` / `LANGFUSE_PUBLIC_KEY`：Langfuse 可观测性
- `TDSF_LOG_LEVEL`：日志级别（debug/info/warn/error）

## 参赛差异化核心

**TDSF 不是"AI 替代运维"，而是"AI 让运维可解释"**

### 7 个评委爽点

1. 现场双击安装，30 秒看到 AI 运维
2. 证据链可点击溯源
3. 4 层风险控制拦截 `rm -rf /`
4. Langfuse trace 实时可视化
5. MCP Server 让 Claude Code 调用 TDSF
6. 149+ 测试 + 17+ E2E 全通过
7. 学生为学生做的教育叙事

## 不采纳清单

- ❌ Docker 主程序部署（桌面软件路线已定）
- ❌ 复制 databuff 代码（AGPL-3.0）
- ❌ LangGraph.js（Vercel AI SDK 更轻量）
- ❌ LlamaIndex.TS（2026-03 已废弃）
- ❌ keytar（safeStorage 是 Electron 30+ 推荐）
- ❌ 知识图谱/因果超图（3 周无法可信复现）
- ❌ 自动化自愈执行（与"人机协同"定位冲突）

---

## 项目目录索引（v8.4 新增 · 动态更新）

> **维护规则**：每次新增/删除目录或重要文件后，AI 必须同步更新本章节。
> **用途**：AI 开发时快速定位代码位置，无需 LS 全量扫描。

### 源代码（`src/`）

| 路径 | 职责 | 关键文件 |
|------|------|---------|
| `src/main/index.ts` | 主进程入口 | Electron app 启动 |
| `src/main/windows/main-window.ts` | 窗口管理 | BrowserWindow 创建 |
| `src/main/core/` | 核心算法层 | `confidence.ts`(置信度) / `decision-engine.ts` / `risk-engine.ts` / `grounding.ts` / `rule-engine.ts` / `sampling.ts` / `agent-workflow.ts` |
| `src/main/core/agent/` | Agent 编排 | `supervisor.ts` / `subagents/`(12 个子 agent) / `at-commands/`(@命令) / `claude-sdk/` / `credibility/`(D-S+PCR5) / `providers/`(LLM 工厂) / `modes/`(5 模式) |
| `src/main/ipc/` | IPC 通道（43 个） | `index.ts`(注册中心) / 按域分文件：`ssh.ts` `llm.ts` `agent.ts` `sandbox.ts` `scheduler.ts` `loop-engineering.ts` 等 |
| `src/main/services/` | 服务层 | `db/` `deploy/` `diagnostics/` `llm/` `log/` `mcp/` `observability/` `profiler/` `sandbox/` `scheduler/` `security/redact.ts` `ssh/` `storage/` `tutorial/`(爬虫+RAG) |
| `src/preload/index.ts` | Preload 桥接 | contextBridge 暴露所有 IPC API（2900+ 行，待拆分） |
| `src/renderer/src/` | 渲染进程 | `App.tsx`(路由) / `pages/`(14 页面) / `components/`(ide/ai/history/knowledge/...) / `stores/`(Zustand) / `assets/`(icons+dict) |

### 配置与规范（项目根）

| 文件 | 用途 |
|------|------|
| `AGENTS.md` | **AI 开发指南**（本文件） |
| `CLAUDE.md` | **AI 硬约束**（A 红线 + B 开发约束 + C 白名单） |
| `.claude/agents/reviewer.md` | **审查 Agent 配置**（7 维审查 + BLOCK 权限） |
| `.claude/agents/*.md` | 其他 Agent 配置（api/architect/backend） |
| `package.json` | 依赖 + scripts（typecheck/lint/test/build/ai:*） |
| `electron.vite.config.ts` | 构建配置 |
| `tsconfig*.json` | TypeScript 配置（strict 模式） |
| `eslint.config.cjs` | ESLint 配置 |
| `playwright.config.ts` | E2E 测试配置 |
| `.env.example` | 环境变量模板 |

### 测试与脚本（`scripts/`）

| 路径 | 用途 |
|------|------|
| `scripts/test-*.ts` | 集成测试（cron-parser/scheduler/redact/sidecar/loop-smoke/...） |
| `scripts/browser-check/` | Playwright 视觉审计（截图对比 + audit report） |
| `scripts/ai-coordination/` | 多 AI 协作脚本（v8.4 备用，单 AI 模式不用） |
| `scripts/promptfoo/` | LLM 红队测试 + eval |
| `scripts/*.cjs` | 调试/诊断脚本（diag-db-health/probe-ssh/overnight-*） |

### Python Sidecar（3 进程隔离）

| 路径 | 端口 | 用途 |
|------|------|------|
| `sidecar-a/` | 7931 | Drain3 日志模板分析 + E2B/OpenDeRisk 沙箱 |
| `sidecar-b/` | 7932 | DoWhy 因果推断 |
| `sidecar-c/` | 7933 | AgentScope/SmolAgents 多 Agent |

### 学习沉淀（`.learnings/`）

| 文件 | 用途 |
|------|------|
| `LEARNINGS.md` | 全量经验沉淀（LRN-2026xxxx-xxx 系列） |
| `PROGRESS.md` | Phase 0-7 进度表 |
| `loop-progress.md` | 循环工程日常轮次日志 |
| `verify-report.md` | 验证报告 |
| `dead-code-audit.md` | 死代码审计 |
| `p1-visual-optimizations.md` | P1 视觉优化 |

### 文档索引（`docs/`）

> **分类规则**：按版本号 + 主题分类。开发时只需读"当前活跃方案书"，历史方案书按需查阅。

#### 当前活跃方案书（开发时优先读）

| 文件 | 行数 | 用途 |
|------|------|------|
| `design-to-delivery-功能兑现方案.md` | ~200 | **功能 gap 清单 + 死代码清单 + 补齐优先级**（最关键） |
| `DELIVERY_CHECKLIST.md` | ~60 | **交付验收清单 + 演示路径**（比赛用） |
| `v1.0-重构总方案书.md` | 960 | v1.0 架构决策 + 技术栈 + 路线图 |
| `AGENT_MAIN_PATH.md` | - | 主进程入口路径说明 |

#### UI 设计规范

| 文件 | 用途 |
|------|------|
| `UI设计规范-v2.0.md` | 最新 UI 设计规范（714 行） |
| `UI设计规范-v1.0.md` | v1.0 旧规范（550 行，历史参考） |
| `UI接入接线图-v0.9.5.md` | UI → IPC 接线图 |
| `UI_AUDIT_LATEST.md` | 最新 UI 审计报告 |
| `UI自检与修复方案-v2.2.md` | UI 自检方案（781 行） |
| `UI极致美学前后对比-v2.0.md` | 美学对比 |
| `UI美化前后对比-v0.7.0.md` | 早期美化对比 |

#### v1.0 分析报告系列

| 文件 | 用途 |
|------|------|
| `v1.0-设计稿规范与接口契约报告.md` | 设计稿 → 接口契约 |
| `v1.0-页面结构与视觉规范报告.md` | 页面结构 + 视觉规范 |
| `v1.0-设计稿差异分析报告.md` | 设计稿差异 |
| `v1.0-现有渲染层资产清单.md` | 现有资产 |

#### Agent 架构方案书系列（历史参考）

| 文件 | 行数 | 用途 |
|------|------|------|
| `方案书-v0.9.3-Agent架构设计最终整合版.md` | 2080 | **Agent 架构最终方案**（29 项 P0 借鉴 + 26 项落地改进） |
| `方案书-v0.9.2-Agent架构设计深度调研.md` | 1135 | 4 开源项目深度调研 |
| `方案书-v0.9.1-4Agent协作开发模式.md` | - | 4-Agent 协作模式 |
| `方案书-v1.5-循环工程配置子Agent.md` | - | 循环工程子 Agent |
| `方案书-v0.8.0-终端翻译模块.md` | - | 终端翻译 |
| `方案书-v0.7.0-Phase5g-UI修复与日志系统.md` | - | UI 修复 + 日志 |
| `方案书-v0.7.0-Phase5j-UI精致微调.md` | 623 | UI 微调 |

#### 问答归档 + 其他

| 文件 | 用途 |
|------|------|
| `问答归档.md` | 1924 行，全量问答 |
| `问答归档-v0.7.0-Phase5g.md` | Phase5g 问答 |
| `问答归档-v2.0-极致美学.md` | 美学问答 |
| `飞书文档-在线文档-大纲.md` | 飞书文档大纲 |
| `飞书文档-隐私政策-大纲.md` | 隐私政策大纲 |
| `OVERNIGHT_LOOP.md` / `OVERNIGHT_PROGRESS.md` | 通宵循环日志 |
| `OpenHands-list沙箱-session_api_key-调研报告.md` | 沙箱调研 |

### 上层调研报告（项目根上级）

| 文件 | 路径 | 用途 |
|------|------|------|
| `AI_Coding_Agent_自检失效根因分析报告.md` | `d:\ai\linux教学一体\` | AI 自检失效根因（30 条 URL） |
| `循环工程质量根因分析与改进方案.md` | `d:\ai\linux教学一体\` | 循环工程改进方案 + skill 清单 |

---

## 📦 历史归档区（开发时无需通读 · 按需查阅）

> **⚠️ 以下内容为历史经验沉淀，不是开发时必须遵循的规范。**
> AI Agent 开发时只需读上面的"项目概述/技术栈/协作规范/质量门禁/审查 Agent"部分 + `CLAUDE.md`。
> 以下内容仅在遇到特定问题时按需查阅（如 IPC 通道清单、循环工程经验、polish 经验）。
> **不要因为以下内容而停止开发**——规范是用来帮助开发的，不是用来阻碍开发的。

---

## 循环工程经验（v8.1 新增 · 2026-07-21）

> 本节记录 `build-runnable-tdsf-from-design` spec 全 Phase 执行过程中沉淀的 subagent-driven-development 模式最佳实践。

### 核心模式：subagent-driven-development

将大型 spec 拆分为 Phase → Task → SubTask 三层，父 agent 通过 `Task` 工具 dispatch 子 agent，每个子 agent 独立完成一个边界清晰的 Task 并返回报告。父 agent 汇总报告后决定下一步。

### 最佳实践

1. **subagent 启动协议（强制）**：
   - 第一步必跑 `git status` + `git log -5` 验证工作区状态
   - 第二步必读 `LEARNINGS.md` + `PROGRESS.md` 验证当前进度
   - 第三步必读 `CLAUDE.md` 的 A 红线（v8.4 单 AI 模式，无需 ai:check）
   - 禁止跳过上述步骤直接动手

2. **Task 边界原则**：
   - 每个 Task 必须有明确的「输入文件 / 输出文件 / 验证门禁」三要素
   - Task 之间禁止共享可变状态（通过 commit hash 传递）
   - 跨域 Task 必须由父 agent 协调，subagent 不跨域

3. **报告模板（subagent 必须返回）**：
   - 完成的 Task ID + commit hash
   - 实际修改的文件清单（区分新增 / 修改 / 删除）
   - 验证门禁通过情况（typecheck / lint / test）
   - 遗留问题与下一步建议

4. **工作区隔离**（v8.4 单 AI 模式）：
   - 单 AI 工作无需 claim/release 锁文件
   - 如并发 dispatch 多个 subagent 改同一文件，用 `git diff` 合并而非 claim 锁
   - commit message 无需带 Session ID（符合 Git Commit 规范即可）

5. **进度同步（防止 LRN-20260721-007 重演）**：
   - 每个 Task 完成后立即更新 `PROGRESS.md` 的进度表
   - commit message 包含 `Refs: Task X.Y` 便于反查
   - 不要等到最后批量更新 spec 文档

### 反模式

- ❌ subagent 跳过 `git status` 直接动手（导致 LRN-20260721-008 工作区污染）
- ❌ 父 agent dispatch 后不验证 subagent 报告（导致 spec 与代码脱节）
- ❌ subagent 报告混淆「我完成」与「工作区已存在」（导致父 agent 误判进度）
- ❌ Task 边界过宽（一个 Task 改 10+ 文件，难以审查）
- ❌ subagent 不跑验证门禁就报告「完成」（违反 verification-before-completion）

---

## IPC 通道清单（v8.1 新增 · 2026-07-21）

> 本节列出 `build-runnable-tdsf-from-design` spec 实现的全部 IPC 通道。所有通道遵守 IPC 4 步同步铁律（main 定义 → ipc/index.ts 注册 → preload 暴露 → electron.d.ts 类型）。

### loop:* · 循环工程

| 通道 | 用途 | 实现文件 |
|------|------|---------|
| `loop:start` | 启动循环工程 | `src/main/ipc/loop-engineering.ts` |
| `loop:stop` | 停止循环工程 | `src/main/ipc/loop-engineering.ts` |
| `loop:status` | 查询循环状态 | `src/main/ipc/loop-engineering.ts` |
| `loop:list` | 列出历史循环 | `src/main/ipc/loop-engineering.ts` |
| `loop:detail` | 查询循环详情 | `src/main/ipc/loop-engineering.ts` |

### scheduler:* · 定时任务调度

| 通道 | 用途 | 实现文件 |
|------|------|---------|
| `scheduler:list` | 列出所有定时任务 | `src/main/ipc/scheduler.ts` |
| `scheduler:create` | 创建定时任务 | `src/main/ipc/scheduler.ts` |
| `scheduler:update` | 更新定时任务 | `src/main/ipc/scheduler.ts` |
| `scheduler:delete` | 删除定时任务 | `src/main/ipc/scheduler.ts` |
| `scheduler:toggle` | 启用/禁用任务 | `src/main/ipc/scheduler.ts` |
| `scheduler:run-now` | 立即执行一次 | `src/main/ipc/scheduler.ts` |
| `scheduler:parse-cron` | 解析 cron 表达式 | `src/main/ipc/scheduler.ts` |

### ssh:* · SSH 连接管理

| 通道 | 用途 | 实现文件 |
|------|------|---------|
| `ssh:connect` | 建立 SSH 连接 | `src/main/ipc/ssh.ts` |
| `ssh:disconnect` | 断开连接 | `src/main/ipc/ssh.ts` |
| `ssh:exec` | 执行命令 | `src/main/ipc/ssh.ts` |
| `ssh:list` | 列出已保存连接 | `src/main/ipc/ssh.ts` |
| `ssh:save` | 保存连接配置 | `src/main/ipc/ssh.ts` |
| `ssh:delete` | 删除连接配置 | `src/main/ipc/ssh.ts` |
| `ssh:sftp-list` | SFTP 列目录 | `src/main/ipc/ssh.ts` |
| `ssh:sftp-get` | SFTP 下载文件 | `src/main/ipc/ssh.ts` |
| `ssh:sftp-put` | SFTP 上传文件 | `src/main/ipc/ssh.ts` |

### llm:* · LLM 推理

| 通道 | 用途 | 实现文件 |
|------|------|---------|
| `llm:chat` | 单轮对话 | `src/main/ipc/llm.ts` |
| `llm:stream` | 流式对话 | `src/main/ipc/llm.ts` |
| `llm:abort` | 中止推理 | `src/main/ipc/llm.ts` |
| `llm:test-connection` | 测试 API 连通性 | `src/main/ipc/llm.ts` |
| `llm:tools:list` | 列出可用工具 | `src/main/ipc/llm-tools.ts` |
| `llm:tools:call` | 调用工具 | `src/main/ipc/llm-tools.ts` |

### monitor:* · 监控

| 通道 | 用途 | 实现文件 |
|------|------|---------|
| `monitor:start` | 启动监控 | `src/main/ipc/monitor.ts` |
| `monitor:stop` | 停止监控 | `src/main/ipc/monitor.ts` |
| `monitor:get` | 获取监控数据 | `src/main/ipc/monitor.ts` |
| `monitor:history` | 查询历史数据 | `src/main/ipc/monitor.ts` |

### log:* · 日志

| 通道 | 用途 | 实现文件 |
|------|------|---------|
| `log:list` | 列出日志 | `src/main/ipc/log.ts` |
| `log:detail` | 日志详情 | `src/main/ipc/log.ts` |
| `log:analyze` | Drain3 分析 | `src/main/ipc/log.ts` |
| `log:export` | 导出日志 | `src/main/ipc/log.ts` |

### knowledge:* · 知识库

| 通道 | 用途 | 实现文件 |
|------|------|---------|
| `knowledge:list` | 列出知识条目 | `src/main/ipc/knowledge.ts` |
| `knowledge:detail` | 知识详情 | `src/main/ipc/knowledge.ts` |
| `knowledge:search` | 混合检索（FTS5 + 向量） | `src/main/ipc/knowledge.ts` |
| `knowledge:recommend-path` | 推荐学习路径 | `src/main/ipc/knowledge.ts` |

### history:* · 决策历史

| 通道 | 用途 | 实现文件 |
|------|------|---------|
| `history:list` | 列出决策记录 | `src/main/ipc/history.ts` |
| `history:detail` | 决策详情 | `src/main/ipc/history.ts` |
| `history:search` | FTS5 BM25 检索 | `src/main/ipc/history.ts` |
| `history:export` | 导出决策报告 | `src/main/ipc/history.ts` |

### 通道总数统计

| 域 | 通道数 |
|----|--------|
| loop:* | 5 |
| scheduler:* | 7 |
| ssh:* | 9 |
| llm:* | 6 |
| monitor:* | 4 |
| log:* | 4 |
| knowledge:* | 4 |
| history:* | 4 |
| **总计** | **43** |

---

## 评分基准（v8.1 新增 · 2026-07-21）

> 7 维质量评分标准，用于 subagent 完成 Task 后的自评与父 agent 的验收。**阈值：8.5/10**，低于阈值的 Task 必须返工。

### 7 维评分维度

| 维度 | 权重 | 评分标准 | 满分 |
|------|------|---------|------|
| **功能完整性** | 20% | 是否覆盖 Task 描述的全部需求？是否有遗漏的边界情况？ | 2.0 |
| **代码质量** | 15% | 是否符合 TypeScript strict？单文件 ≤ 500 行？单函数圈复杂度 ≤ 15？ | 1.5 |
| **设计稿还原度** | 15% | 渲染层是否 1:1 复刻设计稿？间距/字体/排版是否一致？ | 1.5 |
| **测试覆盖** | 15% | 是否有对应单元测试？集成测试？覆盖率 ≥ 85%？ | 1.5 |
| **IPC 4 步同步** | 10% | 新增 IPC 通道是否完成 4 步同步（main + ipc/index + preload + d.ts）？ | 1.0 |
| **Token 规范** | 10% | 是否全部使用 `var(--trae-*)`？无硬编码颜色？ | 1.0 |
| **文档同步** | 15% | 是否更新 LEARNINGS.md / PROGRESS.md？commit message 是否规范？ | 1.5 |

### 评分等级

| 总分 | 等级 | 处置 |
|------|------|------|
| ≥ 9.5 | A+ | 直接合并，作为标杆案例 |
| 9.0 - 9.4 | A | 合并，小修即可 |
| 8.5 - 8.9 | B+ | 合并，记录改进点 |
| 8.0 - 8.4 | B | **返工**，修复 P1 问题后重新提交 |
| 7.0 - 7.9 | C | **返工**，重新设计实现方案 |
| < 7.0 | D | **拒绝**，Task 边界或方向有误 |

### 评分流程（v8.3 更新 · 2026-07-22）

> **重构背景**：原流程"subagent 自评 + 父 agent 复评"都是同一个 AI 打分，
> 违反 Anthropic 官方"做事的 Agent 和打分的 Agent 必须不是同一个"原则。
> 现改为：每个 Task 完成后强制 dispatch reviewer agent（独立上下文）。

1. **implementer 完成**：完成 Task 后写报告（不含自评分数，只含改动清单 + 验证输出）
2. **reviewer 审查（每个 Task 强制 · CLAUDE.md A6）**：父 agent dispatch `.claude/agents/reviewer.md`，独立上下文 7 维审查 + 贴实际输出
3. **PASS/BLOCK**：reviewer 给出 PASS → 合并；BLOCK → dispatch fix-implementer 返工
4. **verifier 终评（每个 Phase）**：Phase 结束时由 verifier agent 全量 review
5. **归档**：最终分数写入 `PROGRESS.md` 的对应 Phase 条目

### 评分示例

```
Task 6.1 cron-parser 实现
- 功能完整性: 1.9/2.0（覆盖 cron 全语法，缺 L/W 高级修饰符）
- 代码质量: 1.5/1.5（strict + 单文件 412 行 + 圈复杂度 ≤ 12）
- 设计稿还原度: 1.5/1.5（scheduler UI 1:1 复刻）
- 测试覆盖: 1.5/1.5（37 个单测覆盖全部语法分支）
- IPC 4 步同步: 1.0/1.0（scheduler:parse-cron 4 步完成）
- Token 规范: 1.0/1.0（scheduler 页面全 Token）
- 文档同步: 1.4/1.5（PROGRESS.md 已更新，缺 LEARNINGS.md 一条）
总分: 9.8/10 → A+
```

---

*v8.1 归档更新 · 2026-07-21 · Phase 7.6*

---

## polish-tdsf-p1-issues 经验总结（v8.2 新增 · 2026-07-21 夜间）

> 本节记录 `polish-tdsf-p1-issues` spec 全 Phase 执行过程中沉淀的最佳实践与架构模式。
> 关联文档：`.learnings/LEARNINGS.md` LRN-20260721-009 至 013

### 1. IPC 通道集中化模式（19 域 71 通道常量）

**目标**：消除代码中所有 IPC 通道字面量字符串，统一到 `src/shared/ipc-channels.ts` 单一事实源。

**实现**（commit ff37091）：
- 19 个域 × 平均 3.7 个通道 = 71 个通道常量
- 每域用 `as const` 标注，确保字面量类型推断
- 三层引用同步：main (`ipcMain.handle`) / preload (`ipcRenderer.invoke`) / renderer (`window.electronAPI.xxx`)

**模式**：

```typescript
// src/shared/ipc-channels.ts
export const IPC_CHANNELS = {
  LOOP: {
    START: 'loop:start',
    CONFIRM: 'loop:confirm',
    CANCEL: 'loop:cancel',
    BLOCKED: 'loop:blocked',  // Phase D 新增
  } as const,
  SCHEDULER: {
    LIST: 'scheduler:list',
    TOGGLE: 'scheduler:toggle',
    TRIGGER: 'scheduler:trigger',
    STATUS: 'scheduler:status',
  } as const,
  // ... 其他 17 个域
} as const

// 引用方（main / preload / renderer）
import { IPC_CHANNELS } from '@shared/ipc-channels'
ipcMain.handle(IPC_CHANNELS.LOOP.START, handler)
```

**最佳实践**（详见 LRN-20260721-009）：
1. 三阶段渐进式集中化：扩展常量 → 批量替换 → 全量验证
2. 每域用 `as const` 标注，避免类型推断为 `string`
3. grep 验证 0 残留字面量

### 2. 大文件拆分模式（helpers + config + 主文件）

**目标**：把超过 500 行的文件按职责拆分为主文件 + helpers + config 子模块。

**实现**（commit ca0228e）：
- `credibility.ts` 597 → 445 行（抽出 `credibility-helpers.ts` 188 行）
- `sandbox.ts` 715 → 392 行（抽出 `sandbox-approval.ts` 199 行 + `sandbox-config.ts` 208 行）

**模式**：

```
原文件（715 行，混杛建模 + 审批 + 配置）
  ↓ 拆分
├── sandbox.ts          （392 行，主流程 orchestrator）
├── sandbox-approval.ts （199 行，审批流逻辑）
└── sandbox-config.ts   （208 行，配置读取与校验）
```

**最佳实践**（详见 LRN-20260721-010）：
1. 四步依赖分析法：识别类型边界 → 工具边界 → 逻辑边界 → 抽出测试
2. 主文件保留 orchestrator 角色，不包含具体业务逻辑
3. 抽出后立即跑 typecheck + 单测验证接口兼容
4. 命名约定：`<原文件名>-helpers.ts` / `<原文件名>-<职责>.ts` / `<原文件名>-types.ts`

### 3. 脱敏工具的 8 类正则规则

**目标**：所有写入日志/数据库/UI 的错误信息必须先经过 `redactSensitiveInfo()` 脱敏。

**实现**（commit 1fd3ee0）：
- 新建 `src/main/services/security/redact.ts`
- 8 类正则规则覆盖常见敏感信息

**8 类正则规则**：

| 序号 | 类别 | 正则模式示例 |
|------|------|--------------|
| 1 | API Key / Token | `(api[_-]?key\|token\|secret)['"\s:=]+['"]?[A-Za-z0-9_-]{20,}` |
| 2 | 密码 | `(password\|passwd\|pwd)['"\s:=]+['"]?[^\s'"]{6,}` |
| 3 | 私钥（PEM 块） | `-----BEGIN (RSA\|EC\|DSA\|OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END.*PRIVATE KEY-----` |
| 4 | JWT | `eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}` |
| 5 | IPv4 | `\b(\d{1,3}\.){3}\d{1,3}\b`（白名单除外） |
| 6 | 邮箱 | `[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}` |
| 7 | 手机号 | `\b1[3-9]\d{9}\b` |
| 8 | .env 文件路径 | `(?:^\|[\\/\\])\.env(?:[\\/\\]\|$\|\b)` |

**最佳实践**（详见 LRN-20260721-011）：
1. 所有正则必须有边界约束（`^` / `$` / `\b` / 字符类）
2. 白名单机制：已知安全的 IP / 邮箱不脱敏
3. 单测覆盖正例 + 反例两类
4. 脱敏后日志保留可读性，避免连续 `[REDACTED]`

**应用场景**：
- `daily-decision-archive.ts` catch 块写入日志前
- 任何 `console.error(error.message)` 调用前
- IPC 错误响应推送到渲染层前

### 4. SSH 预检查的 blocked 事件架构

**目标**：在 `doExecute` 前检查 SSH 连接状态，未连接时推 `loop:blocked` 事件让 UI 显示 BlockedCard。

**实现**（commit 3c393a5）：
- `SshConnectionManager.hasActiveConnection()` 同步方法（不抛错）
- `loop-engineering-subagent.ts` SSH 预检查 + `loop:blocked` 事件
- `LoopWorkflowPanel.tsx` 新增 `<BlockedCard />` 组件

**架构决策**（详见 LRN-20260721-012）：

选择独立事件 `loop:blocked` 而非复用 `loop:step` 的 `step: 'blocked'` 状态。原因：
1. **关注点分离**：blocked 是"前置失败"，与 HITL 7 步流程正交，不应混入 step 状态机
2. **UI 渲染清晰**：BlockedCard 是独立组件，与 StepProgress 并列渲染
3. **可扩展性**：未来可增加"权限不足 blocked"、"资源不足 blocked"

**事件流**：

```
正常流程：loop:start → loop:step(collect) → ... → loop:step(verify) → loop:done
预检查失败：loop:start → loop:blocked(reason=no-ssh-connection) → 等待用户操作 → loop:start（重试）
```

**最佳实践**：
1. 事件 payload 含 `{ reason: string, suggestion: string, retryable: boolean }` 三字段
2. blocked 不抛错、不中断 workflow，用户可解决后重试
3. 渲染层订阅独立事件时，useEffect cleanup 中正确取消订阅

### 5. lint warnings 修复的 3 种策略

**目标**：将 `no-explicit-any` warnings 从 3 个降至 0，不引入新 any。

**实现**（commit 2d3e348）：
- `client-manager.ts` 2 处 no-explicit-any 修复
- `langfuse.ts` 1 处 no-explicit-any 修复
- lint 0 errors / 0 warnings（原 3 → 0）

**3 种修复策略**（详见 LRN-20260721-013）：

| 策略 | 适用场景 | 示例 |
|------|----------|------|
| `unknown` + 类型守卫 | `catch (error)` 子句 | `catch (error: unknown) { if (error instanceof Error) ... }` |
| `Record<string, unknown>` | 函数参数传给 SDK | `function logEvent(name: string, metadata: Record<string, unknown>)` |
| 具体 SDK 类型 | SDK 返回值解构 | `import type { SDKResponse } from 'sdk'; const result: SDKResponse = await sdk.fetch()` |

**最佳实践**：
1. `catch (error)` 子句一律用 `unknown` + 类型守卫，禁止 `catch (error: any)`
2. 函数参数禁止 `any`，必须用 `Record<string, unknown>` 或具体 interface
3. SDK 调用优先 `import type` 引入 SDK 类型
4. pre-commit hook 加入 `eslint --max-warnings=0` 阻止新 any 进入仓库

---

*v8.2 归档更新 · 2026-07-21 夜间 · polish-tdsf-p1-issues Phase F*
