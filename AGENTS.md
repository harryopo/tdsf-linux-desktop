# TDSF-Linux Desktop - AI Agent 开发指南

> 编码规范见 `CODING.md`；界面规范唯一权威是 `DESIGN.md`（动 `src/renderer/**` 前先读它）；
> AI 入口指引与核心红线见 `CLAUDE.md`。
> **本文件不抄门禁数字**——每一轮的退出码只有当轮那次运行算数。

---

## 项目定位

**TDSF-Linux Desktop** = SSH 终端 + AI 辅助 + 高危命令拦截 + 日志分析 + 可信决策

> 帮助 Linux 初学者不怕命令行的桌面工具。

详细的产品定位、目标用户与"不要做成什么"见 `PRODUCT.md`。

---

## 三进程架构

```
主进程 (src/main/)      — Node.js：ssh2 / LLM / SQLite / 命令闸 / 可信度 / MCP / 技能
预加载 (src/preload/)   — contextBridge 安全桥接，按域拆分，入参走 zod 契约
渲染层 (src/renderer/)  — React 19 + Zustand 5，沙箱隔离，不用 Ant Design
共享 (src/shared/)      — 跨进程类型与常量的单源（IPC 通道名、可信度表、boot 载荷）
```

Electron 安全三原则（`contextIsolation:true` / `nodeIntegration:false` / `sandbox:true`）
是硬红线，见 `CLAUDE.md` 第 4 条。

---

## 关于"模块完成度表"

本文件以前有一张 2026-07-23 拍的模块状态表（Task Protocol 95%、Claude SDK 90%、IPC 55+ 通道……）。
**它已经不可信了，所以删掉而不是更新**：

- 那种百分比没有测量方法，改一次代码它就过期，而且没人会去复核它；
- 里面的"Claude SDK 集成"根本不存在（不是依赖，`src/main` 全仓搜不到）；
- "14 步 Task Protocol"有代码有测试，但**生产链路零调用**——把这种写成 95% 完成度，
  下一个接手的人会以为能直接用。（这条 2026-10-20 已经判掉：整删，见下面的降级表。）

要判断某个模块的真实状态，读它的代码和它的测试，别读任何汇总表。
已知降级或没接上的能力，统一列在 `README.md` §已知边界，
逐条带 `file:line` 的完整版在 [docs/功能实景清单.md](docs/功能实景清单.md)（A 可用 / B 有条件 / C 断线）；
往前要做什么在 [docs/长期优化目标.md](docs/长期优化目标.md)。

---

## 降级策略（接口保留，待后续迭代）

| 模块 | 当前策略 | 保留内容 | 恢复的前提 |
|------|-----------|----------|------------|
| Langfuse 追踪 | 无 Key 自动关闭 | `langfuse.ts`、`langfuse-trace.ts` | 配 Key 即启用 |
| Python 侧车（Drain3 日志模板） | 缺 venv 时整条链路降级并在界面显示原因 | `sidecar-a/` + 宿主监督与握手代码 | 重建 venv + 装依赖 |

> **14 步 Task Protocol 不在这张表里了**（2026-10-20 整删）：实现 7 个文件、`task-sediment`、
> `ipc/task-permission-approval`、`TASK` 通道、preload 两把键与那批单测一起删，代码只留在 git 历史。
> 别把同目录的东西一起打成"死代码"，也别把"注册在跑"当成"有人在用"——这两条在同一天都各咬了一口
> （2026-10-25 #216）：`agent-loader` 唯一的读者就是 `ipc/subagent.ts` 那两把渲染层零调用的键，
> 所以它随通道一起整删；反过来，`ipc/risk.ts` 整删会带走同文件里**活着**的 `risk:rules`
> （设置页风险控制区在读），这一刀是 `pnpm audit:ipc` 报"preload 调了但主进程未注册"才拦下来的。
> **判"死"要按通道与调用点判，不能按文件判。**`subagents/dispatcher.ts` 的 8 步调度
> 已于 2026-10-24 整删（生产零调用、与 supervisor 的 PAOR 重复，专属测试与 barrel 导出同批删）。
> 当时接的替手"循环工程"（`loop-engineering-subagent` 与注册它的 `ipc/loop-engineering.ts`）
> 也已于次日 #222 整删——**现在产品里唯一在跑的多步编排就是 Supervisor 的 PAOR**，别再写"还有另一条在跑"。
> **`ipc/agent.ts` 与裸 `llm:*` 家族同样已于 2026-10-24 整删**（`agent:start/confirm/cancel` +
> `agent:step`、`llm:chat/analyze/validate/chat-with-context/chat-with-tools/tool-approve` 与 6 条推送）：
> 渲染层零调用，主对话一直是 `agent:chat`（Supervisor）那一条。当年留下的 `core/agent-workflow.ts`
> 也已于 **2026-10-29 #281 整删**：它唯一的入站消费者是"把本应用能力暴露给外部客户端"的 MCP Server，
> 而那个 Server 只接 `StdioServerTransport`——桌面主进程的 stdio 没有对端，外部客户端结构上连不上
> （实测：开 `MCP_SERVER_ENABLED=true` 后日志写"Server 已启动"，`netstat` 里 3107 命中 0，配置里那个端口
> 在代码注释中自认"只用于展示"）。同一刀带走的还有 `services/mcp/tools/registry-*.ts` 七张工具表、
> `resources.ts`/`prompts.ts`、`services/llm/tools/` 那五个工具外壳、`services/deploy/` 整条模板链、
> `diagnostics/log-analyzer.ts` 与 `shared/llm-tool-types.ts`——**它们的存在理由是那张入站派发口**。
> 那一刀之后诊断服务那个目录还剩一份类型抄本（里面真在用的只有 `LogLevel`，
> 与应用日志那个同名联合一字不差）和一条还在 import 已删服务的死脚本；两处都已于 **2026-10-30 #282** 收走，
> sidecar 现在直接从 `services/log/logger.ts` 取 `LogLevel`。常驻闸：`tests/unit/no-dangling-relative-imports.test.ts`
> ——**删完一条链要回头扫"谁还指着它"**，手工脚本不在 CI、注释不在 doc:links 的面上，这类断链只有门能抓住。
> 决策超时那条设置键没有跟着变摆设：它现在的消费者是 `src/main/core/security/approval-request.ts`
> （主进程启动时注入取数口，到点自动拒绝）。界面上只留外部 MCP 客户端那一条（设置 → MCP，每次调用人工审批）。
> **五模式（chat/ask/plan/code/debug）已于 2026-10-24 整删**：`ipc/mode.ts`、`core/agent/modes/`
> （含 ask/plan 两份系统提示词共 295 行）、`MODE` 通道、preload 三键与 `agent-types.ts` 里那组形状。
> 判决理由不是"没人按"，是**它兑不了自己许的诺**：Supervisor 取 systemPrompt 不读 mode，
> `getAllowedTools` 生产零调用，所以"ask 只读""plan 不执行"从来没有执行体；而 MCP 资源
> `tdsf://config/agent-mode` 曾把 `canWriteFiles`/`canExecuteCommands` 当真实能力报给外部客户端。
> 下一次想加模式，先写执行体（拦截点或注入点），再谈界面上的选择器。

> CoT 熵轨迹**不在这张表里**：收集与 SVG 可视化都在链路上（`supervisor.ts:1462` → `agent-store.ts:381`
> → `ChatCredibility.tsx:120` → `ConfidenceBreakdown.tsx:117`），只是那一轮没采到熵点时不画。
> 旧版本这里写过"可视化未做/待前端接线"，是照抄 2026-07-25 的表没回代码核对——2026-10-18 纠正。
>
> **D-S / PCR5 同样不在这张表里**（2026-10-19 纠正，与上面那条是同一类错）：`credibility:assess`
> 先按 `decision.weights` 做 Shafer 折扣（`ipc/credibility-helpers.ts:269`），折扣完的那批 mass function
> 仍然进 `FusionEngine.fuseAndAssess`（`ipc/credibility.ts:184` → `credibility/fusion-engine.ts:174`：
> 两两冲突 < 0.3 走 Dempster，否则 `pcr5.ts` 重分配）。旧版本写"生产走折扣后的简化融合"
> ——折扣是真的，但"简化融合"没有，写这话时没打开过函数。
> （原来这里还写着"MCP 那条用的是同一个引擎"——那条入站 MCP 工具出口已随 #281 整删，句子跟着撤。）

---

## 终端 OSC 规矩（动 xterm 之前必读）

**注册 OSC handler 一律 `return false`。**

`term.parser.registerOscHandler(ident, cb)` 的分发规则是：同一 ident **后注册的先被调用**，
回调返回 `true` 表示"我已处理，停止传播"——于是谁先 `return true`，后面的 handler
和 xterm 内建处理就全收不到。这类 bug 只坏一半：本地终端一条命令块都产不出来，
而 SSH 侧因注册顺序不同侥幸正常。

我们的 handler 只旁听（命令块收集器读 OSC 133/633），不接管渲染，所以永远返回 false。
判据：`tests/unit/xterm-osc-return-false.test.ts` 扫 src 下每个 `registerOscHandler`，
回调体必须以 `return false` 收尾且不得出现 `return true`。

命令-输出块的切分逻辑在 `src/renderer/src/terminal/block-model.ts`（纯函数，可单测），
xterm 接线在 `block-collector.ts`。**读屏幕只能读 `term.buffer.active`**，
不要缓存行内容——滚动后行号会整体位移。

---

## 审查 Agent

- **reviewer**：`.claude/agents/reviewer.md` — 每个 Task 完成后 7 维审查
- **outsider-reviewer**：`.claude/agents/outsider-reviewer.md` — 每 3-5 版本 11 维审查
- **verifier subagent**：声明"任务完成"前必须 dispatch（见 `CLAUDE.md` 第 6 条核心红线）

---

## 文件所有权

> **本节是协作模式的唯一权威声明**：允许几个 AI 并行、工作流、禁并行清单、分支策略均以此处为准；
> 其他文件（`CLAUDE.md`、规则镜像等）只引用本节，不得另行定义。

### 多 AI 并行工作流

1. **启动预检**：每个 AI 会话开始前运行 `pnpm ai:check`
2. **声明所有权**：修改文件前 `pnpm ai:claim -f <file> -t <task>`
3. **释放所有权**：修改完成后 `pnpm ai:release -f <file>` 或 `--all`
4. **提交规范**：commit message 包含 sessionId，例如 `feat(xxx): [ai-20260725-001] ...`
5. **claim 必须活到提交那一刻**：顺序只能是 claim → 改 → commit → release。
   改完就 release 会被 pre-commit 钩子拦下。
6. **高共享文件中央协调**：以下文件禁止并行修改，需由当前主导 AI 串行处理
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
| 质量 AI | `tests/`, e2e, 死代码审计, 各类闸 | 业务代码只读 |

### 分支策略

- `master`：单一可发布状态，只合并已过全部门禁的提交
- 特性分支：正常工作区，完成后快进合并回 `master`

### 冲突处理

- 发现冲突先 `git status`，不要覆盖他人的修改
- 高共享文件冲突时，优先与相关 AI 协商，或统一由后端 AI 串行处理
- 过期 claim 由任一 AI 在修改 `.ai-coordination.json` 时清理

---

## 仓库卫生（公开仓的规矩）

- **产物不入库**：`scripts/.cjs/`、`tests/e2e/screenshots*/`、`__pycache__/`、`.tmp/`、
  `docs/assets/{theme-check,ui-audit-*,ui-baseline}/`。
  `.gitignore` 已挡；**新克隆要注意：`.gitignore` 对已被跟踪的文件完全无效**，
  发现"忽略规则写了但文件还在跟踪集里"要 `git rm --cached` 补一刀。
- **内部文档不入库**：审查报告、交接文档、故障复盘、评审材料与演示文稿一律本地保留、不提交。
  本仓库公开在跑的文档见 `docs/INDEX.md`。
- **发版说明草稿不入库**（`.gitignore` 里 `RELEASE_NOTES*.md`）：1.0 尚未发布，而草稿最容易漂成
  "写着已删能力"的假账——第一份就是这么长出来的（2026-10-29 把 `RELEASE_NOTES_v1.0.0.md` 摘出跟踪集：
  它还在写"8 Subagent 并行"与"Claude Agent SDK"，两者都不是事实，且没有任何活消费者）。
  **发版时按当期真值现写**，别拿旧草稿改两个字就发。
- **凭据值永不进任何文本**：源码、测试夹具、注释、提交信息、日志都不行。
  需要示例就拆成相邻字面量（避免触发 GitHub 密钥扫描的真警报邮件）。
- **Tailwind v4 的内容源 = "git 看得见的文件"**：未跟踪又未忽略的目录会被扫进产物 CSS，
  所以任何 scratch 目录**必须先加 .gitignore 再往里写东西**。

---

*v14 · 2026-10-20 · 14 步 Task Protocol 按判决整删（实现 + 专属测试 + `TASK` 通道 + preload 键 +
审批类型一起走，代码只留在 git 历史）；降级表因此少一行，"别把在跑的东西一起打成死代码"改成表下的注。
上一版（v13 · 2026-10-19）新增两份讲真话的入口文档：docs/功能实景清单.md（能力按 A/B/C 三档判决，带 file:line）
与 docs/长期优化目标.md（每条目标绑一处代码欠账），并把门禁清单标清哪几把只在本地跑
