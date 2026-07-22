# CLAUDE.md · TDSF Linux Desktop

> 本文件是 Claude Code / Trae / Codex 等 AI Agent 在本项目工作时的**约束清单**。
> 与 `AGENTS.md` 互补：AGENTS.md 是「如何工作」的指南，CLAUDE.md 是「不可违反」的红线。
> 更新日期：2026-07-22 · v2.4 A9 收窄边界 + A10-A14 降级为 B6-B10（完全放宽，后续逐步缩减）

---

## 约束分级说明（v2.0 重构 · 2026-07-22）

> **重构背景**：原 v1.0 把 7 条规则全标为"A 红线"，导致 AI 为了不违反红线而"宁愿不干也不愿冒险"。
> 现改为三级分类，让开发阶段有弹性，发布阶段有刚性。

| 级别 | 含义 | 违反处置 |
|------|------|---------|
| **A 红线** | 不可违反的安全/质量底线 | 返工 + 记录 LEARNINGS |
| **B 开发约束** | 发布前必须满足，开发阶段可临时违反但**必须标注 `// WIP:`** | 发布前必须修复；未标注 WIP 的违规按 A 红线处置 |
| **C 白名单** | 明确允许的例外 | 不视为违规 |

---

## A 红线（不可违反 · 违反即返工）

### A1 · IPC 4 步同步铁律

任何新增 IPC 通道必须完成 4 步同步，**缺一不可**：

1. **main 定义**：在 `src/main/ipc/<domain>.ts` 中实现 `ipcMain.handle('<channel>', ...)` handler
2. **ipc/index.ts 注册**：在 `src/main/ipc/index.ts` 中导入并注册该 handler
3. **preload 暴露**：在 `src/preload/index.ts` 中通过 `contextBridge.exposeInMainWorld` 暴露给渲染进程
4. **d.ts 类型声明**：在 `src/renderer/src/types/electron.d.ts` 中声明 TypeScript 类型

**验证**：`pnpm typecheck:node && pnpm typecheck:web` 双绿。如出现「Property does not exist on type 'Window'」错误，说明 4 步中至少一步缺失。

### A2 · TypeScript strict 模式

`tsconfig.json` 必须启用 `"strict": true`，禁止：

- `any` 类型（如必须使用，需 `// eslint-disable-next-line @typescript-eslint/no-explicit-any` 并附注释说明原因）
- 隐式 `any`（函数参数、变量声明必须显式标注类型）
- `as unknown as T` 双重断言（除非有明确的类型边界冲突，需注释说明）
- `!` 非空断言（除非有运行时保证，需注释说明）

**验证**：`pnpm typecheck:node && pnpm typecheck:web` 双绿 + `pnpm lint` 0 errors（warnings 允许 ≤ 3 个 pre-existing）。

### A3 · catch 块 error.message 写入日志前必须脱敏

**所有 `catch` 块中的 `error.message` / `error.stack` 在写入日志、数据库、IPC 响应前必须经过 `redactSensitiveInfo()` 脱敏**：

```typescript
/* ✅ 允许 */
import { redactSensitiveInfo } from '@/main/services/security/redact'
catch (error: unknown) {
  const safeMessage = error instanceof Error
    ? redactSensitiveInfo(error.message)
    : redactSensitiveInfo(String(error))
  logger.error({ msg: safeMessage, ... })
}

/* ❌ 禁止 */
catch (error: any) {
  logger.error(error.message)  // 未脱敏
}
```

**验证**：`grep -rn "catch.*error.*{" src/main/ --include='*.ts'` 检查每个 catch 块。

### A4 · 诚实标注未完成（v2.0 新增 · 直击死占位 UI 问题）

> **背景**：上一轮调研发现，死占位 UI 的根因是 AI 偏好"完成"而非"诚实标注未完成"。
> Anthropic 官方建议：*"You MUST NOT claim a task is complete without pasting the actual command output that proves it"*

**禁止以下行为**（违反即 BLOCK）：

1. ❌ 声称"测试通过"但未贴测试输出
2. ❌ 声称"UI 已实现"但 onClick 调的是空函数 / `() => {}`
3. ❌ 声称"功能完成"但 IPC 通道无 handler
4. ❌ 声称"已对接后端"但用的是 mock 数据 / 硬编码假数据
5. ❌ 用 `// TODO` 伪装已完成（TODO 必须配合 `// WIP:` 明确标注未完成）

**正确做法**（诚实标注未完成）：

```typescript
// WIP: SSH 连接功能未实现，预计 Task 2.3 完成
// NOT_IMPLEMENTED: 这个按钮暂时没有 handler，等后端 IPC 就绪后对接
function handleConnect() {
  // WIP: 等 ssh:connect IPC 通道实现后对接
  console.warn('handleConnect: not implemented yet')
}
```

**验证**：
- `grep -rn "TODO\|FIXME" src/` 检查每个 TODO 是否配合 `// WIP:` 标注
- `grep -rn "=> {}" src/renderer/` 检查空函数是否标注 `// WIP:`
- reviewer agent 检查 implementer 报告中的"完成"声明是否有证据

### A5 · Skill 使用要求（v2.0 新增 · 用户硬要求）

> **背景**：循环工程过程中 skill 使用不充分，只用了 `subagent-driven-development`，
> 没用 `code-review`/`systematic-debugging`/`webapp-testing`——这是自检失效的直接原因。

**开发类 skill 使用清单**（按场景必用）：

| 场景 | 必用 skill | 用途 |
|------|-----------|------|
| 写新功能前 | 查全局 skill 列表 | 避免重复造轮子 |
| UI 开发 | `frontend-design` / `web-dev` / `impeccable` | 高质量前端 |
| 代码审查 | `code-review` / `trae-remote-official:coderabbit:code-review` | 独立二次审查 |
| 遇到 bug | `systematic-debugging` | 系统化调试，不拍脑袋 |
| 写测试 | `test-driven-development` / `webapp-testing` | TDD + 自动化测试 |
| 大型 spec | `subagent-driven-development` | 循环子 agent 编排 |
| 组件开发 | `shadcn` / `vercel-react-best-practices` | 组件复用 + 性能最佳实践 |
| 遇阻联网 | `research-first` / `agent-reach` / `multi-search-engine` | 全网调研根因 |

**约束**：
- 动工前先查全局 skill 列表，有相关 skill 必须调用
- 无相关 skill 则全网搜索（`research-first` / `agent-reach`）
- reviewer agent 会检查 skill 使用情况，未使用的标注"skill 缺失"

**验证**：reviewer agent 审查报告中包含"skill 使用"维度。

### A6 · 审查 agent 强制调用（v2.0 新增 · Anthropic 官方推荐）

> **背景**：Anthropic 官方 Best Practices 原文：
> *"做事的 Agent 和打分的 Agent 必须不是同一个。a verification subagent has a fresh model try to refute the result."*
> 原 v1.0 的 verifier 是"Phase 7.7 才做"，导致 bug 积累一整个 Phase 才发现。

**每个 Task 完成后必须 dispatch reviewer agent**（`.claude/agents/reviewer.md`）：

```
implementer 完成 Task
  ↓
父 agent dispatch reviewer agent（独立上下文）
  ↓
reviewer 7 维审查 + 贴实际输出
  ↓
PASS → 合并；BLOCK → dispatch fix-implementer 返工
```

**禁止**：
- ❌ implementer 自己 review 自己（自评不算数）
- ❌ 跳过 reviewer 直接合并
- ❌ 用"测试通过"总结代替 reviewer 的实际输出

**验证**：每个 Task 的 commit 历史中必须有 reviewer 报告。

### A7 · 质量绝对优先（v2.1 新增 · 2026-07-22 用户硬约束）

> **背景**：用户明确要求"质量优先而不是轻量优先，可以开发的很大，占用的空间很大，但是就是要质量优先"。
> 这条约束覆盖所有"为了轻量/省体积/省资源而跳步或降级方案"的倾向。

**核心原则**：
1. **质量 > 轻量**：选型时优先选功能完整、生产成熟的方案，不为了省体积选轻量但不成熟的方案
2. **质量 > 效率**：不允许为了节省开发效率/资源/体积而跳步或降级方案
3. **体积允许做大**：软件体积无上限约束，功能必须真正实现（非 mock/占位）
4. **开源源码全量分析**：调研任何开源项目必须先 git clone 全量分析，不能仅凭 README 判断

**技术选型原则**：
- 框架选型：优先选 2026 年主流 + 生产成熟方案（如 LangGraph.js 状态机编排 > 轻量但不成熟的方案）
- 被砍方向重新评估：之前为了轻量而"不建议"的方向，在质量优先原则下应重新评估
  - Cline gRPC + protobuf（之前说"过度设计"→ 质量优先下值得评估）
  - Aider RepoMap PageRank + tree-sitter（之前说 P1 → 质量优先下应做）
  - knip unused exports 检查（之前说 P2 → 质量优先下应做）
  - Cline Checkpointing 影子 git 回滚（之前说 P1 → 质量优先下必须做）

**禁止**：
- ❌ 为了省体积而删功能或降级方案
- ❌ 为了省资源而跳过测试/验证步骤
- ❌ 用"轻量"作为质量不足的借口
- ❌ 拒绝引入主流框架（如 LangGraph.js）仅因为"增加了依赖"

**验证**：每次选型决策必须贴出"质量 vs 轻量"对比表，质量优先时选质量方案。

### A8 · 避免重复造轮子（v2.2 新增 · 2026-07-22 用户硬约束）

> **背景**：用户明确要求"避免重复造轮子"。项目已积累 17 份调研报告 + 8 份源码分析报告 + 18 个已 clone 项目，必须充分利用这些资产。

**核心原则**：动工前必须先查开源项目复用清单，有现成方案必须复用，禁止重复造轮子。

**强制流程**：
1. 动工前查 `开源项目复用清单.md`，确认是否有现成开源方案
2. 有方案：直接依赖 / 借鉴架构 / 参考实现（按复用方式选择）
3. 无方案：先全网调研（research-first / agent-reach skill），确认无成熟方案后才自行实现
4. 自行实现的模块必须在代码顶部注释说明"为何不复用开源方案"

**禁止**：
- ❌ 已有成熟开源库却自行实现（如 SSH 协议不用 ssh2 而自己写）
- ❌ 已有源码分析报告却不参考（如不读 Cline 源码分析就实现 Agent）
- ❌ 不查调研清单就动工
- ❌ 复用 AGPL/SSPL/未标注 License 项目代码（仅可借鉴架构思想）

**复用方式分级**：
- 🟢 直接依赖：npm 安装即用（如 ssh2、xterm.js、Mastra、Vercel AI SDK 7）
- 🟡 借鉴架构：参考设计思想，TS 等价实现（如 Cline plan-and-act、Aider git 沙箱回滚）
- ⚪ 待评估：列入待办，调研后决策
- 🔴 红线：仅架构参考，禁止代码复用（如 AGPL/GPL/闭源项目）

**配套文档**：
- `d:\ai\linux教学一体\开源项目复用清单.md`（主清单，636 行）
- `d:\ai\linux教学一体\idea-to-dev-output\00-调研索引.md`（17 份调研报告索引）
- `d:\ai\linux教学一体\opensource-reference\`（18 个已 clone 全量源码）

**红线 License 清单**（仅架构参考，禁止代码复用）：
- AGPL-3.0：databuff / Coder / Warp
- SSPL：所有 SSPL 项目
- GPL-3.0：JumpServer / judge0 / bashlex
- LGPL-3.0：cube-shell
- 闭源/专有：claude-code（仅通过 Claude Agent SDK 集成）/ Gemini CLI（已闭源）/ Roo Code（已归档）
- 未标注 License：nterm-ng

**已确认主推方案**（无需重复评估）：
- Agent 编排：Mastra v1.34.x + Vercel AI SDK 7（Apache-2.0）
- SSH 协议：ssh2（MIT，已用）
- 终端渲染：xterm.js（MIT，已用）
- 凭证加密：Electron safeStorage（MIT，已用）
- Bash 解析：web-tree-sitter + tree-sitter-bash WASM（MIT）
- 代码编辑器：monaco-editor + @monaco-editor/react（MIT）
- 沙箱主方案：OpenHands Docker runtime 借鉴（MIT）

**验证**：reviewer agent 审查报告中包含"开源复用"维度，未查清单直接动工的标注"复用清单缺失"。

### A9 · 技术栈 Skill 调用前置（v2.4 收窄边界 · 2026-07-22）

> **背景**：项目已沉淀 8 大技术栈 10 份调研文档（`docs/tech-stack-skills/`）+ 10 个核心 Skill 全部已装本地。
> **v2.4 调整**：原 v2.3 "开发任何技术栈组件前必须查"过于宽泛，导致改文案/调间距也要查文档，影响效率。现收窄为以下场景才触发。

**触发条件**（以下场景必须查调研文档 + Skill SKILL.md）：
- 新增模块 / 页面 / 组件（≥50 行新代码）
- 重构现有模块（改动 ≥30% 代码）
- 集成新第三方库
- 修复技术栈相关 bug（IPC / 类型 / 构建 / 性能问题）

**不触发**（以下场景无需查，直接改）：
- 改文案 / 调间距 / 改颜色（<50 行改动）
- 修复业务逻辑 bug（不涉及技术栈本身）
- 添加同类组件（已有 Button，再加 Input）
- 快速验证 / 原型实验

**10 个必装 Skill**（全部已装 ✅）：
| 技术栈 | Skill 名称 | 评级 | 项目应用 |
|--------|-----------|------|---------|
| Electron 43 | `electron-dev` | ⭐⭐⭐ | ✅ 已用 |
| Electron E2E | `electron` | ⭐⭐ | ⚪ 待用（v1.0 dogfood） |
| React 18 | `vercel-react-best-practices` | ⭐⭐⭐ | ✅ 已用 |
| React 架构 | `react-expert` | ⭐⭐ | ⚪ 部分待用 |
| React 组合 | `vercel-composition-patterns` | ⭐⭐ | ⚪ 待用（重构时用） |
| TypeScript | `typescript` | ⭐⭐⭐ | ✅ 已用 |
| Tailwind v4 | `tailwind-v4-shadcn` | ⭐⭐⭐ | ✅ 已用 |
| shadcn | `shadcn` | ⭐⭐⭐ | ✅ 已用 |
| Zustand | `zustand-patterns` | ⭐⭐⭐ | ✅ 已用 |
| SQLite | `sqlite` | ⭐⭐⭐ | ✅ 已用 |

**禁止**：
- ❌ 新增模块时不查调研文档
- ❌ 已有 Skill 规则却不参考（触发条件下）
- ❌ 违反 Skill 中的"禁止"条款（触发条件下）

---

## B 开发约束（发布前必须满足 · 开发阶段可临时违反但必须标注 `// WIP:`）

> **重构背景**：原 v1.0 把这些标为"A 红线"，导致开发阶段 AI"宁愿不干也不愿冒险"。
> 现改为 B 级：开发阶段可以先用字面量/硬编码/mock 快速验证，但**必须标注 `// WIP:`**，发布前必须修复。
>
> **v2.4 新增**：A10-A14 从 A 红线降级为 B 开发约束（用户要求"完全放宽，后续优化再逐渐缩减"）。
> 开发阶段允许临时违反，加 `// WIP: 待修复` 标注即可，发布前必须满足。

### B1 · 单文件 ≤ 500 行

任何 `.ts` / `.tsx` 文件**行数不得超过 500 行**（含空行、注释、import）。

- 超过 500 行必须拆分：按功能职责拆为多个模块
- 测试文件可放宽至 800 行
- **开发阶段豁免**：快速验证时如超过 500 行，加 `// WIP: 待拆分，预计 Task X.X 处理` 可临时违反

**验证**：`wc -l src/main/**/*.ts src/renderer/**/*.tsx | sort -rn | head -20`

### B2 · 全部用 var(--trae-*) token

所有 CSS 颜色必须使用 `var(--trae-*)` 设计 Token，**禁止硬编码颜色**：

```css
/* ✅ 允许 */
color: var(--trae-text-primary);

/* ❌ 禁止 */
color: #ffffff;
```

- **开发阶段豁免**：token 系统未建好时，加 `/* WIP: 待替换为 token */` 可临时用硬编码
- **例外**：`rgba()` 半透明叠加见 C2 白名单

**验证**：`grep -rE '#[0-9a-fA-F]{3,8}' src/renderer/src/ --include='*.css' --include='*.tsx'`

### B3 · 无 mock 数据运行时 fallback

生产环境（`NODE_ENV=production`）禁止任何 mock 数据 fallback：

```typescript
/* ❌ 禁止 */
const data = await window.api.someMethod() || MOCK_DATA;
```

- **开发阶段豁免**：DEV 模式下允许 import sample data（见 C1 白名单）
- **禁止**：生产环境用 mock 伪装已完成功能（违反 A4 诚实标注）

**验证**：`grep -rn 'MOCK_\|mock-data\|fallback.*mock' src/main/ src/renderer/src/`

### B4 · IPC 通道必须使用 @shared/ipc-channels 常量

**所有 IPC 通道字符串必须引用 `src/shared/ipc-channels.ts` 中的常量**，禁止字面量：

```typescript
/* ✅ 允许 */
import { IPC_CHANNELS } from '@shared/ipc-channels'
ipcMain.handle(IPC_CHANNELS.LOOP.START, handler)

/* ❌ 禁止 */
ipcMain.handle('loop:start', handler)
```

- **开发阶段豁免**：快速验证时加 `// WIP: 待替换为常量` 可临时用字面量
- 发布前必须全部替换为常量引用

**验证**：`grep -rn "ipcMain.handle\(['\"]" src/main/ --include='*.ts' | grep -v "IPC_CHANNELS"`

### B5 · UI 选型决策树（v2.4 简化 · 2026-07-22）

> **v2.4 调整**：原 v2.3 决策树过于复杂（2 层嵌套 + 5 分支），快速验证时纠结选库。现简化为"快速验证随意，发布前收敛"。

**快速验证阶段**（允许）：
- 随意选 Antd 或 shadcn，先跑通功能
- 加 `// WIP: 待收敛 UI 选型` 标注

**发布前收敛规则**：
- 复杂业务组件（Form/Table/Tree/Steps）→ Antd（按需 import）
- 设计稿 1:1 复刻 → shadcn + Tailwind + CVA
- 跨组件状态 → Zustand（一模块一 Store）
- 浏览器事件流 → Dexie
- 主进程业务数据 → better-sqlite3
- 配置/窗口状态 → electron-store
- 凭据 → SecureStore 加密

**关键约定**（发布前必须满足）：
- Antd Token 用 CSS 变量字符串：`colorPrimary: 'var(--color-primary)'`
- 不用 className 覆盖 Antd 内部样式（改用 ConfigProvider token）
- 条件 className 用 `cn()`（clsx + tailwind-merge）

### B6 · 跨进程类型放 `src/shared/`（v2.4 从 A10 降级 · 2026-07-22）

> **v2.4 调整**：从 A 红线降级为 B 约束，允许快速验证时先内联类型，发布前移到 `src/shared/`。

**规则**：main ↔ renderer 共享的类型**发布前必须放 `src/shared/`**。

**开发阶段豁免**：快速验证时可在组件内内联类型，加 `// WIP: 待移到 src/shared/` 即可。

**验证**：`grep -rn "from '\.\./\.\./main/" src/renderer/` 发布前必须 0 命中。

### B7 · 重组件 lazy + Suspense（v2.4 从 A11 降级 · 2026-07-22）

> **v2.4 调整**：从 A 红线降级为 B 约束，允许快速验证时直接 import，发布前改 lazy。

**规则**：以下重组件**发布前必须 `React.lazy` + `<Suspense>`**：
- `@monaco-editor/react`（chunk ~50MB）
- `@xterm/xterm` / `@xterm/addon-*`
- `reactflow` / `@xyflow/react`
- `recharts` / `three`

**开发阶段豁免**：快速验证时可直接 import，加 `// WIP: 待改 lazy` 即可。

**验证**：`grep -rn "^import.*from '@monaco-editor\|@xterm\|reactflow" src/renderer/` 发布前必须 0 命中（除 `import type`）。

### B8 · 禁止 barrel imports（v2.4 从 A12 降级 · 2026-07-22）

> **v2.4 调整**：从 A 红线降级为 B 约束，允许快速验证时用 barrel，发布前改直接路径。

**规则**：**发布前禁止** `import { X } from '@/components'`，必须 `import { X } from '@/components/ui/button'`。

**开发阶段豁免**：快速验证时可用 barrel，加 `// WIP: 待改直接路径` 即可。

**验证**：`grep -rn "from '@/components'$\|from '@/components\"$" src/renderer/` 发布前必须 0 命中。

### B9 · IPC handler 入参 zod 校验（v2.4 从 A13 降级 · 2026-07-22）

> **v2.4 调整**：从 A 红线降级为 B 约束，且收窄为"仅涉及用户输入的 IPC 必须校验"，内部 IPC 豁免。

**规则**：**发布前**，涉及用户输入的 IPC handler 必须用 zod schema 校验：
- SSH 配置 / API Key / 文件路径 / 命令输入 等用户可控参数 → 必须 zod 校验
- `app.getVersion` / `app.getPath` 等无入参或内部 IPC → 豁免

**开发阶段豁免**：快速验证时可先 `config: any`，加 `// WIP: 待加 zod 校验` 即可。

**验证**：reviewer agent 审查涉及用户输入的 IPC 是否有 zod 校验。

### B10 · SQLite 三大 Pragma（v2.4 从 A14 降级 · 2026-07-22）

> **v2.4 调整**：从 A 红线降级为 B 约束，允许快速验证时先建简单连接，发布前加 Pragma。

**规则**：**发布前**，所有 better-sqlite3 数据库连接必须设置：
```typescript
db.pragma('journal_mode = WAL')        // 并发性能
db.pragma('busy_timeout = 5000')       // 锁等待
db.pragma('foreign_keys = ON')         // 外键约束（默认关闭！）
```

**开发阶段豁免**：快速验证时可先建简单连接，加 `// WIP: 待加 Pragma` 即可。

**例外**：`:memory:` 内存数据库（用于测试）豁免 WAL 和 busy_timeout，但 foreign_keys 仍需开启。

**验证**：`grep -B2 -A10 "new Database" src/main/ --include='*.ts'` 发布前检查每个 Database 实例。

---

## C 白名单（允许 · 不视为违规）

### C1 · DEV 模式下 import sample data 用于演示

在 `import.meta.env.DEV` 或 `process.env.NODE_ENV === 'development'` 条件下，允许：

```typescript
if (import.meta.env.DEV) {
  setDecisions(SAMPLE_DECISIONS);  // DEV 演示
} else {
  const data = await window.api.historyList();  // 生产真实 IPC
  setDecisions(data);
}
```

**约束**：sample data 必须放在 `__fixtures__/` 或 `__mocks__/` 目录下，不得在生产构建中打包。

### C2 · rgba 半透明 background（设计稿玻璃质感）

```css
/* ✅ 允许（玻璃质感） */
background: rgba(255, 255, 255, 0.72);
backdrop-filter: blur(16px);
```

**约束**：必须配合 `backdrop-filter: blur()` 使用，优先用 `rgb(var(--trae-*-rgb) / alpha)` 形式。

### C3 · lint 0 warnings / 0 errors

当前仓库状态：`pnpm lint` → 0 errors / 0 warnings。

**约束**：不得新增任何 `any` warning；`catch (error)` 一律用 `unknown` + 类型守卫。

---

## 验证清单（每次 commit 前必跑）

```bash
# 1. 编译门禁三绿
pnpm typecheck:node   # exit 0
pnpm typecheck:web    # exit 0
pnpm lint             # exit 0，warnings = 0

# 2. 冒烟测试（如涉及 main 进程）
pnpm test:smoke       # 23/23 通过

# 3. 单元测试（如涉及 scheduler）
tsx scripts/test-cron-parser.ts   # 58/58 通过

# 4. 集成测试（如涉及 IPC）
tsx scripts/test-scheduler.ts      # 36/36 通过

# 5. 构建（如涉及生产打包）
pnpm build            # electron-vite build PASS

# 6. AI 协作（v8.4 单 AI 模式 · 无需 ai:check/claim/release）
#    如恢复多 AI 模式，再启用 pnpm ai:check / ai:release --all

# 7. 死代码检测（v2.0 新增，如有 knip）
npx knip --include-files,dependencies,exports,types
```

---

## 违反处置

| 级别 | 规则 | 首次违反 | 重复违反 |
|------|------|---------|---------|
| **A 红线** | A1 IPC 4 步 | 返工补全 | 父 agent 拒绝合并 + LEARNINGS |
| **A 红线** | A2 TypeScript strict | 修复类型 | 返工 + LEARNINGS |
| **A 红线** | A3 catch 块未脱敏 | 添加 redactSensitiveInfo | 全仓扫描 + LEARNINGS |
| **A 红线** | A4 不诚实标注 | BLOCK + 返工 | 全仓审查 + LEARNINGS |
| **A 红线** | A5 skill 未使用 | 标注"skill 缺失" | LEARNINGS + 建议补做 |
| **A 红线** | A6 跳过 reviewer | 返工 dispatch reviewer | LEARNINGS |
| **A 红线** | A7 质量降级 | 返工重做 | LEARNINGS |
| **A 红线** | A8 重复造轮子 | 标注"复用缺失" | LEARNINGS |
| **A 红线** | A9 技术栈 skill 未查（触发条件下） | 标注"skill 缺失" | LEARNINGS |
| **B 约束** | B1 单文件 500 行 | 标注 WIP 或拆分 | 发布前必须拆分 |
| **B 约束** | B2 硬编码颜色 | 标注 WIP 或替换 Token | 发布前必须替换 |
| **B 约束** | B3 mock fallback | 移除 fallback | 发布前必须移除 |
| **B 约束** | B4 IPC 字面量 | 标注 WIP 或替换常量 | 发布前必须替换 |
| **B 约束** | B5 UI 选型 | 标注 WIP | 发布前必须收敛 |
| **B 约束** | B6 跨进程类型位置 | 标注 WIP | 发布前必须移到 src/shared/ |
| **B 约束** | B7 重组件 lazy | 标注 WIP | 发布前必须改 lazy |
| **B 约束** | B8 barrel imports | 标注 WIP | 发布前必须改直接路径 |
| **B 约束** | B9 IPC zod 校验 | 标注 WIP | 发布前必须加 zod（仅用户输入 IPC） |
| **B 约束** | B10 SQLite Pragma | 标注 WIP | 发布前必须加三大 Pragma |

---

*CLAUDE.md v2.4 · 2026-07-22 · A9 收窄边界 + A10-A14 降级为 B6-B10（完全放宽，后续逐步缩减）*
