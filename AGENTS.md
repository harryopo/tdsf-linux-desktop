# TDSF-Linux Desktop - AI Agent 开发指南 v8.0

> 本文件是所有 AI Agent（Claude Code / Trae / Codex 等）在本项目工作时的通用入口。
> 更新日期：2026-07-20
> 版本：v8.0（新增多 AI 并发协作冲突预防协议）

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

## 文件所有权声明

```yaml
main-agent:     {domains: [src/main/**], forbidden: [src/renderer/**]}
renderer-agent: {domains: [src/renderer/**], forbidden: [src/main/**]}
shared-files:   [src/shared/**, AGENTS.md, package.json, tsconfig*.json]
test-agent:     {domains: [tests/**], forbidden: [src/main/**, src/renderer/**], readonly: [src/**]}
```

## 多 AI 并发协作规范（v8.0 新增，**强制**）

> **背景**：用户常同时开多个 AI 会话（Trae / Claude Code / Codex），可能并发修改同一文件，导致内容覆盖或互相读到不一致的中间状态。本节定义冲突预防协议。

### 3 层防护架构

1. **预防层（中央登记）**：每个 AI 修改文件前必须 `claim`；写完后必须 `release`。
2. **检测层（写前自检）**：启动时跑 `check-conflict.ps1`；写文件前再跑一次。
3. **补救层（Git 仲裁）**：即便有登记，**Git 永远是最终事实源**。所有冲突由 commit 历史可追溯、可回滚。

### 工作流（每个 AI 会话必须遵守）

```
启动 ──▶ pnpm ai:check ──▶ pnpm ai:claim -f -t ──▶ 修改文件 ──▶ typecheck + lint ──▶ pnpm ai:release -f ──▶ git commit
```

| 阶段 | 命令 | 必须 |
|------|------|------|
| 启动时 | `pnpm ai:check` | ✅ 必跑 |
| 修改前 | `pnpm ai:claim -f <path> -t <desc>` | ✅ 必跑 |
| 修改中 | 不要中途关闭会话，claim 2h 自动过期 | ⚠️ 注意 |
| 完成后 | `pnpm ai:release -f <path>` 或 `pnpm ai:release --all` | ✅ 必跑 |
| 提交时 | `git add .ai-coordination.json` + commit | ✅ 必跑 |
| 查询时 | `pnpm ai:status` 或 `pnpm ai:status -f <path>` | 按需 |

> 也可直接用 `node scripts/ai-coordination/*.cjs`，pnpm scripts 只是快捷方式。

### 核心约束

1. **写文件前必 claim**：未 claim 的修改视为违规；其他 AI 有权拒绝协作。
2. **commit message 必须带 Session ID**：`fix: WorkbenchPage 修复 (session: ai-20260720-001)`。
3. **claim 自动 2 小时过期**：防止 AI 崩溃后锁永久持有；过期后其他 AI 可强制 claim。
4. **冲突时优雅降级**：
   - 不强行覆盖
   - 读 `git diff` 了解对方修改
   - 合并思路或切换到下一个任务
   - 在 PR / commit 中说明
5. **域级所有权仍生效**：在 v7.0 文件所有权基础上叠加 claim；不允许跨域 claim（如 renderer-agent 不可 claim `src/main/**`）。
6. **Git 是最终仲裁**：即使两个 AI 都 claim 了同一文件，git merge 处理冲突，本协议只预防**同时写入**而不是 merge 冲突。

### 反模式（禁止）

- ❌ 直接 Write/Edit 文件不先 claim
- ❌ 写完文件忘记 release（导致其他 AI 误判为占用）
- ❌ 修改 `.ai-coordination.json` 而不通过脚本（破坏数据一致性）
- ❌ commit 时不连带提交 `.ai-coordination.json`（其他 AI 看不到状态变化）
- ❌ 强制覆盖被 claim 的文件（必须先沟通或换任务）

### 故障排查

| 现象 | 原因 | 解决 |
|------|------|------|
| `claim` 报"文件被占用" | 其他 AI 正在写 | `status.ps1 -File <path>` 查看；或等其完成 |
| 看到过期 claim | 旧会话崩溃 | 手动编辑 `.ai-coordination.json` 删除；或 `check-conflict.ps1` 提示 |
| 多个 AI 改了同一文件 | 没遵守协议 | `git diff` 合并；commit message 标注多 Session |
| `.ai-coordination.json` 冲突 | git merge 冲突 | 手动合并：保留所有 sessions，手动 add 文件 |

### 文件级 Lock Frontmatter（可选强提示）

对争议多的关键文件，可在 TypeScript 顶部加注释（**仅提示，不强制**）：

```typescript
// @ai-session: ai-20260720-001
// @ai-task: WorkbenchPage 1:1 复刻
// @ai-claimed-at: 2026-07-20T15:00:00Z
// @ai-expires-at: 2026-07-20T17:00:00Z
```

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
- 单文件 ≤ 500 行
- 单函数圈复杂度 ≤ 15
- **v7.0 新增**：所有 LLM 调用必须有 Langfuse trace
- **v7.0 新增**：所有高危命令必须有 Ground-Check 证据

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

## 开源参考项目

| 项目 | 路径 | 用途 | License | 借鉴方式 |
|------|------|------|---------|---------|
| databuff | `../opensource-reference/databuff/` | AI APM 架构 | AGPL-3.0 | ⚠️ 只借鉴思想 |
| tabby | `../opensource-reference/tabby/` | Electron SSH 架构 | MIT | 可自由借鉴 |
| mastra | `../opensource-reference/mastra/` | TS Agent 框架 | Elastic-2.0 | ⚠️ 只参考架构 |
| cube-shell | `../opensource-reference/cube-shell/` | Python SSH 客户端 | MIT | 可自由借鉴 |
| itops-agent-platform | `../opensource-reference/itops-agent-platform/` | ITOps Agent | MIT | 可自由借鉴 |

### ⚠️ License 红线

- **AGPL-3.0 项目（databuff）**：只借鉴架构思想，**绝不复制代码**
- **Elastic-2.0 项目（mastra）**：只参考架构，**不复制代码**
- **MIT 项目**：可自由借鉴，但需保留原始 License 声明

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

## 循环工程经验（v8.1 新增 · 2026-07-21）

> 本节记录 `build-runnable-tdsf-from-design` spec 全 Phase 执行过程中沉淀的 subagent-driven-development 模式最佳实践。

### 核心模式：subagent-driven-development

将大型 spec 拆分为 Phase → Task → SubTask 三层，父 agent 通过 `Task` 工具 dispatch 子 agent，每个子 agent 独立完成一个边界清晰的 Task 并返回报告。父 agent 汇总报告后决定下一步。

### 最佳实践

1. **subagent 启动协议（强制）**：
   - 第一步必跑 `git status` + `git log -5` 验证工作区状态
   - 第二步必读 `LEARNINGS.md` + `PROGRESS.md` 验证当前进度
   - 第三步必跑 `pnpm ai:check` 检查 AI 协作冲突
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

4. **工作区隔离**：
   - 多 subagent 共享同一工作区时，必须先 `pnpm ai:claim` 锁定文件
   - 完成后立即 `pnpm ai:release` 释放锁
   - commit message 必须带 Session ID

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

### 评分流程

1. **subagent 自评**：完成 Task 后，按 7 维打分并写入报告
2. **父 agent 复评**：dispatch 完成后，父 agent 验证分数合理性
3. **verifier 终评**：Phase 7.7 由 verifier agent 全量 review，给出最终分数
4. **归档**：最终分数写入 `PROGRESS.md` 的对应 Phase 条目

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
