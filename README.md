# TDSF-Linux Desktop

> **面向 Linux 运维的人机协同可信决策桌面助手** —— SSH 终端 + AI 辅助 + 高危命令拦截 + 日志分析

[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.0.0-orange.svg)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4+-3178c6.svg)](https://www.typescriptlang.org/)
[![Electron](https://img.shields.io/badge/Electron-30-47848F.svg)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18-61dafb.svg)](https://react.dev/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![火山杯 2026](https://img.shields.io/badge/火%E5%B2%A9%E6%9D%AF-2026-ff6b35.svg)](#火山杯参赛作品)

[English](#english) | [简体中文](#简体中文)

---

## 简体中文

### 项目简介

TDSF-Linux Desktop 是一款 **面向 Linux 运维学习者与初学者的桌面工具**，通过 AI 辅助 + 高危命令拦截 + 可信度透明化的方式，让 Linux 终端不再是"高门槛"的代名词。

**核心场景**：学生/新人连上服务器执行命令时，AI 在旁边实时解释、提醒、拦截高危操作，所有决策都附上论文支撑的可信度评估。

### 界面预览

> 📸 真实截图（含中文界面 + 暗色主题），未经任何美化

| 页面 | 预览 | 描述 |
|------|------|------|
| **主页 + SSH 终端** | ![Home](https://raw.githubusercontent.com/harryopo/tdsf-linux-desktop/master/tests/e2e/screenshots-acceptance/01-home-terminal.png) | 左侧 SSH 终端 + 右侧 AI 对话面板 |
| **主页 + 监控** | ![Monitor](https://raw.githubusercontent.com/harryopo/tdsf-linux-desktop/master/tests/e2e/screenshots-acceptance/02-home-monitor.png) | 系统资源实时监控 |
| **设置 → 外观** | ![Appearance](https://raw.githubusercontent.com/harryopo/tdsf-linux-desktop/master/tests/e2e/screenshots-acceptance/03-settings-appearance.png) | 主题/字体/暗色模式 |
| **设置 → LLM** | ![LLM](https://raw.githubusercontent.com/harryopo/tdsf-linux-desktop/master/tests/e2e/screenshots-acceptance/04-settings-llm.png) | AI Provider 配置 |
| **设置 → 高危命令** | ![Risk](https://raw.githubusercontent.com/harryopo/tdsf-linux-desktop/master/tests/e2e/screenshots-acceptance/06-settings-risk.png) | 黑名单 + 三态审批 |
| **历史决策** | ![History](https://raw.githubusercontent.com/harryopo/tdsf-linux-desktop/master/tests/e2e/screenshots-acceptance/07-history.png) | 所有 AI 决策可追溯 |
| **知识库** | ![Knowledge](https://raw.githubusercontent.com/harryopo/tdsf-linux-desktop/master/tests/e2e/screenshots-acceptance/08-knowledge-command.png) | 教程词库 + 事件沉淀 |

更多截图见 [tests/e2e/screenshots-acceptance/](tests/e2e/screenshots-acceptance/)

### 核心特性

#### 🔐 SSH 终端 + 高危命令拦截
- 基于 `ssh2` 的完整 SSH 客户端 + `xterm.js` 终端模拟
- 内置 **12 条高危命令黑名单**（`rm -rf /`、磁盘格式化、修改 `passwd` 等）
- 三态权限审批：ALWAYS / AUTO / NEVER（参考 AgentScope Permission）
- 每次拦截都给出建议的回滚方案

#### 🤖 AI 辅助问答
- 多 Provider 支持：Anthropic Claude / Google Gemini / OpenAI / 火山方舟
- 14 步 Task Protocol 任务编排 + 25+ MCP 工具
- Supervisor + 1-2 Subagent（标准）/ 8 Subagent 并行（深度）
- **CoT-shape 可信度评估**（基于 Zhao 2026 论文）+ 熵轨迹 SVG 可视化

#### 📊 可信度透明化（D-S 证据理论 + PCR5 融合）
- 6 源证据权重可视化：规则匹配 / 知识库 / 历史 / CoT / LLM 自评 / 用户偏好
- D-S + PCR5 冲突融合算法（论文支撑：Smarandache 2006）
- 每个 AI 决策都展示 6 源证据权重 + 融合公式

#### 📚 内置教程词库（v1.2.0）
- **2236 词条**（v1.1.0 → v1.2.0 升级）
- 数据源：jaywcjlove/linux-command（MIT）+ tldr-pages（CC BY 4.0）+ 人工标注
- 8 爬虫源教程聚合（鸟哥 / 阮一峰 / Linux 中国等）

#### 🔌 IDE 工作台（SFTP 文件管理）
- 基于 `react-arborist` 的文件树
- Monaco Editor（VS Code 同源体验）
- 双击编辑 + Ctrl+S 保存 + SFTP 同步

#### 🛡️ 安全合规
- IPC 三原则：`contextIsolation: true` / `nodeIntegration: false` / `sandbox: true`
- 敏感数据 redact（.env / .ssh / *_key 发送前自动脱敏）
- OpenTelemetry 集成（Langfuse 追踪，DEV 自动降级）
- 所有网络请求 UI 可见（防 Grok Build 式静默上传）

### 快速开始

#### 系统要求
- Windows 10+ / macOS 12+ / Linux（Ubuntu 20.04+）
- Node.js 20+
- pnpm 9+（推荐） 或 npm 10+

#### 安装

```bash
# 1. 克隆仓库
git clone https://github.com/harryopo/tdsf-linux-desktop.git
cd tdsf-linux-desktop

# 2. 安装依赖（推荐 pnpm）
pnpm install

# 3. 启动开发模式
pnpm dev
```

#### 构建打包

```bash
# Windows 打包（生成 .exe 安装包）
pnpm build:win

# macOS 打包
pnpm build:mac

# Linux 打包
pnpm build:linux
```

#### 一键命令清单

| 命令 | 作用 |
|------|------|
| `pnpm dev` | 启动 Electron 开发模式（Vite HMR） |
| `pnpm typecheck:node` | 主进程 TypeScript 类型检查 |
| `pnpm typecheck:web` | 渲染进程 TypeScript 类型检查 |
| `pnpm lint` | ESLint 检查 |
| `pnpm test` | 单元测试（Vitest，1292+ 用例） |
| `pnpm test:e2e` | E2E 测试（Playwright） |
| `pnpm deadcode` | 死代码扫描（knip） |
| `pnpm build:win` | Windows 打包（生成 .exe） |

### 技术栈

| 类别 | 选型 | 理由 |
|------|------|------|
| **桌面框架** | Electron 30 | 跨平台 + 生态成熟 |
| **前端框架** | React 18 + TypeScript strict | 类型安全 + HMR |
| **UI 库** | Ant Design 5 | 中文友好 + 组件全 |
| **状态管理** | Zustand | 轻量 + 无 boilerplate |
| **终端** | xterm.js + ssh2 | 业界标准 |
| **代码编辑** | Monaco Editor | VS Code 同源 |
| **AI SDK** | Vercel AI SDK + Anthropic SDK | 多 Provider 抽象 |
| **MCP 协议** | @modelcontextprotocol/sdk | 工具调用标准化 |
| **数据持久化** | Dexie（IndexedDB） | 离线事件流 |
| **可观测性** | Langfuse（OpenTelemetry） | 决策可追踪 |
| **可信度算法** | D-S 证据理论 + PCR5 融合 | 论文支撑 |
| **测试** | Vitest + Playwright | 现代测试栈 |

### 架构图

```
┌─────────────────────────────────────────────────────────┐
│                  Electron 30 (Chromium + Node)         │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │   主进程     │  │   Preload    │  │  渲染进程     │   │
│  │  (main/)    │  │  (preload/)  │  │ (renderer/)  │   │
│  │             │  │              │  │              │   │
│  │ • SSH2      │  │ contextBridge│  │ • React 18   │   │
│  │ • LLM       │  │ 安全桥接     │  │ • Antd 5     │   │
│  │ • SQLite    │  │              │  │ • Zustand    │   │
│  │ • Skills    │  │              │  │ • xterm.js   │   │
│  │ • MCP       │  │              │  │ • Monaco     │   │
│  │ • Credibility│ │              │  │              │   │
│  └─────────────┘  └──────────────┘  └──────────────┘   │
│         │                                  │           │
│         │  IPC 4 步同步                     │           │
│         │  (主→ipc→preload→types)          │           │
└─────────┼──────────────────────────────────┼───────────┘
          │                                  │
          ▼                                  ▼
   ┌─────────────┐                    ┌─────────────┐
   │ Sidecar     │                    │  LLM        │
   │ (Python)    │                    │  Provider   │
   │ SRE/Analyst │                    │ Claude/GPT/ │
   │ /Agent      │                    │ Gemini/Doubao│
   └─────────────┘                    └─────────────┘
```

### 项目结构

```
tdsf-linux-desktop/
├── src/
│   ├── main/                 # 主进程（Node.js）
│   │   ├── core/
│   │   │   ├── agent/        # Agent 核心（Task Protocol / Credibility）
│   │   │   ├── knowledge/    # 知识库 + 词库
│   │   │   └── llm/          # LLM Provider 抽象
│   │   ├── ipc/              # IPC 4 步同步
│   │   └── services/         # 业务服务（SSH / SFTP / Skills / MCP）
│   ├── preload/              # contextBridge 安全桥接
│   ├── renderer/             # 渲染进程（React 18）
│   │   └── src/
│   │       ├── components/   # UI 组件
│   │       ├── pages/        # 页面（Workbench / Decision / History / Knowledge / Tutorial / Settings）
│   │       ├── stores/       # Zustand 状态
│   │       └── styles/       # CSS Token
│   └── shared/               # 跨进程共享类型 + 算法
├── tests/                    # Vitest + Playwright
├── docs/                     # 设计文档 + 调研报告
└── scripts/                  # 工具脚本（dict-import / hooks / handoff）
```

### 路线图

- ✅ **v1.0** (2026-07-30)：比赛交付 — SSH + AI + 高危拦截 + 词库 + 可信度
- 🚧 **v1.5** (Q4 2026)：Firecracker microVM 沙箱 + OpenTelemetry 全量
- 📋 **v2.0** (2027 Q1)：code-server / Theia IDE 嵌入 + WASM 沙箱备选
- 📋 **v3.0** (2027 Q2)：LoRA 微调 Shell 命令模型 + 多 Agent 协作

详细路线见 [ROADMAP.md](ROADMAP.md)。

### 贡献

欢迎贡献代码 / 文档 / Bug 报告 / 功能建议！

- 📖 阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 了解流程
- 🐛 提交 Bug：[Issue Tracker](https://github.com/harryopo/tdsf-linux-desktop/issues/new?template=bug_report.md)
- 💡 提出想法：[Feature Request](https://github.com/harryopo/tdsf-linux-desktop/issues/new?template=feature_request.md)
- 💬 加入讨论：[GitHub Discussions](https://github.com/harryopo/tdsf-linux-desktop/discussions)

### 安全披露

发现安全漏洞？请阅读 [SECURITY.md](SECURITY.md) 私密披露，**不要**在 Issue 中公开。

### 行为准则

本项目采用 [Contributor Covenant 2.1](CODE_OF_CONDUCT.md) 行为准则，参与即视为同意。

### 许可证

[MIT License](LICENSE) — 商业使用、修改、分发、私用均允许。

### 致谢

本项目站在开源巨人肩膀上，详见 [NOTICE.md](NOTICE.md) 中的第三方依赖致谢。

### 火山杯参赛作品

本项目参加 **2026 火山杯**比赛（截止 2026-07-30），作品主题：教育科技 — 让 Linux 运维学习门槛降到零。

---

## English

### Introduction

TDSF-Linux Desktop is a **human-machine collaborative trusted-decision desktop assistant for Linux operations** — SSH terminal + AI assistance + high-risk command interception + log analysis.

**Core scenario**: When students/beginners connect to a server and execute commands, AI sits beside them to explain, warn, and intercept dangerous operations in real-time. Every AI decision is backed by paper-supported credibility assessment.

### Key Features

- **SSH Terminal + High-Risk Command Interception** — `ssh2` + `xterm.js` + 12 blacklist rules + 3-state permission approval
- **AI Assistant** — Multi-provider (Claude / Gemini / OpenAI / Doubao) + 14-step Task Protocol + 25+ MCP tools
- **Credibility Transparency** — D-S evidence theory + PCR5 fusion + 6-source evidence weights visualization
- **Built-in Tutorial Dictionary v1.2.0** — 2236 entries from jaywcjlove + tldr-pages + manual
- **SFTP File Management** — `react-arborist` tree + Monaco Editor + sync
- **Security & Compliance** — IPC 3 principles + sensitive data redaction + OpenTelemetry + visible network requests

### Quick Start

```bash
git clone https://github.com/harryopo/tdsf-linux-desktop.git
cd tdsf-linux-desktop
pnpm install
pnpm dev
```

### Tech Stack

Electron 30 · React 18 · TypeScript strict · Antd 5 · Zustand · ssh2 · xterm.js · Vercel AI SDK · MCP · Dexie · Langfuse · D-S + PCR5 · Vitest · Playwright

### License

[MIT](LICENSE)

### Volcano Cup 2026 Submission

This project is submitted to **2026 Volcano Cup** (deadline 2026-07-30), theme: Educational Technology — Lower the Linux operations learning barrier to zero.

---

⭐ If this project helps you, please **Star** it on GitHub!  
👀 [Watch](https://github.com/harryopo/tdsf-linux-desktop/watchers) for updates.  
🍴 [Fork](https://github.com/harryopo/tdsf-linux-desktop/forks) to start your own.
