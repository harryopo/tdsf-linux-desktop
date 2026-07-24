# 前后端职责边界与共享层契约

> 生成时间：2026-07-24
> 适用版本：v2.4（Phase A/B/C 已落地）
> 范围：TDSF Linux Desktop（Electron 三进程架构）
> 配套文档：[`ipc-contract.md`](./ipc-contract.md)、[`data-flow.md`](./data-flow.md)

---

## 0. 文档目的

本文档明确划分 TDSF Linux Desktop 项目中**主进程（后端）**与**渲染进程（前端）**的职责边界，定义 `src/shared/` 共享层类型契约，并汇总 v2.4 Phase A/B/C 后端新增能力清单，作为前后端交接的权威依据。

**铁律**：
- 后端不直接操作 DOM；前端不直接访问 Node.js API（fs / child_process / network / ssh2 等）。
- 任何跨进程通信必须通过 IPC 通道（见 `ipc-contract.md`），不允许绕过 preload 暴露的 API 直接调用 `ipcRenderer.invoke`。
- 共享类型必须定义在 `src/shared/`，三端（main / preload / renderer）共同引用，禁止在渲染层重复定义主进程类型。

---

## 1. 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                     Electron 应用（单 BrowserWindow）            │
│                                                                  │
│  ┌────────────────────┐   IPC 4 步同步   ┌────────────────────┐ │
│  │  Main Process      │  ←─────────────→ │  Renderer Process  │ │
│  │  (后端 / Node.js)  │                   │  (前端 / React)    │ │
│  │                    │                   │                    │ │
│  │  - SSH/SFTP        │   invoke / push   │  - Pages           │ │
│  │  - LLM/Agent       │  ──────────────→  │  - Components      │ │
│  │  - 可信度/校准      │                   │  - Stores (Zustand)│ │
│  │  - DB (SQLite)     │                   │  - Hooks           │ │
│  │  - Sidecar/沙箱    │                   │                    │ │
│  └─────────┬──────────┘                   └─────────▲──────────┘ │
│            │                                         │            │
│            │  contextBridge.exposeInMainWorld         │            │
│            └─────────────┌───────────────────────────┘            │
│                          │                                        │
│                ┌─────────┴──────────┐                             │
│                │  Preload Script    │                             │
│                │  (src/preload/)    │                             │
│                │  - 扁平化 API      │                             │
│                │  - 类型声明 .d.ts  │                             │
│                └────────────────────┘                             │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │              src/shared/  （三端共享 SSOT）                 │ │
│  │  - agent-types.ts   - models.ts   - ipc-channels.ts        │ │
│  │  - at-command-types.ts  - deploy-types.ts  - ...           │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 1.1 三进程职责速览

| 进程 | 路径 | 职责一句话 | 可用 API |
|------|------|-----------|----------|
| **Main** | `src/main/` | 业务逻辑、数据采集、IPC handler、DB、外部服务 | Node.js 全集 + Electron main API |
| **Preload** | `src/preload/` | 桥接层，暴露扁平化 IPC API，类型声明 | 受限 Node.js + `contextBridge` |
| **Renderer** | `src/renderer/` | UI 渲染、用户交互、状态管理、IPC 调用 | 浏览器 API + `window.electronAPI` |
| **Shared** | `src/shared/` | 三端共享的类型定义 + 通道常量 + 纯函数 | 仅类型与常量，零运行时副作用 |

---

## 2. 后端职责（Main Process）

**根路径**：`src/main/`

### 2.1 目录结构

```
src/main/
├── core/                    # 核心业务算法（无 IPC 直接耦合）
│   ├── agent/               # Agent 运行时 + 可信度算法
│   │   └── credibility/     # D-S 证据理论 + PCR5 + 校准
│   │       └── calibration/ # 🔥 v2.4 Phase C：ECE + Temperature Scaling
│   ├── memory/              # 记忆模块
│   └── sidecar/             # Python Sidecar 编排
├── ipc/                     # IPC handler 注册（42 个文件）
│   ├── index.ts             # 注册入口（统一调用 registerAllIpcHandlers）
│   ├── ssh.ts / monitor.ts / llm.ts / ...
│   └── model-stats.ts       # 🔥 v2.4 Phase A/B：toolCalls / budget:alerts
├── services/                # 基础设施服务
│   ├── db/                  # SQLite 数据库（DatabaseManager 单例）
│   ├── llm/                 # LLM Provider + Budget Alerter
│   │   └── budget-alerter.ts# 🔥 v2.4 Phase B：LLM 慢/失败/Token 超阈值告警
│   ├── ssh/                 # SSH 连接管理 + 主机密钥校验
│   ├── storage/             # 配置持久化（ConfigStore + SafeStore 加密）
│   ├── sandbox/             # OpenHands 沙箱
│   ├── scheduler/           # 定时任务
│   ├── security/            # 风险评估
│   └── ...
├── types/                   # 主进程私有类型
├── windows/                 # 窗口管理
└── resources/               # 内置资源（沙箱脚本等）
```

### 2.2 后端职责清单

#### 2.2.1 数据采集层

| 职责 | 实现位置 | 说明 |
|------|---------|------|
| SSH 连接管理 | `services/ssh/` | 连接池、心跳保活、自动重连、known_hosts 校验 |
| SFTP 文件操作 | `services/ssh/sftp*.ts` | 上传/下载/删除/重命名/chmod/readFile/writeFile |
| 远程文件搜索 | `ipc/sftp-search.ts` | `find -name` 模糊匹配 + `grep -rn` 内容正则 |
| 远程文件监听 | `ipc/file-watcher.ts` | inotifywait 长连接 + 5s 轮询降级 |
| 系统监控采集 | `ipc/monitor.ts` | CPU/内存/磁盘/网络/负载/进程数 |
| 进程信息采集 | `services/ssh/` | 通过 SSH 执行 `top` / `ps` / `free` 等命令 |

#### 2.2.2 业务逻辑层

| 职责 | 实现位置 | 说明 |
|------|---------|------|
| LLM 调用 | `ipc/llm.ts` + `services/llm/` | chat / chatStream / analyze / chat-with-context |
| 内联补全 + Diff | `ipc/llm-inline.ts` | v2.0 Phase B：inline-completion / apply-diff |
| Provider 管理 | `core/agent/providers/` | 8 类 Provider（openai-compatible / anthropic / claude-sdk 等） |
| Token 统计 | `core/agent/providers/token-stats.ts` | 数量统计 + 成本（USD）统计 |
| Agent 工作流 | `core/agent/` | Supervisor + Subagent + Reflect |
| 可信度融合 | `core/agent/credibility/fusion-engine.ts` | D-S + PCR5 自适应组合 |
| 校准 | `core/agent/credibility/calibration/` | 🔥 v2.4 Phase C：ECE + Temperature Scaling |
| 风险评估 | `services/security/` + `ipc/risk.ts` | 5 级风险（SAFE/LOW/MEDIUM/HIGH/CRITICAL） |
| 命令预期回显 | `ipc/expectation.ts` | 预期 vs 实际对比，异常高亮 |
| 循环工程 | `ipc/loop-engineering.ts` | 7 步 HITL 编排 |
| 决策历史 | `ipc/history.ts` | DecisionCard 持久化 + 统计聚合 |
| 知识库 | `ipc/knowledge.ts` | command_skills + incident_cases 双轨制 |

#### 2.2.3 IPC Handler 层

**注册入口**：`src/main/ipc/index.ts` 的 `registerAllIpcHandlers(mainWindow, db)`

**注册顺序**（无强依赖，仅保持一致性）：
1. `system:ping`（内联，最早注册，心跳保活）
2. SSH → 监控 → 存储 → LLM → 内联补全 → 知识库 → 决策历史
3. Agent → AgentRuntime → Profiler → Tutorial（依赖 db）
4. Deploy → LLM Tools → Log → Credibility → Risk → Alert
5. Sandbox → @命令 → Claude SDK
6. v0.9.5 P0 五组：Token 成本 / Mode / Attention / Subagent / Provider
7. MCP 状态机 → Sidecar → Promptfoo → Diagnostics → Loop
8. Scheduler → SFTP 搜索 → 文件监听 → 预期回显 → Task 审批
9. App 更新 → FS 上传 → 🔥 v2.3.2 模型统计 + 预算告警（依赖 db）
10. 推送 `boot:loading-stage`（`ipc-ready`）

**Handler 实现规范**：
- 单文件单域（如 `ssh.ts` 只管 SSH 域）
- 文件 ≤ 500 行（超出拆分到 `xxx-helpers.ts`，参考 `credibility-helpers.ts`）
- 出错时 `throw new Error(用户可读消息)`，前端 `try/catch` 捕获
- 日志通过 `logger.info/domain, message, context` 统一记录
- 涉及 DB 时通过 `DatabaseManager.getInstance()` 单例获取

#### 2.2.4 数据库层

**实现**：`src/main/services/db/database.ts`（`DatabaseManager` 单例，基于 better-sqlite3）

**关键表**：
| 表名 | 用途 | v2.4 关联 |
|------|------|-----------|
| `decisions` | DecisionCard 持久化 | — |
| `knowledge_entries` | 知识库条目 | — |
| `tool_call_log` | 工具调用日志 | 🔥 v2.4 Phase A：`model:toolCalls` 聚合数据源 |
| `budget_alerts` | 预算告警历史 | 🔥 v2.4 Phase B：`budget:alerts` 查询数据源 |
| `tutorial_*` | 教程相关（多表） | — |
| `kb_view_history` | 知识库浏览历史 | — |

**降级策略**：DB 不可用时（`db.isAvailable() === false`），所有读取返回空数组/空对象，写入静默失败，不影响主流程。

#### 2.2.5 外部服务层

| 服务 | 实现 | 说明 |
|------|------|------|
| Python Sidecar | `core/sidecar/` + `ipc/sidecar.ts` | SRE + 日志解析（Drain3） |
| OpenHands 沙箱 | `services/sandbox/` + `ipc/sandbox.ts` | Docker 检测 + 沙箱生命周期 |
| Claude Agent SDK | `ipc/claude-sdk.ts` | `@anthropic-ai/claude-agent-sdk` query() agent loop |
| MCP 服务器 | `services/mcp/` + `ipc/mcp.ts` | 5 阶段生命周期状态机 |
| Promptfoo 红队 | `services/promptfoo/` + `ipc/promptfoo.ts` | 红队 + Prompt 评估 |
| GitHub Releases | `ipc/app-update.ts` | HTTP GET 比对版本号（不引入 electron-updater） |

---

## 3. 前端职责（Renderer Process）

**根路径**：`src/renderer/`

### 3.1 目录结构

```
src/renderer/
└── src/
    ├── pages/               # 23 个页面（SettingsLayout + 路由级页面）
    │   ├── WorkbenchPage.tsx        # 主工作台
    │   ├── DecisionPage.tsx         # 决策卡片列表
    │   ├── HistoryPage.tsx          # 决策历史
    │   ├── MonitorPage.tsx          # 系统监控
    │   ├── ModelSettings.tsx        # 模型配置（🔥 消费 v2.4 数据）
    │   ├── BootPage.tsx             # 启动加载页
    │   └── ...
    ├── components/           # 组件库（按域分组）
    │   ├── ai/               # AI 对话面板
    │   ├── terminal/         # 终端
    │   ├── decision/         # 决策卡片
    │   ├── workbench/        # 工作台组件
    │   ├── settings/         # 设置组件
    │   └── ...
    ├── stores/               # Zustand 状态管理（9 个 store）
    │   ├── ai-store.ts
    │   ├── terminal-store.ts
    │   ├── monitor-store.ts
    │   ├── server-store.ts
    │   ├── settings-store.ts
    │   ├── agent-store.ts
    │   ├── editor-store.ts
    │   ├── theme-store.ts
    │   ├── translate-store.ts
    │   └── workbench-store.ts
    ├── hooks/                # 自定义 Hooks
    ├── types/                # 渲染层私有类型
    ├── utils/                # 工具函数
    ├── styles/               # 全局样式
    └── assets/               # 静态资源
```

### 3.2 前端职责清单

#### 3.2.1 UI 渲染层

| 职责 | 实现 | 说明 |
|------|------|------|
| 页面路由 | `pages/` + React Router | 23 个页面 |
| 组件复用 | `components/` 按 17 个域分组 | ai / terminal / decision / workbench / ... |
| 主题切换 | `stores/theme-store.ts` | 深色/浅色/跟随系统 |
| 国际化 | `stores/translate-store.ts` | 中英对照（hover/点击翻译） |
| 启动加载 | `pages/BootPage.tsx` | 消费 `boot:loading-stage` 推送 |

#### 3.2.2 用户交互层

| 职责 | 实现 | 说明 |
|------|------|------|
| SSH 连接管理 | `components/ssh/` + `stores/server-store.ts` | 连接 / 断开 / 主机密钥确认弹窗 |
| 终端交互 | `components/terminal/` + `stores/terminal-store.ts` | xterm.js + shell 输入输出 |
| AI 对话 | `components/ai/AIPanel.tsx` + `stores/ai-store.ts` | 流式响应 + 图片附件 |
| 决策审批 | `components/decision/` + `pages/DecisionPage.tsx` | approve / reject / execute |
| 文件浏览 | `components/workbench/` | SFTP + 远程文件监听 |
| 设置管理 | `pages/*Settings.tsx` | 12 个设置页面 |

#### 3.2.3 状态管理层（Zustand Stores）

| Store | 文件 | 职责 | 关联 IPC |
|-------|------|------|---------|
| `aiStore` | `ai-store.ts` | AI 对话消息、流式状态、模式切换 | `llm:chat*` / `mode:*` |
| `terminalStore` | `terminal-store.ts` | 终端会话、shell 数据 | `ssh:shell:*` / `terminal:data` |
| `monitorStore` | `monitor-store.ts` | 监控数据时序 | `monitor:*` |
| `serverStore` | `server-store.ts` | SSH 服务器列表、连接状态 | `ssh:connect` / `ssh:list` |
| `settingsStore` | `settings-store.ts` | 全局设置（LLLM / 外观 / 通知） | `storage:*` / `config:*` |
| `agentStore` | `agent-store.ts` | Agent 工作流状态、Subagent | `agent:*` / `subagent:*` |
| `editorStore` | `editor-store.ts` | 代码编辑器状态 | `sftp:readFile` / `sftp:writeFile` |
| `themeStore` | `theme-store.ts` | 主题切换 | `storage:get` / `storage:set` |
| `translateStore` | `translate-store.ts` | 翻译状态 | — |
| `workbenchStore` | `workbench-store.ts` | 工作台布局、面板切换 | — |

**Store 设计规范**：
- 单一数据源：每个域一个 store，避免跨 store 重复状态
- IPC 调用集中在 store action 中，组件不直接调用 `window.electronAPI`
- 推送通道通过 `onXxx` 订阅，组件 mount 时订阅、unmount 时取消
- 异步 action 使用 `async/await`，错误在 store 内捕获并设置 error 状态

#### 3.2.4 IPC 调用层

**调用规范**：
- 所有 IPC 调用通过 `window.electronAPI.<methodName>(...)` 进行
- 不允许直接 `ipcRenderer.invoke`（preload 已通过 contextBridge 隔离）
- 推送通道订阅：`window.electronAPI.onXxx(callback)`，返回取消订阅函数
- 类型声明：`src/preload/index.d.ts` 的 `ElectronAPI` 接口

**前端不直接做的事**（必须走 IPC）：
- ❌ 文件系统读写（使用 `sftp:*` / `storage:*` / `fs:upload-image`）
- ❌ 子进程执行（使用 `ssh:exec` / `sandbox:*`）
- ❌ 网络请求（LLM 调用使用 `llm:chat*`，更新检查使用 `app:check-update`）
- ❌ 数据库访问（使用 `history:*` / `knowledge:*` / `model:toolCalls` 等）
- ❌ 加密存储（使用 `storage:set` / `storage:get`，后端走 SafeStore）

---

## 4. Preload 桥接层

**根路径**：`src/preload/`

### 4.1 文件结构

| 文件 | 职责 |
|------|------|
| `index.ts` | contextBridge 暴露扁平化 API（约 231 个方法） |
| `index.d.ts` | `ElectronAPI` 接口类型声明（渲染层类型来源） |

### 4.2 暴露规范

**扁平化命名**：
- `ssh:connect` → `window.electronAPI.sshConnect`
- `llm:chat-stream` → `window.electronAPI.llmChatStream`
- `terminal:data`（push） → `window.electronAPI.onTerminalData`

**推送通道返回取消订阅函数**：
```typescript
// preload/index.ts
onTerminalData: (callback: (sessionId: string, data: string) => void) => {
  const handler = (_event, sessionId, data) => callback(sessionId, data)
  ipcRenderer.on('terminal:data', handler)
  return () => ipcRenderer.removeListener('terminal:data', handler)
}
```

**类型同步铁律（IPC 4 步同步）**：
1. `src/shared/ipc-channels.ts` 定义通道常量
2. `src/main/ipc/index.ts` 注册 `ipcMain.handle`
3. `src/preload/index.ts` 暴露 `ipcRenderer.invoke` 包装
4. `src/preload/index.d.ts` 声明 `ElectronAPI` 类型

任何一步缺失都会导致前端调用失败或类型不安全。

---

## 5. 共享层契约（src/shared/）

**根路径**：`src/shared/`

### 5.1 文件清单

| 文件 | 职责 | 主要导出 |
|------|------|---------|
| `agent-types.ts` | Agent / Provider / Token 类型 | `ProviderConfig` / `TokenUsageRecord` / `ChatResult` / `ConfidenceAssessment` |
| `models.ts` | 通用业务模型 | `SshConfig` / `MonitorData` / `DecisionCard` / `Evidence` / `KnowledgeEntry` / 🔥 `ToolCallStat` / `BudgetAlert` |
| `ipc-channels.ts` | IPC 通道常量 | `SSH` / `LLM` / `CREDIBILITY` / `MODEL_STATS` / `BUDGET` 等枚举 |
| `at-command-types.ts` | @命令类型 | `AtCommandContext` / `AtSuggestion` |
| `crawler-types.ts` | 爬虫类型 | `CrawlTarget` / `CrawlResult` |
| `deploy-types.ts` | 部署助手类型 | `DeployTask` / `DeployLog` |
| `llm-tool-types.ts` | LLM 工具类型 | `LlmToolCall` / `LlmToolApproval` |
| `scheduler-types.ts` | 调度器类型 | `SchedulerTask` / `SchedulerStatus` |
| `tutorial-types.ts` | 教程类型 | `Tutorial` / `TutorialProgress` |

### 5.2 共享层设计原则

1. **零运行时副作用**：仅导出类型（`type` / `interface`）、常量（`const`）、纯函数。禁止导出涉及 fs / net / process 的代码。
2. **三端可安全导入**：main / preload / renderer 均可 `import`，不依赖任何运行时环境。
3. **SSOT（Single Source of Truth）**：业务类型只在 `src/shared/` 定义一次，禁止在 main 或 renderer 重复定义同名类型。
4. **不依赖 'ai' SDK 运行时类型**：`LanguageModelV2` 等仅 main 使用的类型定义在 `src/main/types.ts`，不进 shared。
5. **少量纯函数允许**：如 `generateSessionId()` / `getProtocolVersion()` / `DEFAULT_PROVIDER_ID` 常量，均为无副作用、不依赖运行时环境。

### 5.3 v2.4 共享层新增类型

#### 5.3.1 `models.ts` 新增（v2.3.2 落地，v2.4 复用）

```typescript
/** 工具调用统计行（v2.3.2 新增，v2.4 Phase A 数据源） */
export interface ToolCallStat {
  name: string       // 工具名称
  count: number      // 调用次数
  percent: number    // 占比百分比（0-100 整数）
}

/** 预算告警行（v2.3.2 新增，v2.4 Phase B 数据源） */
export interface BudgetAlert {
  level: 'alert' | 'error'  // 告警级别
  text: string               // 告警文本
  timestamp: number          // 时间戳（ms）
}
```

#### 5.3.2 `agent-types.ts` 新增（v2.4 Phase C）

```typescript
/** ConfidenceAssessment 扩展字段（fusion-engine.ts） */
export interface ConfidenceAssessment {
  // ... 原有字段 ...
  /** v2.4 Phase C：校准后可信度（applyCalibration=true 时填充） */
  calibratedConfidence?: number
  /** v2.4 Phase C：ECE 评估报告（applyCalibration=true 时填充） */
  eceReport?: EceResult
}

/** 融合评估选项（fusion-engine.ts） */
export interface FuseAssessOptions {
  /** 是否应用 Temperature Scaling 校准（默认 false） */
  applyCalibration?: boolean
  /** Provider ID（分类校准，applyCalibration=true 时必填） */
  providerId?: string
}
```

---

## 6. v2.4 后端新增能力清单 🔥

### 6.1 Phase A：工具调用统计（`recordToolCall`）

**目的**：让 `ModelSettings` 页面展示工具调用分布，替代静态 mock 数据。

**实现位置**：`src/main/ipc/model-stats.ts`

**新增 API**：
```typescript
/**
 * 记录一次工具调用（供主进程其他模块调用）
 * @param db    数据库管理器
 * @param toolName 工具名称（与 ModelSettings 显示一致）
 */
export function recordToolCall(db: DatabaseManager, toolName: string): void
```

**数据流**：
1. 主进程某模块执行工具（如 `ssh:exec`）
2. 调用 `recordToolCall(db, '终端命令执行')`
3. 写入 `tool_call_log` 表（`toolName` + `timestamp`）
4. 前端 `ModelSettings` 通过 `model:toolCalls` IPC 拉取聚合数据
5. 返回 `ToolCallStat[]`（按 count 降序，percent = count / total * 100）

**已接入的工具名**：
- `终端命令执行`（`ssh:exec` handler 内调用）
- 其他工具（kb:search / 联网搜索 / Skill调用 / 方法论应用）由各 handler 自行接入

**IPC 通道**：
| 通道 | Preload API | 参数 | 返回值 |
|------|-------------|------|--------|
| `model:toolCalls` | `modelToolCalls` | 无 | `Promise<ToolCallStat[]>` |

**降级**：DB 不可用或表为空时返回 `[]`，前端显示"暂无工具调用数据"。

---

### 6.2 Phase B：预算告警（`recordBudgetAlert`）

**目的**：让 `ModelSettings` 页面展示预算告警历史，让用户对 LLM 消耗有直观感知。

**实现位置**：
- `src/main/ipc/model-stats.ts`（`recordBudgetAlert` 写入函数）
- `src/main/services/llm/budget-alerter.ts`（告警触发器）

**新增 API**：
```typescript
/**
 * 记录一条预算告警（供主进程其他模块调用）
 * @param db    数据库管理器
 * @param level 告警级别（'alert' / 'error'）
 * @param text  告警文本
 */
export function recordBudgetAlert(
  db: DatabaseManager,
  level: 'alert' | 'error',
  text: string
): void
```

**告警触发场景**（`budget-alerter.ts`）：

| 触发器 | 函数 | 阈值 | 级别 |
|--------|------|------|------|
| LLM 响应慢 | `alertLlmSlowResponse(method, durationMs)` | `> 5000ms` | `alert` |
| LLM 连续失败 | `alertLlmFailure(method, error)` | `>= 3 次` | `error` |
| Token 成本超阈值 | `alertTokenBudgetExceeded(cost, threshold, dimension)` | `cost > threshold` | `alert`（当日去重） |
| LLM 调用成功 | `alertLlmSuccess()` | — | 重置失败计数 |

**设计原则**：
- 模块级状态，无需注入 db（直接 `DatabaseManager.getInstance()`）
- 静默失败：db 未初始化或不可用时不影响主流程
- 当日去重：token 告警每天最多一次，避免每次查询都告警
- 失败计数重置：记录后清零，下一轮 3 次再告警

**IPC 通道**：
| 通道 | Preload API | 参数 | 返回值 |
|------|-------------|------|--------|
| `budget:alerts` | `budgetAlerts` | `(limit?: number)` | `Promise<BudgetAlert[]>` |

**参数约束**：`limit` 默认 20，上限 100（`Math.min(Math.max(limit ?? 20, 1), 100)`）

**降级**：DB 不可用或表为空时返回 `[]`，前端显示"暂无告警"。

---

### 6.3 Phase C：可信度校准（`fuseAndAssess` options）

**目的**：解决 `ai-param-source.ts` 中 `CALIBRATION_DISCOUNT=0.85` 硬编码问题，为不同 LLM Provider 计算最优 Temperature Scaling 参数 T。

**实现位置**：
- `src/main/core/agent/credibility/fusion-engine.ts`（`fuseAndAssess` 新增 `options` 参数）
- `src/main/core/agent/credibility/calibration/`（4 个文件）

**新增模块**：

| 文件 | 职责 |
|------|------|
| `calibration-tuner.ts` | `CalibrationTuner` 类：维护历史样本 + Provider 分类校准 + 持久化 |
| `ece.ts` | ECE（Expected Calibration Error）分桶计算 |
| `temperature-scaling.ts` | Temperature Scaling 优化（网格搜索 T ∈ [0.1, 5.0]） |
| `types.ts` | `CalibrationSample` / `EceResult` / `ProviderCalibration` / `CalibrationState` / `CalibrationChannelMap` |

**`fuseAndAssess` 新签名**：
```typescript
/**
 * 融合并评估证据，可选应用校准
 * @param massFunctions 6 源证据的 Mass 函数列表
 * @param options 融合选项（v2.4 Phase C 新增）
 *   - applyCalibration: 是否应用 Temperature Scaling 校准（默认 false）
 *   - providerId: Provider ID（applyCalibration=true 时必填，用于分类校准）
 * @returns ConfidenceAssessment（含 calibratedConfidence / eceReport 可选字段）
 */
fuseAndAssess(
  massFunctions: MassFunction[],
  options?: FuseAssessOptions
): ConfidenceAssessment
```

**校准流程**：
1. 调用 `fuse(massFunctions)` 得到融合 Mass 函数 + 原始 `confidence`
2. 若 `options.applyCalibration === true`：
   - 取 `options.providerId`（未传时 fallback 到 `'default'`）
   - 调用 `CalibrationTuner.applyCalibration(confidence, providerId)` 得到 `calibratedConfidence`
   - 调用 `CalibrationTuner.computeEce(providerId)` 得到 `eceReport`
   - 填充到 `ConfidenceAssessment.calibratedConfidence` / `.eceReport`
3. 否则：返回原始 `confidence`，不填充校准字段

**持久化**：
- 状态文件：`calibration-state.json`（`CALIBRATION_STATE_VERSION = 1`）
- 结构：`CalibrationState { version, providers: Record<ProviderId, ProviderCalibration>, defaultT, updatedAt }`
- 默认 T = 1.0（未校准过的 Provider）
- 触发重新校准阈值：累计 `>= 20` 个新样本（`RETUNE_THRESHOLD`）

**论文支撑**：
- Guo et al. 2017 (ICML) "On Calibration of Modern Neural Networks" arXiv:1706.04599 §3.2
- Kadavath et al. 2022 (Anthropic) arXiv:2207.05221（LLM 自我评估能力）
- Shrivastava et al. 2023 (Stanford) arXiv:2311.08877（医学 LLM 校准）

**IPC 通道状态**（⚠️ 未完成，详见附录 A）：
| 通道 | 期望 Preload API | 期望参数 | 期望返回值 | 状态 |
|------|------------------|---------|-----------|------|
| `credibility:calibrate` | `credibilityCalibrate` | `(providerId, options?)` | `Promise<TemperatureScalingResult>` | ❌ 未注册 |
| `credibility:get-calibration` | `credibilityGetCalibration` | `(providerId)` | `Promise<ProviderCalibration>` | ❌ 未注册 |
| `credibility:get-calibration-state` | `credibilityGetCalibrationState` | 无 | `Promise<CalibrationState>` | ❌ 未注册 |
| `credibility:reset-calibration` | `credibilityResetCalibration` | `(providerId)` | `Promise<boolean>` | ❌ 未注册 |
| `credibility:compute-ece` | `credibilityComputeEce` | `(providerId, numBuckets?)` | `Promise<EceResult>` | ❌ 未注册 |
| `credibility:add-calibration-sample` | `credibilityAddCalibrationSample` | `(sample)` | `Promise<boolean>` | ❌ 未注册 |

**说明**：`CalibrationChannelMap` 类型已在 `calibration/types.ts` 定义，但 `ipcMain.handle` 未注册对应 handler，preload 也未暴露方法。当前校准只能通过 `fuseAndAssess(massFunctions, { applyCalibration: true, providerId })` 内部触发，前端无法直接管理校准状态。

**`credibility:assess` 透传状态**（⚠️ 未完成）：
- `ipc/credibility.ts` 的 `credibility:assess` handler 当前未读取 `options` 参数透传给 `fuseAndAssess`
- 即前端调用 `credibilityAssess(inputs)` 时，无法通过第二个参数指定 `applyCalibration: true`
- **临时方案**：需要校准的场景在主进程内部直接调用 `engine.fuseAndAssess(massFunctions, options)`

---

## 7. 跨层契约与约束

### 7.1 类型契约

| 契约 | 说明 |
|------|------|
| **SSOT** | 业务类型只在 `src/shared/` 定义，main/renderer 引用 |
| **Preload 类型声明** | `src/preload/index.d.ts` 的 `ElectronAPI` 接口是渲染层调用 IPC 的唯一类型来源 |
| **通道常量** | `src/shared/ipc-channels.ts` 是通道名字符串的唯一来源，禁止字面量硬编码 |
| **推送载荷** | push 通道的载荷类型必须在 `src/shared/` 定义，preload 的 `onXxx` 回调签名引用该类型 |

### 7.2 错误处理契约

| 层 | 处理方式 |
|----|---------|
| **IPC handler（main）** | `try/catch` 捕获，`throw new Error(用户可读消息)`，同时 `logger.error` 记录 |
| **Preload** | 透明传递 `ipcRenderer.invoke` 的 Promise rejection |
| **Renderer store** | `try/catch` 捕获，设置 store 的 `error` 字段，UI 展示错误提示 |
| **DB 降级** | `db.isAvailable() === false` 时返回空数组/空对象，不抛错 |
| **Sidecar 不可用** | 返回 `{ ok: false, error: '...' }`，前端显示"Sidecar 未启动"提示 |

### 7.3 性能契约

| 场景 | 约束 |
|------|------|
| SFTP 文件搜索 | 3 秒超时，最多 50 条 |
| SFTP grep | 3 秒超时，最多 100 条 |
| SFTP readFile | 10MB 上限 |
| 图片上传 | 4MB 上限，支持 png/jpg/jpeg/gif/webp/bmp |
| 预算告警查询 | `limit` 上限 100，默认 20 |
| IPC handler 启动 | `system:ping` 必须最早注册，确保心跳可用 |

### 7.4 安全契约

| 契约 | 说明 |
|------|------|
| **contextBridge 隔离** | 渲染层只能通过 `window.electronAPI` 访问，不能直接 `require('electron')` |
| **凭证加密** | API Key / 密码 / 私钥通过 `SafeStore` 加密存储，不进 electron-store 明文 |
| **主机密钥校验** | `strictHostKeyCheck: true` 时首次连接弹窗确认，密钥变更拒绝连接 |
| **命令风险评估** | HIGH / CRITICAL 命令必须人工确认（`risk:check` + `DecisionPage`） |
| **沙箱隔离** | OpenHands 沙箱通过 Docker 容器隔离，不直接在宿主执行 |
| **Token 透明** | 每次 LLM 调用后展示 token + 成本（USD），硬约束 |

### 7.5 日志契约

- 统一通过 `src/main/services/log/logger.ts` 的 `logger` 实例
- 域标识符规范：`IPC.SSH` / `IPC.LLM` / `IPC.CREDIBILITY` / `IPC.MODEL_STATS` 等
- 日志级别：`debug` / `info` / `warn` / `error`
- 所有 IPC handler 注册时打 `info` 日志，列出注册的通道列表
- 关键操作（连接 / 决策 / 告警）打 `info` 日志，附带上下文对象

---

## 8. 交接检查清单

### 8.1 前端开发者在接入新 IPC 时需确认

- [ ] 通道常量已在 `src/shared/ipc-channels.ts` 定义
- [ ] handler 已在 `src/main/ipc/*.ts` 注册并在 `index.ts` 调用 `registerXxxHandlers`
- [ ] preload 已暴露扁平化方法（`src/preload/index.ts`）
- [ ] `ElectronAPI` 接口已声明类型（`src/preload/index.d.ts`）
- [ ] 参数和返回值类型已在 `src/shared/` 定义
- [ ] DB 相关 handler 已处理 `db.isAvailable() === false` 降级
- [ ] 错误消息用户可读（不暴露 stack trace）

### 8.2 后端开发者在新增能力时需确认

- [ ] 共享类型已迁移到 `src/shared/`（不在 main 私有）
- [ ] IPC 4 步同步全部完成
- [ ] `logger` 记录了关键操作
- [ ] 涉及 DB 写入的函数提供了 `recordXxx` 辅助函数供其他模块调用
- [ ] 静默失败策略已实施（不影响主流程）
- [ ] v2.4 新增能力已在本文档第 6 节登记

### 8.3 v2.4 收尾待办

| 优先级 | 待办 | 关联 Phase | 阻塞方 | 状态 |
|--------|------|-----------|--------|------|
| P1 | `credibility:assess` handler 透传 `options` 参数给 `fuseAndAssess` | Phase C | 后端 | ✅ 完成 |
| P1 | 注册 6 个校准 IPC 通道（`credibility:calibrate` 等） | Phase C | 后端 | ✅ 完成 |
| P1 | preload 暴露 6 个校准方法 + 类型声明 | Phase C | 后端 | ✅ 完成 |
| P1 | Credibility 6 源加权融合真实实现（Shafer Discounting） | Phase D5 | 后端 | ✅ 完成 |
| P1 | Claude SDK Provider 缓存清理 | Phase D1 | 后端 | ✅ 完成 |
| P1 | MCP Prompts 未知 ID 优雅降级 | Phase D2 | 后端 | ✅ 完成 |
| P1 | DatabaseManager mock Statement 错误明确化 | Phase D4 | 后端 | ✅ 完成 |
| P2 | VercelAiService 降级 Token 估算 | Phase D3 | 后端 | ✅ 完成 |
| P2 | 更多工具 handler 接入 `recordToolCall`（kb:search / 联网搜索 / Skill 调用） | Phase A | 后端 | ✅ 已接入 ssh:exec + kb:search |
| P2 | `alertTokenBudgetExceeded` 接入实际 token 成本监控循环 | Phase B | 后端 | ✅ 完成 |
| P3 | `ModelSettings` 页面消费 `model:toolCalls` + `budget:alerts` | Phase A/B | 前端 | ⏳ 待前端接入 |
| P3 | 校准状态管理 UI（`CalibrationSettings` 组件） | Phase C | 前端 | ⏳ 待前端接入 |

---

## 附录 A：v2.4 Phase C 校准能力完成度矩阵

| 编号 | 能力 | 完成度 | 验证证据 |
|------|------|--------|---------|
| C-1 | `calibration/` 4 个文件（tuner / ece / temperature-scaling / types） | ✅ | `src/main/core/agent/credibility/calibration/` 存在 |
| C-2 | `CalibrationTuner` 类实现（addSample / applyCalibration / computeEce / retune） | ✅ | `calibration-tuner.ts` 已实现 |
| C-3 | `FuseAssessOptions` 类型定义 | ✅ | `fusion-engine.ts` 已导出 |
| C-4 | `fuseAndAssess` 支持 `options` 参数 | ✅ | `fusion-engine.ts` 已扩展签名 |
| C-5 | `ConfidenceAssessment` 扩展 `calibratedConfidence` / `eceReport` | ✅ | `fusion-engine.ts` 已添加可选字段 |
| C-6 | `CalibrationChannelMap` 类型定义（6 通道） | ✅ | `calibration/types.ts` 已定义 |
| C-7 | `credibility:assess` handler 透传 `options` | ✅ | `ipc/credibility.ts` 已读取 options 并透传 |
| C-8 | 6 个校准 IPC 通道 `ipcMain.handle` 注册 | ✅ | `ipc/credibility.ts` 已注册 6 个 handler |
| C-9 | preload 暴露 6 个校准方法 | ✅ | `preload/index.ts` 已暴露 6 个扁平化方法 |
| C-10 | `ElectronAPI` 类型声明 6 个方法 | ✅ | 由 `exposeInMainWorld` 对象字面量自动推断 |
| C-11 | 校准状态持久化文件 `calibration-state.json` | ✅ | `calibration-tuner.ts` `load/save` 方法 |
| C-12 | 论文支撑文档 | ✅ | `idea-to-dev-output/22-可信度算法论文支撑调研.md` |

**完成度**：12 项全部 ✅（v2.4 收尾完成，前后端交接硬阻塞已解除）

---

## 附录 B：关键文件索引

### 后端核心文件

| 路径 | 职责 |
|------|------|
| `src/main/ipc/index.ts` | IPC 注册入口（42 个 register 函数） |
| `src/main/ipc/ssh.ts` | SSH 域 handler |
| `src/main/ipc/llm.ts` | LLM 域 handler |
| `src/main/ipc/credibility.ts` | 可信度域 handler（含 v2.4 Phase C 接入点） |
| `src/main/ipc/model-stats.ts` | 🔥 v2.4 Phase A/B：工具调用 + 预算告警 |
| `src/main/core/agent/credibility/fusion-engine.ts` | 🔥 v2.4 Phase C：融合引擎 + 校准接入 |
| `src/main/core/agent/credibility/calibration/calibration-tuner.ts` | 🔥 v2.4 Phase C：校准器 |
| `src/main/services/llm/budget-alerter.ts` | 🔥 v2.4 Phase B：告警触发器 |
| `src/main/services/db/database.ts` | SQLite 单例 |
| `src/main/services/ssh/` | SSH 连接管理 |

### 前端核心文件

| 路径 | 职责 |
|------|------|
| `src/renderer/src/pages/ModelSettings.tsx` | 🔥 v2.4 消费方：工具调用 + 告警展示 |
| `src/renderer/src/pages/DecisionPage.tsx` | 决策卡片列表 |
| `src/renderer/src/pages/WorkbenchPage.tsx` | 主工作台 |
| `src/renderer/src/stores/ai-store.ts` | AI 对话状态 |
| `src/renderer/src/stores/terminal-store.ts` | 终端状态 |
| `src/renderer/src/components/ai/AIPanel.tsx` | AI 对话面板 |

### 共享层文件

| 路径 | 职责 |
|------|------|
| `src/shared/agent-types.ts` | Agent / Provider / Token 类型（v2.4 扩展校准字段） |
| `src/shared/models.ts` | 通用业务模型（含 `ToolCallStat` / `BudgetAlert`） |
| `src/shared/ipc-channels.ts` | IPC 通道常量 |

### Preload 文件

| 路径 | 职责 |
|------|------|
| `src/preload/index.ts` | contextBridge 暴露扁平化 API |
| `src/preload/index.d.ts` | `ElectronAPI` 接口类型声明 |

---

**文档结束**。如有疑问，请对照 [`ipc-contract.md`](./ipc-contract.md) 核对通道细节，或对照 [`data-flow.md`](./data-flow.md) 核对数据流转。
