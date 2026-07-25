# 接手 AI 提示词 v2（基于接手 AI 进度更新）

> 生成时间：2026-07-25
> 当前分支：`feat/p0-type-declarations`（HEAD: `29aad7b`）
> 编译门禁：✅ typecheck:node + typecheck:web 全过
> 复制下方 `---` 之间的内容发给新接手 AI 即可。

---

## 项目背景

你是 TDSF Linux Desktop 项目的接手 AI（第二任）。这是一个 Electron + React 18 + TypeScript + Vite 的桌面应用，核心功能是 SSH 终端 + AI 辅助 + 高危命令拦截 + 日志分析，用于 Linux 教学辅助。比赛交付冲刺中（截止 2026-07-30）。

**前一任接手 AI 已完成 UI 重构 + P0-2 类型声明补齐**，但仍有 2 个 P0 项未完成。你的任务是接续完成剩余 P0 项 + 处理未提交变更 + 视比赛需要决定 P0-4 是否做。

## 工作目录

```
d:\ai\linux教学一体\tdsf-linux-desktop
```

## 起步流程（5 分钟）

```bash
cd d:/ai/linux教学一体/tdsf-linux-desktop

# 1. 查看当前状态
git status
git log --oneline -10

# 2. 确认编译门禁三绿
pnpm typecheck:node
pnpm typecheck:web
pnpm lint

# 3. 必读文档（按顺序）
# 必读 1：前一任 AI 写的前端交付说明（项目根目录，未追踪）
cat 前端交付说明.md
# 必读 2：后端交接总说明（统一入口）
cat docs/handoff/HANDOVER.md
# 必读 3：P0 项实测状态（注意：部分项已被前一任 AI 修复，需对照本文档第 4 节）
cat docs/handoff/frontend-integration-verification.md
# 必读 4：IPC 4 步同步审计（类型声明修复清单）
cat docs/handoff/ipc-4step-sync-audit.md
```

## 当前项目状态（截至 2026-07-25）

### 已完成项（前一任 AI 交付）

| 项 | 状态 | 提交 | 说明 |
|----|------|------|------|
| 前端 UI 重构（设计稿 1:1 对齐） | ✅ | e7a3d15 / 44f26f7 / 1ae9df3 | 14 文件全局对齐 + 6 项视觉修复 + 三面板基线 |
| 死代码清理 | ✅ | a104e71 | 3850+ 行清理 |
| ModelSettings exportModelStats BUG 修复（原 P0-1） | ✅ | ce1b953 | preload 暴露名 `exportModelStats`（非 `appExportModelStats`） |
| ElectronAPI 类型声明补齐（原 P0-2） | ✅ | 29aad7b | 校准 6 + backfill 4 = 10 个方法类型已声明 |
| SettingsLayout 6 项导航对齐设计稿 | ✅ | 88317af | 通用/SSH/AI引擎/告警阈值/外观/关于 |
| BootPage 进度条对接真实加载阶段 | ✅ | 14debeb | boot:loading-stage IPC 4 步同步 |
| DecisionSettings 6 源权重 | ✅ | e5b09df | credibilityAssess 联动 |
| TutorialPage RAG 混合检索 | ✅ | a15e511 | 分类数量展示 |
| TutorialDetailPage 沙箱审批 UI | ✅ | 24c5e18 | onSandboxApprovalRequest + sandboxApprove |
| 编译门禁三绿 | ✅ | — | typecheck:node + typecheck:web + lint 全过 |

### 未提交变更（需处理）

工作树有 4 个未提交文件（前一任 AI 的 in-progress 工作）：

```
modified:   src/preload/index.ts                              # v2.5 backfill 4 通道暴露（含中文注释 GBK 乱码）
modified:   src/renderer/src/components/workbench/AIPanel.css  # 视觉调整
modified:   src/renderer/src/components/workbench/Workbench.css # 视觉调整
modified:   src/renderer/src/styles/workbench-density.css     # 视觉调整
Untracked:  前端交付说明.md                                     # 前一任 AI 写的交付文档
```

**⚠️ 风险**：`src/preload/index.ts` 的中文注释出现 GBK 乱码（如 `锛堝紓姝ュ洖濉...`），是 PowerShell GBK 编码导致。需要修复为 UTF-8 中文或改为英文注释后再提交。

**处理建议**：
1. 先 `git diff src/preload/index.ts` 查看乱码位置
2. 用 Edit 工具将乱码注释修复为可读中文（或英文）
3. 验证 `pnpm typecheck:node` 仍通过
4. 单独提交：`fix(preload): 修复 backfill 4 通道中文注释乱码`
5. 3 个 CSS 文件视觉调整可合并提交：`style(workbench): 视觉微调`
6. `前端交付说明.md` 移动到 `docs/handoff/` 目录并提交

## 仍待办 P0 项（你的核心任务）

### P0-1：接入 v2.5 异步 backfill 4 通道（~2h，比赛演示核心场景）

**问题**：前端 `src/renderer/src/hooks/useHybridSearch.ts:335` 仍用旧版同步 `tutorialBackfillEmbeddings`，2578 条教程首次回填会阻塞 UI 1-3 分钟。

**后端 + preload 已就绪**（4 步同步完整）：
- 通道：`TUTORIAL.BACKFILL_START` / `BACKFILL_CANCEL` / `BACKFILL_STATUS` / `BACKFILL_PROGRESS`
- preload 已暴露：`tutorialBackfillStart` / `tutorialBackfillCancel` / `tutorialBackfillStatus` / `onTutorialBackfillProgress`
- 类型已声明：见 `src/renderer/src/types/electron.d.ts:1284/1292/1298/1305`

**实施步骤**：
1. 在 `useHybridSearch.ts` 的 `backfill` 回调中（第 322-371 行），用 `tutorialBackfillStart({ pageSize: 100, inferenceBatch: 8 })` 替换 `tutorialBackfillEmbeddings()`
2. 紧接着订阅 `onTutorialBackfillProgress(p => setProgress(...))`，将 `p.pct` / `p.eta` / `p.processed` / `p.total` / `p.failed` 写入 progress state（需扩展 `BackfillProgress` 类型以匹配新载荷）
3. 在 `TutorialPage` 添加"取消回填"按钮调用 `tutorialBackfillCancel()`
4. 页面挂载时调用 `tutorialBackfillStatus()` 恢复 UI 状态（如已有运行中任务则显示进度）
5. 注意：旧版 `BackfillProgress` 类型是 `{ phase, current, total, errorMessage? }`，新版是 `{ taskId, processed, total, failed, pct, currentBatch, eta, status }`，需要适配或并存

**进度推送频率**：2578 条 / 100 页 = 26 次推送，频率合理。

**验证**：
- 首次回填时 UI 不阻塞，进度条 0-100% 平滑推进
- 取消按钮可中断回填
- 刷新页面后能恢复显示运行中任务

### P0-3：接入 PAOR 启动入口（~1h，审批链已通）

**问题**：`src/renderer/src/components/workbench/AIPanel.tsx` 第 85-100 行已订阅 `onPaorApprovalRequest` + 调用 `paorApprove`（审批响应链已通），但**没有 `agentPaor` 启动调用**，PAOR 自动循环无法主动启动。

**后端已就绪**：
- 通道：`AGENT.PAOR` / `PAOR.APPROVE` / `PAOR.APPROVAL_REQUEST`（push）
- preload 已暴露：`agentPaor` / `paorApprove` / `onPaorApprovalRequest`
- 类型已声明：`electron.d.ts:835` `agentPaor(task: string, sshSessionId: string, maxIterations?: number): Promise<unknown>`

**实施步骤**：
1. 在 `AIPanel.tsx` 增加"PAOR 自动循环"按钮（建议放在发送按钮旁，或作为 Composer 的辅助操作）
2. 点击后调用 `window.electronAPI.agentPaor(task, sshSessionId, maxIterations?)` 启动
   - `task`：用户输入的运维任务描述
   - `sshSessionId`：从 `useServerStore((s) => s.activeSessionId)` 获取
   - `maxIterations`：可选，默认由后端决定
3. 订阅 `onPaorApprovalRequest` 已就绪（AIPanel.tsx:88），收到请求时弹出已有的 `PaorApprovalCard`
4. 用户批准/拒绝后调用 `paorApprove(callId, approved)` 已就绪（AIPanel.tsx:98）

**验证**：触发 PAOR 后遇到高危命令时弹窗，用户批准后继续执行，拒绝后停止循环。

### P0-4：CalibrationSettings 组件（可选，~3h）

**状态**：前一任 AI 在 `前端交付说明.md` 第 123 行明确表示"ECE 校准跳过"（Demo 阶段简化）。

**后端已就绪**（如需启用）：
- 主进程 `credibility.ts:296/326/345/364/388/411` 已注册 6 个 handler
- preload 已暴露 6 个方法
- 类型已声明

**决策建议**：
- 若比赛演示不涉及校准 → 跳过（与前一任 AI 决策一致）
- 若比赛演示需要展示可信度校准 → 新建 `src/renderer/src/pages/CalibrationSettings.tsx` + 在 `SettingsLayout.tsx` 添加"校准"导航项
- UI 包含：校准状态卡片 / 触发校准按钮 / ECE 值显示 / 重置按钮 / 校准样本列表
- 测试调用：`credibilityComputeEce('deepseek', 10)` 返回 ECE 值

## P1 项（建议接入，提升功能完整度）

详见 `docs/handoff/HANDOVER.md` 第 4 节 P1 清单（13 项），包括：
- Claude Agent SDK 6 通道
- Subagent 管理
- 外部 MCP 服务器
- 诊断服务
- 沙箱容器生命周期
- Sidecar 高级能力
- Provider 能力 + 定价
- 合规审计报告（如 P0-4 跳过，此项也可跳过）
- 知识库 CRUD 完整链
- historySave 决策卡片入库
- fsUploadImage 图片附件
- 内联补全取消 + Diff 应用
- SSH 心跳事件

## 工作流约束（必读）

### 红线

1. **不碰 `src/main/`**：后端已冻结（211 IPC handler 全部真实业务逻辑），如需修改请先在 PR 描述中说明
2. **IPC 4 步同步铁律**：通道常量（`src/shared/ipc-channels.ts`）→ handler 注册（`src/main/ipc/`）→ preload 暴露（`src/preload/index.ts`）→ 类型声明（`src/renderer/src/types/electron.d.ts`），缺一不可
3. **编译门禁五绿**：每个 PR 必须通过 `pnpm typecheck:node && pnpm typecheck:web && pnpm lint && pnpm test`，里程碑时跑 `pnpm build:win`
4. **不假设工作区干净**：动工前先 `git status` 确认
5. **不降质减配**：不允许为节省开发效率/资源/体积而跳步或降级方案
6. **PowerShell 编码警告**：写中文注释时务必用 Edit 工具，避免 PowerShell `git commit` 导致 GBK 乱码

### 开发规范

- **CSS 颜色系统**：必须用 `var(--color-*)` 或 `var(--trae-*)`，禁止 `#ffffff` / `#fafafa` / `#0071e3` 等硬编码
- **品牌色**：`#387BFF`（科技蓝），暗色基底 `#1A1B1D`，次级背景 `#222427`，卡片背景 `#2A2D31`
- **字体**：SF Pro Text + Microsoft YaHei + JetBrains Mono 三栈
- **暗色模式**：默认开启
- **卡片 hover**：仅允许阴影变化，禁止同时变 border + 位移 + scale
- **输入框**：border 聚焦变蓝，无 glow
- **IDE 编辑器**：必须用 `@monaco-editor/react`，不用 CodeMirror
- **远程路径作为唯一 ID**：同时用于 Tree key 和 Tab key
- **工作台布局**：48px ActivityRail + 40px TitleBar + 200px FileTree + flex EditorArea + 560px AIPanel + 24px StatusBar，三面板标题栏统一 40px

### commit message 规范

```
feat(frontend): P0-1 接入 v2.5 异步 backfill 4 通道
feat(frontend): P0-3 接入 PAOR 启动入口
fix(preload): 修复 backfill 4 通道中文注释乱码
style(workbench): 视觉微调
docs(handoff): 归档前端交付说明
```

### 分支策略

- 当前分支 `feat/p0-type-declarations` 可继续用，或新建：
- `feat/p0-backfill-integration` — P0-1
- `feat/p0-paor-entry` — P0-3
- `chore/handoff-cleanup` — 处理未提交变更

## 验证清单（每个 P0 项完成后）

- [ ] `pnpm typecheck:web` exit 0（无新类型错误）
- [ ] `pnpm lint` exit 0（无新 lint 错误）
- [ ] `pnpm test` 全绿（无回归）
- [ ] 手动验证：在 Electron 环境下实际触发功能，确认无运行时错误
- [ ] 更新 `docs/handoff/frontend-integration-verification.md` 中对应 P0 项状态为 ✅

## 重要文档参考

| 文档 | 路径 | 用途 |
|------|------|------|
| **前端交付说明** ⭐ | `前端交付说明.md`（根目录，未追踪） | 前一任 AI 写的完整前端文档（代码规模/路由/设计系统/状态管理/Agent 对接） |
| 统一入口 | `docs/handoff/HANDOVER.md` | TOP 5 关键发现 + P0-P3 行动清单 |
| IPC 契约 | `docs/handoff/ipc-contract.md` | 36 域 / 211 handler / 全量参数与返回值 |
| 前后端职责边界 | `docs/handoff/frontend-backend-boundary.md` | 共享层契约 + v2.4/v2.5 新增能力清单 |
| 核心数据流 | `docs/handoff/data-flow.md` | 7 条数据流时序图 |
| 后端完成度审计 | `docs/handoff/backend-completion-audit.md` | 211 handler + 15 services + 30+ core 模块 |
| 前端待接入清单 | `docs/handoff/frontend-integration-checklist.md` | 231 调用 + 75 孤儿 API |
| IPC 4 步同步审计 | `docs/handoff/ipc-4step-sync-audit.md` | 4 步同步缺失项 + 类型声明修复清单 |
| 前端集成验证 | `docs/handoff/frontend-integration-verification.md` | P0 项实测状态（部分已过时，需对照本文档） |
| 编译门禁验证 | `docs/handoff/build-gate-verification.md` | 四绿实测报告 |
| v2.5 方案书 | `docs/v2.5-loop-engineering-plan.md` | v2.5 Phase C/D/E 任务清单 |
| 项目根 CLAUDE.md | `../../CLAUDE.md` | 工作区入口 + CodeGraph 使用指引 |

## CodeGraph 图谱（动工前先查）

```bash
# 找符号定义（替代 grep + Read 链）
codegraph query <SymbolName>          # 例：query useHybridSearch / query AIPanel

# 改函数前看影响范围
codegraph impact <SymbolName> --depth 2

# 追踪调用链
codegraph trace <Entry> <Target>      # 例：trace AIPanel agentPaor

# 看谁调用它 / 它调用了谁
codegraph callers <SymbolName>
codegraph callees <SymbolName>
```

图谱规模：542 files / 7,193 nodes / 20,567 edges（Electron 桌面端）

## 起步指令

请按以下顺序执行：

1. **处理未提交变更**（优先，避免后续冲突）
   - `git status` 确认 4 个未提交文件
   - 修复 `src/preload/index.ts` 中文注释乱码（用 Edit 工具逐行修复为可读中文）
   - 验证 `pnpm typecheck:node` 仍通过
   - 提交：`fix(preload): 修复 backfill 4 通道中文注释乱码`
   - 3 个 CSS 文件单独提交：`style(workbench): 视觉微调`
   - `前端交付说明.md` 移动到 `docs/handoff/前端交付说明.md` 并提交

2. **读必读文档**
   - `前端交付说明.md`（前一任 AI 的完整交付说明）
   - `docs/handoff/HANDOVER.md`（后端交接总说明）
   - `docs/handoff/ipc-4step-sync-audit.md`（类型声明修复清单）

3. **从 P0-1 开始**（v2.5 backfill 接入，比赛演示核心场景）
   - 改 `src/renderer/src/hooks/useHybridSearch.ts:322-371` 的 `backfill` 回调
   - 用新版 4 通道替换旧版同步调用
   - 验证：首次回填时 UI 不阻塞，进度条 0-100% 平滑推进

4. **做 P0-3**（PAOR 启动入口，~1h）
   - 在 `AIPanel.tsx` 增加"PAOR 自动循环"按钮
   - 调用 `agentPaor(task, sshSessionId, maxIterations?)` 启动
   - 验证：触发 PAOR 后遇到高危命令时弹窗

5. **P0-4 视比赛需要决定**
   - 若比赛演示不涉及校准 → 跳过（与前一任 AI 决策一致）
   - 若需要 → 新建 `CalibrationSettings.tsx` + 添加导航项

6. **所有 P0 完成后**
   - 跑 `pnpm build:win` 完成第五绿门禁
   - 更新 `docs/handoff/frontend-integration-verification.md` 状态

**重要提示**：
- 动工前先 `git status` 确认工作区状态
- 不碰 `src/main/`，仅改 `src/renderer/` + 必要时 `src/preload/index.ts`
- 遇到文档与代码不一致时，以代码为准，并更新文档
- 中文注释务必用 Edit 工具写，避免 PowerShell `git commit` 导致 GBK 乱码
- 如有疑问，对照 `前端交付说明.md` 了解前端架构，或对照 `ipc-contract.md` 核对通道细节

---

## 复制说明

上方 `---` 之间的内容即为接手 AI 提示词 v2，可直接复制粘贴发给新接手 AI。

**与 v1 的差异**：
- v1 假设 P0-1/P0-2/P0-3/P0-4 都未做
- v2 基于**前一任 AI 实际进度**：P0-2 已完成、P0-1 部分完成（类型声明已补齐但前端未接入）、P0-3 审批链已通但启动入口缺失、P0-4 明确跳过

**使用建议**：
1. 将整段提示词作为新接手 AI 的第一条用户消息
2. 新接手 AI 完成每个 P0 项后，要求其更新 `docs/handoff/frontend-integration-verification.md` 状态
3. 所有 P0 项完成后，要求新接手 AI 跑一次 `pnpm build:win` 完成第五绿门禁

**预计工作量**：
- 处理未提交变更：~30min（含乱码修复）
- P0-1 backfill 接入：~2h
- P0-3 PAOR 启动入口：~1h
- P0-4 CalibrationSettings（可选）：~3h
- 合计：~3.5h（不含 P0-4）/ ~6.5h（含 P0-4）

**关键提醒**：
- 前一任 AI 已完成 UI 重构 + 类型声明补齐，**不要重做**
- 重点在 P0-1（backfill 前端接入）和 P0-3（PAOR 启动入口）
- 未提交变更有中文乱码，**必须先处理再开工**
