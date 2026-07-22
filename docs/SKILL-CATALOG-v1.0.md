# TDSF-Linux Desktop — Skill 完整索引 v1.0

> 本文档是项目级 Skill 单一索引（Single Source of Truth），回答"项目需要哪些 Skill / 何时调用"。
> 与 `DEV_SKILLS.md` v1.2（执行层调度规范）配套：本目录回答"有什么"，DEV_SKILLS 回答"怎么调"。
> 更新日期：2026-07-22
> 适用版本：v1.0+
> 变更记录：
> - v1.0 在 DEV_SKILLS v1.2（13 大类）基础上做**增量化整合**，合并 3 类：
>   1. **Electron 专用类**（v1.2 缺失，本次新增）
>   2. **AI Agent 框架类**（v1.2 散落在 MCP/工具类，本次集中）
>   3. **Python Sidecar 类**（v1.0 新增多 Sidecar 隔离，本次新增）
> - 标注每条 Skill 的"质量评级"（必装/推荐/可选）与"项目应用"（已在用/待集成/不适用）

---

## 1. 项目技术栈（Skill 匹配的依据）

### 1.1 核心运行时

| 组件 | 版本 | 角色 | 对应 Skill 类别 |
|------|------|------|-----------------|
| **Electron** | 43.1.1 | 跨平台桌面壳 | Electron 专用类 |
| **electron-vite** | 2.3.0 | 主/预/渲三进程构建 | Electron 专用类 |
| **electron-builder** | 24.13.0 | 安装包打包 | Electron 专用类 |
| **React** | 18.3.0 | 渲染层 UI 框架 | 前端 React 类 |
| **TypeScript** | 5.4.0 (strict) | 全栈类型系统 | 代码质量类 |
| **Vite** | 5.4.0 | 构建工具 | 前端 React 类 |
| **Node.js** | 20.x LTS | 运行时 | 工程方法论类 |

### 1.2 UI 与样式

| 组件 | 版本 | 角色 | 对应 Skill 类别 |
|------|------|------|-----------------|
| **Tailwind CSS** | 4.3.3 | 工具类 CSS | 前端 React 类 |
| **Ant Design** | 5.20.0 | 企业级组件库 | 前端 React 类 |
| **Radix UI** | 1.x（多包） | 无样式可访问原语 | 前端 React 类 |
| **Lucide React** | 1.25.0 | 图标 | 前端 React 类 |
| **CVA + clsx + tailwind-merge** | - | className 合并 | 前端 React 类 |
| **shadcn/ui** | 组件组合 | 复制粘贴组件 | 前端 React 类 |

### 1.3 状态与数据

| 组件 | 版本 | 角色 | 对应 Skill 类别 |
|------|------|------|-----------------|
| **Zustand** | 4.5.0 | 全局状态 | 前端 React 类 |
| **Dexie** | 4.4.4 | IndexedDB 包装 | 前端 React 类 |
| **better-sqlite3** | 13.0.1 | 本地持久化 | 数据库类 |
| **@photostructure/sqlite-vec** | 1.2.0 | 向量检索 | 数据库类 |
| **electron-store** | 8.2.0 | 配置持久化 | 数据库类 |
| **zod** | 3.25.76 | Schema 校验 | 代码质量类 |

### 1.4 集成与通信

| 组件 | 版本 | 角色 | 对应 Skill 类别 |
|------|------|------|-----------------|
| **ssh2** | 1.15.0 | SSH 客户端 | Linux 运维类 |
| **Monaco Editor** | 0.56.0 | 代码编辑器 | 前端 React 类 |
| **@xterm/xterm** | 5.5.0 | 终端 | 前端 React 类 |
| **React Flow** | 11.11.4 | 节点图 | 前端 React 类 |
| **Recharts** | 2.12.0 | 图表 | 前端 React 类 |
| **tar / cheerio / turndown** | - | 解析与转换 | 工程方法论类 |

### 1.5 AI 栈

| 组件 | 版本 | 角色 | 对应 Skill 类别 |
|------|------|------|-----------------|
| **ai (Vercel AI SDK)** | 7.0.29 | 多 Provider 统一接口 | AI Agent 类 |
| **@ai-sdk/openai/anthropic/google/volcengine** | 2.0.x | 各 Provider 适配 | AI Agent 类 |
| **@anthropic-ai/claude-agent-sdk** | 0.3.211 | Claude Agent 集成 | AI Agent 类 |
| **@mastra/core + @mastra/memory** | 1.51/1.23 | TS 原生 Agent 框架 | AI Agent 类 |
| **@modelcontextprotocol/sdk** | 1.0.4 | MCP 协议 | AI Agent 类 |
| **Langfuse** | 3.30.0 | LLM 观测性 | 测试/质量类 |
| **@xenova/transformers** | 2.17.2 | 本地 Embedding | AI Agent 类 |

### 1.6 测试与质量

| 组件 | 版本 | 角色 | 对应 Skill 类别 |
|------|------|------|-----------------|
| **Vitest** | 2.0.0 | 单元测试 | 测试/质量类 |
| **Playwright** | 1.61.1 | E2E 测试 | 测试/质量类 |
| **ESLint** | 9.6.0 | 代码规范 | 代码质量类 |
| **@testing-library/react** | 16.3.2 | 组件测试 | 测试/质量类 |
| **Promptfoo** | （已部署） | 提示词测试 | 测试/质量类 |
| **DeepEval** | （待评估） | LLM 评估 | 测试/质量类 |

### 1.7 Python Sidecar（v1.0 新增多进程隔离）

| 组件 | 端口 | 角色 | 对应 Skill 类别 |
|------|------|------|-----------------|
| **sidecar-a: drain3** | 7931 | 日志模板挖掘 | Python Sidecar 类 |
| **sidecar-b: dowhy** | 7932 | 因果推断 | Python Sidecar 类 |
| **sidecar-c: agentscope / smolagents** | 7933 | 多 Agent 编排 | Python Sidecar 类 |

---

## 2. Skill 完整索引（按角色分类，共 16 类）

### 类别速查表

| # | 类别 | 数量 | 必装 | 推荐 | 可选 | 项目已用 |
|---|------|------|------|------|------|----------|
| 1 | 开发流程与规划 | 10 | 5 | 3 | 2 | 6 |
| 2 | 代码质量与审查 | 8 | 5 | 2 | 1 | 5 |
| 3 | **Electron 专用（新增）** | 6 | 3 | 2 | 1 | 2 |
| 4 | 前端 React / UI 设计 | 14 | 5 | 6 | 3 | 6 |
| 5 | **AI Agent 框架（新增）** | 9 | 4 | 3 | 2 | 4 |
| 6 | 测试 / 质量保证 | 11 | 5 | 4 | 2 | 5 |
| 7 | 数据库 / 向量 | 4 | 2 | 1 | 1 | 2 |
| 8 | Linux 运维 / 安全 | 6 | 3 | 2 | 1 | 3 |
| 9 | 架构 / 设计模式 | 6 | 1 | 3 | 2 | 2 |
| 10 | 调研 / 搜索 / 联网 | 9 | 3 | 4 | 2 | 5 |
| 11 | 文档 / 写作 | 7 | 2 | 3 | 2 | 3 |
| 12 | 工程实践 / Git / CI | 11 | 4 | 4 | 3 | 5 |
| 13 | 记忆 / 上下文 | 5 | 3 | 1 | 1 | 3 |
| 14 | **Python Sidecar（新增）** | 4 | 1 | 2 | 1 | 0 |
| 15 | MCP / 工具集成 | 4 | 2 | 1 | 1 | 3 |
| 16 | 调试 / 排错 | 5 | 3 | 1 | 1 | 3 |

---

### 类别 1：开发流程与规划

| Skill | 质量 | 项目应用 | 触发词 | 说明 |
|-------|------|----------|--------|------|
| `using-superpowers` | ⭐⭐⭐必装 | 已在用 | 任意会话开头 | 元规范，强制 Skill 工具调用前置 |
| `brainstorming` | ⭐⭐⭐必装 | 待集成 | 任何创意/功能/改动前 | 探索用户意图，避免盲目实现 |
| `writing-plans` | ⭐⭐⭐必装 | 已在用 | "写方案" / "RFC" | 多步任务前出实施计划 |
| `test-driven-development` (TDD) | ⭐⭐⭐必装 | 待集成 | "TDD" / "红绿重构" | 先写测试再写实现 |
| `verification-before-completion` | ⭐⭐⭐必装 | 已在用 | 声明完成前 | 完成前必跑验证命令 |
| `executing-plans` | ⭐⭐推荐 | 已在用 | "执行计划" | 在单独会话执行计划 |
| `subagent-driven-development` | ⭐⭐推荐 | 已在用 | "subagent 编排" | 当前会话执行多独立任务 |
| `dispatching-parallel-agents` | ⭐⭐推荐 | 已在用 | "并行调研/开发" | 2+ 独立任务 |
| `ai-dev-workflow` | ⭐⭐推荐 | 已在用 | "标准化开发流程" | 6 阶段 pipeline |
| `using-git-worktrees` | ⭐可选 | 待集成 | "git worktree" | 隔离开发 |
| `finishing-a-development-branch` | ⭐可选 | 已在用 | "完成分支" | 收尾工作 |

### 类别 2：代码质量与审查

| Skill | 质量 | 项目应用 | 触发词 | 说明 |
|-------|------|----------|--------|------|
| `code-review-excellence` | ⭐⭐⭐必装 | 已在用 | "代码审查" | 提交前自检 |
| `TRAE-security-review` | ⭐⭐⭐必装 | 已在用 | "安全扫描" | ssh/密码/私钥相关 |
| `verification-before-completion` | ⭐⭐⭐必装 | 已在用 | "完成前验证" | 强制 |
| `security-best-practices` | ⭐⭐⭐必装 | 待集成 | "安全实践" | TS/JS 安全审查 |
| `multi-reviewer-patterns` | ⭐⭐推荐 | 已在用 | "多 reviewer 协作" | 并行审查 |
| `requesting-code-review` | ⭐⭐推荐 | 待集成 | "请求 review" | 完成前 |
| `receiving-code-review` | ⭐⭐推荐 | 待集成 | "收到 review" | 验证而非盲从 |
| `secrets-management` | ⭐可选 | 待集成 | "密钥管理" | 凭证管理（与 redact 配套） |

### 类别 3：Electron 专用（v1.0 新增）

| Skill | 质量 | 项目应用 | 触发词 | 说明 |
|-------|------|----------|--------|------|
| `electron-best-practices` (社区) | ⭐⭐⭐必装 | 待集成 | "Electron 安全" | contextIsolation/sandbox/preload |
| `electron-builder` 官方文档 | ⭐⭐⭐必装 | 已在用 | "打包" / "安装包" | win/mac/linux 三平台 |
| `electron-vite` 官方文档 | ⭐⭐推荐 | 已在用 | "构建配置" | 三进程分离 |
| `ipc-patterns` (社区) | ⭐⭐推荐 | 已在用 | "IPC 通信" | main↔renderer 安全通道 |
| `context-bridge-safety` | ⭐⭐推荐 | 已在用 | "preload 桥接" | 不暴露 Node API |
| `electron-auto-updater` (社区) | ⭐可选 | 不适用 | "自动更新" | v1.0 暂不需要 |

**关键参考**：
- 官方安全白皮书：https://www.electronjs.org/docs/latest/tutorial/security
- electron-vite：https://electron-vite.org/
- electron-builder：https://www.electron.build/

### 类别 4：前端 React / UI 设计

| Skill | 质量 | 项目应用 | 触发词 | 说明 |
|-------|------|----------|--------|------|
| `frontend-design` | ⭐⭐⭐必装 | 已在用 | "前端设计" | 生产级 UI |
| `nimpeccable` | ⭐⭐⭐必装 | 已在用 | "UI 打磨" | 已有设计精修 |
| `vercel-react-best-practices` | ⭐⭐⭐必装 | 已在用 | "React 性能" | 57 条规则 |
| `composition-patterns` (vercel) | ⭐⭐⭐必装 | 已在用 | "组件设计" | compound components |
| `vercel-react-view-transitions` | ⭐⭐推荐 | 已在用 | "页面切换动画" | View Transition API |
| `design-system-patterns` | ⭐⭐推荐 | 待集成 | "设计系统" | tokens / 主题 |
| `tailwind-design-system` | ⭐⭐推荐 | 待集成 | "Tailwind v4" | 与 Tailwind 4.3.3 配套 |
| `super-frontend-design` | ⭐⭐推荐 | 待集成 | "前端全流程" | 5 阶段工作流 |
| `interaction-design` | ⭐⭐推荐 | 已在用 | "微交互" | 动效设计 |
| `responsive-design` | ⭐可选 | 待集成 | "响应式" | 跨端 |
| `wcag-audit-patterns` | ⭐可选 | 待集成 | "WCAG 审计" | 无障碍 |
| `accessibility-compliance` | ⭐可选 | 待集成 | "无障碍合规" | WCAG 2.2 |
| `web-dev` | ⭐可选 | 不适用 | "做 web" | 全新 web 项目（本项目是 Electron） |
| `web-component-design` | ⭐可选 | 待集成 | "组件库设计" | 跨框架 |

**关键参考**：
- React 官方：https://react.dev/
- Ant Design 5：https://ant.design/
- Tailwind v4：https://tailwindcss.com/docs/installation
- shadcn/ui：https://ui.shadcn.com/
- Radix UI：https://www.radix-ui.com/

### 类别 5：AI Agent 框架（v1.0 新增集中）

| Skill | 质量 | 项目应用 | 触发词 | 说明 |
|-------|------|----------|--------|------|
| `mcp-builder` | ⭐⭐⭐必装 | 已在用 | "MCP server" | 暴露工具给 LLM |
| `claude-agent-sdk-guide` (Anthropic) | ⭐⭐⭐必装 | 已在用 | "Claude Agent" | 官方 SDK 集成 |
| `vercel-ai-sdk` 官方 | ⭐⭐⭐必装 | 已在用 | "AI SDK" | 多 Provider 统一 |
| `mastra` 官方 | ⭐⭐⭐必装 | 已在用 | "Mastra" | TS 原生 Agent 框架 |
| `langgraph` 官方 | ⭐⭐推荐 | 待集成 | "LangGraph" | 复杂状态工作流 |
| `prompt-engineering-patterns` | ⭐⭐推荐 | 已在用 | "Prompt 优化" | 生产级 Prompt |
| `rag-implementation` | ⭐⭐推荐 | 已在用 | "RAG" | 知识库检索增强 |
| `llm-evaluation` | ⭐推荐 | 待集成 | "LLM 评估" | 评估生产表现 |
| `agent-design-patterns` (社区) | ⭐推荐 | 待集成 | "Agent 设计" | ReAct / Plan-Execute / Reflection |

**关键参考**：
- Vercel AI SDK：https://sdk.vercel.ai/docs
- Anthropic Claude Agent SDK：https://docs.anthropic.com/en/api/agent-sdk/overview
- Mastra：https://mastra.ai/docs
- LangGraph：https://langchain-ai.github.io/langgraph/
- MCP 协议：https://modelcontextprotocol.io/

### 类别 6：测试 / 质量保证

| Skill | 质量 | 项目应用 | 触发词 | 说明 |
|-------|------|----------|--------|------|
| `javascript-testing-patterns` | ⭐⭐⭐必装 | 已在用 | "Vitest" / "单测" | 单元测试 |
| `e2e-testing-patterns` | ⭐⭐⭐必装 | 已在用 | "E2E" / "Playwright" | 端到端 |
| `webapp-testing` | ⭐⭐⭐必装 | 已在用 | "测试本地 web" | renderer 端 |
| `playwright` MCP | ⭐⭐⭐必装 | 已在用 | 浏览器自动化 | 实际 E2E 操作 |
| `verification-before-completion` | ⭐⭐⭐必装 | 已在用 | "完成前验证" | 强制门禁 |
| `promptfoo` 官方 | ⭐⭐推荐 | 已在用 | "Prompt 测试" | 提示词回归 |
| `deepeval` 官方 | ⭐⭐推荐 | 待集成 | "LLM 评估" | 准确性/偏见/毒性 |
| `ragas` 官方 | ⭐推荐 | 待集成 | "RAG 评估" | 检索质量 |
| `test-driven-development` | ⭐⭐推荐 | 待集成 | "TDD" | 测试先行 |
| `load-testing-patterns` | ⭐可选 | 不适用 | "压测" | 桌面端一般不需要 |
| `chaos-engineering` | ⭐可选 | 待集成 | "混沌工程" | Sidecar 故障注入 |

**关键参考**：
- Vitest：https://vitest.dev/
- Playwright：https://playwright.dev/
- Promptfoo：https://promptfoo.dev/docs
- DeepEval：https://docs.confident-ai.com/

### 类别 7：数据库 / 向量

| Skill | 质量 | 项目应用 | 触发词 | 说明 |
|-------|------|----------|--------|------|
| `better-sqlite3` 官方 | ⭐⭐⭐必装 | 已在用 | "SQLite" | 参数化防注入 |
| `sql-optimization-patterns` | ⭐⭐推荐 | 待集成 | "SQL 慢" / "EXPLAIN" | 性能 |
| `sqlite-vec` 官方 | ⭐⭐推荐 | 已在用 | "向量检索" | RAG 本地向量 |
| `database-migration` | ⭐可选 | 待集成 | "Schema 迁移" | 增量变更 |

**关键参考**：
- better-sqlite3：https://github.com/WiseLibs/better-sqlite3
- sqlite-vec：https://github.com/asg017/sqlite-vec

### 类别 8：Linux 运维 / 安全

| Skill | 质量 | 项目应用 | 触发词 | 说明 |
|-------|------|----------|--------|------|
| `linux-ops` | ⭐⭐⭐必装 | 已在用 | "Linux 故障" / "诊断" | 真实服务器问题 |
| `centos-linux-triage` | ⭐⭐推荐 | 已在用 | "CentOS" / "SELinux" | RHEL 兼容 |
| `security-best-practices` | ⭐⭐⭐必装 | 待集成 | "Linux 加固" | 通用安全 |
| `sast-configuration` | ⭐⭐推荐 | 待集成 | "SAST" | 静态扫描 |
| `secrets-management` | ⭐⭐推荐 | 已在用 | "凭证管理" | redact 配套 |
| `centos-linux-triage` | ⭐⭐推荐 | 已在用 | "CentOS" | 国产化场景 |

**关键参考**：
- Arch Wiki：https://wiki.archlinux.org/
- Red Hat Docs：https://docs.redhat.com/
- Ubuntu Docs：https://help.ubuntu.com/

### 类别 9：架构 / 设计模式

| Skill | 质量 | 项目应用 | 触发词 | 说明 |
|-------|------|----------|--------|------|
| `architecture-decision-records` | ⭐⭐推荐 | 已在用 | "ADR" | 记录技术选型 |
| `architecture-patterns` | ⭐⭐推荐 | 已在用 | "Clean Arch" / "DDD" | 后端架构 |
| `api-design-principles` | ⭐⭐推荐 | 已在用 | "REST" / "API 设计" | 接口设计 |
| `openapi-spec-generation` | ⭐推荐 | 待集成 | "OpenAPI" | 接口文档 |
| `microservices-patterns` | ⭐可选 | 部分（Sidecar） | "微服务" | 多 Sidecar 场景 |
| `event-store-design` | ⭐可选 | 不适用 | "Event Sourcing" | 项目不用事件溯源 |

### 类别 10：调研 / 搜索 / 联网

| Skill | 质量 | 项目应用 | 触发词 | 说明 |
|-------|------|----------|--------|------|
| `agent-reach` | ⭐⭐⭐必装 | 已在用 | "全网调研" / "搜搜" | 13 平台 |
| `context7` | ⭐⭐⭐必装 | 已在用 | "查库最新用法" | Context7 API |
| `web-search` / `web-fetch` | ⭐⭐⭐必装 | 已在用 | 通用 | 内置工具 |
| `last30days` | ⭐⭐推荐 | 已在用 | "最近 30 天趋势" | Reddit/X/HN |
| `multi-search-engine` | ⭐⭐推荐 | 已在用 | "多引擎搜索" | 16 引擎 |
| `deep-research-ultra` | ⭐⭐推荐 | 待集成 | "深度调研" | 报告生成 |
| `research-first` | ⭐⭐推荐 | 已在用 | "先查一下" | 调研前置 |
| `defuddle` | ⭐推荐 | 已在用 | "提取网页" | 转 md |
| `find-skills` | ⭐⭐推荐 | 已在用 | "找 skill" | Skill 发现 |

### 类别 11：文档 / 写作

| Skill | 质量 | 项目应用 | 触发词 | 说明 |
|-------|------|----------|--------|------|
| `doc-coauthoring` | ⭐⭐⭐必装 | 已在用 | "写技术文档" / "RFC" | 协作文档 |
| `office-document-suite` | ⭐⭐推荐 | 已在用 | "Word/PPT/PDF" | 演示材料 |
| `changelog-automation` | ⭐推荐 | 待集成 | "changelog" | 发版 |
| `edit-article` | ⭐推荐 | 已在用 | "润色" | 文档精修 |
| `writing-skills` | ⭐推荐 | 已在用 | "写 skill" | 团队能力沉淀 |
| `skill-creator` | ⭐推荐 | 已在用 | "创建 skill" | 编写规范 |
| `docx`（已合并入 office-document-suite） | - | - | - | DEPRECATED |

### 类别 12：工程实践 / Git / CI

| Skill | 质量 | 项目应用 | 触发词 | 说明 |
|-------|------|----------|--------|------|
| `git-commit` | ⭐⭐⭐必装 | 已在用 | "/commit" | 智能 commit |
| `github-actions-templates` | ⭐⭐推荐 | 已在用 | "GitHub Actions" | CI/CD |
| `setup-pre-commit` | ⭐⭐推荐 | 已在用 | "pre-commit" | 提交检查 |
| `dependency-upgrade` | ⭐⭐推荐 | 待集成 | "升级依赖" | 大版本 |
| `git-advanced-workflows` | ⭐推荐 | 待集成 | "rebase/cherry-pick" | 复杂 Git |
| `git-guardrails-claude-code` | ⭐推荐 | 待集成 | "阻止危险 git" | Claude Code hooks |
| `github-deploy` | ⭐推荐 | 待集成 | "部署网页" | GitHub Pages |
| `github-triage` | ⭐推荐 | 待集成 | "issue triage" | Issue 处理 |
| `gitlab-ci-patterns` | ⭐可选 | 不适用 | "GitLab" | 项目用 GitHub |
| `deployment-pipeline-design` | ⭐推荐 | 待集成 | "部署流水线" | CI/CD 设计 |
| `turborepo-caching` | ⭐可选 | 待评估 | "monorepo 缓存" | 当前单包不需要 |

### 类别 13：记忆 / 上下文

| Skill | 质量 | 项目应用 | 触发词 | 说明 |
|-------|------|----------|--------|------|
| `super-memory` | ⭐⭐⭐必装 | 已在用 | "保存记忆" / "sync" | 任务/会话结束 |
| `context7` | ⭐⭐⭐必装 | 已在用 | "查最新文档" | 库版本变更 |
| `skill-workspace` | ⭐⭐推荐 | 已在用 | "skill 工作台" | Skill 全生命周期 |
| `cocoloop` | ⭐推荐 | 已在用 | "安装 skill" / "管理" | Skill 安全管理 |
| `claude-code-sessions` | ⭐推荐 | 待集成 | "历史会话" | 回溯与 token 分析 |

### 类别 14：Python Sidecar（v1.0 新增）

| Skill | 质量 | 项目应用 | 触发词 | 说明 |
|-------|------|----------|--------|------|
| `drain3` 官方 | ⭐⭐推荐 | 已在用 | "日志模板挖掘" | drain3_adapter.py |
| `dowhy` 官方 | ⭐⭐推荐 | 已在用 | "因果推断" | dowhy_adapter.py |
| `agentscope` 官方 | ⭐推荐 | 待集成 | "多 Agent 编排" | agentscope_adapter.py |
| `smolagents` 官方 | ⭐推荐 | 待集成 | "轻量 Agent" | smolagents_adapter.py |

**关键参考**：
- drain3：https://github.com/IBM/drain3
- DoWhy：https://github.com/py-why/dowhy
- AgentScope：https://github.com/modelscope/agentscope
- smolagents：https://github.com/huggingface/smolagents

### 类别 15：MCP / 工具集成

| Skill | 质量 | 项目应用 | 触发词 | 说明 |
|-------|------|----------|--------|------|
| `mcp-builder` | ⭐⭐⭐必装 | 已在用 | "MCP server" | 项目已实现 |
| `context7` | ⭐⭐推荐 | 已在用 | "库最新文档" | 自动调用 |
| `github` / `gh-cli` | ⭐⭐推荐 | 已在用 | "PR/issue" | GitHub 操作 |
| `amap-lbs-skill` | ⭐可选 | 不适用 | "地图" | 桌面端不需要 |

### 类别 16：调试 / 排错

| Skill | 质量 | 项目应用 | 触发词 | 说明 |
|-------|------|----------|--------|------|
| `systematic-debugging` | ⭐⭐⭐必装 | 已在用 | "系统化调试" | 任何 bug 前置 |
| `parallel-debugging` | ⭐⭐推荐 | 已在用 | "并行调试" / "多假设" | 复杂 bug |
| `TRAE-debugger` | ⭐⭐推荐 | 已在用 | "运行时调试" | 复现 bug |
| `linux-ops` | ⭐⭐⭐必装 | 已在用 | "Linux 故障" | 服务端 |
| `debugging-strategies` | ⭐推荐 | 待集成 | "调试策略" | 通用方法 |

---

## 3. 关键开源项目推荐

### 3.1 直接可借鉴（必读源码）

| 项目 | 用途 | 学习点 | 来源 |
|------|------|--------|------|
| **zcf** (Claude Code 增强) | Claude Code 配置与工作流 | Skill 编排、Slash 命令设计 | https://github.com/UfoMiao/zcf |
| **claude-code-best-practices** | Claude Code 使用模式 | 上下文工程、token 优化 | https://github.com/anthropics/claude-code-best-practices |
| **electron-vite** 模板 | 项目脚手架 | 三进程分离、构建配置 | https://github.com/alex8088/electron-vite |
| **shadcn/ui** | 组件范式 | 复制粘贴组件 + Radix | https://github.com/shadcn-ui/ui |
| **Mastra** | TS Agent 框架 | 工具调用、记忆、可观测 | https://github.com/mastra-ai/mastra |

### 3.2 AI Agent 参考架构

| 项目 | 价值 | 调研方式 | 来源 |
|------|------|----------|------|
| **LangGraph** | 复杂状态工作流 | `opensource-reference/langgraph` | https://github.com/langchain-ai/langgraph |
| **Claude Agent SDK** | 官方 Agent 范式 | 官方文档 + sample | https://github.com/anthropics/claude-agent-sdk |
| **AutoGen** | 多 Agent 协作 | 模式参考 | https://github.com/microsoft/autogen |
| **CrewAI** | 角色化多 Agent | 角色定义 | https://github.com/crewAIInc/crewAI |
| **AgentScope** | 国产多 Agent | Sidecar 集成 | https://github.com/modelscope/agentscope |

### 3.3 SSH / Linux 运维参考

| 项目 | 价值 | 来源 |
|------|------|------|
| **electerm** | Electron 终端参考 | https://github.com/electerm/electerm |
| **next-terminal** | Web 堡垒机 | https://github.com/dushixiang/next-terminal |
| **webssh** | Web SSH 参考 | https://github.com/huashengdun/webssh |

### 3.4 评测与监控

| 项目 | 价值 | 来源 |
|------|------|------|
| **Langfuse** | LLM 可观测性 | https://github.com/langfuse/langfuse |
| **Promptfoo** | Prompt 评估 | https://github.com/promptfoo/promptfoo |
| **DeepEval** | LLM 评估 | https://github.com/confident-ai/deepeval |
| **RAGAS** | RAG 评估 | https://github.com/explodinggradients/ragas |

---

## 4. 方法论汇总（项目级 SOP）

### 4.1 大任务实施流程（强制）

```
1. brainstorming → 探索用户意图，避免盲目实现
2. research-first → 调研技术、查官方文档
3. writing-plans → 写实施计划（spec.md + tasks.md + checklist.md）
4. test-driven-development → 关键路径 TDD
5. subagent-driven-development / dispatching-parallel-agents → 执行
6. verification-before-completion → 完成前必跑门禁
7. code-review-excellence → 提交前自检
8. super-memory → 会话结束沉淀记忆
```

### 4.2 单次会话流程（using-superpowers 强制）

```
任意任务到来
  ↓
① using-superpowers（必须先调用）
  ↓
② 查本目录找相关 Skill
  ↓
③ 调用 Skill（先看 description）
  ↓
④ 按 Skill 指引执行
  ↓
⑤ 完成前调用 verification-before-completion
  ↓
⑥ 会话结束调用 super-memory
```

### 4.3 调研类任务流程

```
1. agent-reach / web-search → 联网搜索
2. context7 → 查库最新 API
3. 关键开源项目 → git clone 到 opensource-reference/ 全量分析（硬约束 R17）
4. 输出调研报告 → docs/调研报告-xxx.md
5. 更新本目录的"项目应用"列
```

### 4.4 排错流程

```
任何 bug
  ↓
① systematic-debugging（前置）
  ↓
② 根因明确 → 修复
  根因不明 → parallel-debugging（多假设并行）
  ↓
③ 复杂场景 → TRAE-debugger
  ↓
④ 修复后 → code-review + verification-before-completion
```

---

## 5. 不适用 Skill 清单（明确不调用）

| Skill | 不适用原因 |
|-------|-----------|
| `python-*` 全系列（Sidecar 除外） | 主进程是 TypeScript |
| `rust-*` / `go-*` | 不涉及 |
| `defi-protocol-templates` / `web3-testing` | 不涉及区块链 |
| `unity-*-patterns` | 不涉及 Unity |
| `obsidian-*` | 不涉及 Obsidian |
| `react-native-*` | 不涉及移动端 |
| `spark-optimization` | 不涉及 Spark |
| `postgresql-table-design` | 项目用 SQLite |
| `temporal-*` | 不涉及 Temporal |
| `tikhub-api-helper` | 不涉及社媒爬取 |
| `load-testing-patterns` | 桌面端一般不需要 |
| `electron-auto-updater` | v1.0 暂不需要 |

---

## 6. 文档维护规则

- 新发现 Skill：先在本目录 §X.Y 加一行，质量评级 + 项目应用
- 不再适用的 Skill：移到 §5
- 反模式发现：追加到 `DEV_SKILLS.md` §7
- Skill 调用踩坑：追加到 `DEV_SKILLS.md` §6

---

## 附录 A：本目录与其他文档的关系

```
SKILL-CATALOG-v1.0.md（本文件） ─── "有什么"
    ↓
DEV_SKILLS.md v1.2 ─── "怎么调"
    ↓
AGENTS.md ─── "代码怎么写"
    ↓
CLAUDE.md ─── "AI 会话怎么工作"
```

## 附录 B：版本演进

- v1.0（2026-07-22）：基于 DEV_SKILLS v1.2 增量化整合，新增 Electron / AI Agent / Python Sidecar 三类
