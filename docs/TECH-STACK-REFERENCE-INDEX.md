# TDSF-Linux Desktop — 技术栈参考文档索引 v1.0

> 本文档是项目核心技术栈的**官方文档快速索引 + 下载指引 + 关键注意事项**。
> 配合 `SKILL-CATALOG-v1.0.md` 使用：Skill 解决"如何开发"，文档解决"怎么写对"。
> 更新日期：2026-07-22
> 适用版本：v1.0+

---

## 1. 核心 10 份必读文档（按优先级）

### 1.1 ⭐⭐⭐ 必读（4 份）

#### ① Electron 官方安全指南

- **官方地址**：https://www.electronjs.org/docs/latest/tutorial/security
- **关键章节**：
  - "Context Isolation"（**必读**）
  - "Sandbox"（**必读**）
  - "Security Checklist"（**必读**）
  - "Don't Enable Node.js Integration for Remote Content"（**必读**）
- **本项目应用**：
  - 已在 `electron.vite.config.ts` 强制 `contextIsolation: true`、`nodeIntegration: false`
  - 已在 `src/preload/index.ts` 用 `contextBridge.exposeInMainWorld` 暴露 API
  - 详见 `AGENTS.md` §安全规范
- **关键注意事项**：
  - ❌ 不要在 renderer 启用 `nodeIntegration: true`（会被 V8 warning + 安全扫描拦截）
  - ❌ 不要直接 `require('fs')` 在 renderer（必须走 IPC）
  - ❌ 不要把 `ipcRenderer` 暴露给渲染端（仅暴露具体方法）
  - ✅ 永远 `contextBridge.exposeInMainWorld('electronAPI', { ... })`
  - ✅ Sandbox 模式下 preload 只用 `electron` + `contextBridge` API
- **本地化建议**：HTML 转 PDF，保存到 `docs/references/electron-security.html`

---

#### ② Vercel AI SDK 文档

- **官方地址**：https://sdk.vercel.ai/docs
- **关键章节**：
  - "Foundations: AI SDK Core"（**必读**）
  - "Providers: OpenAI / Anthropic / Google / Volcengine"（**必读**）
  - "Tools and Tool Calling"（**必读**）
  - "Streaming"（推荐）
- **本项目应用**：
  - 项目已用 `ai` 7.0.29 + `@ai-sdk/openai` / `@ai-sdk/anthropic` / `@ai-sdk/google` / `@volcengine/ark-runtime`
  - 见 `src/main/services/llm/vercel-ai-service.ts`
- **关键注意事项**：
  - ✅ `streamText` 返回 `stream.toDataStreamResponse()` 处理 SSE
  - ✅ `generateText` 同步调用 + `toolChoice: 'auto'` 让模型选工具
  - ✅ `tool()` 定义用 Zod schema（与项目 `zod` 配套）
  - ❌ 不要在 tool 内部发起新 LLM 调用（会触发递归 token 爆炸）
  - ❌ 不要把 System Prompt 超过 8K（影响 cache 命中率）
- **本地化建议**：保存 `docs/references/vercel-ai-sdk/`（按章节分别 HTML）

---

#### ③ Anthropic Claude Agent SDK 文档

- **官方地址**：https://docs.anthropic.com/en/api/agent-sdk/overview
- **关键章节**：
  - "Overview"（**必读**）
  - "TypeScript SDK"（**必读**）
  - "Tool Definition"（**必读**）
  - "Permissions & Approvals"（**必读**）
- **本项目应用**：
  - 项目已用 `@anthropic-ai/claude-agent-sdk` 0.3.211
  - 见 `src/main/core/agent/claude-sdk/`
- **关键注意事项**：
  - ✅ 工具定义必须 `name` + `description` + `input_schema`（JSON Schema）
  - ✅ 用 `allowedTools` / `disallowedTools` 控制权限（项目硬约束 R12 三态审批）
  - ✅ 每次 `claude.chat()` 都会创建新会话，如需连续用 `claude.resume()`
  - ❌ 不要混用 Claude Code CLI 与 SDK（API 不一致）
  - ❌ 不要绕过 SDK 直接调 Anthropic API（失去 tool use 编排）
- **本地化建议**：保存 `docs/references/claude-agent-sdk.html`

---

#### ④ React 18 官方文档

- **官方地址**：https://react.dev/
- **关键章节**：
  - "Thinking in React"（**必读**）
  - "Hooks: useState / useEffect / useMemo / useCallback"（**必读**）
  - "Server Components vs Client Components"（Electron 用不到）
  - "Performance: useTransition / useDeferredValue / Suspense"（推荐）
- **本项目应用**：
  - 项目已用 React 18.3.0
  - 渲染层全部用函数组件 + Hooks
- **关键注意事项**：
  - ✅ `useEffect` 依赖必须用 `eslint-plugin-react-hooks` 校验
  - ✅ 大量列表用 `useMemo` 缓存 + `key` 稳定
  - ✅ 重组件用 `React.lazy` + `Suspense` 懒加载
  - ❌ 不要在循环/条件里调 Hooks（违反 Rules of Hooks）
  - ❌ 不要把对象/数组字面量直接传给 memoized 组件（每次新建引用）
  - ❌ 不要滥用 `useEffect`——能用事件回调就别用 effect
- **本地化建议**：保存 `docs/references/react/`（分章节）

---

### 1.2 ⭐⭐ 推荐阅读（4 份）

#### ⑤ Ant Design 5 文档

- **官方地址**：https://ant.design/
- **关键章节**：
  - "Design Values"（必读）
  - "Components: Form / Table / Modal / Drawer / Tree"（按需）
  - "Customize Theme"（推荐）
  - "Migration to v5"（v4→v5 升级时必读）
- **本项目应用**：
  - 项目已用 Ant Design 5.20.0
  - 主要用于：Form、Table、Modal、Drawer、Tree、Message
- **关键注意事项**：
  - ✅ Form 用 `Form.useForm()` + 受控/非受控混合
  - ✅ Table 列定义用 `useMemo` 缓存
  - ✅ Modal/Drawer 必须 `destroyOnClose` 避免内存泄漏
  - ❌ 不要直接改 antd 内部样式（用 `ConfigProvider.theme`）
  - ❌ 不要同时用 `Modal.confirm` + 自定义 Modal（焦点冲突）
  - ⚠️ 主题变量必须用 `var(--color-*)`（项目硬约束）
- **本地化建议**：保存关键组件 API 到 `docs/references/antd/`

---

#### ⑥ Tailwind CSS v4 文档

- **官方地址**：https://tailwindcss.com/docs/installation
- **关键章节**：
  - "Installation with Vite"（必读）
  - "Core Concepts: Utility-First"（必读）
  - "Dark Mode"（推荐）
  - "Customization: @theme"（**v4 新增**，**必读**）
- **本项目应用**：
  - 项目已用 Tailwind 4.3.3
  - 用 `@theme` 集中颜色变量（避免硬编码）
- **关键注意事项**：
  - ✅ v4 用 `@theme` 替代 v3 的 `tailwind.config.js`
  - ✅ v4 自动 import，无需 `@tailwind base/components/utilities`
  - ✅ 颜色用 `bg-[var(--color-primary)]` 引用 CSS 变量
  - ❌ 不要混用 v3/v4 写法（会冲突）
  - ❌ 不要在 `safelist` 里硬编码类名（v4 自动检测）
- **本地化建议**：保存 `@theme` 章节到 `docs/references/tailwind-v4-theme.html`

---

#### ⑦ Vite 5 官方文档

- **官方地址**：https://vitejs.dev/
- **关键章节**：
  - "Why Vite"（了解即可）
  - "Features: HMR / Build"（**必读**）
  - "Static Asset Handling"（推荐）
  - "Plugin API"（自定义插件时必读）
- **本项目应用**：
  - electron-vite 内部用 Vite 5.4.0
  - 渲染层与主进程用 Vite 双构建
- **关键注意事项**：
  - ✅ 静态资源 `import url from './x.css?url'` 显式 URL
  - ✅ 大量依赖预构建 `optimizeDeps.include`
  - ❌ 不要在主进程用 `import.meta.env.VITE_*`（主进程没有）
  - ❌ 不要在 renderer 用 `__dirname` / `__filename`（被 Vite 替换）
- **本地化建议**：保存 Plugin API 到 `docs/references/vite-plugin.html`

---

#### ⑧ Playwright 官方文档

- **官方地址**：https://playwright.dev/
- **关键章节**：
  - "Getting Started"（**必读**）
  - "Locators: getByRole / getByText / getByTestId"（**必读**）
  - "Auto-waiting"（推荐）
  - "Electron: electron API"（**必读**）
- **本项目应用**：
  - 项目已用 @playwright/test 1.61.1
  - 见 `playwright.config.ts` + `scripts/browser-check/`
- **关键注意事项**：
  - ✅ 优先用 `getByRole`（无障碍 + 稳定）
  - ✅ 元素断言用 `expect(locator).toBeVisible()` 而非 `waitForTimeout`
  - ✅ Electron 测试用 `_electron.launch()`
  - ❌ 不要用 XPath（脆弱）
  - ❌ 不要在 production build 跑 E2E（必须 dev 模式）
- **本地化建议**：保存 Electron 章节到 `docs/references/playwright-electron.html`

---

### 1.3 ⭐ 选读（2 份）

#### ⑨ Mastra 框架文档

- **官方地址**：https://mastra.ai/docs
- **关键章节**：
  - "Quick Start"（**必读**）
  - "Agents: Tool Calling / Memory"（**必读**）
  - "Workflows: State Machines"（推荐）
  - "Integrations: AI SDK / Anthropic"（推荐）
- **本项目应用**：
  - 项目已用 `@mastra/core` 1.51.0 + `@mastra/memory` 1.23.0
  - 见 `src/main/core/agent/mastra/`
- **关键注意事项**：
  - ✅ Agent 定义 `new Agent({ name, instructions, model, tools })`
  - ✅ Memory 用 `Memory` 类配 `PostgresStore` / `LibSQLStore`
  - ✅ Tools 用 `createTool()` + Zod schema
  - ❌ 不要把工具调用与 LLM 推理混在同一个 callback（难调试）
- **本地化建议**：保存 Agent 章节到 `docs/references/mastra-agent.html`

---

#### ⑩ better-sqlite3 文档

- **官方地址**：https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
- **关键章节**：
  - "transactions"（**必读**）
  - "Statement.bind / run / get / all"（**必读**）
  - "PRAGMA: journal_mode / synchronous / foreign_keys"（推荐）
  - "Performance Tips"（推荐）
- **本项目应用**：
  - 项目已用 better-sqlite3 13.0.1
  - 见 `src/main/services/db/database.ts`
- **关键注意事项**：
  - ✅ 事务用 `db.transaction(() => { ... })`（同步，**不**用 callback）
  - ✅ 查询参数化 `stmt.get(name, age)` 而非字符串拼接（防 SQL 注入）
  - ✅ 启动时 `PRAGMA journal_mode = WAL`（提升并发）
  - ✅ 启动时 `PRAGMA foreign_keys = ON`（启用外键）
  - ❌ 不要在事务里 `await`（better-sqlite3 是同步的，await 会破坏事务）
  - ❌ 不要在主线程做长查询（考虑 Worker 线程）
- **本地化建议**：保存 API 速查到 `docs/references/better-sqlite3-api.html`

---

## 2. 辅助参考文档（按需查阅）

| 库 | 官方地址 | 必读章节 | 本项目用途 |
|----|---------|---------|----------|
| TypeScript 5 | https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-4.html | "Template Literal Types" / "satisfies" | 严格模式类型 |
| Zustand 4 | https://docs.pmnd.rs/zustand | "Slices Pattern" / "Persist" | 全局状态 |
| Dexie 4 | https://dexie.org/docs/Tutorial/Getting-started | "Versioning" / "Live Queries" | IndexedDB |
| Radix UI | https://www.radix-ui.com/primitives | "Dialog" / "Dropdown" / "Tooltip" | 无样式原语 |
| ssh2 | https://github.com/mscdex/ssh2#readme | "API documentation" | SSH 客户端 |
| Monaco Editor | https://microsoft.github.io/monaco-editor/typedoc/index.html | "Editor" / "Model" | 代码编辑器 |
| xterm.js | https://xtermjs.org/docs/ | "Addon: Fit / Search / WebGL" | 终端 |
| React Flow | https://reactflow.dev/learn | "Custom Nodes" / "Edges" | 节点图 |
| Recharts | https://recharts.org/en-US/api | "ComposedChart" | 图表 |
| Langfuse | https://langfuse.com/docs | "TypeScript SDK" | LLM 观测 |
| MCP | https://modelcontextprotocol.io/ | "Server" / "Client" / "Tools" | 工具协议 |
| Vitest | https://vitest.dev/guide/ | "Mocking" / "Coverage" | 单元测试 |
| ESLint 9 | https://eslint.org/docs/latest/use/configure/configuration-files | "Flat Config" | 代码规范 |
| electron-builder | https://www.electron.build/configuration/configuration | "Win / Mac / Linux" | 打包 |
| electron-vite | https://electron-vite.org/ | "Config" / "Main Process" | 三进程构建 |

---

## 3. 本地化策略

### 3.1 推荐下载的 4 份

考虑到核心必读 + 离线可用，重点下载：

```bash
# 1. Electron 安全指南（最关键）
curl -L "https://www.electronjs.org/docs/latest/tutorial/security" \
  -o "docs/references/electron-security.html"

# 2. Vercel AI SDK 入门
curl -L "https://sdk.vercel.ai/docs" -o "docs/references/vercel-ai-sdk.html"

# 3. Claude Agent SDK 概述
curl -L "https://docs.anthropic.com/en/api/agent-sdk/overview" \
  -o "docs/references/claude-agent-sdk.html"

# 4. React 18 入门
curl -L "https://react.dev/learn" -o "docs/references/react-learn.html"
```

### 3.2 转 PDF（可选）

```bash
# 需要 wkhtmltopdf 或 pandoc
pandoc docs/references/electron-security.html -o docs/references/electron-security.pdf
pandoc docs/references/vercel-ai-sdk.html -o docs/references/vercel-ai-sdk.pdf
```

### 3.3 增量更新

- 每季度检查官方文档是否有 breaking change
- 用 `defuddle` Skill 提取更新内容
- 写入本文件 §3.1

---

## 4. 项目踩坑清单（按技术栈分组）

### 4.1 Electron + electron-vite 踩坑

| 问题 | 症状 | 解决 |
|------|------|------|
| 主进程 IPC 全部就绪但渲染层 UI 空白 | 编译门禁 4 绿，UI 不显示 | 第七轮发现。**必须 E2E 验证 UI** |
| contextBridge 嵌套 API | `window.electronAPI.ssh.connect()` 崩溃 | **扁平化**所有 API（`window.electronAPI.sshConnect()`） |
| Sandbox 模式下 preload 用了 fs | 启动失败 | preload 只能用 `electron` + `contextBridge` |
| 三进程类型不共享 | `Cannot find module '../../../main/...'` | 跨端类型放 `src/shared/`，主进程 services/types.ts 用 re-export 兼容 |

### 4.2 TypeScript 5.4 踩坑

| 问题 | 症状 | 解决 |
|------|------|------|
| `satisfies` 用在 EventEmitter emit | TS2345 缺 `type` 字段 | 依赖 emit 方法签名自动注入，直接传 payload |
| 对象方法返回类型标注 `) => ReturnType =>` | esbuild 误解析，启动失败 | 用 `): ReturnType =>`（冒号） |
| tsx 独立测试找不到 `@main/*` | 路径别名失败 | 显式指定 `--tsconfig tsconfig.node.json` |
| 类未导出 | 测试脚本无法实例化 | 加 `export` 关键字 |
| 跨端 shared 类型不能因 UI 框架需求修改 | React Flow 缺 `label` 报错 | 本地用 `& { label?: string }` 扩展，不动 shared |

### 4.3 React 18 + Ant Design 踩坑

| 问题 | 症状 | 解决 |
|------|------|------|
| Modal/Drawer 不 destroyOnClose | 内存泄漏 | 必须 `destroyOnClose` |
| Table 列定义每次重渲染 | 性能差 | `useMemo` 缓存 |
| Form.Item 嵌套过深 | 校验失效 | 保持 ≤3 层 |
| v4→v5 升级：Form 校验时机变化 | 行为不一致 | 看 Migration 文档 |
| Ant Design 主题硬编码颜色 | 违反项目硬约束 | 用 `var(--color-*)` |

### 4.4 better-sqlite3 踩坑

| 问题 | 症状 | 解决 |
|------|------|------|
| 事务中 `await` | 事务边界错误 | better-sqlite3 是同步的，不能 `await` |
| 字符串拼接 SQL | SQL 注入 | 必须参数化 `stmt.get(name, age)` |
| 没开 WAL | 并发写阻塞 | 启动时 `PRAGMA journal_mode = WAL` |
| 没开外键 | 外键不生效 | 启动时 `PRAGMA foreign_keys = ON` |
| 在主线程长查询 | UI 卡顿 | 考虑 Worker 线程（v1.0 暂不实施） |

### 4.5 Tailwind 4 踩坑

| 问题 | 症状 | 解决 |
|------|------|------|
| v3 写法 + v4 混用 | 类名失效 | v4 用 `@theme`，不用 `tailwind.config.js` |
| 颜色硬编码 `#0071e3` | 违反项目硬约束 | 必须用 `var(--color-*)` |
| 任意值类名 `bg-[#fff]` | 不可重命名 | 用 `bg-[var(--color-bg)]` |

### 4.6 Vite 5 踩坑

| 问题 | 症状 | 解决 |
|------|------|------|
| 主进程用 `import.meta.env.VITE_*` | undefined | 主进程无 Vite env |
| renderer 用 `__dirname` | undefined | Vite 替换，要用 `import.meta.url` |
| 依赖未预构建 | 启动慢 | `optimizeDeps.include` 显式指定 |

### 4.7 AI Agent 框架踩坑

| 问题 | 症状 | 解决 |
|------|------|------|
| Tool 内递归调 LLM | Token 爆炸 | Tool 内不发新推理 |
| System Prompt > 8K | Cache miss | 控制 ≤ 8K |
| Claude Code CLI vs SDK 混用 | API 不一致 | 用 SDK 统一 |
| 不传 `allowedTools` | 工具调用无边界 | 必须显式传白名单 |
| 没设置 `toolChoice` | 模型可能不调 | 显式 `'auto'` 或 `'required'` |

---

## 5. 性能优化清单（按技术栈）

### 5.1 React 渲染优化

```typescript
// ✅ 大量列表 memo
const Row = React.memo(({ item }) => <div>{item.name}</div>)

// ✅ 计算密集型用 useMemo
const filtered = useMemo(() => items.filter(x => x.active), [items])

// ✅ 子组件回调用 useCallback
const handleClick = useCallback((id) => { ... }, [])

// ✅ 重组件用 React.lazy
const HeavyChart = React.lazy(() => import('./HeavyChart'))
```

### 5.2 Electron 启动优化

```typescript
// ✅ preload 轻量化（只暴露方法，不引用大库）
contextBridge.exposeInMainWorld('electronAPI', {
  sshConnect: (config) => ipcRenderer.invoke('ssh:connect', config),
  // ...
})

// ✅ 主进程按需加载服务
const monitor = require('./services/ssh/monitor')  // lazy require

// ✅ Vite optimizeDeps 预构建大依赖
// electron.vite.config.ts
optimizeDeps: {
  include: ['monaco-editor', 'better-sqlite3', 'ssh2']
}
```

### 5.3 数据库优化

```sql
-- ✅ WAL 模式
PRAGMA journal_mode = WAL;

-- ✅ 索引
CREATE INDEX idx_session_id ON logs(session_id);

-- ✅ prepared statement 复用
const stmt = db.prepare('SELECT * FROM logs WHERE session_id = ?')
for (const id of ids) stmt.get(id)
```

---

## 6. 安全清单（按 OWASP + Electron）

| # | 项目 | 实施位置 | 状态 |
|---|------|---------|------|
| S1 | contextIsolation: true | electron.vite.config.ts | ✅ |
| S2 | nodeIntegration: false | electron.vite.config.ts | ✅ |
| S3 | sandbox: true | electron.vite.config.ts | ✅ |
| S4 | webSecurity: true | electron.vite.config.ts | ✅ |
| S5 | 禁用 webview tag | electron.vite.config.ts | 待确认 |
| S6 | 加载外部链接用 BrowserWindow | webContents | 待实施 |
| S7 | preload 只暴露白名单方法 | preload/index.ts | ✅ |
| S8 | contextBridge 不暴露 ipcRenderer | preload/index.ts | ✅ |
| S9 | IPC handler 验证输入 | ipc/*.ts | 部分 |
| S10 | 敏感文件默认 redact | services/security/redact.ts | ✅ |
| S11 | 所有网络请求 UI 可见 | network monitor | 待实施 |
| S12 | SSH 连接用密钥 | secure-store | ✅ |
| S13 | better-sqlite3 参数化 | 所有 db 调用 | ✅ |
| S14 | noUncheckedIndexedAccess | tsconfig | 推荐 |
| S15 | eval() 禁用 | ESLint | 推荐 |

---

## 7. 文档维护

- 新增技术栈：追加到 §1 或 §2
- 重大踩坑：追加到 §4
- 官方 breaking change：更新对应章节
- 每季度检查链接可用性

---

## 附录 A：完整下载脚本

```bash
# 创建 references 目录
mkdir -p docs/references

# 核心 4 份
curl -L "https://www.electronjs.org/docs/latest/tutorial/security" \
  -o "docs/references/electron-security.html"
curl -L "https://sdk.vercel.ai/docs" \
  -o "docs/references/vercel-ai-sdk.html"
curl -L "https://docs.anthropic.com/en/api/agent-sdk/overview" \
  -o "docs/references/claude-agent-sdk.html"
curl -L "https://react.dev/learn" \
  -o "docs/references/react-learn.html"

# 扩展 6 份
curl -L "https://ant.design/docs/react/getting-started" \
  -o "docs/references/antd-getting-started.html"
curl -L "https://tailwindcss.com/docs/installation" \
  -o "docs/references/tailwind-v4-install.html"
curl -L "https://playwright.dev/docs/intro" \
  -o "docs/references/playwright-intro.html"
curl -L "https://mastra.ai/docs" \
  -o "docs/references/mastra-docs.html"
curl -L "https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md" \
  -o "docs/references/better-sqlite3-api.html"
curl -L "https://www.electron.build/configuration/configuration" \
  -o "docs/references/electron-builder.html"

echo "Downloaded 10 reference docs to docs/references/"
```

## 附录 B：版本记录

- v1.0（2026-07-22）：初版，10 份核心文档 + 踩坑清单 + 安全清单
