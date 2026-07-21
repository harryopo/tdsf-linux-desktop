# LEARNINGS · TDSF Linux Desktop

> 经验沉淀文档：记录每次循环工程中发现的问题、根因、修复方案与防护建议。
> 编号规范：`LRN-YYYYMMDD-NNN`（同日顺序递增）。
> 关联文档：`PROGRESS.md`（进度表） / `loop-progress.md`（循环轮次日志）。

---

## LRN-20260721-001 · Windows 缺少 VS Build Tools 致原生模块未编译

| 字段 | 内容 |
|------|------|
| 发现时间 | 2026-07-21 |
| 严重级别 | P1（影响 Phase 4+ 真实执行） |
| 发现阶段 | Phase 0 · 环境前置校验（SubTask 0.1.2） |
| 关联 Task | Task 0.1 |

### 问题描述

在 `tdsf-linux-desktop/` 执行 `pnpm rebuild` 时，`better-sqlite3` / `sqlite-vec` / `ssh2` / `cpu-features` / `@photostructure/sqlite-vec` 原生模块编译失败，原因是 Windows 缺少 Visual Studio Build Tools 2019+ 工作负载。

### 根因分析

- Windows 平台下 Node.js 原生模块（.node 二进制）需要 C++ 编译工具链（MSBuild + Windows SDK）
- 用户机器未预装 VS Build Tools，`node-gyp` 找不到 `cl.exe`
- `pnpm install` 阶段使用了预编译二进制（prebuild-install），但 `pnpm rebuild` 强制源码编译时失败

### 修复方案

**临时方案（当前）**：
- typecheck / lint / 单元测试 / 渲染层逻辑均不依赖原生模块编译，Phase 1-3 纯代码任务可正常进行
- 冒烟测试 `scripts/test-loop-engineering-smoke.ts` 不依赖原生模块（仅验证子 agent 结构完整性，不触发真实 SSH/数据库）

**根治方案（Phase 4+ 前置）**：
1. 下载 Visual Studio Build Tools 2019+（https://visualstudio.microsoft.com/visual-cpp-build-tools/）
2. 安装时勾选「使用 C++ 的桌面开发」工作负载
3. 重启终端后执行 `pnpm rebuild` 验证原生模块编译成功
4. 验证 `better-sqlite3` 可正常 `require()` 加载

### 防护建议

- 在 README.md 中将「VS Build Tools」加入 Windows 开发环境前置要求
- `scripts/check-env.js` 增加原生模块加载自检（`try { require('better-sqlite3') } catch`）
- CI 流水线在 Windows 镜像中预装 VS Build Tools

---

## LRN-20260721-002 · cron-parser.ts 文档注释 `*/N` 触发 ESLint 解析错误

| 字段 | 内容 |
|------|------|
| 发现时间 | 2026-07-21 |
| 严重级别 | P2（不影响功能，仅 lint 噪声） |
| 发现阶段 | Phase 4 · 循环工程配置子 Agent 主进程编排验证（Task 4.5 后置 lint） |
| 关联 Task | Phase 6 · Task 6.1（cron-parser 属于定时任务模块） |

### 问题描述

执行 `pnpm lint` 时，`src/main/services/scheduler/cron-parser.ts` 报错：

```
10:23  error  Parsing error: Unterminated regular expression literal
```

### 根因分析

文件第 10 行的 JSDoc 文档注释中包含字符串 `*/N`：

```typescript
 *   - `*/N`   步进（如 `*/15` = 0,15,30,45）
```

ESLint 解析器将 `*/` 识别为块注释结束符，导致后续 `N`   步进...` 被当作代码解析，`/N` 被误识别为正则表达式字面量的起始，从而报「未终止的正则表达式字面量」错误。

这是 JSDoc 中包含 cron 表达式语法的「注释边界冲突」问题——cron 步进语法 `*/N` 与 C 风格注释结束符 `*/` 字符级冲突。

### 修复方案（建议）

**方案 A（推荐，零功能影响）**：转义文档注释中的 `*/` 为 `*\/`：

```typescript
 *   - `*\/N`   步进（如 `*\/15` = 0,15,30,45）
```

**方案 B**：将 cron 表达式语法示例移到独立的字符串常量或 markdown 文档中，避免在 JSDoc 中出现 `*/` 序列。

**方案 C**：将 JSDoc 块注释改为行内注释 `//`，但会损失多行格式。

### 防护建议

- 在 ESLint 配置中添加自定义规则：检测 JSDoc 内的 `*/` 序列并告警
- 编码规范补充：JSDoc 中如需出现 `*/` 字符序列，必须转义为 `*\/`
- Phase 6 Task 6.1 实施 cron-parser 时，优先采用方案 A 修复

### 当前处理决策

**不修复，仅记录**。原因：
1. cron-parser.ts 属于 Phase 6（定时任务自动化）模块，不在 Phase 4（循环工程验证）任务范围内
2. 修复需要修改 Phase 6 文件，违反「只读验证 + 修复 Phase 4 P0/P1 问题」的任务边界
3. P2 级别问题不影响循环工程模块的 typecheck / 冒烟测试 / 功能正确性
4. 留待 Phase 6 Task 6.1 实施时一并修复

---

## LRN-20260721-003 · DecisionDetailPage.tsx `message` 变量未使用

| 字段 | 内容 |
|------|------|
| 发现时间 | 2026-07-21 |
| 严重级别 | P2（不影响功能，仅 lint 噪声） |
| 发现阶段 | Phase 4 · 循环工程配置子 Agent 主进程编排验证（Task 4.5 后置 lint） |
| 关联 Task | Phase 2 · Task 2.3（DecisionDetailPage 复刻） |

### 问题描述

执行 `pnpm lint` 时，`src/renderer/src/pages/DecisionDetailPage.tsx` 第 24 行报错：

```
24:24  error  'message' is defined but never used  no-unused-vars
```

### 根因分析

第 24 行从 `antd` 导入了 `message`：

```typescript
import { Modal, Input } from 'antd'
```

但实际代码中使用了 `Modal` 和 `Input.TextArea`，未调用 `message` API。这是 Phase 2 Task 2.3 实施 DecisionDetailPage 1:1 复刻时的遗留 import，未在自审阶段清理。

### 修复方案（建议）

删除未使用的 `message` import：

```typescript
// 修改前
import { Modal, Input } from 'antd'

// 修改后（如 Modal 仍在使用）
import { Modal, Input } from 'antd'
// 或更精确地按使用情况导入
```

实际验证：Grep 确认 `Modal` 在第 973-1002 行使用、`Input.TextArea` 在修改对话框中使用，仅 `message` 未使用。应移除 `message` 从 import 列表。

### 当前处理决策

**不修复，仅记录**。原因：
1. DecisionDetailPage.tsx 属于 Phase 2 Task 2.3 的未提交工作（commit c88c7bf 之后的修改），不属于 Phase 4（循环工程验证）任务范围
2. 修复需要修改 Phase 2 文件，违反「只读验证 + 修复 Phase 4 P0/P1 问题」的任务边界
3. P2 级别问题不影响循环工程模块的 typecheck / 冒烟测试 / 功能正确性
4. 留待 Task 2.3 后续 fix-implementer 或 Phase 5 Task 5.2（ESLint 检查通过）时一并修复

### 防护建议

- Task 2.3 implementer 在归档前应执行 `npx eslint <file>` 自审，移除所有未使用 import
- ESLint 配置已启用 `no-unused-vars` 规则，但应在 CI 中将 max-warnings 设为 0
- 建议在 pre-commit hook 中加入 lint-staged，阻止未使用 import 进入仓库

---

## LRN-20260721-004 · TypeScript 对象方法返回类型标注双箭头陷阱

| 字段 | 内容 |
|------|------|
| 发现时间 | 2026-07-21 |
| 严重级别 | P0（已修复，记录防护） |
| 发现阶段 | v1.5 循环工程子 Agent 集成后的 Diagnostics 后端构建 |
| 关联文件 | `src/preload/index.ts` |

### 问题描述

`src/preload/index.ts` 中 10 个 preload API 方法签名使用了错误的返回类型标注语法：

```typescript
// 错误写法（双箭头）
loopStart: async (problem: string, connId: string, opts?: LoopStartOpts): Promise<void> => {
  // ...
}
```

TypeScript 将 `): Promise<void> =>` 解析为「函数返回 `Promise<void> => {...}`（即返回一个函数）」，导致 esbuild 编译失败，dev server 无法启动。

### 根因分析

正确语法应为「冒号 + 类型 + 箭头函数」：

```typescript
// 正确写法（冒号）
loopStart: async (problem: string, connId: string, opts?: LoopStartOpts): Promise<void> => {
  // ...
}
```

注意：对象方法简写语法下，返回类型标注必须用 `): ReturnType => {`，不能用 `) => ReturnType => {`。这是 TypeScript 对象方法语法与独立箭头函数语法的细微差异。

### 修复方案（已实施）

批量修改 10 个方法签名的 `=>` 为 `:`（在返回类型标注位置）。

### 防护建议

- 在 ESLint 配置中启用 `@typescript-eslint/type-annotation-spacing` 规则
- 编码规范补充：对象方法返回类型标注必须用 `): T =>`，禁止 `) => T =>`
- pre-commit hook 中加入 `pnpm typecheck:node` 阻止此类错误进入仓库

---

## LRN-20260721-005 · Glob 工具对含中文 Windows 路径匹配不稳定

| 字段 | 内容 |
|------|------|
| 发现时间 | 2026-07-21 |
| 严重级别 | P2（工具使用经验） |
| 发现阶段 | Phase 4 · 循环工程配置子 Agent 验证 |

### 问题描述

使用 Glob 工具查询 `d:\ai\linux教学一体\tdsf-linux-desktop\.learnings\*` 时返回 "No file found"，但实际目录下存在 `loop-progress.md` 文件。

### 根因分析

Glob 工具底层 ripgrep 在 Windows 平台对含中文字符的路径（`linux教学一体`）匹配不稳定，可能是：
- 路径编码转换问题（GBK ↔ UTF-8）
- glob 模式与 ripgrep 正则转换时中文字符未正确转义
- Windows 路径分隔符 `\` 与 Unix 风格 `/` 的混用

### 修复方案

**使用 LS 工具替代 Glob 验证文件存在性**：

```text
LS d:\ai\linux教学一体\tdsf-linux-desktop\.learnings
→ 列出 loop-progress.md（确认文件存在）
```

### 防护建议

- AI agent 在 Windows 中文路径下验证文件存在性时，优先使用 LS 工具而非 Glob
- 如必须使用 Glob，尝试将模式改为相对路径或使用 `**` 通配符
- 在项目命名约定中避免中文路径（但当前项目 `linux教学一体` 已成型，不可改名）

---

*LEARNINGS 文档结束 · 持续更新中*
