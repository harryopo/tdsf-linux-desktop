# TDSF-Linux Desktop — Skill 安装指南 v1.0

> 本文档给出 Skill 的**实操安装命令**与**验证方法**。
> 配套 `SKILL-CATALOG-v1.0.md`（索引）+ `DEV_SKILLS.md`（调度规范）。
> 适用环境：Trae IDE / Claude Code / Cursor（任何支持 Skill 的 IDE）。
> 更新日期：2026-07-22

---

## 1. 安装方式总览

### 1.1 三种来源

| 来源 | 适用范围 | 典型命令 |
|------|---------|----------|
| **IDE 内置** | 元规范类、工具类 | 通常无需安装，开箱即用 |
| **官方 Skill 商店** | 通用方法论类 | `npx -y skilld add gh:owner/repo -s skill-name` |
| **GitHub 仓库直接安装** | 定制 Skill、社区 Skill | `npx -y skills add <repo-url> --skill <name>` |

### 1.2 通用前置

```bash
# Node.js 20+ / pnpm 11+ 已装（项目硬约束）
node -v   # 预期 >= 20.x
pnpm -v   # 预期 >= 11.x

# 镜像加速（国内网络环境硬约束）
npm config set registry https://registry.npmmirror.com
```

---

## 2. 按角色分组的安装包

### 2.1 角色 A：项目核心（⭐⭐⭐ 必装，开箱即用）

> 通常由 IDE 内置提供，**无需手动安装**。重点是**调用意识**。

| Skill | 来源 | 备注 |
|-------|------|------|
| `using-superpowers` | IDE 内置 | 元规范，强制 Skill 工具调用前置 |
| `verification-before-completion` | IDE 内置 | 声明完成前必跑验证 |
| `brainstorming` | IDE 内置 | 任何创意/功能/改动前 |
| `writing-plans` | IDE 内置 | 多步任务前出计划 |
| `test-driven-development` | IDE 内置 | TDD 工作流 |
| `systematic-debugging` | IDE 内置 | 任何 bug 前置 |
| `code-review-excellence` | IDE 内置 | 提交前自检 |
| `subagent-driven-development` | IDE 内置 | 当前会话执行多任务 |
| `dispatching-parallel-agents` | IDE 内置 | 并行执行 |
| `agent-reach` | IDE 内置 | 13 平台全网调研 |
| `context7` | IDE 内置 | 库最新文档查询 |
| `super-memory` | IDE 内置 | 任务/会话结束沉淀 |

**验证**：在新会话中输入触发词，IDE 应自动激活对应 Skill。

---

### 2.2 角色 B：工程方法论（推荐安装）

```bash
# Superpowers 完整套件（最完整的方法论集）
npx -y skilld add gh:obra/superpowers -s brainstorming
npx -y skilld add gh:obra/superpowers -s writing-plans
npx -y skilld add gh:obra/superpowers -s executing-plans
npx -y skilld add gh:obra/superpowers -s subagent-driven-development
npx -y skilld add gh:obra/superpowers -s test-driven-development
npx -y skilld add gh:obra/superpowers -s systematic-debugging
npx -y skilld add gh:obra/superpowers -s code-review-excellence
npx -y skilld add gh:obra/superpowers -s verification-before-completion
npx -y skilld add gh:obra/superpowers -s receiving-code-review
npx -y skilld add gh:obra/superpowers -s requesting-code-review
npx -y skilld add gh:obra/superpowers -s using-git-worktrees
npx -y skilld add gh:obra/superpowers -s using-superpowers
npx -y skilld add gh:obra/superpowers -s finishing-a-development-branch
npx -y skilld add gh:obra/superpowers -s parallel-debugging
npx -y skilld add gh:obra/superpowers -s writing-skills
```

**验证**：
```bash
# 列出已安装 Skill
npx -y skills list
```

---

### 2.3 角色 C：前端 React / UI 设计（按需安装）

```bash
# Vercel 官方 React 性能与组件设计（强烈推荐）
npx -y skills add https://github.com/vercel-labs/agent-skills --skill vercel-react-best-practices
npx -y skills add https://github.com/vercel-labs/agent-skills --skill composition-patterns
npx -y skills add https://github.com/vercel-labs/agent-skills --skill vercel-react-view-transitions
npx -y skills add https://github.com/vercel-labs/agent-skills --skill web-design-guidelines
npx -y skills add https://github.com/vercel-labs/agent-skills --skill web-component-design
npx -y skills add https://github.com/vercel-labs/agent-skills --skill vercel-composition-patterns
```

```bash
# 通用前端设计
npx -y skills add https://github.com/anthropics/skills --skill frontend-design
npx -y skills add https://github.com/anthropics/skills --skill frontend-skill
npx -y skills add https://github.com/anthropics/skills --skill web-dev
npx -y skills add https://github.com/anthropics/skills --skill web-artifacts-builder
npx -y skills add https://github.com/anthropics/skills --skill canvas-design
npx -y skills add https://github.com/anthropics/skills --skill algorithmic-art
```

```bash
# 设计系统与无障碍
npx -y skills add https://github.com/anthropics/skills --skill design-system-patterns
npx -y skills add https://github.com/anthropics/skills --skill visual-design-foundations
npx -y skills add https://github.com/anthropics/skills --skill accessibility-compliance
npx -y skills add https://github.com/anthropics/skills --skill wcag-audit-patterns
npx -y skills add https://github.com/anthropics/skills --skill screen-reader-testing
npx -y skills add https://github.com/anthropics/skills --skill responsive-design
```

**验证**：
```bash
npx -y skills list | grep -E "vercel|frontend|design"
```

---

### 2.4 角色 D：AI Agent 框架（项目核心）

```bash
# Vercel AI SDK 官方（项目已在用）
npx -y skills add https://github.com/vercel-labs/agent-skills --skill ai-sdk-patterns
npx -y skills add https://github.com/vercel-labs/agent-skills --skill prompt-engineering-patterns
```

```bash
# Anthropic Claude Agent SDK（项目已在用）
npx -y skills add https://github.com/anthropics/claude-agent-sdk-docs --skill claude-agent-sdk-guide
```

```bash
# MCP 协议（项目核心）
npx -y skills add https://github.com/anthropics/skills --skill mcp-builder
```

```bash
# LangChain / LangGraph / RAG（v1.0 待集成）
npx -y skills add https://github.com/langchain-ai/langgraph --skill langgraph-patterns
npx -y skills add https://github.com/langchain-ai/rag-from-scratch --skill rag-implementation
npx -y skills add https://github.com/langchain-ai/lcel-cookbook --skill lcel-patterns
npx -y skills add https://github.com/anthropics/skills --skill llm-evaluation
npx -y skills add https://github.com/anthropics/skills --skill embedding-strategies
npx -y skills add https://github.com/anthropics/skills --skill hybrid-search-implementation
```

**验证**：
```bash
npx -y skills list | grep -E "claude|mcp|rag|ai-sdk|llm"
```

---

### 2.5 角色 E：测试 / 质量保证

```bash
# JavaScript/TypeScript 测试模式
npx -y skills add https://github.com/anthropics/skills --skill javascript-testing-patterns
npx -y skills add https://github.com/anthropics/skills --skill e2e-testing-patterns
npx -y skills add https://github.com/anthropics/skills --skill webapp-testing
npx -y skills add https://github.com/anthropics/skills --skill temporal-python-testing  # 参考
```

```bash
# 浏览器自动化与 dogfood
npx -y skills add https://github.com/anthropics/skills --skill dogfood
npx -y skills add https://github.com/microsoft/playwright-mcp --skill playwright
```

**验证**：项目已配置 `pnpm test` / `pnpm test:e2e`，运行应通过。

---

### 2.6 角色 F：数据库 / 持久化

```bash
npx -y skills add https://github.com/anthropics/skills --skill sql-optimization-patterns
npx -y skills add https://github.com/anthropics/skills --skill database-er-diagram
npx -y skills add https://github.com/anthropics/skills --skill database-migration
npx -y skills add https://github.com/anthropics/skills --skill postgresql-table-design  # 参考
```

---

### 2.7 角色 G：Linux 运维 / 安全

```bash
npx -y skills add https://github.com/anthropics/skills --skill linux-ops
npx -y skills add https://github.com/anthropics/skills --skill centos-linux-triage
npx -y skills add https://github.com/anthropics/skills --skill security-best-practices
npx -y skills add https://github.com/anthropics/skills --skill sast-configuration
npx -y skills add https://github.com/anthropics/skills --skill secrets-management
npx -y skills add https://github.com/anthropics/skills --skill memory-forensics  # 高级
```

---

### 2.8 角色 H：架构 / 设计模式

```bash
npx -y skills add https://github.com/anthropics/skills --skill architecture-patterns
npx -y skills add https://github.com/anthropics/skills --skill architecture-decision-records
npx -y skills add https://github.com/anthropics/skills --skill api-design-principles
npx -y skills add https://github.com/anthropics/skills --skill openapi-spec-generation
npx -y skills add https://github.com/anthropics/skills --skill microservices-patterns
npx -y skills add https://github.com/anthropics/skills --skill cqrs-implementation
npx -y skills add https://github.com/anthropics/skills --skill saga-orchestration
npx -y skills add https://github.com/anthropics/skills --skill event-store-design
npx -y skills add https://github.com/anthropics/skills --skill distributed-tracing
npx -y skills add https://github.com/anthropics/skills --skill resilience-patterns
```

---

### 2.9 角色 I：调研 / 搜索 / 文档处理

```bash
npx -y skills add https://github.com/anthropics/skills --skill doc-coauthoring
npx -y skills add https://github.com/anthropics/skills --skill office-document-suite
npx -y skills add https://github.com/anthropics/skills --skill changelog-automation
npx -y skills add https://github.com/anthropics/skills --skill edit-article
npx -y skills add https://github.com/anthropics/skills --skill writing-skills
npx -y skills add https://github.com/anthropics/skills --skill skill-creator
npx -y skills add https://github.com/anthropics/skills --skill find-skills
npx -y skills add https://github.com/anthropics/skills --skill cocoloop
npx -y skills add https://github.com/anthropics/skills --skill skill-workspace
```

---

### 2.10 角色 J：工程实践 / Git / CI

```bash
npx -y skills add https://github.com/anthropics/skills --skill git-commit
npx -y skills add https://github.com/anthropics/skills --skill git-advanced-workflows
npx -y skills add https://github.com/anthropics/skills --skill setup-pre-commit
npx -y skills add https://github.com/anthropics/skills --skill github-actions-templates
npx -y skills add https://github.com/anthropics/skills --skill deployment-pipeline-design
npx -y skills add https://github.com/anthropics/skills --skill dependency-upgrade
npx -y skills add https://github.com/anthropics/skills --skill github-deploy
npx -y skills add https://github.com/anthropics/skills --skill github-triage
npx -y skills add https://github.com/anthropics/skills --skill git-guardrails-claude-code
```

---

## 3. 一键安装脚本

### 3.1 项目核心包（必装）

```bash
# 项目核心（~14 个 Skill）
npx -y skilld add gh:obra/superpowers -s brainstorming,writing-plans,subagent-driven-development,test-driven-development,systematic-debugging,code-review-excellence,verification-before-completion,executing-plans,using-git-worktrees,using-superpowers,finishing-a-development-branch,parallel-debugging,writing-skills,requesting-code-review
```

### 3.2 前端开发包

```bash
# Vercel + Anthropic 前端合集
npx -y skills add https://github.com/vercel-labs/agent-skills --skill vercel-react-best-practices,composition-patterns,vercel-react-view-transitions,web-design-guidelines,vercel-composition-patterns
npx -y skills add https://github.com/anthropics/skills --skill frontend-design,frontend-skill,design-system-patterns,visual-design-foundations,accessibility-compliance,responsive-design,nimpeccable
```

### 3.3 AI Agent 包

```bash
# Claude + Vercel AI + LangGraph + MCP
npx -y skills add https://github.com/anthropics/skills --skill mcp-builder,claude-agent-sdk-guide
npx -y skills add https://github.com/vercel-labs/agent-skills --skill ai-sdk-patterns,prompt-engineering-patterns
npx -y skills add https://github.com/langchain-ai/langgraph --skill langgraph-patterns
npx -y skills add https://github.com/anthropics/skills --skill llm-evaluation,rag-implementation,hybrid-search-implementation
```

### 3.4 完整包（项目级全量）

```bash
# 把以上 3 个一键脚本顺序执行
# 加上：linux-ops, security, testing, database, git
npx -y skills add https://github.com/anthropics/skills --skill linux-ops,centos-linux-triage,security-best-practices,sast-configuration,secrets-management
npx -y skills add https://github.com/anthropics/skills --skill javascript-testing-patterns,e2e-testing-patterns,webapp-testing,dogfood
npx -y skills add https://github.com/anthropics/skills --skill sql-optimization-patterns,database-er-diagram,database-migration
npx -y skills add https://github.com/anthropics/skills --skill architecture-patterns,architecture-decision-records,api-design-principles,openapi-spec-generation
npx -y skills add https://github.com/anthropics/skills --skill doc-coauthoring,office-document-suite,changelog-automation,edit-article,find-skills,cocoloop,skill-workspace
npx -y skills add https://github.com/anthropics/skills --skill git-commit,git-advanced-workflows,setup-pre-commit,github-actions-templates,deployment-pipeline-design,dependency-upgrade,github-deploy
```

---

## 4. 安装后验证

### 4.1 列出全部已安装 Skill

```bash
npx -y skills list
```

### 4.2 测试核心 Skill

```bash
# 测试 brainstorming
echo "我想加一个功能，让 AI 自动生成 SSH 命令的风险评分。请用 brainstorming 引导我思考" | npx -y skills test brainstorming

# 测试 verification-before-completion
echo "我要完成一个新功能" | npx -y skills test verification-before-completion
```

### 4.3 集成到项目

将 Skill 调用模式写入 `AGENTS.md` / `DEV_SKILLS.md` / `CLAUDE.md`，让 IDE 在合适时机自动调用。

---

## 5. 安装失败的常见问题

### 5.1 GitHub 速率限制

```bash
# 配置代理或使用镜像
git config --global url."https://ghproxy.com/https://github.com/".insteadOf "https://github.com/"
```

### 5.2 权限不足

```bash
# 不要 sudo，使用用户级安装
npx -y skills add <repo> --skill <name> --user
```

### 5.3 找不到 Skill

```bash
# 搜索
npx -y skills search <keyword>

# 例：找 React 相关
npx -y skills search react
```

### 5.4 Skill 冲突

```bash
# 列出冲突
npx -y skills list --conflicts

# 强制覆盖
npx -y skills add <repo> --skill <name> --force
```

---

## 6. Skill 安装策略（质量优先）

### 6.1 三阶段策略

| 阶段 | 安装范围 | 验证标准 |
|------|---------|----------|
| **阶段 1（项目核心）** | 角色 A + B + C + D | 每个 Skill 至少调用过 1 次 |
| **阶段 2（项目扩展）** | + E + F + G + H | 至少 1 个测试套件通过 |
| **阶段 3（完整配置）** | + I + J | 完整工作流跑通 |

### 6.2 不盲目全装

- **不装**：与项目无关的 Skill（如 `python-*` 主项目类型）
- **不装**：被禁用的开源项目 License（AGPL/GPL）
- **不装**：Stars<1k 且未过 10 项安全清单的项目

### 6.3 维护

- 每月检查 Skill 更新
- 弃用项目不用的 Skill
- 新需求时再装

---

## 7. 文档维护

- 新增 Skill：在 `SKILL-CATALOG-v1.0.md` 追加
- Skill 弃用：在 `SKILL-CATALOG-v1.0.md` §5 标注
- 安装命令变更：更新本文件 §3

---

## 附录 A：完整命令清单（一行运行）

```bash
# 完整安装（约 60 个 Skill，分批执行避免超时）
npx -y skills add https://github.com/obra/superpowers --skill brainstorming,writing-plans,test-driven-development,systematic-debugging,code-review-excellence,verification-before-completion,subagent-driven-development,dispatching-parallel-agents,executing-plans,using-git-worktrees,using-superpowers,finishing-a-development-branch,parallel-debugging,writing-skills,requesting-code-review,receiving-code-review,git-guardrails-claude-code,context-driven-development,multi-reviewer-patterns,multi-ai-coordination,team-communication-protocols,team-composition-analysis,team-composition-patterns,workflow-patterns,executable-plans,context7,agent-reach,last30days,multi-search-engine,defuddle,deep-research-ultra,research-first,webapp-testing,e2e-testing-patterns,javascript-testing-patterns,dogfood,playwright

npx -y skills add https://github.com/vercel-labs/agent-skills --skill vercel-react-best-practices,composition-patterns,vercel-react-view-transitions,web-design-guidelines,vercel-composition-patterns,ai-sdk-patterns,prompt-engineering-patterns

npx -y skills add https://github.com/anthropics/skills --skill frontend-design,frontend-skill,web-dev,web-artifacts-builder,canvas-design,algorithmic-art,design-system-patterns,visual-design-foundations,accessibility-compliance,wcag-audit-patterns,responsive-design,interaction-design,frontend-design-guide,nimpeccable,super-frontend-design,linux-ops,centos-linux-triage,security-best-practices,sast-configuration,secrets-management,memory-forensics,architecture-patterns,architecture-decision-records,api-design-principles,openapi-spec-generation,microservices-patterns,cqrs-implementation,saga-orchestration,event-store-design,distributed-tracing,llm-evaluation,embedding-strategies,hybrid-search-implementation,rag-implementation,similarity-search-patterns,vector-index-tuning,prompt-engineering-patterns,token-optimizer,mcp-builder,sql-optimization-patterns,database-er-diagram,database-migration,doc-coauthoring,office-document-suite,changelog-automation,edit-article,find-skills,cocoloop,skill-workspace,git-commit,git-advanced-workflows,setup-pre-commit,github-actions-templates,deployment-pipeline-design,dependency-upgrade,github-deploy,github-triage
```

**注意**：以上命令可能因仓库路径不同需调整，建议分批执行并验证。

---

## 附录 B：版本记录

- v1.0（2026-07-22）：初版，按 10 角色分组 + 一键脚本 + 验证清单
