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

## LRN-20260721-006 · electron-builder 打包失败：VS Build Tools 缺 Windows SDK

| 字段 | 内容 |
|------|------|
| 发现时间 | 2026-07-21 21:55 |
| 严重级别 | P1（影响 Phase 5.5 打包验证，不阻塞应用运行） |
| 发现阶段 | Phase 5 · Task 5.5 打包验证 |
| 关联 Task | Task 5.5 / Task 0.1（LRN-001 同源） |

### 问题描述

在 `tdsf-linux-desktop/` 执行 `npx electron-builder --win` 生成 Windows NSIS 安装包时失败：

- `electron-builder` 启动原生模块重编译（`better-sqlite3@12.11.1` / `tree-sitter-bash@0.25.1`）
- `prebuild-install` 提示 `No prebuilt binaries found (target=43.1.1 runtime=electron arch=x64)`
- 回退到 `node-gyp rebuild --release` 时失败
- 错误堆栈：`gyp ERR! find VS - missing any Windows SDK`

### 根因分析

- 用户机器预装了 VS2022 BuildTools 部分：找到 `Visual Studio C++ core features` + `VC++ toolset: v143`
- **缺失关键组件**：Windows SDK（任意版本）
- `node-gyp` 要求 VS 安装包含「使用 C++ 的桌面开发」工作负载（含 Windows SDK），而当前安装仅为最小 C++ 核心组件
- `better-sqlite3@12.11.1` 没有为 `electron@43.1.1` 预编译 win32-x64 二进制，强制走源码编译路径

### 当前处理（不阻塞 Phase 5）

- `pnpm dev` 开发模式正常（prebuilt binary 仍可用）
- `pnpm typecheck:node` / `pnpm typecheck:web` / `pnpm lint` 全部 exit 0
- `pnpm build`（electron-vite build）成功，生成 `out/main` / `out/preload` / `out/renderer` 产物
- 仅 `electron-builder --win` 失败（打包阶段）

### 根治方案（用户醒后执行）

1. 打开「Visual Studio Installer」
2. 修改 VS2022 BuildTools 安装
3. 勾选工作负载「使用 C++ 的桌面开发」（Desktop development with C++）
4. 右侧「安装详细信息」中确保至少勾选一个「Windows 10 SDK」或「Windows 11 SDK」
5. 安装完成后重启终端，运行 `pnpm rebuild` 验证原生模块编译
6. 重新执行 `pnpm build:win` 生成 `release/TDSF-Linux Desktop Setup *.exe`

### 防护建议

- `package.json` 添加 `"postinstall": "electron-builder install-app-deps"` 自动匹配原生模块
- README.md Windows 开发环境前置中加入「VS Build Tools + Windows SDK」必装项
- 在 CI 流水线使用 `windows-2022` GitHub runner（预装完整 VS 工具链）
- `scripts/check-env.cjs` 增加 `node-gyp` 环境自检（检测 VS + Windows SDK 完整性）
- 验证安装包大小 ≤ 400MB（R17 预算）的检查需在打包成功后才能执行

---

## LRN-20260721-007 · spec 文档与代码进度同步脱节

| 字段 | 内容 |
|------|------|
| 发现时间 | 2026-07-21 |
| 严重级别 | P2（影响多 agent 协作效率，不影响代码功能） |
| 发现阶段 | Phase 7 · 归档五件套（Task 7.6） |
| 关联 Task | Phase 7.6 / 全 spec 周期 |

### 问题描述

执行 Phase 7.6 归档时发现，`.trae/specs/build-runnable-tdsf-from-design/` 下的 `tasks.md` / `checklist.md` 与实际 `git log` 严重脱节：

- tasks.md 中 Phase 6.4/6.5 标记为未完成，但 `git log` 显示已有提交
- 多个 Phase 3/4/5 的 Task 在 spec 文档中状态滞后于实际代码
- 归档 agent 必须额外花时间交叉验证「spec 声称的状态」与「git log 真实状态」

### 根因分析

- spec 文档位于 `.trae/specs/` 目录，**该目录在仓库外**（项目根在 `tdsf-linux-desktop/`，spec 在 `d:/ai/linux教学一体/.trae/specs/`），无法被 git 跟踪
- 每个 Task 完成后没有立即更新 spec 文档勾选状态，而是依赖最后阶段批量回顾
- 多个 subagent 串行执行时，前一个 agent 完成的任务状态未及时同步到 spec，后一个 agent 启动时仍按「未完成」假设工作

### 修复方案

**每个 Task 完成后立即更新 spec 文档勾选状态**，不要等到最后批量更新。具体：

1. Task 完成的 commit 中，commit message 包含 `Refs: Task X.Y` 便于反查
2. commit 后立即编辑 `tasks.md` 勾选对应条目
3. 在 `PROGRESS.md` 中追加该 Task 的 commit hash
4. 如果 spec 文档因外部目录无法 git 跟踪，至少在 `LEARNINGS.md` 或 `loop-progress.md` 中留下「已完成 Task 清单」便于下一个 agent 读取

### 防护建议

- 在 spec 文档顶部加「最后更新时间 + 已完成 Task 列表」摘要块
- subagent 启动协议中加入「先读 PROGRESS.md / loop-progress.md 验证当前进度」步骤
- 考虑将 spec 文档软链接到仓库内（如 `tdsf-linux-desktop/.spec/`）使其可被 git 跟踪

---

## LRN-20260721-008 · 并行 subagent 之间的工作区污染

| 字段 | 内容 |
|------|------|
| 发现时间 | 2026-07-21 |
| 严重级别 | P1（影响 subagent 决策正确性） |
| 发现阶段 | Phase 3.2 / Phase 7.6 验证 |
| 关联 Task | Phase 3.2 / 全 spec 多 Task |

### 问题描述

Phase 3.2 subagent 在执行报告中声称「Phase 6.4 / 6.5 已完成」，但实际当时 Phase 6 尚未开始。归档阶段交叉验证 `git log` 后确认 Phase 6.4/6.5 的提交是后续其他 agent 的工作，Phase 3.2 agent 误判的原因是工作区中存在其他 agent 的残留文件状态。

### 根因分析

- 多个 subagent 共享同一工作区（`tdsf-linux-desktop/`），文件系统状态可能交叉
- subagent 启动时未先 `git status` 检查工作区清洁度
- subagent 报告中混淆了「我完成的工作」与「工作区中已存在的工作」
- 部分文件（如 `.ai-coordination.json`、未提交的修改）可能被多个 agent 读写

### 修复方案

**subagent 启动前先 `git status` 检查工作区**，避免误判。具体协议：

1. subagent 启动第一步：`git status` + `git log -5` 验证当前工作区状态
2. 如发现非本 session 的未提交修改，先报告父 agent，不擅自处理
3. subagent 完成工作后，commit message 必须明确列出本 session 实际修改的文件
4. 报告中区分「本 session 完成」与「工作区中已存在」两类工作

### 防护建议

- 在 `subagent-driven-development` skill 中加入「启动前 git status 自检」硬约束
- subagent 报告模板增加「工作区初始状态」字段
- 考虑为每个 subagent 分配独立的 git worktree（`git worktree add`），物理隔离工作区
- 父 agent dispatch 时传入「预期工作区清洁」标志，subagent 检测到污染时立即中止

---

## LRN-20260721-009 · IPC 通道集中化的最佳实践（先扩展常量 → 再批量替换 → 验证）

| 字段 | 内容 |
|------|------|
| 发现时间 | 2026-07-21 夜间 |
| 严重级别 | P3（经验沉淀） |
| 发现阶段 | polish-tdsf-p1-issues Phase A · IPC 通道集中化 |
| 关联 Task | Phase A（commit ff37091） |

### 现象

执行 Phase A IPC 通道集中化时，初次尝试同时修改常量定义和字面量引用，导致 typecheck:node / typecheck:web 同时大量报错，难以定位是常量定义错误还是引用错误。

### 根因

IPC 通道字面量分布在 main / preload / renderer 三层共 12 个文件，无单一事实源。一次性大改时：
1. 常量定义遗漏（如 `LOOP_*` 通道漏写 `as const`）导致类型推断为 string 而非字面量联合
2. 引用替换与定义扩展未对齐时，typecheck 错误信息难以追溯到根因
3. 渲染层 `window.electronAPI.xxx` 的字面量在 preload 暴露层和 d.ts 类型层需同步更新

### 方案（最佳实践）

**三阶段渐进式集中化**：

1. **阶段 1 · 扩展常量**（仅改 `src/shared/ipc-channels.ts`）
   - 列出所有 19 个域（agent / credibility / sandbox / at-commands / claude-sdk / token / mode / attention / subagent / provider / sidecar / diagnostics / loop / scheduler / ssh / llm / monitor / knowledge / log 等）
   - 每域用 `as const` 标注，确保字面量类型推断
   - 验证 `typecheck:node` 通过（常量文件先单独验证）

2. **阶段 2 · 批量替换**（按层替换 main → preload → renderer）
   - main 层替换 `ipcMain.handle('xxx', ...)` → `ipcMain.handle(IPC_CHANNELS.DOMAIN.XXX, ...)`
   - preload 层替换 `ipcRenderer.invoke('xxx', ...)` → `ipcRenderer.invoke(IPC_CHANNELS.DOMAIN.XXX, ...)`
   - renderer 层替换 `window.electronAPI.xxx` 字面量（如有）
   - 每层替换后单独 typecheck，定位错误

3. **阶段 3 · 全量验证**（typecheck:node + typecheck:web + lint + 冒烟测试）
   - 71 个通道常量必须 100% 覆盖原有字面量（grep 验证 0 残留）
   - 冒烟测试保证 IPC 调用链路未断裂

### 防护建议

- CLAUDE.md A 红线新增：「所有新增 IPC 通道必须定义在 `src/shared/ipc-channels.ts` 中，禁止在代码中使用字面量字符串」
- pre-commit hook 加入 grep 检测：`ipcMain.handle\(['"][a-z]+:` 应匹配 `IPC_CHANNELS.`
- ESLint 自定义规则禁止 `ipcRenderer.invoke('xxx:yyy')` 字面量调用

---

## LRN-20260721-010 · 大文件拆分的依赖分析（先识别类型/工具/逻辑边界 → 抽出后跑测试验证接口兼容）

| 字段 | 内容 |
|------|------|
| 发现时间 | 2026-07-21 夜间 |
| 严重级别 | P3（经验沉淀） |
| 发现阶段 | polish-tdsf-p1-issues Phase B · 大文件拆分 |
| 关联 Task | Phase B（commit ca0228e） |

### 现象

Phase B 拆分 `credibility.ts`（597 行 → 445 行）和 `sandbox.ts`（715 行 → 392 行）时，初次按"长度切分"失败：
- 抽出的 helper 函数引用了主文件的内部类型，导致循环 import
- 主文件 import 抽出模块后，部分类型推断变成 `any`（缺少类型导出）
- 抽出后单测失败：mock 路径未同步调整

### 根因

大文件拆分的边界不是"行数"而是"职责"。三类边界需识别：
1. **类型边界**：interface / type 定义应放在哪一层？helpers 共享的类型 vs 主文件独占的类型
2. **工具边界**：纯函数 helper（无副作用，可独立测试）vs 主流程函数（有状态依赖）
3. **逻辑边界**：单一职责原则——approval/config/execution 应各自独立，而非混杂在主流程

### 方案（最佳实践）

**四步依赖分析法**：

1. **第 1 步 · 识别类型边界**
   - Grep `^export (interface|type)` 列出所有类型
   - 标注每个类型的"消费方"：仅主文件用 / 仅 helper 用 / 两者都用
   - "两者都用"的类型移到 `xxx-helpers.ts` 或 `xxx-types.ts`（共享层）

2. **第 2 步 · 识别工具边界**
   - Grep `^function |^async function ` 列出所有函数
   - 标注每个函数的"副作用"：纯函数 / 调用 IPC / 调用 DB / 调用 electron API
   - 纯函数移到 `xxx-helpers.ts`，有副作用的留在主文件

3. **第 3 步 · 识别逻辑边界**
   - 按功能聚合：approval（审批）/ config（配置）/ execution（执行）应分开
   - 例如 sandbox.ts 拆分为 sandbox.ts + sandbox-approval.ts + sandbox-config.ts
   - 主文件保留 orchestrator 角色，调用各子模块

4. **第 4 步 · 抽出 + 测试验证**
   - 一次只抽一个文件，抽出后立即 `pnpm typecheck:node` + `pnpm typecheck:web`
   - 同步调整测试 mock 路径（`jest.mock('./credibility')` → `jest.mock('./credibility-helpers')`）
   - 跑全量冒烟测试验证接口兼容

### 防护建议

- 单文件 ≤ 500 行硬约束（CLAUDE.md A2）应在 pre-commit hook 加入行数检查
- 抽出 helper 文件命名约定：`<原文件名>-helpers.ts` / `<原文件名>-<职责>.ts`
- 类型共享层命名约定：`<原文件名>-types.ts`（如类型多到需要独立文件）
- 拆分后主文件应保留"orchestrator"角色，不应再包含具体业务逻辑

---

## LRN-20260721-011 · redact 工具的正则陷阱（.env 路径误匹配纯文本 → 要求前缀盘符/路径分隔符）

| 字段 | 内容 |
|------|------|
| 发现时间 | 2026-07-21 夜间 |
| 严重级别 | P1（脱敏工具误判可能泄露或过度脱敏） |
| 发现阶段 | polish-tdsf-p1-issues Phase C · 错误脱敏 |
| 关联 Task | Phase C（commit 1fd3ee0） |

### 现象

`redact.ts` 初版正则 `/.env/g` 在脱敏日志时，把日志中的纯文本 "production.env"、"development.env" 也匹配了，导致脱敏后日志可读性极差（大量 `[REDACTED]` 出现在非敏感文本中）。

### 根因

正则 `/.env/g` 缺少边界约束：
1. 文件路径中的 `.env`（如 `~/.env`、`C:\Users\xxx\.env`）应被脱敏
2. 但单词内的 `.env`（如 `production.environment`、`node_env`、`process.env`）不应被脱敏
3. 初版未区分"路径分隔符前的 .env"与"单词字符前的 .env"

### 方案（正则改进）

要求 `.env` 前必须是「盘符前缀」或「路径分隔符」，避免误匹配纯文本：

```typescript
// 错误：会误匹配 production.env / development.env
const ENV_FILE_PATTERN = /\.env/g

// 正确：要求前面是路径分隔符或字符串起始
const ENV_FILE_PATTERN = /(?:^|[\\/\\])\.env(?:[\\/\\]|$|\b)/g
```

`redact.ts` 最终实现 8 类正则规则：
1. **API Key / Token**：`(api[_-]?key|token|secret)['"\s:=]+['"]?[A-Za-z0-9_-]{20,}`
2. **密码**：`(password|passwd|pwd)['"\s:=]+['"]?[^\s'"]{6,}`
3. **私钥**：`-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END.*PRIVATE KEY-----`
4. **JWT**：`eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}`
5. **IPv4**：`\b(\d{1,3}\.){3}\d{1,3}\b`（仅当不在 IP 白名单中时脱敏）
6. **邮箱**：`[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}`
7. **手机号**：`\b1[3-9]\d{9}\b`
8. **.env 文件路径**：`(?:^|[\\/\\])\.env(?:[\\/\\]|$|\b)`

### 防护建议

- 所有脱敏正则必须有「边界约束」：`^` / `$` / `\b` / 字符类 `[\\/\s]` 等
- 脱敏工具必须有「白名单」机制：已知安全的 IP / 邮箱 / 关键词不脱敏
- 单元测试必须覆盖「正例」（应脱敏）+「反例」（不应脱敏）两类
- 脱敏后日志必须保留可读性，不应出现 `... [REDACTED] [REDACTED] [REDACTED]` 连续脱敏

---

## LRN-20260721-012 · SSH 预检查的 blocked 事件架构（独立事件类型 vs 复用 step 事件的 tradeoff）

| 字段 | 内容 |
|------|------|
| 发现时间 | 2026-07-21 夜间 |
| 严重级别 | P2（架构设计决策） |
| 发现阶段 | polish-tdsf-p1-issues Phase D · SSH 预检查 |
| 关联 Task | Phase D（commit 3c393a5） |

### 现象

Phase D 实现 SSH 预检查时，需在 `doExecute` 前检查 SSH 连接状态。如果未连接，应推事件让 UI 显示"BlockedCard"。设计决策有两种方案：

- **方案 A**：独立事件 `loop:blocked`，payload 含 `{ reason, suggestion }`
- **方案 B**：复用 `loop:step` 事件，新增 `step: 'blocked'` 状态

### 根因（架构 tradeoff）

**方案 A（独立事件）优势**：
- UI 监听 `loop:blocked` 时立即渲染 BlockedCard，无需在 step handler 中分支
- 事件类型清晰，便于日志分析和监控
- 未来可扩展多个 blocked 原因（SSH 未连接 / 权限不足 / 资源不足）

**方案 A 劣势**：
- 渲染层需新增订阅 `loop:blocked`，多一个事件监听器
- 事件流被拆分：`step → blocked → step → done` 而非 `step(blocked) → step(running) → done`

**方案 B（复用 step）优势**：
- 渲染层只订阅 `loop:step`，handler 内分支处理 `step === 'blocked'`
- 事件流连贯，StepProgress 组件可统一渲染所有步骤状态

**方案 B 劣势**：
- StepProgress 组件的 step 类型联合扩展，需处理 'blocked' 额外状态
- blocked 不属于 7 步 HITL 流程，强行塞入 step 会破坏状态机清晰度

### 方案（最终选择 A）

选择**方案 A：独立事件 `loop:blocked`**。原因：
1. **关注点分离**：blocked 是"前置失败"，与 HITL 7 步流程是正交关系，不应混入 step 状态机
2. **UI 渲染清晰**：BlockedCard 是独立组件，与 StepProgress 并列渲染，而非 StepProgress 的一个状态
3. **可扩展性**：未来如增加"权限不足 blocked"、"资源不足 blocked"，只需扩展 blocked payload，不影响 step 状态机

实现：
- `loop-engineering-subagent.ts` 在 `doExecute` 前调用 `SshConnectionManager.hasActiveConnection()`
- 未连接时 `emit('loop:blocked', { reason: 'no-ssh-connection', suggestion: '请先在 SSH 设置中连接服务器' })`
- 不抛错，不中断 workflow（用户可解决后重试）
- 渲染层 `useLoopEngineering` 新增 `onLoopBlockedChange` 订阅，`LoopWorkflowPanel` 渲染 `<BlockedCard />`

### 防护建议

- 事件设计原则：「正交关注点用独立事件，线性流程用同一事件的 step 状态」
- 事件 payload 应含 `{ reason: string, suggestion: string, retryable: boolean }` 三字段，便于 UI 通用化
- 渲染层订阅独立事件时，必须在 useEffect cleanup 中正确取消订阅，避免内存泄漏
- 独立事件不应与现有事件形成隐式时序依赖（如 `blocked` 后必须 `step`，这种隐式约定应避免）

---

## LRN-20260721-013 · lint warnings 修复策略（unknown + 类型守卫 vs Record<string, unknown> vs 具体 SDK 类型）

| 字段 | 内容 |
|------|------|
| 发现时间 | 2026-07-21 夜间 |
| 严重级别 | P3（lint 修复策略） |
| 发现阶段 | polish-tdsf-p1-issues Phase G · lint warnings 修复 |
| 关联 Task | Phase G（commit 2d3e348） |

### 现象

Phase G 修复 3 处 `no-explicit-any` warnings 时，发现不同场景需用不同策略：

1. `client-manager.ts:170` — `catch (error: any)` 后访问 `error.message`
2. `client-manager.ts:381` — 函数参数 `metadata: any` 传给 SDK
3. `langfuse.ts:138` — SDK 返回值 `result: any` 直接解构

### 根因

`any` 类型的三种使用场景，对应三种修复策略：

| 场景 | 类型来源 | 修复策略 |
|------|----------|----------|
| `catch (error: any)` | JS 标准 catch 子句默认 any | `unknown` + 类型守卫 |
| 函数参数传给 SDK | SDK 类型缺失或不完整 | `Record<string, unknown>` |
| SDK 返回值解构 | SDK 类型推断失败 | 引入具体 SDK 类型 |

### 方案（三种修复策略）

**策略 1 · `unknown` + 类型守卫**（适用于 catch 子句）

```typescript
// 错误：
catch (error: any) {
  console.error(error.message)
}

// 正确：
catch (error: unknown) {
  if (error instanceof Error) {
    console.error(error.message)
  } else {
    console.error(String(error))
  }
}
```

适用场景：`catch (error)` 子句、JSON.parse 失败、外部回调错误。类型守卫必须覆盖所有分支，避免后续 `error` 仍为 unknown。

**策略 2 · `Record<string, unknown>`**（适用于传给 SDK 的元数据）

```typescript
// 错误：
function logEvent(name: string, metadata: any) {
  sdk.track(name, metadata)
}

// 正确：
function logEvent(name: string, metadata: Record<string, unknown>) {
  sdk.track(name, metadata as Record<string, unknown> as SDKMetadata)
}
```

适用场景：SDK 接受 `Record<string, unknown>` 但 d.ts 声明为 any 时。注意：仍需 `as` 断言，但比 `any` 更安全——调用方必须显式构造对象，不能传函数引用。

**策略 3 · 具体 SDK 类型**（适用于 SDK 返回值解构）

```typescript
// 错误：
const result: any = await sdk.fetch()
const { id, name } = result

// 正确（如有 SDK 类型）：
import type { SDKResponse } from 'sdk'
const result: SDKResponse = await sdk.fetch()
const { id, name } = result

// 正确（如 SDK 无类型，本地声明）：
interface LocalSDKResponse { id: string; name: string }
const result = (await sdk.fetch()) as LocalSDKResponse
const { id, name } = result
```

适用场景：SDK 返回 any 但实际有稳定结构时。优先用 SDK 自带类型，其次本地声明 interface，最后才用 `as` 断言。

### 防护建议

- `catch (error)` 子句一律用 `unknown` + 类型守卫，禁止 `catch (error: any)`（CLAUDE.md A 红线候选）
- 函数参数禁止 `any`，必须用 `Record<string, unknown>` 或具体 interface
- SDK 调用优先 `import type` 引入 SDK 类型，避免本地重复声明
- 如 SDK 类型不完整，向 SDK 仓库提交 PR 补全类型，而非用 `as any` 绕过
- pre-commit hook 加入 `eslint --max-warnings=0` 阻止新 any 进入仓库

---

*LEARNINGS 文档结束 · 持续更新中*
