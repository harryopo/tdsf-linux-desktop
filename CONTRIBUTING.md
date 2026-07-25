# Contributing to TDSF-Linux Desktop

> 感谢你有兴趣为 TDSF-Linux Desktop 做出贡献！
> 这里是面向贡献者的完整指南：开发环境、代码规范、提交流程、审查标准。

---

## 目录

- [行为准则](#行为准则)
- [开发环境](#开发环境)
- [项目结构](#项目结构)
- [开发流程](#开发流程)
- [代码规范](#代码规范)
- [提交规范](#提交规范)
- [Pull Request 流程](#pull-request-流程)
- [测试要求](#测试要求)
- [文档贡献](#文档贡献)
- [社区](#社区)

---

## 行为准则

本项目遵循 [Contributor Covenant 2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/)。
参与本项目即表示你同意遵守其条款。

**核心原则：**

- 尊重每一位贡献者，不区分性别、种族、宗教、性取向等
- 建设性反馈，专注问题本身而非个人
- 接受新手的提问，不嘲笑"愚蠢"的问题
- 关注社区最大利益

---

## 开发环境

### 前置要求

- **Node.js** ≥ 20.x（推荐 LTS）
- **pnpm** ≥ 9.x（`npm install -g pnpm`）
- **Python** ≥ 3.10（用于 Sidecar AI 服务）
- **Git** ≥ 2.30
- **Visual Studio Code**（推荐）+ 扩展：
  - ESLint
  - Prettier
  - TypeScript Vue Plugin (Volar)
  - Vitest

### Fork & Clone

```bash
# 1. 在 GitHub 上 Fork 本仓库
# 2. Clone 你的 fork
git clone https://github.com/<your-username>/tdsf-linux-desktop.git
cd tdsf-linux-desktop

# 3. 添加 upstream 远程
git remote add upstream https://github.com/harryopo/tdsf-linux-desktop.git

# 4. 安装依赖
pnpm install

# 5. 启动 Python Sidecar
cd sidecar-a
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python main.py
# 新终端 ↓

# 6. 启动桌面应用
cd ..
pnpm dev
```

### 五绿门禁（必跑）

修改代码后必须全部通过：

```bash
pnpm typecheck:node && pnpm typecheck:web && pnpm lint && pnpm test
```

构建验证（涉及 UI / 构建配置时）：

```bash
pnpm build:win
```

---

## 项目结构

```
tdsf-linux-desktop/
├── src/
│   ├── main/           # Electron 主进程（Node.js）
│   │   ├── ipc/        # IPC 处理器
│   │   └── index.ts    # 主进程入口
│   ├── preload/        # 安全桥接层
│   ├── renderer/       # React 渲染进程
│   │   └── src/
│   │       ├── pages/        # 路由页面
│   │       ├── components/   # 业务组件
│   │       ├── stores/       # Zustand 状态
│   │       └── styles/       # 全局样式
│   └── shared/         # 三端共享类型
├── sidecar-a/          # Python AI 服务（FastAPI）
├── tests/              # 测试
│   ├── unit/           # 单元测试（Vitest）
│   ├── e2e/            # E2E 测试（Playwright）
│   └── components/     # 组件测试
├── docs/               # 文档
├── .github/            # GitHub 配置（CI、Issue 模板）
├── AGENTS.md           # AI Agent 协作指南
└── package.json
```

详细架构：[docs/technical/architecture.md](docs/technical/architecture.md)

---

## 开发流程

### 1. 同步最新代码

```bash
git checkout master
git pull upstream master
```

### 2. 创建功能分支

```bash
# 命名规范：<type>/<short-description>
# type: feat / fix / refactor / docs / test / chore
git checkout -b feat/add-firecracker-sandbox
```

### 3. 开发 & 测试

- 保持单个 PR 的范围最小（一个 PR = 一个功能/修复）
- 写代码的同时写测试（参见 [测试要求](#测试要求)）
- 每次提交前跑五绿门禁

### 4. 提交 & 推送

```bash
git add .
git commit -m "feat(sandbox): add firecracker microvm executor"
git push origin feat/add-firecracker-sandbox
```

### 5. 创建 Pull Request

访问 GitHub → "Compare & pull request" → 填写 PR 模板

---

## 代码规范

### TypeScript

- 使用 **TypeScript strict mode**（`tsconfig.json` 已开启）
- 禁止使用 `any`（如必需，必须注释说明）
- 公共函数必须有显式返回类型
- 命名规范：
  - 文件：`kebab-case.ts` 或 `PascalCase.tsx`（组件）
  - 类/组件：`PascalCase`
  - 函数/变量：`camelCase`
  - 常量：`UPPER_SNAKE_CASE`
  - 接口：`IPascalCase`（前缀 I，参见 [CODING.md](CODING.md)）

### React

- 函数组件 + Hooks，不使用 class 组件
- 每个文件一个组件
- Props 接口用 `interface` 显式声明
- 使用 `useMemo` / `useCallback` 优化重计算

### 样式

- 使用 CSS Modules 或 CSS-in-JS（**不**用内联 style，除非动态计算）
- 颜色 / 间距 / 圆角使用 CSS 变量（`var(--trae-*)`）
- 遵循 [docs/UI设计规范-v2.0.md](docs/UI设计规范-v2.0.md)

### 注释

- 复杂逻辑必须有中文 + 英文双语注释
- JSDoc 用于公共 API
- 避免"what"注释（代码自解释），专注"why"

---

## 提交规范

本项目遵循 [Conventional Commits 1.0](https://www.conventionalcommits.org/en/v1.0.0/)。

### 格式

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Type

| Type       | 说明                                  |
| ---------- | ------------------------------------- |
| `feat`     | 新功能                                |
| `fix`      | Bug 修复                              |
| `docs`     | 文档变更                              |
| `style`    | 代码格式（不影响功能）                |
| `refactor` | 重构（既不是 feat 也不是 fix）        |
| `test`     | 添加 / 修改测试                       |
| `chore`    | 构建 / 工具 / 依赖变更                |
| `perf`     | 性能优化                              |
| `ci`       | CI/CD 配置                            |

### Scope

模块名：`terminal` / `ai` / `risk` / `sftp` / `ui` / `ipc` / `sidecar` / `docs` ...

### 示例

```
feat(ai): add D-S evidence fusion for credibility scoring

Implement Dempster-Shafer + PCR5 fusion algorithm based on
Smarandache 2006 paper. 6 source evidences (rules, knowledge base,
history, CoT, LLM self-eval, user preference) are combined into
final confidence score.

Refs #42
```

```
fix(terminal): prevent xterm.js memory leak on long sessions
```

---

## Pull Request 流程

### 提交流程

1. **关联 Issue**：在 PR 描述中使用 `Closes #123` 或 `Fixes #456`
2. **填写模板**：完整填写 PR 模板所有必填项
3. **五绿门禁**：CI 必须全绿才能合并
4. **代码审查**：至少 1 名维护者 Approve
5. **Squash Merge**：默认 Squash 合并，commit message 会规范化

### 审查标准

- 代码质量：符合 [代码规范](#代码规范)
- 测试覆盖：新增功能必须有测试，修复必须有回归测试
- 文档：用户可见改动需更新 README / CHANGELOG
- 性能：避免明显性能回退（用 `pnpm test` + benchmark 对比）
- 安全性：避免 XSS / 注入 / 敏感信息泄露

### 合并后

- 自动触发 Release Please（每周一）发布 CHANGELOG
- 自动部署到 GitHub Pages（介绍页）
- 通知 Issue 作者（`Closes #xxx` 关联的 issue 自动关闭）

---

## 测试要求

### 单元测试

- 公共函数 / Hooks / 工具类必须 100% 覆盖
- 关键算法（D-S 融合、CoT 分析）覆盖率 ≥ 90%
- 测试文件位于 `tests/unit/` 或与源文件同目录 `*.test.ts`

```bash
pnpm test                    # 全部测试
pnpm test -- --watch         # 监视模式
pnpm test -- --coverage      # 覆盖率
```

### E2E 测试

- 用户关键路径必须有 E2E 覆盖（登录 / SSH 连接 / 命令拦截 / AI 问答）
- 截图存于 `tests/e2e/screenshots-*/`，用于回归对比
- 跑 E2E 前必须启动 Sidecar

```bash
pnpm test:e2e
```

### 组件测试

- React 组件关键交互必须有测试
- 使用 Vitest + React Testing Library

---

## 文档贡献

文档与代码同等重要！欢迎任何形式的贡献：

- 修正错别字 / 翻译不准
- 补充使用场景 / FAQ
- 增加教程 / 示例
- 翻译（英文 / 简体中文 / 繁体中文）

文档源位于：

- `README.md` — 项目门面
- `CHANGELOG.md` — 版本历史
- `docs/` — 详细文档
- `*.md` 内嵌在代码中 — 架构 / 设计决策

---

## 社区

- **GitHub Issues**：Bug 报告 / 功能建议
- **GitHub Discussions**：问答 / 想法交流（即将开放）
- **飞书问卷**：产品反馈（链接在 软件 → 设置 → 关于 → 产品调研问卷）

### 获取帮助

遇到问题？

1. 先看 [README.md](README.md) 和 [docs/](docs/)
2. 搜索 [已有 Issue](https://github.com/harryopo/tdsf-linux-desktop/issues)
3. 创建 [新 Issue](https://github.com/harryopo/tdsf-linux-desktop/issues/new/choose) 选择 Question 模板

### 报告安全漏洞

**请勿在公开 Issue 中报告安全漏洞**。
邮件发送至 <harryopo@example.com>，我们会在 48 小时内响应。

---

## 许可证

贡献你的代码即表示你同意将贡献以 [MIT License](LICENSE) 协议授权。
