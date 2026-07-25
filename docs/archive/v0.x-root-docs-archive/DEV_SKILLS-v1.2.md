# TDSF-Linux Desktop - Skill 开发规范 v1.2

> 本文档定义在 TDSF-Linux Desktop 项目中**何时调用哪个 Skill** 的标准化工作流。
> 与 `AGENTS.md`（架构与代码规范）配套使用：AGENTS.md 回答"代码怎么写"，本文档回答"Skill 怎么调"。
> 更新日期：2026-07-16
> 适用版本：v8.0 起
> 变更记录：
> - v1.0 初版（13 大类、3 个反模式、4 阶段触发矩阵）
> - v1.1 新增 v0.4.0 部署助手/tutor知识库模块的反模式与最佳实践
> - v1.2 新增 v0.5.0 LLM Tool Calling + MCP 5 工具复用 + ToolDefinition 统一化的反模式与最佳实践

---

## 1. Skill 调用总原则

### 1.1 三大铁律

1. **Skill 优先**：动工前先在本文档第 3 节查找相关 Skill，无相关 Skill 时才全网搜索
2. **场景化调用**：按第 4 节的触发矩阵**精确匹配**触发词，不得盲目全量调用
3. **完成即沉淀**：Skill 调用产生的最佳实践、踩坑记录 → 更新到本文档或 `AGENTS.md`

### 1.2 调用流程

```
[任务到来] 
   ↓
① 查本文档 §3 是否有现成 Skill
   ↓ 是
② 按 §4 触发矩阵确定具体 Skill
   ↓
③ 调用 Skill（先看其 prompt/详情）
   ↓
④ Skill 返回结果后立即执行
   ↓
⑤ 完成后 §6 沉淀新经验
   ↓
[任务结束]
```

---

## 2. 项目核心定位（用于 Skill 匹配）

**TDSF-Linux Desktop = AI 驱动的 Linux 运维桌面助手**

- **核心能力**：SSH 终端、文件管理、监控、AI 对话、Agent 工作流
- **差异化**：可解释决策（4 层风险控制 + 证据链 + 人机协同）
- **v8.0 新增**：系统架构感知、知识库教程、服务器管理深化、Web 部署助手
- **技术栈**：Electron + React 18 + TypeScript + ssh2 + Ant Design + better-sqlite3
- **参赛**：2026 火山杯 Agent 创新大赛

---

## 3. 可用 Skill 分类与映射

### 3.1 核心开发流程类（项目级高频）

| Skill | 触发词 | 适用场景 | 调用频率 |
|-------|--------|---------|---------|
| `ai-dev-workflow` | "标准化开发流程" / "初始化项目" / "审查项目结构" | 大任务前定 6 阶段 pipeline | ⭐⭐⭐ |
| `writing-plans` | "写个实施计划" / "给我写 RFC" | 多步任务开工前 | ⭐⭐⭐ |
| `executing-plans` | "执行计划" / "实施 RFC" | 在单独会话执行已有计划 | ⭐⭐ |
| `subagent-driven-development` | "并行实施" / "多 agent 实现" | 任务独立可并行 | ⭐⭐ |
| `dispatching-parallel-agents` | "并行调研" / "并行开发" | 2+ 独立任务 | ⭐⭐ |
| `context-driven-development` | "建立 context" / "scaffold project" | 项目初始化或 onboarding | ⭐ |
| `using-superpowers` | 任意会话开头 | 元规范（强制） | ⭐⭐⭐ |
| `using-git-worktrees` | "git worktree" | 隔离开发 | ⭐ |
| `finishing-a-development-branch` | "完成分支" | 收尾工作 | ⭐ |

### 3.2 代码质量与审查类

| Skill | 触发词 | 适用场景 | 调用频率 |
|-------|--------|---------|---------|
| `code-review-excellence` | "代码审查" / "PR review" | 提交前自检 | ⭐⭐⭐ |
| `TRAE-code-review` | "审查合并请求" | PR/MR 审查 | ⭐⭐ |
| `TRAE-security-review` | "安全扫描" / "漏洞检查" | 涉及 ssh/密码/私钥 | ⭐⭐⭐ |
| `verification-before-completion` | "完成前验证" | 声明完成前必跑 | ⭐⭐⭐（强制）|
| `javascript-testing-patterns` | "写单测" / "vitest 模式" | 单元测试 | ⭐⭐⭐ |
| `e2e-testing-patterns` | "E2E 测试" / "Playwright 模式" | 端到端测试 | ⭐⭐ |
| `webapp-testing` | "测试本地 web" | electron renderer 端测试 | ⭐⭐ |
| `playwright` MCP | 浏览器自动化 | E2E 实操 | ⭐⭐ |
| `agent-browser-suite` | "浏览器自动化" / "open a website" | 含 agent-browser + browser-use + dogfood 三大模块 | ⭐⭐ |
| `dogfood` | "QA" / "find issues" / "bug hunt" | 系统化 dogfood 测试 | ⭐⭐ |
| `composition-patterns` (vercel) | "组件设计" / "refactor 组件" | React 组件架构（Vercel 官方） | ⭐⭐ |
| `vercel-react-best-practices` | "React 性能" / "Next.js 优化" | React 性能优化 | ⭐⭐ |
| `vercel-react-view-transitions` | "view transition" / "页面切换动画" | View Transition API | ⭐ |

### 3.3 前端与设计类

| Skill | 触发词 | 适用场景 | 调用频率 |
|-------|--------|---------|---------|
| `frontend-design` | "前端设计" / "做个组件" / "美化 UI" | 创建生产级 UI | ⭐⭐⭐ |
| `super-frontend-design` | "前端设计全流程" / "从零设计前端" | 完整前端项目 | ⭐⭐ |
| `nimpeccable` | "设计打磨" / "UI 优化" / "精修" | 已有设计优化 | ⭐⭐ |
| `web-dev` | "做 web" / "做网页" / "从零建站" | 全新 web 项目 | ⭐ |
| `frontend-skill` | "视觉强的 landing" | 营销/落地页 | ⭐ |
| `responsive-design` | "响应式" / "移动端适配" | 跨端适配 | ⭐⭐ |
| `design-system-patterns` | "设计系统" / "design tokens" | 主题/组件库 | ⭐ |
| `tailwind-design-system` | "tailwind 设计系统" | Tailwind v4 | ⭐（项目未用） |
| `interaction-design` | "微交互" / "动效" | 动效设计 | ⭐ |
| `accessibility-compliance` | "无障碍" / "WCAG" | 适老化/无障碍 | ⭐ |
| `wcag-audit-patterns` | "WCAG 审计" | 审计现有 UI | ⭐ |

### 3.4 Linux / 运维 / 调试类（项目核心）

| Skill | 触发词 | 适用场景 | 调用频率 |
|-------|--------|---------|---------|
| `linux-ops` | "Linux 运维" / "故障诊断" / "服务器异常" | 真实服务器问题 | ⭐⭐⭐ |
| `centos-linux-triage` | "CentOS" / "RHEL" / "SELinux" | 国产化/银行场景 | ⭐⭐ |
| `TRAE-debugger` | "运行时调试" / "复现 bug" | 多轮静态分析无法解决 | ⭐⭐ |
| `systematic-debugging` | "系统化调试" / "根因" | 任何 bug 前置 | ⭐⭐ |
| `parallel-debugging` | "并行调试" / "多假设" | 复杂 bug 多因 | ⭐ |

### 3.5 架构与设计模式类

| Skill | 触发词 | 适用场景 | 调用频率 |
|-------|--------|---------|---------|
| `architecture-patterns` | "Clean Architecture" / "DDD" | 后端架构设计 | ⭐⭐ |
| `microservices-patterns` | "微服务" | 分布式系统 | ⭐（项目单进程） |
| `api-design-principles` | "REST 设计" / "API 设计" | 接口设计 | ⭐⭐ |
| `openapi-spec-generation` | "OpenAPI" / "swagger" | 接口文档生成 | ⭐ |
| `architecture-decision-records` | "ADR" / "架构决策记录" | 记录技术选型 | ⭐ |

### 3.6 数据库类

| Skill | 触发词 | 适用场景 | 调用频率 |
|-------|--------|---------|---------|
| `database-er-diagram` | "ER 图" / "画 ER" | 数据库建模 | ⭐⭐ |
| `sql-optimization-patterns` | "SQL 慢" / "EXPLAIN" | 性能调优 | ⭐⭐ |
| `database-migration` | "数据库迁移" | schema 变更 | ⭐ |

> 注：项目用 better-sqlite3（非 PG），`postgresql-table-design` 不直接适用

### 3.7 MCP / 工具集成类

| Skill | 触发词 | 适用场景 | 调用频率 |
|-------|--------|---------|---------|
| `mcp-builder` | "MCP server" / "暴露给 Claude Code" | 项目已实现 | ⭐⭐ |
| `context7` | "查文档" / "库的最新用法" | 任何不熟悉的库 | ⭐⭐⭐ |
| `github` / `gh-cli` | "提交 PR" / "建 issue" | GitHub 操作 | ⭐⭐ |

### 3.8 搜索 / 调研 / 联网类

| Skill | 触发词 | 适用场景 | 调用频率 |
|-------|--------|---------|---------|
| `agent-reach` | "全网调研" / "查一下" / "搜搜" | 联网搜索（13 平台） | ⭐⭐⭐ |
| `last30days` | "最近 30 天" / "大家怎么看" | 趋势调研 | ⭐⭐ |
| `multi-search-engine` | "多引擎搜索" | 16 引擎聚合 | ⭐⭐ |
| `deep-research-ultra` | "深度调研" / "全面分析" / "调研报告" | 16 引擎 + 迭代搜索 + 报告生成 | ⭐⭐ |
| `research-first` | "先查一下" / "research first" | 动手前先研究 | ⭐⭐ |
| `defuddle` | "提取网页" / "网页转 md" | 提取干净 markdown 内容（教程爬取） | ⭐⭐ |
| `web-search` / `web-fetch` | 工具内 | 通用 | ⭐⭐⭐ |
| `find-skills` | "找 skill" / "有什么 skill" | 发现/安装 skill | ⭐⭐ |

### 3.9 文档与写作类

| Skill | 触发词 | 适用场景 | 调用频率 |
|-------|--------|---------|---------|
| `doc-coauthoring` | "写技术文档" / "写 RFC" | 协作文档 | ⭐⭐ |
| `edit-article` | "润色" / "改稿" | 文档精修 | ⭐ |
| `writing-skills` / `skill-creator` | "写个 skill" | 团队能力沉淀 | ⭐ |
| `changelog-automation` | "生成 changelog" | 发版 | ⭐ |
| `office-document-suite` | "Word" / "PPT" / "PDF" | Office 三件套 | ⭐⭐ |

### 3.10 流程与工程实践类

| Skill | 触发词 | 适用场景 | 调用频率 |
|-------|--------|---------|---------|
| `setup-pre-commit` | "pre-commit" / "git hooks" | 配置提交检查 | ⭐ |
| `git-commit` | "/commit" / "智能 commit" | 提交时 | ⭐⭐ |
| `git-advanced-workflows` | "rebase" / "cherry-pick" / "reflog" | 复杂 Git 操作 | ⭐ |
| `git-guardrails-claude-code` | "git 安全钩子" / "阻止危险 git 命令" | Claude Code hooks | ⭐ |
| `github-actions-templates` | "CI/CD" / "GitHub Actions" | 持续集成 | ⭐ |
| `deployment-pipeline-design` | "部署流水线" | CI/CD 设计 | ⭐ |
| `dependency-upgrade` | "升级依赖" | 框架大版本升级 | ⭐ |
| `github-deploy` | "提交代码" / "push 到 github" / "部署网页" | 一键 GitHub Pages 部署 | ⭐ |
| `gitlab-ci-patterns` | "GitLab CI" | GitLab 流水线 | ⭐ |
| `multi-reviewer-patterns` | "多 reviewer 协作" | 并行代码审查 | ⭐ |
| `vercel-composition-patterns` | "组件组合" / "compound components" | Vercel 组件设计 | ⭐ |

### 3.11 记忆与上下文类

| Skill | 触发词 | 适用场景 | 调用频率 |
|-------|--------|---------|---------|
| `super-memory` | "保存记忆" / "整理记忆" / "sync" | 任务/会话结束 | ⭐⭐⭐ |
| `context7` | "查最新文档" | 库版本变更时 | ⭐⭐ |
| `skill-workspace` | "skill 工作台" / "管理 skill" / "下载 skill" | Skill 全生命周期管理 | ⭐⭐ |
| `cocoloop` | "安装 skill" / "管理 skill" / "安全检查" | Skill 安全管理 | ⭐ |

### 3.12 安全类

| Skill | 触发词 | 适用场景 | 调用频率 |
|-------|--------|---------|---------|
| `security-best-practices` | "安全实践" | TS/JS 安全审查 | ⭐⭐ |
| `secrets-management` | "密钥管理" / "Vault" | 凭证管理 | ⭐ |
| `sast-configuration` | "SAST" / "静态扫描" | 自动化安全 | ⭐ |

### 3.13 不适用 Skill（明确不调用）

| Skill | 不适用原因 |
|-------|-----------|
| `python-*` 全系列 | 项目是 TypeScript，Python 仅 drain3 桥接 |
| `rust-async-patterns` / `go-concurrency-patterns` | 不涉及 Rust/Go |
| `defi-protocol-templates` / `web3-testing` | 不涉及区块链 |
| `unity-*-patterns` | 不涉及 Unity |
| `obsidian-*` | 不涉及 Obsidian |
| `react-native-*` | 不涉及移动端（除非用户后续要求） |
| `spark-optimization` | 不涉及 Spark |
| `postgresql-table-design` | 项目用 SQLite |
| `temporal-*` | 不涉及 Temporal |
| `tikhub-api-helper` | 不涉及社交平台爬取 |

---

## 4. 任务 → Skill 触发矩阵

### 4.1 立项与规划

| 任务 | 调用 Skill | 顺序 |
|------|-----------|------|
| 写方案书 | `writing-plans` → `doc-coauthoring` | 1→2 |
| 大任务开工 | `ai-dev-workflow` → `writing-plans` | 1→2 |
| 拆解为可并行任务 | `dispatching-parallel-agents` | 1 |
| 调研竞品/技术 | `agent-reach` 或 `last30days` | 1 |
| 查库的最新 API | `context7` | 1 |

### 4.2 实现

| 任务 | 调用 Skill | 顺序 |
|------|-----------|------|
| 设计新 UI/页面 | `frontend-design` 或 `super-frontend-design` | 1 |
| 打磨已有 UI | `nimpeccable` | 1 |
| 重构 React 组件 | `composition-patterns` (vercel) → `vercel-react-best-practices` | 1→2 |
| 写单测 | `javascript-testing-patterns` | 1 |
| 写 E2E | `e2e-testing-patterns` → `agent-browser-suite` (test) | 1→2 |
| 浏览器自动化（点/截图/填表） | `agent-browser-suite` (core) | 1 |
| 系统性 dogfood 测试 | `dogfood` | 1 |
| 数据库 schema | `database-er-diagram` | 1 |
| API 设计 | `api-design-principles` | 1 |
| MCP 集成 | `mcp-builder` | 1 |
| 真实 Linux 故障 | `linux-ops` → `centos-linux-triage`（如适用） | 1→2 |
| 教程/网页内容提取 | `defuddle` → `agent-reach`（找源） | 1→2 |
| Electron 三进程架构 | `using-superpowers` + `ai-dev-workflow` | 1 |
| 跨进程类型设计 | `AGENTS.md` §类型约定 + 本规范 §11.2 经验 #1 | 1 |
| Web 部署/自动化脚本 | `linux-ops` + 风险规则引擎 | 1 |
| 视图过渡/动画 | `vercel-react-view-transitions` | 1 |
| 主题/暗黑模式 | `nimpeccable` → `visual-design-foundations` | 1→2 |

### 4.3 调试与排错

| 任务 | 调用 Skill | 顺序 |
|------|-----------|------|
| 任何 bug | `systematic-debugging` | 1（前置） |
| 复杂 bug 多因 | `parallel-debugging` | 1 |
| 运行时无法复现 | `TRAE-debugger` | 1 |
| 安全漏洞 | `TRAE-security-review` | 1 |

### 4.4 收尾

| 任务 | 调用 Skill | 顺序 |
|------|-----------|------|
| 提交代码 | `git-commit` | 1 |
| 提交前 | `code-review-excellence` | 1 |
| 声明完成 | `verification-before-completion` | 1（强制） |
| 完成分支 | `finishing-a-development-branch` | 1 |
| 会话结束 | `super-memory` | 1 |
| 升级依赖 | `dependency-upgrade` | 1 |
| 写 changelog | `changelog-automation` | 1 |

---

## 5. 项目级 Skill 调度流程图

```
新任务到来
   │
   ├─ 写方案 ──────→ writing-plans
   │
   ├─ 调研 ──────→ agent-reach / last30days / context7
   │
   ├─ 设计 UI ───→ frontend-design / super-frontend-design
   │
   ├─ 实现 ──────→ 直接写代码（按 AGENTS.md 规范）
   │
   ├─ 测试 ──────→ javascript-testing-patterns / e2e-testing-patterns
   │
   ├─ 调试 ──────→ systematic-debugging / TRAE-debugger
   │
   ├─ 审查 ──────→ code-review-excellence / TRAE-security-review
   │
   ├─ 完成声明 ──→ verification-before-completion
   │
   └─ 会话收尾 ──→ super-memory → 更新本规范
```

---

## 6. Skill 沉淀规则

每次调用 Skill 后必须思考：

1. **有没有新的最佳实践值得记入本规范？**
   - 是 → 追加到对应章节
2. **有没有踩坑/反模式值得记入？**
   - 是 → 追加到 §7 反模式清单
3. **有没有新的 Skill 是项目级有用的？**
   - 是 → 追加到 §3 对应分类
4. **有没有已记录但发现不适用的 Skill？**
   - 是 → 移到 §3.13

---

## 7. 反模式清单（禁止行为）

### 7.1 通用反模式

- ❌ **盲目调用 Skill**：用户没要求时不要主动触发 design/architecture 类 Skill
- ❌ **Skill 全量执行**：复杂 Skill 必先看其 prompt/详情，按需执行子步骤
- ❌ **跨域误用**：把 `web-dev` 套到 Electron 桌面端（应改用 `frontend-design`）
- ❌ **未读 Skill 即调用**：必须先看 Skill 的 description 和 prompt
- ❌ **完成前不跑 `verification-before-completion`**：禁止"应该成功了"的伪完成声明
- ❌ **Python Skill 误用**：项目是 TS，Python Skill 仅在 drain3 桥接相关时考虑
- ❌ **同一任务重复 Skill**：同一问题不重复调用同一 Skill（除非上下文变了）
- ❌ **改 AGENTS.md 的 v7.0 内容**：v7.0 定稿，v8.0 改动记入本规范与 v8.0 方案书

### 7.2 Electron + TypeScript 三进程架构反模式

- ❌ **跨进程类型放在主进程 services 中**：渲染端 `import type from '../../../main/services/xxx/types'` 会触发
  `TS2307: Cannot find module '../../../main/services/xxx/types'`
  - 根因：`tsconfig.web.json` 的 `include` 只允许 `src/renderer/src/**/*` + `src/shared/**/*`
  - ✅ 正确做法：将跨进程类型放 `src/shared/xxx-types.ts`，主进程 services/types.ts 改为
    `export * from '../../../shared/xxx-types'` 兼容层（保留旧 import 路径）
  - 已在 v0.4.0 实践：`shared/deploy-types.ts` + `shared/tutorial-types.ts`

- ❌ **ipcMain.handle 注册缺导入**：`registerAllIpcHandlers` 中调用某 handler 函数但顶部未 import
  - 症状：`error TS2552: Cannot find name 'registerXxxIpcHandlers'`
  - ✅ 正确做法：每个新加的 IPC 通道必须同时：① 在 ipc/xxx.ts 中定义 ② 在 ipc/index.ts 中 import

- ❌ **tsconfig.web.json 包含 main 目录**：会引入 Node 内置模块（fs/path/electron）到渲染端类型检查
  - ✅ 正确做法：renderer 端只能 include `src/renderer/src/**/*` + `src/shared/**/*`，
    主进程 include 由 `tsconfig.node.json` 单独管理

- ❌ **better-sqlite3 事务用 `db.transaction()`**：`DatabaseManager` 不暴露 transaction 方法
  - ✅ 正确做法：`const raw = db.getRawConnection(); raw.transaction(...)` 才能用 better-sqlite3 原生事务

- ❌ **Preload API 嵌套结构**：`window.electronAPI.ssh.connect()` 会因函数未定义而崩溃
  - ✅ 正确做法：**扁平化**所有 preload API（`window.electronAPI.sshConnect()`）

### 7.3 ESLint 配置反模式

- ❌ **在 ESLint v9 项目保留 .eslintrc.cjs 直接用 pnpm lint**：ESLint v9 默认找 `eslint.config.js`
  - 症状：`ESLint couldn't find an eslint.config.(js|mjs|cjs) file`
  - ✅ 正确做法：迁移到 flat config（`eslint.config.cjs`，用 `module.exports = [...]` 不用 ESM import）

- ❌ **react-hooks 4.6 与 ESLint 9 混用**：`TypeError: context.getSource is not a function`
  - 根因：react-hooks 4.6.x 用了 ESLint 8 内部 API
  - ✅ 正确做法：升级到 react-hooks 5.x；或暂时在 flat config 中关闭
    `'react-hooks/rules-of-hooks': 'off', 'react-hooks/exhaustive-deps': 'off'`

### 7.4 Lint 错误处理反模式

- ❌ **lint 全绿才允许构建**：项目早期会累积大量 unused-vars 错误，阻塞 build
  - ✅ 正确做法：lint 错误**分两类**处理
    - 阻塞类（影响运行）：`@typescript-eslint/no-explicit-any` 大量警告、`react-hooks/rules-of-hooks` 错误
    - 非阻塞类（仅风格）：`@typescript-eslint/no-unused-vars` 历史遗留
  - 在 CI 中区分：lint 必跑但**不阻塞** build（用 `|| true`），在 typecheck 与 build 上严格门禁

### 7.5 教程/知识库模块反模式

- ❌ **AI 生成教程内容**：违反"100% 权威源白名单"原则
  - ✅ 正确做法：手工从 Arch Wiki / Red Hat Docs / Ubuntu Docs 等白名单源爬取
  - 参考 skill：`defuddle`（提取网页内容为 md）、`agent-reach`（按平台精准爬）

- ❌ **教程分类硬编码在数据中**：分类变动要改 N 个地方
  - ✅ 正确做法：分类作为 `Record<TutorialCategory, string>` 常量集中维护（`TUTORIAL_CATEGORY_LABELS`）

- ❌ **知识库搜索只支持关键词**：漏掉"按 distro 过滤"等运维场景
  - ✅ 正确做法：搜索支持 category + tags + distros + difficulty 四维过滤

### 7.6 Web 部署助手反模式

- ❌ **部署步骤不区分风险等级**：rm -rf / 与 ls 一样可点 = 灾难
  - ✅ 正确做法：5 级风险（safe/low/medium/high/critical），high/critical 必须二次确认
  - 颜色 + emoji 双重提示（`DEPLOY_RISK_COLORS` + `DEPLOY_RISK_EMOJI`）

- ❌ **部署执行无回滚机制**：失败后系统半残
  - ✅ 正确做法：每步 `rollback` 字段非空，失败时按逆向顺序回滚

- ❌ **部署日志一次性返回**：用户体验差，进度不可见
  - ✅ 正确做法：实时日志流式推送（`deploy:log` IPC 事件 + `mainWindow.webContents.send`）

---

## 8. Skill 工具调用速查

### 8.1 在 Trae IDE 中调用 Skill

```typescript
// 通过 Skill 工具
Skill({ name: "frontend-design" })
Skill({ name: "linux-ops" })
```

### 8.2 通过 MCP 工具调用

```typescript
// Playwright 浏览器自动化
mcp_playwright__browser_navigate(...)
mcp_playwright__browser_snapshot(...)

// Notion 文档
mcp_notion__API-post-search(...)

// Docker
mcp_docker__run_command(...)
```

### 8.3 通过 run_command 调外部 CLI

```bash
# GitHub CLI
gh issue list
gh pr create

# npx skills（已确认未启用，备选）
npx skills find <query>
```

---

## 9. 版本与变更

| 版本 | 日期 | 主要变更 |
|------|------|---------|
| v1.0 | 2026-07-16 | 初版：13 大类、3 个反模式、4 阶段触发矩阵 |
| v1.1 | 2026-07-16 | ① 新增 v0.4.0 部署助手/教程知识库模块的 6 类反模式 ② 新增 agent-browser-suite/dogfood/composition-patterns/vercel-react-best-practices 等 12 个新 skill ③ 拆分反模式章节为 6 个子节（通用/Electron 架构/ESLint/Lint/教程/部署） ④ 新增 §11 v0.4.0 实施经验库 |
| v1.2 | 2026-07-16 | ① 新增 v0.5.0 LLM Tool Calling + MCP 5 工具复用的 6 条关键经验（ToolDefinition/Meta 分离、MCP 复用、审批超时、5 阶段进度、ProfilerRunData 精简、签名校验） ② 新增 §12 v0.5.0 实施经验库（交付清单/关键经验/失败案例/改进方向/验证记录） ③ 清理 `vercel-ai-service.ts` 重复 ToolDefinition + 3 个 Tool 常量 |

---

## 10. 与其他文档的关系

```
AGENTS.md            ─ 项目架构 + 代码规范（v7.0 定稿）
  │
  ├─ DEV_SKILLS.md  ─ Skill 调用规范（本文件，v1.1）
  │
  ├─ 方案书-*.md     ─ 各版本方案书
  │
  ├─ 循环工程测试报告-*.md ─ 质量门禁记录
  │
  └─ 自检验收报告-*.md ─ 阶段性验收
```

**调用顺序**：先查 AGENTS.md 确认架构 → 再查 DEV_SKILLS.md 确认 Skill → 实施。

---

## 11. v0.4.0 实施经验库

> 本章记录 v0.4.0（系统架构感知 + 教程知识库 + Web 部署助手）实施过程中产生的实战经验。
> 后续 v0.5.0+ 任务开工前应先扫一眼本章。

### 11.1 v0.4.0 模块交付清单

| 模块 | 主进程入口 | 渲染端入口 | IPC 通道数 | 关键类型 |
|------|-----------|-----------|-----------|---------|
| 系统架构感知 | `services/profiler/` | `components/profiler/ProfilerDialog.tsx` | 4 | `ProfilerRunResponse`（@shared/models） |
| 教程知识库 | `services/tutorial/` | `components/tutorial/TutorialPage.tsx` | 6 | `TutorialEntry`（@shared/tutorial-types） |
| Web 部署助手 | `services/deploy/` | `components/deploy/DeployDialog.tsx` | 7 | `DeployTemplate`（@shared/deploy-types） |

### 11.2 v0.4.0 关键经验

1. **跨进程类型必须放 `src/shared/`**：v0.4.0 起新加的所有跨进程类型走 `shared/xxx-types.ts`，
   主进程 services/types.ts 改为 `export * from '../../../shared/xxx-types'` 兼容层。
   这样既保留旧 import 路径又满足 tsconfig.web.json 的 include 限制。

2. **Web 部署助手的 5 级风险模型**：
   - safe（绿）→ low（蓝）→ medium（黄）→ high（橙）→ critical（红）
   - high/critical 自动开启 `requiresConfirm`，必须在 UI 上二次确认
   - 颜色 + emoji 双重提示（`DEPLOY_RISK_COLORS` + `DEPLOY_RISK_EMOJI`）

3. **教程知识库数据流**：
   - 内置 seed（`seeds.ts`，10 篇官方源）→ SQLite knowledge_entries (type='tutorial')
   - 启动时由 `loadTutorialSeeds` 一次性加载，dev 模式可用 `tutorial:seedReload` 重载
   - 搜索支持 category + tags + distros + difficulty 四维过滤

4. **ipcMain.handle 注册顺序原则**：
   - 基础服务（ssh/monitor/storage/llm） → 业务服务（knowledge/history/agent/profiler）
   - → 独立服务（tutorial 需 db 参数、deploy 需 mainWindow）
   - 每个新 IPC 文件必须同时：① 在 `ipc/xxx.ts` 定义 ② 在 `ipc/index.ts` import ③ 在 `preload/index.ts` 暴露
     ④ 在 `types/electron.d.ts` 加类型

5. **部署执行器与 SSH 的桥接**：
   - `executor.ts` 通过 `sshManager.exec(sessionId, command)` 复用现有 SSH 会话
   - 日志通过 `mainWindow.webContents.send('deploy:log', ...)` 实时推送
   - 失败时按逆向顺序回滚（依赖 `step.rollback` 字段）

### 11.3 推荐的 Skill 调用链（v0.5.0 起步用）

```
[新功能需求]
  ↓
① writing-plans      → 写 RFC（含模块边界、API、数据流、风险评估）
  ↓
② ai-dev-workflow    → 拆 6 阶段 pipeline（需求/架构/scaffold/coding/quality/knowledge）
  ↓
③ context7           → 查新依赖的最新 API（如果引入新库）
  ↓
④ frontend-design    → 设计 UI（如果是新页面/新组件）
  ↓
⑤ subagent-driven-development → 跨文件并行实现
  ↓
⑥ javascript-testing-patterns → 写单测
  ↓
⑦ e2e-testing-patterns → 写 E2E
  ↓
⑧ TRAE-code-review / code-review-excellence → 提交前自检
  ↓
⑨ verification-before-completion → 跑 typecheck:node + typecheck:web + build
  ↓
⑩ super-memory       → 保存经验到 project_memory.md + DEV_SKILLS.md
```

### 11.4 v0.5.0+ 推荐改进方向

| 方向 | 价值 | 实施复杂度 | 推荐 Skill |
|------|------|----------|-----------|
| 教程数据从权威源爬取 | 解决 10 篇 seed 太少 | 中（需 defuddle） | `defuddle` + `agent-reach` |
| 部署步骤回滚脚本生成 | 让"自动回滚"更可信 | 中 | `linux-ops` + 规则引擎 |
| ServerList 右键菜单 UI 重构 | 验收 6 待优化点之 #1 | 低 | `nimpeccable` |
| LLM Function Calling 集成 | 让 LLM 能调 SSH 命令 | 高 | `langchain-architecture` + `mcp-builder` |
| 暗黑模式 E2E 全覆盖 | 验收 6 待优化点之 #2 | 中 | `agent-browser-suite` (test 子模块) |
| MCP Server 工具补全 | 暴露教程/部署给 Claude Code | 中 | `mcp-builder` |
| electron-builder 打包 | 真正可分发的 .exe/.dmg | 低 | `github-deploy` |

### 11.5 循环工程质量门禁（强制）

每次任务收尾**必须**按以下顺序跑（与 `package.json` 的 scripts 对应）：

```bash
pnpm typecheck      # typecheck:node + typecheck:web（0 错误）
pnpm lint           # ESLint 必跑但不阻塞（历史遗留错误见 7.4 节）
pnpm test           # vitest（单测）
pnpm build          # electron-vite build（产物 out/）
pnpm test:e2e       # playwright E2E（可选，发布前必跑）
```

**声明完成的标准**：
- ✅ typecheck 0 错误（必）
- ✅ build 成功（必）
- ⚠️ lint 错误存在**但已记录**为非阻塞（可选）
- ⚠️ 单测全过（必，新功能必须有测试）
- ⚠️ E2E 全过（推荐，发布前必跑）

### 11.6 v0.4.0 失败案例（避坑）

| 失败 | 根因 | 修复 |
|------|------|------|
| `Cannot find name 'registerDeployIpcHandlers'` | ipc/index.ts 缺 import | 加 `import { registerDeployIpcHandlers } from './deploy'` |
| 渲染端 `Cannot find module '../../../main/services/deploy/types'` | tsconfig.web.json 不含 main | 类型移到 `src/shared/deploy-types.ts`，主进程 services/types.ts 改为 re-export |
| ESLint v9 `couldn't find an eslint.config.(js|mjs|cjs) file` | 用了 v8 的 .eslintrc.cjs | 新建 `eslint.config.cjs`（flat config 格式） |
| react-hooks 4.6 + ESLint 9 `context.getSource is not a function` | 版本不兼容 | flat config 中暂时关闭 react-hooks 规则 |
| `db.transaction is not a function` | DatabaseManager 没暴露 transaction | 用 `db.getRawConnection().transaction(...)` 调原生 |

---

## 12. v0.5.0 实施经验库

> 本章记录 v0.5.0（LLM Tool Calling + MCP 5 工具复用 + ToolDefinition 统一化）
> 实施过程中产生的实战经验。

### 12.1 v0.5.0 模块交付清单

| 模块 | 主进程入口 | 渲染端入口 | 关键能力 |
|------|-----------|-----------|---------|
| Tool Registry | `services/llm/tools/registry.ts` | — | 5 工具统一注册，ToolDefinition + Meta 分离 |
| SSH Exec Tool | `services/llm/tools/ssh-exec.ts` | `LlmToolApprovalDialog` | high 风险命令审批，超时 30s 自动拒绝 |
| Monitor Get Tool | `services/llm/tools/monitor-get.ts` | — | 按需采集（无需启动 SystemMonitor） |
| Deploy List Tool | `services/llm/tools/deploy-list.ts` | — | 列出 LAMP/WordPress/Nginx/Docker 模板 |
| Profiler Run Tool | `services/llm/tools/profiler-run.ts` | — | 27 项并发探查 + 风险检测 + Markdown 渲染 |
| Tutorial Search Tool | `services/llm/tools/tutorial-search.ts` | — | 官方源 4 维过滤（category/tags/distros/difficulty） |
| LLM Tool IPC | `ipc/llm-tools.ts` | `pages/LlmChatPage.tsx` | 5 通道：chat-with-tools / tool-approve / tool-progress / tool-approval / chunk |
| MCP 5 工具复用 | `services/mcp/tools/registry.ts` | — | 复用 LLM tool 的 execute，零业务代码重复 |

### 12.2 v0.5.0 关键经验

#### 经验 #1：ToolDefinition 与 ToolCallMeta 分离（避免重复定义）

**问题**：
- `vercel-ai-service.ts` 自定义 `interface ToolDefinition`（含 name/description/parameters/execute）
- `shared/llm-tool-types.ts` 也定义了 `interface ToolDefinition`
- 还有 3 个 Tool 常量（sshExecTool/knowledgeQueryTool/riskCheckTool）在 vercel-ai-service.ts 里
- `mcp/server.ts` 反向 import 3 个 Tool 常量只为拿 description

**根因**：早期 `VercelAiService` 自成体系，未与 v0.5.0 的统一注册表对齐。

**正确做法**（v0.5.0 重构）：
- 所有 Tool 元数据（name/description/parameters/execute）放 `shared/llm-tool-types.ts` 唯一来源
- 风险/标签/审批等 Meta 单独放 `*_META` 常量（如 `SSH_EXEC_META`）
- Registry 同时维护 `tools: Map<ToolId, ToolDefinition>` 和 `metas: Map<ToolId, ToolCallMeta>`，
  提供 `getMeta(id)` 方法
- IPC 层只调 `registry.getMeta(name)` 拿审批信息，**不**在 ToolDefinition 上加 metadata

```typescript
// ✅ 正确：统一类型 + 分离 Meta
export const sshExecTool: ToolDefinition = { name, description, parameters, execute }
export const SSH_EXEC_META = { risk: 'high', requiresApproval: true, label, emoji } as const
// Registry.register(sshExecTool, SSH_EXEC_META)

// ❌ 反模式：在 ToolDefinition 上塞 requiresApproval
export interface ToolDefinition { ...; requiresApproval?: boolean }
```

#### 经验 #2：MCP 与 LLM Tool Calling 共用业务逻辑

**单一来源原则**：
- 业务逻辑（execute）写在 `services/llm/tools/*.ts`
- MCP `services/mcp/tools/registry.ts` 只做"参数包装 + 返回值适配"——调 `executeSshExec`、
  调 `executeMonitorGet`，不重新实现
- 加新工具只需：① 在 `services/llm/tools/` 加实现 ② 在 MCP 注册表加映射

```typescript
// services/mcp/tools/registry.ts
{
  meta: { name: TOOL_IDS.SSH_EXEC, description: '...', inputSchema: zodToJsonSchema(sshExecArgsSchema) },
  call: async (args) => toMcpResult(await executeSshExec(sshExecArgsSchema.parse(args)))
}
```

#### 经验 #3：高风险工具的审批超时机制

**问题**：LLM 调用 ssh_exec 等高风险工具需要用户审批，但用户可能离开。

**解决**：
- 30 秒审批超时（`APPROVAL_TIMEOUT_MS = 30_000`）
- 超时后**自动拒绝**而非无限等待，避免死锁
- `pendingApprovals: Map<callId, {resolve, reject, timeout}>` 管理并发审批
- 用户拒绝/超时都返回 `ToolCallResult.success = false`，LLM 收到错误后可降级

#### 经验 #4：Tool 调用进度的 5 阶段推送

**流式事件协议**（mainWindow.webContents.send）：
1. `start` — 工具调用开始
2. `awaiting-approval` — 等待用户审批（含 risk/riskReason）
3. `executing` — 用户批准后开始执行
4. `success` — 执行成功（含 result）
5. `failed` — 执行失败（含 result.error）

**用途**：渲染端可以按阶段显示不同 UI（loading/approval modal/spinner/result）。

#### 经验 #5：ProfilerRunResponse vs ProfilerResult 类型分离

**问题**：工具返回 `ProfilerRunData`（精简版，token 友好），不是 `ProfilerRunResponse`（含 md）。

**根因**：LLM 上下文窗口有限，必须避免把整个 27 项原始输出塞进 LLM context。
完整 md 报告存在 `ProfilerRunData.md` 字段，单独给 UI 渲染用。

**正确做法**：
- 工具 execute 函数返回 `ToolCallResult<ProfilerRunData>`（精简 + md 字符串）
- 内部 `runProfiler()` 返回 `ProfilerResult`（完整），不直接对外
- `summary`/`risks` 在 tool 内部用 `summarizeRisks(risks)` 计算后塞进 ProfilerRunData

#### 经验 #6：renderProfilerMarkdown 函数签名（v0.5.0 之前踩坑）

**踩坑**：
- v0.4.0 写 tool 时误传 3 个参数：`renderProfilerMarkdown(result, risks, summary)`
- 实际函数签名只接受 2 个参数，summary 内部由 risks 计算
- typecheck 报 `TS2554: Expected 2 arguments, but got 3`

**避坑**：调用任何公共函数前先 `Grep` 看签名，再 `Read` 函数顶部确认。

### 12.3 v0.5.0 失败案例（避坑）

| 失败 | 根因 | 修复 |
|------|------|------|
| `Property 'summary' does not exist on type 'ProfilerResult'` | ProfilerResult 不含 summary 字段 | 改用 `summarizeRisks(risks)` 工具内部计算 |
| `Expected 2 arguments, but got 3` 给 `renderProfilerMarkdown` | 误传 summary 参数 | 删第 3 个参数，summary 由内部计算 |
| `Property 'requiresApproval' does not exist on type 'ToolDefinition'` | 元数据耦合在工具定义上 | 拆为 ToolDefinition + ToolCallMeta，Registry.getMeta() 分离 |
| `registerAllIpcHandlers` 缺 db 参数 | tutorial 工具需要 db | 改为 `registerAllIpcHandlers(mainWindow, db?)` 可选参数 |
| `Cannot find name 'registerDeployIpcHandlers'` | ipc/index.ts 缺 import | 加 `import { registerDeployIpcHandlers } from './deploy'` |
| `vercel-ai-service.ts` 与 shared/llm-tool-types.ts 重复 ToolDefinition | 早期历史遗留 | 删 vercel-ai-service.ts 的 interface，3 个 Tool 常量删除（无引用方） |

### 12.4 v0.5.0+ 推荐改进方向

| 方向 | 价值 | 推荐 Skill |
|------|------|-----------|
| 教程爬虫从官方源自动同步 | 让 seed 持续更新 | `defuddle` + `agent-reach` |
| LLM Tool Calling 流式输出（Vercel AI SDK streamText） | 工具调用期间也能流式展示 | `langchain-architecture` |
| 工具调用重试与回退策略 | LLM 工具失败后自动降级到 LlmClient | — |
| 用户审批历史持久化 | 审计 + 复盘 | `database-migration` |
| LLM 自动风险分级 | SSH 命令经 risk-engine 评估后自动决定 requiresApproval | `linux-ops` + 风险规则引擎 |

### 12.5 v0.5.0 循环工程验证记录

```
[2026-07-16] typecheck 0 错误（tsc --noEmit -p tsconfig.node.json + tsconfig.web.json）
[2026-07-16] ToolDefinition 重复定义清理（vercel-ai-service.ts 拆解）
[2026-07-16] MCP 5 工具与 LLM Tool Calling 复用率 100%（零业务代码重复）
```


